# Backend and Database Integration Plan

## Objective and preserved design

Extend the current breakfast restaurant site with a maintainable, database-backed backend while preserving its approved HTML/CSS/frontend identity. Continue working only on `feature/backend-database-integration`; never change or merge `main`. The restaurant brand is Khanfem; visible and internal references will be updated consistently, preserving compatibility for existing browser storage through one-time key migration where practical.

## Architecture decision

Use the existing static HTML, CSS and vanilla JavaScript frontend with the existing Express 5 server, plus PostgreSQL accessed only by server-side Node code through `pg` parameterized queries. Keep the current same-origin `/api` approach and add versioned SQL migrations, repeatable seeds, database views/report queries, and a documented migration/bootstrap workflow in the repository. PostgreSQL is preferred by the user and is a straightforward fit for the current Express application; direct PostgreSQL avoids introducing a new browser-facing platform or requiring a Supabase project/service key before any has been supplied. A hosted PostgreSQL/Supabase-compatible connection can be supplied through `DATABASE_URL` later.

Separate concerns into `src/config`, `src/db`, `src/middleware`, `src/routes`, `src/services`, and `src/utils`; retain `server.js` as the application entry point. Preserve existing endpoint shapes where reasonable and adapt current frontend forms with the smallest functional changes. The browser cart remains a temporary convenience; the API accepts product IDs/options/quantities only and always reloads current product data, validates availability, and computes prices/totals server-side.

## Database model

Use UUID primary keys and stable public slugs/legacy product IDs. Core tables: `users`, `categories`, `products`, `orders`, `order_items`, `order_item_options`, `payments`, `order_status_history`, `reservations`, `reservation_items`, `reviews`, `notifications`, `restaurant_hours`, and `sessions` for PostgreSQL-backed login sessions. Define foreign keys, uniqueness/check constraints, indexes, safe deletion policies, and timestamps. Order lines preserve product name/price/options snapshots. Store money as `NUMERIC` and a currency code. The current UI displays `$`; seed that inherited convention as USD, document it as a configuration assumption, and keep it editable rather than silently guessing a different currency.

Migrations provide schema; an idempotent seed imports all current products/images while preserving stable identifiers. Seed showcase reviews and optional demo orders only as clearly marked demo records and exclude them from public approved review metrics, sales, revenue, and best-seller analytics. Dynamic best sellers aggregate eligible real orders; when sales are insufficient, a manually featured fallback is labeled as such.

## Security, business logic and integrations

Use secure server-side sessions with HttpOnly cookies, CSRF protection on state-changing requests, rate limits on login/checkout, password hashing, and backend role checks. Bootstrap the first owner through a one-time CLI command with credentials supplied only through the environment; do not commit credentials. Guest checkout remains available. The public order lookup will use an unguessable tracking capability and disclose only tracking-safe fields; full customer details and management operations require owner authorization.

Create orders transactionally with validated product availability, server-calculated amounts, immutable item snapshots, payment status, initial status history and deduplicated in-app notifications. Use cash-on-delivery/pickup as the available payment methods unless a real gateway is configured. Never store or log card numbers/CVV, and do not report simulated card/wallet payment as real. Persist actual order-status transitions and base tracking/notifications on those events. Store reviews with moderation; only approved reviews contribute to public list/average/count. Persist reservations and enforce capacity under a database lock/transaction; make operating hours and slot/capacity policy configurable. Seed defaults from the existing UI behavior, document them, and keep them editable. Email/SMS/push adapters remain disabled until actual provider credentials and testing are provided.

## API and UI integration

Keep public catalog, category filters, product detail, favorites, cart/checkout, reservation flow, review flow, confirmation and tracking UI compatible. Add APIs for auth/session, public catalog, checkout/order tracking, reviews, reservations, in-app notifications, owner product/order/reservation/review management, settings and analytics. Add a restrained `admin.html`/`admin.js` dashboard using existing design tokens and no redesign of public pages. Keep customer accounts optional; owner authorization is mandatory for all management endpoints.

## Repository structure

- Existing public pages and `css/`, `js/`, `assets/`, `public/` remain the frontend and asset source.
- `server.js` boots Express and mounts modular code under `src/`.
- `database/migrations/` contains ordered schema changes; `database/seeds/` contains repeatable catalog/demo seed scripts; `database/views/` and `database/queries/` contain report definitions and academic examples; `database/diagrams/` contains ERD source and image; `database/README.md` explains setup, migrations, seeds, tables, views, backup and restore.
- `scripts/` contains database migration/seed and secure one-time owner bootstrap commands.
- Tests cover database/migration behavior, API validation/authorization, transactional order and reservation paths, and browser-facing response contracts.

## External configuration and limits

No `DATABASE_URL`, payment provider, SMS/email account or credentials are present in the project. Local/PostgreSQL configuration and all required variables will be documented in `.env.example`. A running real PostgreSQL instance is needed to run/deploy the live integration. Online payments and external notifications must remain unavailable/unclaimed without provider accounts, secrets, webhook configuration and end-to-end tests. The optional Maps key must not be exposed through an API response; map/geocoding behavior should degrade gracefully when not configured.

## Delivery

Run existing and new lint/build/tests, database migration/seed/integrity tests, and focused API/UI regression checks. Commit logical changes only to `feature/backend-database-integration`; leave `main` untouched and do not merge. Clearly report what is complete, what needs configuration, and any remaining limitation.