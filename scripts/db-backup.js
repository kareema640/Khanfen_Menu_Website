'use strict';

require('dotenv').config();
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const databaseUrl = process.env.DATABASE_URL;
const target = process.argv[2];
if (!databaseUrl) throw new Error('DATABASE_URL is required.');
if (!target) throw new Error('Usage: npm run db:backup -- <output.dump>');
const output = path.resolve(target);
fs.mkdirSync(path.dirname(output), { recursive: true, mode: 0o700 });
if (fs.existsSync(output)) throw new Error(`Refusing to overwrite existing backup: ${output}`);
process.umask(0o077);
const result = spawnSync('pg_dump', ['--format=custom', '--no-owner', '--no-privileges', '--file', output, databaseUrl], { stdio: 'inherit', env: { ...process.env, PGPASSFILE: process.env.PGPASSFILE } });
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status || 1);
fs.chmodSync(output, 0o600);
console.log(`Created restricted PostgreSQL backup: ${output}`);
