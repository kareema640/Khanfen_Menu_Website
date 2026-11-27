# Khanfem restaurant website

Khanfem is a responsive restaurant storefront backed by Node.js, Express, and PostgreSQL. The existing customer-facing design and supplied food photography are preserved. The backend powers the database catalog, cash-only checkout, reservations, moderated reviews, capability-token order tracking, owner management, and reporting.

## Quick start

Requirements: Node.js 22 (or compatible), PostgreSQL 16, and a database role with schema creation privileges for initial setup.

```sh
npm ci
cp .env.example .env
# Set DATABASE_URL and a unique SESSION_SECRET (at least 32 characters) in .env.
npm run db:migrate
npm run db:seed
npm run dev
```

Open `http://localhost:3000` and check `GET /api/health`. For the first owner only, temporarily set `ADMIN_NAME`, `ADMIN_EMAIL`, and a unique `ADMIN_PASSWORD` of at least 16 characters in the environment, run `npm run db:bootstrap-admin`, then remove the temporary values. Bootstrap refuses to create another admin if one already exists.

## Tests and database safety

Tests require a dedicated disposable PostgreSQL database in `TEST_DATABASE_URL`; the test runner redirects its DB pool to that value. Never run tests against production. For migration/seed setup, set `DATABASE_URL` to the disposable test database explicitly.

```sh
createdb khanfem_test
DATABASE_URL=postgres://user:password@localhost:5432/khanfem_test npm run db:migrate
DATABASE_URL=postgres://user:password@localhost:5432/khanfem_test npm run db:seed
TEST_DATABASE_URL=postgres://user:password@localhost:5432/khanfem_test npm test
npm run lint
npm run build
npm audit --omit=dev
```

## Documentation

- [API reference](docs/api.md)
- [Database schema, migration, and analytics definitions](docs/database.md)
- [Local setup, test isolation, backup, restore, and deployment notes](docs/operations.md)
- [ERD source](docs/erd.mmd) and [rendered ERD image](docs/erd.png)
- [Reusable SQL report examples](database/reports.sql)

## Important operational limits

Checkout accepts cash on delivery and cash on pickup. Online card/wallet processing is intentionally unavailable until a payment provider, credentials, and verified webhook handling are configured. In-app notifications are stored in PostgreSQL; no customer email/SMS provider or courier dispatch integration is configured. Optional map/geocoding features require a server-side API key.

Do not commit `.env`, database dumps, user/customer records, session data, or provider secrets. Use TLS connections in hosted environments and set preview cookie attributes according to `docs/operations.md`.
