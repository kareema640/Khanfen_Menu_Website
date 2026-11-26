const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const vm = require('vm');

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use(express.json({ limit: '8mb' }));
app.use(express.static(__dirname));
app.use(express.static(path.join(__dirname, 'public')));

/* ---------- Persistent Reviews Storage ---------- */
const DATA_DIR = path.join(__dirname, 'data');
const REVIEWS_FILE = path.join(DATA_DIR, 'reviews.json');
const REVIEW_UPLOADS_DIR = path.join(__dirname, 'uploads', 'reviews');
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

const INITIAL_REVIEWS = [
  {
    id: 'rev-mariam',
    name: 'Mariam Samy',
    rating: 5,
    review: "My new favorite breakfast spot! Loved the food, the atmosphere, and every little detail. Can't wait to come back!",
    photoUrl: null,
    createdAt: '2026-11-15T11:15:00.000Z'
  },
  {
    id: 'rev-noha',
    name: 'Noha Sherief',
    rating: 5,
    review: 'Such a cozy place! The coffee is great, the desserts are irresistible, and everything tastes freshly made',
    photoUrl: null,
    createdAt: '2026-11-12T10:30:00.000Z'
  },
  {
    id: 'rev-kareema',
    name: 'Kareema Esmaiel',
    rating: 5,
    review: 'The breakfast sandwiches are absolutely amazing! Fresh, delicious, and honestly the perfect way to start my day.',
    photoUrl: null,
    createdAt: '2026-11-10T09:00:00.000Z'
  }
];

function ensureReviewStorage() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(REVIEW_UPLOADS_DIR, { recursive: true });
  if (!fs.existsSync(REVIEWS_FILE)) {
    fs.writeFileSync(REVIEWS_FILE, JSON.stringify(INITIAL_REVIEWS, null, 2), 'utf8');
  }
}

function readReviews() {
  ensureReviewStorage();
  try {
    const raw = fs.readFileSync(REVIEWS_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    }
  } catch {}
  return [...INITIAL_REVIEWS];
}

function writeReviews(list) {
  ensureReviewStorage();
  fs.writeFileSync(REVIEWS_FILE, JSON.stringify(list, null, 2), 'utf8');
}

function toPublicReview(r) {
  return {
    id: r.id,
    name: r.name,
    rating: r.rating,
    review: r.review,
    photoUrl: r.photoUrl || null,
    createdAt: r.createdAt
  };
}

const handledReviewRequests = new Map();

app.get('/api/reviews', (req, res) => {
  try {
    const reviews = readReviews().map(toPublicReview);
    return res.json({ reviews });
  } catch {
    return res.status(500).json({ error: 'Unable to load reviews.' });
  }
});

app.post('/api/reviews', (req, res) => {
  const {
    name,
    email = '',
    rating,
    review,
    photoDataUrl = '',
    clientRequestId = ''
  } = req.body || {};

  const reqKey = String(clientRequestId || '').trim();
  if (reqKey && handledReviewRequests.has(reqKey)) {
    return res.status(201).json({ review: handledReviewRequests.get(reqKey) });
  }

  const cleanName = String(name || '').trim();
  const cleanEmail = String(email || '').trim();
  const numRating = Number(rating);
  const cleanReview = String(review || '').trim();

  if (!cleanName) {
    return res.status(400).json({ error: 'Please tell us your name so we can say thanks.' });
  }
  if (cleanEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
    return res.status(400).json({ error: "That email doesn't look quite right." });
  }
  if (!Number.isInteger(numRating) || numRating < 1 || numRating > 5) {
    return res.status(400).json({ error: 'Please choose a star rating between 1 and 5.' });
  }
  if (cleanReview.length < 20) {
    return res.status(400).json({ error: 'Please add at least 20 characters to your review.' });
  }
  if (cleanReview.length > 500) {
    return res.status(400).json({ error: 'Review must be 500 characters or fewer.' });
  }

  let photoUrl = null;
  if (photoDataUrl) {
    const match = /^data:(image\/(?:jpeg|png));base64,([A-Za-z0-9+/=]+)$/.exec(String(photoDataUrl));
    if (!match) {
      return res.status(400).json({ error: 'Uploaded images must be JPG or PNG.' });
    }
    const mime = match[1];
    const buffer = Buffer.from(match[2], 'base64');
    if (buffer.length > MAX_PHOTO_BYTES) {
      return res.status(400).json({ error: 'Uploaded image must be no larger than 5 MB.' });
    }
    ensureReviewStorage();
    const ext = mime === 'image/png' ? 'png' : 'jpg';
    const fileName = `rev-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.${ext}`;
    fs.writeFileSync(path.join(REVIEW_UPLOADS_DIR, fileName), buffer);
    photoUrl = `/uploads/reviews/${fileName}`;
  }

  const record = {
    id: `rev-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`,
    name: cleanName.slice(0, 80),
    email: cleanEmail,
    rating: numRating,
    review: cleanReview,
    photoUrl,
    createdAt: new Date().toISOString()
  };

  try {
    const list = readReviews();
    list.unshift(record);
    writeReviews(list);
    const pub = toPublicReview(record);
    if (reqKey) handledReviewRequests.set(reqKey, pub);
    return res.status(201).json({ review: pub });
  } catch {
    return res.status(500).json({ error: 'Could not save your review. Please try again.' });
  }
});

