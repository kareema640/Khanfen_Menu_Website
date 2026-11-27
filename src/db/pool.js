'use strict';

const { Pool } = require('pg');

let pool;
function getPool() {
  if (!process.env.DATABASE_URL) {
    const error = new Error('Database is not configured. Set DATABASE_URL to a PostgreSQL connection string.');
    error.status = 503;
    error.code = 'DATABASE_NOT_CONFIGURED';
    throw error;
  }
  if (!pool) {
    const sslMode = String(process.env.PGSSLMODE || '').toLowerCase();
    const ssl = sslMode === 'require'
      ? { rejectUnauthorized: String(process.env.PGSSL_REJECT_UNAUTHORIZED || 'true') !== 'false' }
      : false;
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl,
      max: Number(process.env.PGPOOL_MAX) || 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
      application_name: 'khanfem-restaurant'
    });
    pool.on('error', error => console.error('Unexpected PostgreSQL pool error:', error.message));
  }
  return pool;
}

async function query(text, values = []) {
  return getPool().query(text, values);
}

async function withTransaction(work) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch {}
    throw error;
  } finally {
    client.release();
  }
}

async function closePool() {
  if (pool) {
    const current = pool;
    pool = undefined;
    await current.end();
  }
}

module.exports = { getPool, query, withTransaction, closePool };
