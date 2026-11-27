'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const { z } = require('zod');
const { query } = require('../db/pool');
const { AppError } = require('../utils/errors');
const { requireUser } = require('../middleware/auth');

const router = express.Router();
const signupSchema = z.object({ name: z.string().trim().min(2).max(120), email: z.string().trim().email().max(254), phone: z.string().trim().max(30).optional().default(''), password: z.string().min(12).max(128) });
const loginSchema = z.object({ email: z.string().trim().email().max(254), password: z.string().min(1).max(128) });

function userDto(user) {
  return { id: user.id, name: user.full_name, email: user.email, phone: user.phone, role: user.role };
}

async function catalogData() {
  const [categoriesResult, productsResult, bestResult, fallbackResult] = await Promise.all([
    query(`SELECT c.slug AS id,c.name AS label,c.description,c.image_path AS image,c.parent_id,p.slug AS parent_slug,c.is_group AS "isGroup"
           FROM categories c LEFT JOIN categories p ON p.id=c.parent_id WHERE c.is_active=TRUE ORDER BY c.sort_order,c.name`),
    query(`SELECT p.legacy_id AS id,p.slug,p.name,p.description,p.price::float8 AS price,p.currency_code AS "currencyCode",p.image_path AS image,p.is_featured AS featured,p.is_available AS available,c.slug AS category
           FROM products p JOIN categories c ON c.id=p.category_id WHERE p.is_active=TRUE AND c.is_active=TRUE ORDER BY c.sort_order,p.name`),
    query(`SELECT oi.product_legacy_id AS id,SUM(oi.quantity)::int AS quantity
           FROM order_items oi JOIN orders o ON o.id=oi.order_id
           WHERE o.is_demo=FALSE AND o.order_status<>'cancelled' AND o.payment_status NOT IN ('failed','refunded')
           GROUP BY oi.product_legacy_id HAVING SUM(oi.quantity)>0 ORDER BY quantity DESC,oi.product_legacy_id LIMIT 8`),
    query(`SELECT legacy_id AS id FROM products WHERE is_active=TRUE AND is_available=TRUE AND is_featured=TRUE ORDER BY name LIMIT 8`)
  ]);
  const actual = bestResult.rows.map(row => row.id);
  const isFallback = actual.length === 0;
  const featured = (isFallback ? fallbackResult.rows.map(row => row.id) : actual);
  return {
    categories: categoriesResult.rows.map(row => ({ id: row.id, label: row.label, description: row.description, image: row.image, parent: row.parent_slug || null, isGroup: row.isGroup })),
    products: productsResult.rows.map(row => ({ ...row, price: Number(row.price), isAvailable: row.available })),
    featured,
    featuredIsFallback: isFallback,
    featuredLabel: isFallback ? 'Featured picks · fallback until real orders are placed' : 'Best sellers · based on placed orders',
    currency: '$'
  };
}

router.get('/catalog', async (_req, res) => res.json(await catalogData()));
router.get('/best-sellers', async (_req, res) => {
  const data = await catalogData();
  res.json({ products: data.products.filter(item => data.featured.includes(item.id)), isFallback: data.featuredIsFallback, label: data.featuredLabel });
});
router.get('/products/:id', async (req, res) => {
  const result = await query(`SELECT p.legacy_id AS id,p.slug,p.name,p.description,p.price::float8 AS price,p.currency_code AS "currencyCode",p.image_path AS image,p.is_available AS available,c.slug AS category
    FROM products p JOIN categories c ON c.id=p.category_id WHERE p.legacy_id=$1 AND p.is_active=TRUE`, [req.params.id]);
  if (!result.rowCount) throw new AppError(404, 'Product not found.', 'NOT_FOUND');
  const product = result.rows[0]; product.price = Number(product.price); product.isAvailable = product.available;
  res.json({ product });
});

router.get('/auth/session', (req, res) => res.json({ user: req.session?.user || null }));
router.post('/auth/signup', async (req, res) => {
  const input = signupSchema.parse(req.body);
  const hash = await bcrypt.hash(input.password, 12);
  const result = await query(`INSERT INTO users(full_name,email,phone,password_hash,role) VALUES($1,$2,$3,$4,'customer')
    ON CONFLICT(email_normalized) DO NOTHING RETURNING id,full_name,email,phone,role`, [input.name,input.email,input.phone,hash]);
  if (!result.rowCount) throw new AppError(409, 'An account with this email already exists.', 'EMAIL_EXISTS');
  const user = userDto(result.rows[0]);
  await new Promise((resolve, reject) => req.session.regenerate(error => error ? reject(error) : resolve()));
  req.session.user = user;
  res.status(201).json({ user });
});
router.post('/auth/login', async (req, res) => {
  const input = loginSchema.parse(req.body);
  const result = await query(`SELECT id,full_name,email,phone,role,password_hash,is_active FROM users WHERE email_normalized=lower(trim($1))`, [input.email]);
  const row = result.rows[0];
  if (!row || !row.is_active || !(await bcrypt.compare(input.password, row.password_hash))) throw new AppError(401, 'Email or password is incorrect.', 'INVALID_CREDENTIALS');
  const user = userDto(row);
  await new Promise((resolve, reject) => req.session.regenerate(error => error ? reject(error) : resolve()));
  req.session.user = user;
  res.json({ user });
});
router.post('/auth/logout', requireUser, async (req, res) => {
  await new Promise((resolve, reject) => req.session.destroy(error => error ? reject(error) : resolve()));
  res.clearCookie('khanfem.sid');
  res.status(204).end();
});

module.exports = { router, catalogData };