/* ---------- Table Reservations API ---------- */
const TIME_SLOTS = [
  '8:00', '8:30', '9:00', '9:30',
  '10:00', '10:30', '11:00', '11:30', '12:00'
];
const BASE_UNAVAILABLE = new Set(['12:00']);
const SLOT_CAPACITY = 2;

const reservations = [];
const usedCodes = new Set();

function generateReservationCode() {
  let code;
  do {
    const num = Math.floor(10000 + Math.random() * 90000);
    code = `KF-${num}`;
  } while (usedCodes.has(code));
  usedCodes.add(code);
  return code;
}

function getUnavailableSlots(date) {
  const counts = {};
  for (const r of reservations) {
    if (r.date === date) {
      counts[r.time] = (counts[r.time] || 0) + 1;
    }
  }
  return TIME_SLOTS.filter(
    slot => BASE_UNAVAILABLE.has(slot) || (counts[slot] || 0) >= SLOT_CAPACITY
  );
}

app.get('/api/reservations/availability', (req, res) => {
  const date = String(req.query.date || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: 'Valid date (YYYY-MM-DD) is required.' });
  }
  const unavailableSlots = getUnavailableSlots(date);
  return res.json({ date, slots: TIME_SLOTS, unavailableSlots });
});

app.post('/api/reservations', (req, res) => {
  const {
    guests,
    date,
    time,
    fullName,
    phone,
    email,
    specialRequests = '',
    occasion = ''
  } = req.body || {};

  const validGuests = ['1', '2', '3', '4', '5', '6', '7', '8+'];
  if (!validGuests.includes(String(guests))) {
    return res.status(400).json({ error: 'Please select a valid number of guests.' });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ''))) {
    return res.status(400).json({ error: 'Please select a valid reservation date.' });
  }
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  if (String(date) < yesterday) {
    return res.status(400).json({ error: 'Reservation date cannot be in the past.' });
  }
  if (!TIME_SLOTS.includes(String(time))) {
    return res.status(400).json({ error: 'Please select a valid time slot.' });
  }
  const unavailable = getUnavailableSlots(String(date));
  if (unavailable.includes(String(time))) {
    return res.status(409).json({ error: 'This time slot is no longer available. Please choose another time.' });
  }

  const cleanName = String(fullName || '').trim();
  const cleanPhone = String(phone || '').trim();
  const cleanEmail = String(email || '').trim();

  if (cleanName.length < 2) {
    return res.status(400).json({ error: 'Please enter your full name.' });
  }
  if (cleanPhone.replace(/\D/g, '').length < 7) {
    return res.status(400).json({ error: 'Please enter a valid phone number.' });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
    return res.status(400).json({ error: 'Please enter a valid email address.' });
  }

  const rawPreOrder = Array.isArray(req.body && req.body.preOrder) ? req.body.preOrder : [];
  const catalog = loadCatalogMap();
  const preOrder = [];
  let preOrderTotal = 0;
  for (const entry of rawPreOrder) {
    const id = String(entry && entry.id ? entry.id : '').trim();
    const qty = Math.floor(Number(entry && entry.qty));
    const product = catalog[id];
    if (!product || !Number.isInteger(qty) || qty < 1 || qty > 50) {
      return res.status(400).json({ error: 'Invalid pre-ordered menu item.' });
    }
    const lineTotal = product.price * qty;
    preOrderTotal += lineTotal;
    preOrder.push({
      id: product.id,
      name: product.name,
      unitPrice: product.price,
      qty,
      lineTotal
    });
  }

  const record = {
    reservationNumber: generateReservationCode(),
    guests: String(guests),
    date: String(date),
    time: String(time),
    fullName: cleanName,
    phone: cleanPhone,
    email: cleanEmail,
    specialRequests: String(specialRequests || '').trim(),
    occasion: String(occasion || '').trim(),
    preOrder,
    preOrderTotal,
    createdAt: new Date().toISOString()
  };

  reservations.push(record);
  return res.status(201).json({ reservation: record });
});

/* ---------- Checkout & Orders API ---------- */
const ORDERS_FILE = path.join(DATA_DIR, 'orders.json');
const DELIVERY_FEE = 5;
const PICKUP_FEE = 0;

