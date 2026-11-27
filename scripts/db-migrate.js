'use strict';

require('dotenv').config();
const fs = require('node:fs/promises');
const path = require('node:path');
const { getPool, closePool } = require('../src/db/pool');

async function runMigrations() {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [731904122]);
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
    const directory = path.join(__dirname, '..', 'database', 'migrations');
    const files = (await fs.readdir(directory)).filter(name => /^\d+_[a-z0-9_-]+\.sql$/i.test(name)).sort();
    for (const file of files) {
      const already = await client.query('SELECT 1 FROM schema_migrations WHERE version = $1', [file]);
      if (already.rowCount) {
        console.log(`skip ${file} (already applied)`);
        continue;
      }
      const sql = await fs.readFile(path.join(directory, file), 'utf8');
      const body = sql.replace(/^\s*BEGIN\s*;\s*/i, '').replace(/\s*COMMIT\s*;\s*$/i, '');
      console.log(`apply ${file}`);
      await client.query('BEGIN');
      try {
        await client.query(body);
        await client.query('INSERT INTO schema_migrations(version) VALUES ($1)', [file]);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }
  } finally {
    try { await client.query('SELECT pg_advisory_unlock($1)', [731904122]); } catch {}
    client.release();
    await closePool();
  }
}

runMigrations().catch(error => {
  console.error(`Database migration failed: ${error.message}`);
  process.exitCode = 1;
});
