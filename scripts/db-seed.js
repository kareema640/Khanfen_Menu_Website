'use strict';

require('dotenv').config();
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { withTransaction, closePool } = require('../src/db/pool');

const CATALOG = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'database', 'seeds', 'catalog.json'), 'utf8'));
const REVIEW_SEEDS = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'database', 'seeds', 'reviews.json'), 'utf8'));
const categories = [
  { slug: 'sandwiches', name: 'Sandwiches', sort: 1 },
  { slug: 'bakery', name: 'Bakery', sort: 2 },
  { slug: 'drinks', name: 'Drinks', sort: 3, isGroup: true },
  { slug: 'hot-drinks', name: 'Hot Drinks', sort: 4, parent: 'drinks' },
  { slug: 'cold-drinks', name: 'Cold Drinks', sort: 5, parent: 'drinks' },
  { slug: 'desserts', name: 'Desserts', sort: 6 }
];

async function seed() {
  await withTransaction(async client => {
    const categoryIds = new Map();
    for (const category of categories.filter(item => !item.parent)) {
      const result = await client.query(
        `INSERT INTO categories (slug, name, is_group, sort_order)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (slug) DO UPDATE SET name=EXCLUDED.name, is_group=EXCLUDED.is_group, sort_order=EXCLUDED.sort_order, updated_at=now()
         RETURNING id`,
        [category.slug, category.name, Boolean(category.isGroup), category.sort]
      );
      categoryIds.set(category.slug, result.rows[0].id);
    }
    for (const category of categories.filter(item => item.parent)) {
      const result = await client.query(
        `INSERT INTO categories (slug, name, parent_id, is_group, sort_order)
         VALUES ($1,$2,$3,FALSE,$4)
         ON CONFLICT (slug) DO UPDATE SET name=EXCLUDED.name, parent_id=EXCLUDED.parent_id, sort_order=EXCLUDED.sort_order, updated_at=now()
         RETURNING id`,
        [category.slug, category.name, categoryIds.get(category.parent), category.sort]
      );
      categoryIds.set(category.slug, result.rows[0].id);
    }

    const featured = new Set(CATALOG.featured || []);
    const currencyCode = CATALOG.currency === '$' ? 'USD' : 'USD';
    for (const product of CATALOG.products) {
      const categoryId = categoryIds.get(product.category);
      if (!categoryId) throw new Error(`Unmapped product category ${product.category} (${product.id})`);
      await client.query(
        `INSERT INTO products (legacy_id,slug,category_id,name,description,price,currency_code,image_path,is_featured)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (legacy_id) DO UPDATE SET
           slug=EXCLUDED.slug, category_id=EXCLUDED.category_id, name=EXCLUDED.name,
           description=EXCLUDED.description, image_path=EXCLUDED.image_path, updated_at=now()`,
        [product.id, product.id, categoryId, product.name, product.description || '', Number(product.price), currencyCode, product.image || null, featured.has(product.id)]
      );
    }

    for (const review of REVIEW_SEEDS) {
      const key = `seed-review:${crypto.createHash('sha256').update(`${review.name}\n${review.review}`).digest('hex')}`;
      await client.query(
        `INSERT INTO reviews (customer_name,rating,review_text,moderation_status,is_demo,idempotency_key,created_at)
         VALUES ($1,$2,$3,'approved',TRUE,$4,$5)
         ON CONFLICT (idempotency_key) DO NOTHING`,
        [review.name, review.rating, review.review, key, review.createdAt]
      );
    }
  });
  console.log(`Seeded ${categories.length} categories and ${CATALOG.products.length} products; sample reviews are marked as demo.`);
}

seed().catch(error => {
  console.error(`Database seed failed: ${error.message}`);
  process.exitCode = 1;
}).finally(closePool);