const ADDON_PRICES = {
  bacon: { label: 'Crispy turkey bacon', price: 2 },
  avocado: { label: 'Avocado', price: 1.5 },
  hashbrown: { label: 'Hash brown', price: 1 },
  nutella: { label: 'Extra Nutella drizzle', price: 1.5 },
  strawberries: { label: 'Fresh strawberries', price: 2 },
  icecream: { label: 'Vanilla ice cream scoop', price: 2.5 },
  espresso: { label: 'Extra espresso shot', price: 1.5 },
  oatmilk: { label: 'Oat / Almond milk', price: 1 },
  syrup: { label: 'Caramel / Vanilla syrup', price: 1 }
};

function computePromoDiscount(code, subtotal, fee) {
  const clean = String(code || '').trim().toUpperCase();
  if (!clean) return { code: '', discount: 0, waivedFee: false };
  if (clean === 'KEHNFAN10') {
    return { code: clean, discount: Number((subtotal * 0.1).toFixed(2)), waivedFee: false };
  }
  if (clean === 'MORNING15') {
    return { code: clean, discount: Number((subtotal * 0.15).toFixed(2)), waivedFee: false };
  }
  if (clean === 'FREEDEL') {
    return { code: clean, discount: 0, waivedFee: fee > 0 };
  }
  if (clean === 'SAVE5' && subtotal >= 20) {
    return { code: clean, discount: 5, waivedFee: false };
  }
  return null;
}

function loadCatalogMap() {
  try {
    const raw = fs.readFileSync(path.join(__dirname, 'js', 'data.js'), 'utf8');
    const sandbox = { window: {} };
    vm.runInNewContext(raw, sandbox);
    const list = sandbox.window && sandbox.window.MENU && Array.isArray(sandbox.window.MENU.products)
      ? sandbox.window.MENU.products
      : [];
    return Object.fromEntries(list.map(p => [p.id, p]));
  } catch {
    return {};
  }
}

