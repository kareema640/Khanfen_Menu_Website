'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

if (!process.env.TEST_DATABASE_URL) {
  throw new Error('Set TEST_DATABASE_URL to a dedicated disposable PostgreSQL test database. Never point it at production.');
}
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.SESSION_SECRET ||= 'integration-tests-only-session-secret-32-bytes';
process.env.APP_ORIGIN ||= 'http://127.0.0.1';
const app = require('../src/app');
const { query, closePool } = require('../src/db/pool');
let server;
let baseUrl;
let catalog;
before(async () => {
  server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}/api`;
  const response = await fetch(`${baseUrl}/catalog`);
  assert.equal(response.status, 200);
  catalog = await response.json();
});
after(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
  await closePool();
});
const goodProduct = () => catalog.products.find(item => item.available);
const orderBody = (overrides = {}) => ({
  items: [{ id: goodProduct().id, qty: 2, size: 'Regular', addons: [] }],
  fulfillment: 'delivery', fullName: 'Integration Test', phone: '01000000000',
  email: 'integration@example.com', address: 'Test Street 123', instructions: '',
  pickupTime: '', paymentMethod: 'cash-delivery', promoCode: '', ...overrides
});
const uniqueKey = () => `integration-${Date.now()}-${Math.random().toString(36).slice(2)}`;
async function postOrder(body, key) {
  const response = await fetch(`${baseUrl}/orders`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key },
    body: JSON.stringify(body)
  });
  return { response, data: await response.json() };
}

test('catalog and categories are returned from the seeded database', () => {
  assert.ok(catalog.products.length >= 56);
  assert.ok(catalog.categories.some(item => item.id === 'sandwiches'));
  assert.equal(catalog.products.find(item => item.id === goodProduct().id).price, goodProduct().price);
});

test('valid checkout persists database-priced order/item snapshots and retrieves by tracking token', async () => {
  const product = goodProduct();
  const { response, data } = await postOrder(orderBody(), uniqueKey());
  assert.equal(response.status, 201);
  assert.ok(data.order.orderNumber);
  assert.ok(data.trackingToken);
  assert.equal(data.order.items[0].unitPrice, product.price);
  assert.equal(data.order.subtotal, Math.round(product.price * 2 * 100) / 100);
  assert.equal(data.order.total, data.order.subtotal + data.order.fee - data.order.discount);
  const stored = await query(`SELECT o.order_status,o.payment_status,o.subtotal,o.delivery_fee,o.total_amount,oi.product_category_snapshot,oi.product_name_snapshot,oi.quantity,oi.unit_price,oi.line_total FROM orders o JOIN order_items oi ON oi.order_id=o.id WHERE o.order_number=$1`, [data.order.orderNumber]);
  assert.equal(stored.rowCount, 1);
  assert.equal(stored.rows[0].product_category_snapshot, product.category);
  assert.equal(stored.rows[0].product_name_snapshot, product.name);
  assert.equal(Number(stored.rows[0].unit_price), product.price);
  assert.equal(Number(stored.rows[0].quantity), 2);
  assert.equal(stored.rows[0].order_status, 'pending');
  assert.equal(stored.rows[0].payment_status, 'pending');
  const lookup = await fetch(`${baseUrl}/orders/${data.order.orderNumber}?token=${encodeURIComponent(data.trackingToken)}`);
  assert.equal(lookup.status, 200);
  assert.equal((await lookup.json()).order.orderStatus, 'pending');
  const invalidToken = await fetch(`${baseUrl}/orders/${data.order.orderNumber}?token=invalid`);
  assert.equal(invalidToken.status, 404);
});

test('idempotent retry returns the same order and capability token', async () => {
  const body = orderBody({ fulfillment: 'pickup', address: '', pickupTime: 'ASAP · 15 min', paymentMethod: 'cash-pickup' });
  const key = uniqueKey();
  const first = await postOrder(body, key);
  const second = await postOrder(body, key);
  assert.equal(first.response.status, 201);
  assert.equal(second.response.status, 201);
  assert.equal(second.data.order.orderNumber, first.data.order.orderNumber);
  assert.equal(second.data.trackingToken, first.data.trackingToken);
  const count = await query(`SELECT count(*)::int AS n FROM orders WHERE order_number=$1`, [first.data.order.orderNumber]);
  assert.equal(count.rows[0].n, 1);
});

test('invalid product and invalid quantity requests are rejected without partial orders', async () => {
  for (const [body, key] of [
    [orderBody({ items: [{ id: 'unknown-product', qty: 1, size: 'Regular', addons: [] }] }), uniqueKey()],
    [orderBody({ items: [{ id: goodProduct().id, qty: 0, size: 'Regular', addons: [] }] }), uniqueKey()]
  ]) {
    const before = await query('SELECT count(*)::int AS n FROM orders');
    const result = await postOrder(body, key);
    assert.ok(result.response.status >= 400 && result.response.status < 500);
    const after = await query('SELECT count(*)::int AS n FROM orders');
    assert.equal(after.rows[0].n, before.rows[0].n);
  }
});

test('unsupported payment methods and missing idempotency keys fail closed', async () => {
  const card = await postOrder(orderBody({ paymentMethod: 'card' }), uniqueKey());
  assert.equal(card.response.status, 400);
  const noKey = await postOrder(orderBody(), '');
  assert.equal(noKey.response.status, 400);
});

test('reusing an idempotency key for different order details conflicts', async () => {
  const key = uniqueKey();
  const first = await postOrder(orderBody(), key);
  assert.equal(first.response.status, 201);
  const changed = await postOrder(orderBody({ items: [{ id: goodProduct().id, qty: 1, size: 'Regular', addons: [] }] }), key);
  assert.equal(changed.response.status, 409);
});

test('failed payment persistence rolls back the order, items, and idempotency record', async () => {
  const key = uniqueKey();
  await query(`CREATE OR REPLACE FUNCTION test_fail_payment_insert() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected test failure'; END $$`);
  await query(`CREATE TRIGGER test_fail_payment_insert BEFORE INSERT ON payments FOR EACH ROW EXECUTE FUNCTION test_fail_payment_insert()`);
  try {
    const before = await query('SELECT count(*)::int AS n FROM orders');
    const result = await postOrder(orderBody(), key);
    assert.equal(result.response.status, 500);
    const after = await query('SELECT count(*)::int AS n FROM orders');
    const idempotency = await query('SELECT count(*)::int AS n FROM idempotency_keys WHERE idempotency_key=$1', [key]);
    assert.equal(after.rows[0].n, before.rows[0].n);
    assert.equal(idempotency.rows[0].n, 0);
  } finally {
    await query('DROP TRIGGER IF EXISTS test_fail_payment_insert ON payments');
    await query('DROP FUNCTION IF EXISTS test_fail_payment_insert()');
  }
});

