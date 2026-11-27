# Setup and operations

## Requirements

- Node.js 22 or a compatible supported Node.js release
- PostgreSQL 16 (the schema uses UUID generation and PostgreSQL-specific JSONB, filtered aggregates, advisory locks, and views)
- `pg_dump` and `pg_restore` from PostgreSQL client tools for backups

## Local setup

1. Create an empty database and a role with appropriate application privileges. Use a separate role/database for the app; do not use a superuser in production.
2. Copy `.env.example` to `.env`. Set `DATABASE_URL` to the application database and set `SESSION_SECRET` to at least 32 random characters. Never commit `.env`.
3. Run `npm ci`, then `npm run db:migrate` and `npm run db:seed`.
4. For the first owner only, temporarily set `ADMIN_NAME`, `ADMIN_EMAIL`, and a unique `ADMIN_PASSWORD` of at least 16 characters. Run `npm run db:bootstrap-admin`, then unset/remove those values.
5. Run `npm run dev` and verify `GET /api/health` returns HTTP 200 with `{"ok":true,"database":"connected"}`.

The default restaurant-hours and fee/capacity rows are seeded by migration 001. Confirm them with the owner before relying on the defaults in a real operation. The catalog seed is repeatable; it does not overwrite existing product prices or availability when a legacy product ID already exists.

## Test database isolation

Create a disposable database such as `khanfem_test` and use its connection string only for `TEST_DATABASE_URL`. The test runner overrides `DATABASE_URL` with this value before loading the app and refuses to run if `TEST_DATABASE_URL` is missing. Test inserts are synthetic and tagged for cleanup. Do not reuse production data or a production DSN for tests.

```sh
createdb khanfem_test
DATABASE_URL=postgres://user:password@localhost:5432/khanfem_test npm run db:migrate
DATABASE_URL=postgres://user:password@localhost:5432/khanfem_test npm run db:seed
TEST_DATABASE_URL=postgres://user:password@localhost:5432/khanfem_test npm test
```

Migrations and seed read `DATABASE_URL`; they do not use `TEST_DATABASE_URL` by themselves. Always point `DATABASE_URL` explicitly at the disposable database for test schema setup.

## Backup and restore

Backups include customer data, password hashes, guest tracking hashes, and sessions. Store encrypted copies with restricted access and retention consistent with applicable policy. Do not add dump files to Git.

```sh
npm run db:backup -- ./private-backups/khanfem-$(date +%Y%m%d-%H%M%S).dump
```

This creates a PostgreSQL custom-format archive from `DATABASE_URL`. Restore into a newly created empty database first, then validate migrations/catalog and a safe application health check:

```sh
createdb khanfem_restore
RESTORE_DATABASE_URL=postgres://user:password@localhost:5432/khanfem_restore \
RESTORE_CONFIRM=YES npm run db:restore -- ./private-backups/khanfem-YYYYMMDD-HHMMSS.dump
```

The restore script requires the explicit `RESTORE_CONFIRM=YES` acknowledgement and runs `pg_restore --clean --if-exists`. It replaces objects present in the archive in the selected restore database; verify the target DSN/database name and retain a pre-restore backup. Do not restore over a live production database without a separately approved recovery plan and verified backup.

To recreate a database from schema and seed data rather than an archive, create an empty target database, set `DATABASE_URL` to it, and run `npm run db:migrate` followed by `npm run db:seed`.

## Deployment and integrations

Use TLS to PostgreSQL in hosted environments. Set a durable strong `SESSION_SECRET`; use `SESSION_COOKIE_SECURE=true` and `SESSION_COOKIE_SAMESITE=none` for cross-site HTTPS preview embedding, but normally `secure=true` and `lax` for same-site production. Configure `APP_ORIGIN` to the exact public origin and trust-proxy settings to the real proxy topology.

Checkout is cash-on-delivery/cash-on-pickup only. No online payment gateway, webhook, customer email/SMS provider, or courier dispatch provider has been configured or tested. Optional Maps/geocoding requires a server-side `GOOGLE_MAPS_API_KEY`. Never expose provider secrets to browser scripts.

## Checks

```sh
npm run lint
npm run build
TEST_DATABASE_URL=postgres://.../khanfem_test npm test
npm audit --omit=dev
```
