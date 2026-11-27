'use strict';

require('dotenv').config();
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const targetUrl = process.env.RESTORE_DATABASE_URL;
const archive = process.argv[2];
if (!targetUrl) throw new Error('RESTORE_DATABASE_URL is required; use a dedicated restore target.');
if (!archive) throw new Error('Usage: RESTORE_CONFIRM=YES npm run db:restore -- <input.dump>');
if (process.env.RESTORE_CONFIRM !== 'YES') throw new Error('Restore refused. Set RESTORE_CONFIRM=YES only after verifying the target database and retaining a backup.');
const input = path.resolve(archive);
if (!fs.statSync(input).isFile()) throw new Error(`Backup archive is not a file: ${input}`);
const target = new URL(targetUrl);
console.warn(`Restoring archive into database ${target.pathname.slice(1)} on ${target.hostname}. Existing objects found in the archive may be replaced.`);
const result = spawnSync('pg_restore', ['--clean', '--if-exists', '--no-owner', '--no-privileges', '--exit-on-error', '--dbname', targetUrl, input], { stdio: 'inherit', env: process.env });
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status || 1);
console.log('Restore completed. Validate the database before routing any application traffic to it.');