test('owner-only management routes reject unauthenticated requests', async () => {
  const response = await fetch(`${baseUrl}/admin/orders`);
  assert.equal(response.status, 401);
});

test('reservation creation persists in PostgreSQL and enforces slot capacity', async () => {
  const date = new Date(Date.now() + 6 * 86400000).toISOString().slice(0, 10);
  const availabilityResponse = await fetch(`${baseUrl}/reservations/availability?date=${date}`);
  assert.equal(availabilityResponse.status, 200);
  const availability = await availabilityResponse.json();
  const time = availability.slots.find(slot => !availability.unavailableSlots.includes(slot));
  assert.ok(time, 'test date should have at least one available reservation slot');
  const reservationBody = { guests: '2', date, time, fullName: 'Reservation Test', phone: '01000000000', email: 'reservation@example.com', specialRequests: 'Integration test', occasion: '', preOrder: [] };
  const post = async () => fetch(`${baseUrl}/reservations`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(reservationBody) });
  const first = await post();
  assert.equal(first.status, 201);
  const firstData = await first.json();
  const second = await post();
  assert.equal(second.status, 201);
  const third = await post();
  assert.equal(third.status, 409);
  const stored = await query('SELECT status,party_size FROM reservations WHERE reservation_number=$1', [firstData.reservation.reservationNumber]);
  assert.equal(stored.rowCount, 1);
  assert.equal(stored.rows[0].status, 'pending');
  assert.equal(stored.rows[0].party_size, 2);
});

test('reviews persist pending, remain private until approved, and then appear publicly', async () => {
  const clientRequestId = `review-test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const body = { name: 'Review Test', email: 'review@example.com', rating: 5, review: 'A freshly prepared meal with excellent service.', clientRequestId };
  const submit = () => fetch(`${baseUrl}/reviews`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const first = await submit();
  assert.equal(first.status, 201);
  const review = (await first.json()).review;
  assert.equal(review.status, 'pending');
  const duplicate = await submit();
  assert.equal(duplicate.status, 200);
  assert.equal((await duplicate.json()).review.id, review.id);
  const hidden = await fetch(`${baseUrl}/reviews`);
  assert.equal(hidden.status, 200);
  assert.equal((await hidden.json()).reviews.some(item => item.id === review.id), false);
  await query(`UPDATE reviews SET moderation_status='approved' WHERE id=$1`, [review.id]);
  const shown = await fetch(`${baseUrl}/reviews`);
  const publicData = await shown.json();
  assert.equal(publicData.reviews.some(item => item.id === review.id), true);
  assert.ok(publicData.stats.count >= 1);
});
