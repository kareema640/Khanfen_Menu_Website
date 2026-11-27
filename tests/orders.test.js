'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');

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
  await query(`DELETE FROM payments WHERE order_id IN (SELECT id FROM orders WHERE customer_email='integration@example.com' AND customer_name='Integration Test')`);
  await query(`DELETE FROM orders WHERE customer_email='integration@example.com' AND customer_name='Integration Test'`);
  await query(`DELETE FROM reservations WHERE customer_email='reservation@example.com' AND customer_name='Reservation Test'`);
  await query(`DELETE FROM reviews WHERE idempotency_key LIKE 'customer-review:review-test-%'`);
  await query(`DELETE FROM users WHERE email LIKE '%@integration.test'`);
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

test('seeded KHANFEM10 promotion is validated and calculated by the server', async () => {
  const { response, data } = await postOrder(orderBody({ promoCode:'KHANFEM10' }), uniqueKey());
  assert.equal(response.status, 201);
  assert.equal(data.order.promoCode, 'KHANFEM10');
  assert.equal(data.order.discount, Math.round(data.order.subtotal * 0.1 * 100) / 100);
  assert.equal(data.order.total, data.order.subtotal - data.order.discount + data.order.fee);
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

async function createAccount(role) {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const email = `${role}-${suffix}@integration.test`;
  const password = 'Integration-Only-Password-26!';
  const hash = await bcrypt.hash(password, 4);
  const inserted = await query(`INSERT INTO users(full_name,email,password_hash,role) VALUES($1,$2,$3,$4) RETURNING id`, [`Test ${role}`, email, hash, role]);
  return { id: inserted.rows[0].id, email, password };
}

async function loginAccount(account) {
  const response = await fetch(`${baseUrl}/auth/login`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({email:account.email,password:account.password}) });
  assert.equal(response.status, 200);
  const cookie = response.headers.get('set-cookie')?.split(';', 1)[0];
  assert.ok(cookie, 'login should issue a session cookie');
  return { cookie, request: (path, options = {}) => fetch(`${baseUrl}${path}`, { ...options, headers:{...(options.headers || {}), Cookie:cookie} }) };
}

test('authenticated customer receives 403 for owner-only management APIs', async () => {
  const customer = await createAccount('customer');
  const session = await loginAccount(customer);
  const response = await session.request('/admin/orders');
  assert.equal(response.status, 403);
});

test('customers can read and unread only their own notifications; guests use the tracking capability', async () => {
  const customer = await createAccount('customer');
  const session = await loginAccount(customer);
  const placed = await session.request('/orders', {method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':uniqueKey()},body:JSON.stringify(orderBody())});
  assert.equal(placed.status, 201);
  const order = await placed.json();
  const list = await session.request('/notifications');
  assert.equal(list.status, 200);
  const notification = (await list.json()).notifications.find(item => item.type === 'order_placed');
  assert.ok(notification);
  const guest = await fetch(`${baseUrl}/orders/${order.order.orderNumber}/notifications?token=${encodeURIComponent(order.trackingToken)}`);
  assert.equal(guest.status, 200);
  assert.ok((await guest.json()).notifications.some(item => item.id === notification.id));
  const mark = (isRead) => session.request(`/notifications/${notification.id}/read`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({isRead})});
  const read = await mark(true);
  assert.ok((await read.json()).notification.readAt);
  const unread = await mark(false);
  assert.equal((await unread.json()).notification.readAt, null);
  const other = await loginAccount(await createAccount('customer'));
  const forbidden = await other.request(`/notifications/${notification.id}/read`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({isRead:false})});
  assert.equal(forbidden.status, 404);
  const invalidToken = await fetch(`${baseUrl}/orders/${order.order.orderNumber}/notifications?token=invalid`);
  assert.equal(invalidToken.status, 404);
});

test('owner status update persists history and deduplicates status notifications', async () => {
  const owner = await createAccount('admin');
  const session = await loginAccount(owner);
  const placed = await postOrder(orderBody(), uniqueKey());
  assert.equal(placed.response.status, 201);
  const orderNumber = placed.data.order.orderNumber;
  const update = () => session.request(`/admin/orders/${encodeURIComponent(orderNumber)}/status`, {method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({status:'confirmed',note:'Integration status test'})});
  const first = await update();
  assert.equal(first.status, 200);
  const repeated = await update();
  assert.equal(repeated.status, 409, 'same transition must not be applied a second time');
  const stored = await query(`SELECT o.order_status,(SELECT count(*)::int FROM order_status_history h WHERE h.order_id=o.id) AS history_count,(SELECT h.previous_status FROM order_status_history h WHERE h.order_id=o.id AND h.new_status='confirmed') AS previous_status,(SELECT h.new_status FROM order_status_history h WHERE h.order_id=o.id AND h.new_status='confirmed') AS new_status,(SELECT h.changed_by FROM order_status_history h WHERE h.order_id=o.id AND h.new_status='confirmed') AS changed_by,(SELECT h.note FROM order_status_history h WHERE h.order_id=o.id AND h.new_status='confirmed') AS note,(SELECT count(*)::int FROM notifications n WHERE n.order_id=o.id AND n.event_key='status:confirmed') AS notification_count FROM orders o WHERE o.order_number=$1`, [orderNumber]);
  assert.equal(stored.rowCount, 1);
  assert.equal(stored.rows[0].order_status, 'confirmed');
  assert.equal(stored.rows[0].history_count, 2, 'creation and status transition each have one history event');
  assert.equal(stored.rows[0].previous_status, 'pending');
  assert.equal(stored.rows[0].new_status, 'confirmed');
  assert.equal(stored.rows[0].changed_by, owner.id);
  assert.equal(stored.rows[0].note, 'Integration status test');
  assert.equal(stored.rows[0].notification_count, 1);
  const guestNotifications = await fetch(`${baseUrl}/orders/${orderNumber}/notifications?token=${encodeURIComponent(placed.data.trackingToken)}`);
  assert.equal(guestNotifications.status, 200);
  assert.ok((await guestNotifications.json()).notifications.some(item => item.type === 'order_status' && item.title === 'Order confirmed'));
  const payment = await session.request(`/admin/orders/${encodeURIComponent(orderNumber)}/payment`, {method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({status:'paid'})});
  assert.equal(payment.status, 200);
  const paidReport = await query(`SELECT d.paid_orders,d.paid_revenue FROM reporting_daily_sales d WHERE d.day=(SELECT created_at::date FROM orders WHERE order_number=$1)`, [orderNumber]);
  assert.equal(Number(paidReport.rows[0].paid_orders) >= 1, true);
  assert.equal(Number(paidReport.rows[0].paid_revenue) >= Number(placed.data.order.total), true);
  const detail = await session.request(`/admin/orders/${encodeURIComponent(orderNumber)}`);
  assert.equal(detail.status, 200);
  assert.equal((await detail.json()).order.history.length, 2);
  const reports = await session.request('/admin/reports');
  assert.equal(reports.status, 200);
  const reportData = await reports.json();
  assert.match(reportData.revenueDefinition, /paid, non-demo/i);
  assert.ok(Array.isArray(reportData.daily) && Array.isArray(reportData.weekly) && Array.isArray(reportData.monthly));
  const invalidRange = await session.request('/admin/reports?from=not-a-date');
  assert.equal(invalidRange.status, 400);
});

test('reservation creation persists in PostgreSQL and enforces slot capacity', async () => {
  await query(`DELETE FROM reservations WHERE customer_email='reservation@example.com' AND customer_name='Reservation Test'`);
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
  await query(`DELETE FROM reservations WHERE customer_email='reservation@example.com' AND customer_name='Reservation Test'`);
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
  const owner = await loginAccount(await createAccount('admin'));
  const moderation = await owner.request(`/admin/reviews/${review.id}/moderation`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({status:'approved'})});
  assert.equal(moderation.status, 200);
  const shown = await fetch(`${baseUrl}/reviews`);
  const publicData = await shown.json();
  assert.equal(publicData.reviews.some(item => item.id === review.id), true);
  assert.ok(publicData.stats.count >= 1);
  const rejectedBody = {...body,clientRequestId:`review-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,review:'A separate pending review for moderation.'};
  const rejectedResponse = await fetch(`${baseUrl}/reviews`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(rejectedBody)});
  assert.equal(rejectedResponse.status,201);
  const rejectedReview = (await rejectedResponse.json()).review;
  const reject = await owner.request(`/admin/reviews/${rejectedReview.id}/moderation`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({status:'rejected'})});
  assert.equal(reject.status,200);
  const publicAfterReject = await fetch(`${baseUrl}/reviews`);
  assert.equal((await publicAfterReject.json()).reviews.some(item => item.id === rejectedReview.id),false);
});
