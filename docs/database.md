# Khanfem PostgreSQL database

The application uses PostgreSQL for the catalog, authentication sessions, orders, reservations, reviews, notifications, and reporting. Schema changes are ordered SQL files under `database/migrations/` and are applied once by `schema_migrations` through `npm run db:migrate`.

## Tables and relationships

| Area | Tables | Notes |
| --- | --- | --- |
| Identity | `users`, `sessions` | Email-normalized unique account identity; bcrypt password hashes; `customer`/`admin` roles. Sessions are server-side in PostgreSQL. |
| Menu | `categories`, `products`, `addons`, `promotions` | Categories support a parent/child hierarchy. Product legacy IDs and slugs are stable public identifiers. |
| Orders | `orders`, `order_items`, `order_item_options`, `payments`, `order_status_history`, `notifications`, `idempotency_keys` | Order items and options preserve names, category, size, quantity, and prices as snapshots. Payment state is separate from fulfillment state. |
| Reservations | `restaurant_settings`, `restaurant_hours`, `reservations`, `reservation_items` | One settings row controls timezone, fees, reservation slot/duration, capacity, and max party size; weekday hours are configurable. A transaction-scoped advisory lock protects slot capacity. |
| Reviews | `reviews` | Customer submissions begin pending. Only approved, non-demo rows are public and included in public rating statistics. Optional review images are stored as bounded JPG/PNG bytes. |
| Reports | `reporting_order_items`, `reporting_daily_sales`, `reporting_product_sales`, `reporting_category_sales`, `reporting_reservations_daily` | Read-only views defined by migration `004_reporting_views.sql`; the owner report endpoint reads these views. |

See [ERD source](erd.mmd) and the rendered [ERD image](erd.png) for table relationships. The schema includes primary/foreign keys, unique constraints, checks, indexes, and deletion rules. Order and reservation writes use database transactions. All application queries use parameterized values; identifiers interpolated by the owner settings update are selected from a fixed allowlist.

## Migration and seed behavior

```sh
npm run db:migrate
npm run db:seed
```

`db:migrate` requires `DATABASE_URL` and applies only migration files not present in `schema_migrations`. Each migration is transactional and guarded by a PostgreSQL advisory lock. `db:seed` upserts the six menu categories and catalog products while preserving owner-managed price, availability, and featured fields on existing products; it inserts sample reviews once, marked `is_demo=TRUE`. The seed catalog contains the supplied product identities/images, not customer orders. Running the seed more than once is expected to be safe.

A fresh local database should be created explicitly, configured in `DATABASE_URL`, migrated, and seeded before starting the application. Never use the disposable test database variable for production or point tests at production. Integration tests refuse to start unless `TEST_DATABASE_URL` is set.

## Analytics eligibility

- **Placed order count:** non-demo orders whose order status is not `cancelled`; pending cash orders count as placed orders.
- **Paid revenue:** non-demo orders with `payment_status='paid'` and `order_status<>'cancelled'`. Pending cash value is reported separately and is not revenue.
- **Product/category quantity and item sales:** non-demo, non-cancelled orders whose payment is neither `failed` nor `refunded`. Pending cash orders may contribute to popularity until cancelled or marked failed/refunded. Category grouping uses `product_category_snapshot`, not the product's current category.
- **Public rating:** approved, non-demo reviews only.
- **Upcoming reservations:** pending or confirmed non-demo reservations on or after the database current date.

These definitions are intentionally explicit; do not interpret cash-on-delivery pending records as paid revenue. Demo seed reviews and any demo orders are excluded from real-business analytics.

## Reports

`database/reports.sql` contains examples for inclusive date-range totals; daily, weekly, and monthly aggregation; product and category sales; repeat customers; products never ordered; reservation trends; and approved-review statistics. Customer-email reports contain personal information and must remain owner-only. Run views and scripts only against a database you control.
