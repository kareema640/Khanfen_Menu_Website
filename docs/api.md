# HTTP API reference

All routes below are relative to `/api`. JSON endpoints use `Content-Type: application/json` where a request body is present. Errors use a JSON object with `error` and a stable `code`; callers should rely on HTTP status and code, not internal SQL details. Dates use `YYYY-MM-DD`; money is in the restaurant currency (USD in current seed/default data).

## Public catalog and account

| Method and path | Purpose |
| --- | --- |
| `GET /health` | Readiness check; returns success only when PostgreSQL responds. |
| `GET /catalog` | Active categories/products, featured/best-seller IDs, fallback flag, and currency. |
| `GET /best-sellers` | Product list selected by actual eligible order quantities; clearly labels the featured fallback when no eligible sales exist. |
| `GET /products/:id` | Active product detail by stable legacy ID. |
| `GET /auth/session` | Current session user or `null`. |
| `POST /auth/signup` | Create customer account (`name`, `email`, optional `phone`, `password` of 12–128 characters); establishes a session. |
| `POST /auth/login` | Authenticate with email/password; establishes a session. |
| `POST /auth/logout` | End the signed-in session. |
| `GET /maps-config`, `GET /geocode?address=...` | Safe branch/maps configuration and optional server-side geocoding; without a configured key geocoding returns no location. |

Login and signup are rate-limited. Production must set a 32+ character `SESSION_SECRET`. Public HTTPS previews require `SESSION_COOKIE_SECURE=true` and `SESSION_COOKIE_SAMESITE=none`; plain HTTP local development normally uses `false` and `lax`.

## Orders and notifications

| Method and path | Purpose |
| --- | --- |
| `POST /orders` | Create a delivery or pickup order. Requires `Idempotency-Key` (16–128 safe characters) and JSON `items`, `fulfillment`, contact/address fields, and the matching cash method (`cash-delivery` or `cash-pickup`). Server loads live prices, validates product/add-on availability, calculates configured fees/promotions, and writes order/items/snapshots/payment/history/initial notification transactionally. Returns `{order, trackingToken}`. |
| `GET /orders/:orderNumber?token=...` | Capability-token lookup for customer confirmation/tracking. The unguessable token is returned at order creation; only its hash is stored. Customer email and phone are omitted from this response. |
| `GET /orders/:orderNumber/notifications?token=...` | Read notifications for the capability-protected guest order. |
| `GET /notifications` | Read notifications for the signed-in user. |
| `PATCH /notifications/:id/read` | Mark an owned notification read; does not expose other users' notification IDs/data. |

Repeated identical idempotency keys return the original result; a key reused for different request details returns `409`. Card and wallet checkout is deliberately rejected until a real provider and webhook verification exist. The current checkout is cash-only; no external payment, email, or SMS service is claimed as active.

## Reservations and reviews

| Method and path | Purpose |
| --- | --- |
| `GET /reservations/availability?date=YYYY-MM-DD` | Available configured slots and unavailable slots, accounting for overlapping active reservations. |
| `POST /reservations` | Create reservation with `guests`, `date`, `time`, `fullName`, `phone`, `email`, optional `specialRequests`, `occasion`, and optional pre-order lines. Availability/capacity is checked transactionally; returns a reservation reference and status. |
| `GET /reviews` | Approved, non-demo reviews and the matching public average/count. |
| `POST /reviews` | Persist a moderated review (`name`, optional `email`, `rating`, `review`, `clientRequestId`, optional JPG/PNG data URL). Duplicate request IDs are idempotent. New reviews are pending and not public. |
| `GET /reviews/:id/photo` | Return an image only when its review is approved and non-demo. |

## Owner-only APIs

Every `/admin/*` route requires a signed-in session whose role is `admin`; unauthenticated requests receive `401`, authenticated customers receive `403`. The dashboard is at `/admin.html` and its controls are not the authorization boundary—the server middleware is.

| Method and path | Purpose |
| --- | --- |
| `GET /admin/overview` | Order counts by status, paid revenue totals, best-selling products, category sales, upcoming reservations, approved rating/count. |
| `GET /admin/reports?from=YYYY-MM-DD&to=YYYY-MM-DD` | Daily paid/placed totals plus derived Monday-start weekly and monthly summaries. Paid revenue excludes demo and cancelled orders; pending cash is separate. Invalid date syntax returns `400`. |
| `GET /admin/orders` | Recent non-demo orders; optional `status`, `fulfillment`, `q`, `from`, `to` filters. |
| `GET /admin/orders/:id` | Owner detail, immutable item/option snapshots, and order status history. `:id` accepts order UUID or order number. |
| `PATCH /admin/orders/:id/status` | Apply a valid lifecycle transition and optional `note`; transactionally records history and a deduplicated in-app notification. Invalid transitions return `409`. |
| `PATCH /admin/orders/:id/payment` | Owner records `paid`, `failed`, or `refunded`; this is not an external payment-provider capture. |
| `GET /admin/products`, `POST /admin/products`, `PATCH /admin/products/:id`, `DELETE /admin/products/:id` | List/create/update/delete products. Update price, status, category, availability, description, image, and featured flags through validated payloads. Product hard deletion may be blocked by historical foreign keys; deactivation is safer. |
| `GET /admin/categories`, `POST /admin/categories` | List/create category and parent/group metadata. |
| `GET /admin/reservations` | Owner list with optional `status`, `date`, and `q`. |
| `PATCH /admin/reservations/:id/status` | Set reservation to confirmed, rejected, cancelled, or completed. |
| `GET /admin/reviews?status=pending` | List reviews for moderation; status may be filtered. |
| `PATCH /admin/reviews/:id/moderation` | Approve or reject a review. |
| `PATCH /admin/settings` | Update validated restaurant fee, currency, reservation capacity/duration, and party-size settings. |

First-owner creation is an offline one-time administrative operation (`npm run db:bootstrap-admin`) using temporary `ADMIN_NAME`, `ADMIN_EMAIL`, and strong `ADMIN_PASSWORD` values. Bootstrap refuses to run if an admin already exists. Clear the temporary values after use.

## Operational limitations

No transactional online payment gateway, customer email/SMS sender, courier dispatch, or external notification provider is configured in this repository. In-app notifications are durable PostgreSQL records only. Keep the test environment and credentials isolated from production.