function readOrders() {
  ensureReviewStorage();
  if (!fs.existsSync(ORDERS_FILE)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(ORDERS_FILE, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeOrders(list) {
  ensureReviewStorage();
  fs.writeFileSync(ORDERS_FILE, JSON.stringify(list, null, 2), 'utf8');
}

function luhnValid(digits) {
  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = Number(digits[i]);
    if (alt) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alt = !alt;
  }
  return sum % 10 === 0;
}

function detectCardBrand(digits) {
  if (/^4/.test(digits)) return 'Visa';
  if (/^(5[1-5]|2[2-7])/.test(digits)) return 'Mastercard';
  if (/^5078/.test(digits)) return 'Meeza';
  return 'Card';
}

function isExpiryValid(expiry) {
  const m = /^(\d{2})\s*\/\s*(\d{2})$/.exec(String(expiry || '').trim());
  if (!m) return false;
  const month = Number(m[1]);
  const year = 2000 + Number(m[2]);
  if (month < 1 || month > 12) return false;
  const now = new Date();
  const currentYm = now.getFullYear() * 12 + (now.getMonth() + 1);
  const expYm = year * 12 + month;
  return expYm >= currentYm;
}

app.post('/api/orders', (req, res) => {
  const body = req.body || {};
  const catalog = loadCatalogMap();

  const rawItems = Array.isArray(body.items) ? body.items : [];
  if (!rawItems.length) {
    return res.status(400).json({ error: 'Your cart is empty.' });
  }

  const orderItems = [];
  let subtotal = 0;
  for (const entry of rawItems) {
    const id = String(entry && entry.id ? entry.id : '').trim();
    const qty = Math.floor(Number(entry && entry.qty));
    const product = catalog[id];
    if (!product || !Number.isInteger(qty) || qty < 1 || qty > 99) {
      return res.status(400).json({ error: 'One or more cart items are invalid.' });
    }
    const size = entry && entry.size === 'Large' ? 'Large' : 'Regular';
    const sizeDelta = size === 'Large' ? 2 : 0;
    const rawAddons = Array.isArray(entry && entry.addons) ? entry.addons : [];
    const verifiedAddons = [];
    let addonsDelta = 0;
    const seenAddons = new Set();
    for (const a of rawAddons) {
      const addonId = String(typeof a === 'string' ? a : (a && a.id) || '').trim();
      if (addonId && ADDON_PRICES[addonId] && !seenAddons.has(addonId)) {
        seenAddons.add(addonId);
        verifiedAddons.push({
          id: addonId,
          label: ADDON_PRICES[addonId].label,
          price: ADDON_PRICES[addonId].price
        });
        addonsDelta += ADDON_PRICES[addonId].price;
      }
    }

    const unitPrice = Number((product.price + sizeDelta + addonsDelta).toFixed(2));
    const lineTotal = Number((unitPrice * qty).toFixed(2));
    subtotal = Number((subtotal + lineTotal).toFixed(2));
    orderItems.push({
      id: product.id,
      name: product.name,
      size,
      addons: verifiedAddons,
      unitPrice,
      qty,
      lineTotal
    });
  }

  const fulfillment = body.fulfillment === 'pickup' ? 'pickup' : body.fulfillment === 'delivery' ? 'delivery' : '';
  if (!fulfillment) {
    return res.status(400).json({ error: 'Please select Delivery or Pickup.' });
  }

  const fullName = String(body.fullName || '').trim();
  const phone = String(body.phone || '').trim();
  if (fullName.length < 2) {
    return res.status(400).json({ error: 'Please enter your full name.' });
  }
  if (phone.replace(/\D/g, '').length < 7) {
    return res.status(400).json({ error: 'Please enter a valid phone number.' });
  }

  let address = '';
  let instructions = '';
  let pickupTime = '';
  let fee = fulfillment === 'delivery' ? DELIVERY_FEE : PICKUP_FEE;

  if (fulfillment === 'delivery') {
    address = String(body.address || '').trim();
    instructions = String(body.instructions || '').trim().slice(0, 300);
    if (address.length < 5) {
      return res.status(400).json({ error: 'Please enter your delivery address.' });
    }
  } else {
    pickupTime = String(body.pickupTime || '').trim();
    const allowedPickupTimes = ['ASAP · 15 min', '9:15', '9:30', '9:45'];
    if (!allowedPickupTimes.includes(pickupTime)) {
      return res.status(400).json({ error: 'Please select a pickup time.' });
    }
  }

  const promoResult = computePromoDiscount(body.promoCode, subtotal, fee);
  const appliedPromo = promoResult ? promoResult.code : '';
  const discount = promoResult ? promoResult.discount : 0;
  if (promoResult && promoResult.waivedFee) {
    fee = 0;
  }

  const paymentMethod = String(body.paymentMethod || '').trim();
  const allowedMethods = fulfillment === 'delivery'
    ? ['cash-delivery', 'card', 'online']
    : ['cash-pickup', 'card', 'online'];
  if (!allowedMethods.includes(paymentMethod)) {
    return res.status(400).json({ error: 'Please select a compatible payment method.' });
  }

  let paymentSummary = { method: paymentMethod };
  if (paymentMethod === 'card') {
    const card = body.card || {};
    const cardholderName = String(card.cardholderName || '').trim();
    const digits = String(card.cardNumber || '').replace(/\D/g, '');
    const expiry = String(card.expiry || '').trim();
    const cvv = String(card.cvv || '').replace(/\D/g, '');

    if (cardholderName.length < 2) {
      return res.status(400).json({ error: 'Please enter the cardholder name.' });
    }
    if (digits.length < 13 || digits.length > 19 || !luhnValid(digits)) {
      return res.status(400).json({ error: 'Please enter a valid card number.' });
    }
    if (!isExpiryValid(expiry)) {
      return res.status(400).json({ error: 'Please enter a valid future expiry date (MM / YY).' });
    }
    if (cvv.length < 3 || cvv.length > 4) {
      return res.status(400).json({ error: 'Please enter a valid CVV code.' });
    }

    // Never store full card number or CVV
    paymentSummary = {
      method: 'card',
      brand: detectCardBrand(digits),
      last4: digits.slice(-4),
      cardholderName: cardholderName.slice(0, 80)
    };
  } else if (paymentMethod === 'online') {
    const wallet = String(body.wallet || 'Apple Pay').trim().slice(0, 40);
    paymentSummary = {
      method: 'online',
      wallet: wallet || 'Digital Wallet'
    };
  }

  const total = Number(Math.max(0, subtotal - discount + fee).toFixed(2));
  const orderNumber = `KF-ORD-${Math.floor(10000 + Math.random() * 90000)}`;
  const order = {
    orderNumber,
    fulfillment,
    fullName: fullName.slice(0, 80),
    phone: phone.slice(0, 30),
    address,
    instructions,
    pickupTime,
    pickupLocation: fulfillment === 'pickup' ? 'Kehnfan · Nasr City, Cairo' : '',
    items: orderItems,
    subtotal,
    promoCode: appliedPromo,
    discount,
    fee,
    total,
    payment: paymentSummary,
    createdAt: new Date().toISOString()
  };

  try {
    const orders = readOrders();
    orders.unshift(order);
    writeOrders(orders);
    return res.status(201).json({ order });
  } catch {
    return res.status(500).json({ error: 'Could not save your order. Please try again.' });
  }
});

app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running at http://0.0.0.0:${PORT}`);
});
