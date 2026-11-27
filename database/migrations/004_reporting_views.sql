CREATE OR REPLACE VIEW reporting_order_items AS
SELECT
  o.id AS order_id,
  o.order_number,
  o.created_at,
  o.created_at::date AS order_date,
  o.user_id,
  o.customer_email,
  o.fulfillment,
  o.order_status,
  o.payment_status,
  o.payment_method,
  o.is_demo,
  oi.product_legacy_id AS product_id,
  oi.product_name_snapshot AS product_name,
  oi.product_category_snapshot AS category_slug,
  oi.quantity,
  oi.unit_price,
  oi.line_total,
  (NOT o.is_demo AND o.order_status <> 'cancelled' AND o.payment_status NOT IN ('failed','refunded')) AS counts_as_ordered_quantity,
  (NOT o.is_demo AND o.order_status <> 'cancelled' AND o.payment_status = 'paid') AS counts_as_paid_revenue
FROM orders o
JOIN order_items oi ON oi.order_id = o.id;

CREATE OR REPLACE VIEW reporting_daily_sales AS
SELECT
  o.created_at::date AS day,
  count(*) FILTER (WHERE NOT o.is_demo AND o.order_status <> 'cancelled')::integer AS placed_orders,
  count(*) FILTER (WHERE NOT o.is_demo AND o.order_status <> 'cancelled' AND o.payment_status = 'paid')::integer AS paid_orders,
  COALESCE(sum(o.total_amount) FILTER (WHERE NOT o.is_demo AND o.order_status <> 'cancelled' AND o.payment_status = 'paid'), 0)::numeric(14,2) AS paid_revenue,
  COALESCE(sum(o.total_amount) FILTER (WHERE NOT o.is_demo AND o.order_status <> 'cancelled' AND o.payment_status = 'pending'), 0)::numeric(14,2) AS pending_cash_value
FROM orders o
GROUP BY o.created_at::date;

CREATE OR REPLACE VIEW reporting_product_sales AS
SELECT
  ri.product_id,
  ri.product_name,
  sum(ri.quantity) FILTER (WHERE ri.counts_as_ordered_quantity)::bigint AS quantity_ordered,
  COALESCE(sum(ri.line_total) FILTER (WHERE ri.counts_as_ordered_quantity), 0)::numeric(14,2) AS item_sales,
  count(DISTINCT ri.order_id) FILTER (WHERE ri.counts_as_ordered_quantity)::integer AS order_count
FROM reporting_order_items ri
GROUP BY ri.product_id, ri.product_name;

CREATE OR REPLACE VIEW reporting_category_sales AS
SELECT
  ri.category_slug,
  sum(ri.quantity) FILTER (WHERE ri.counts_as_ordered_quantity)::bigint AS quantity_ordered,
  COALESCE(sum(ri.line_total) FILTER (WHERE ri.counts_as_ordered_quantity), 0)::numeric(14,2) AS item_sales,
  count(DISTINCT ri.order_id) FILTER (WHERE ri.counts_as_ordered_quantity)::integer AS order_count
FROM reporting_order_items ri
GROUP BY ri.category_slug;

CREATE OR REPLACE VIEW reporting_reservations_daily AS
SELECT
  reservation_date AS day,
  count(*) FILTER (WHERE NOT is_demo)::integer AS reservations,
  count(*) FILTER (WHERE NOT is_demo AND status IN ('pending','confirmed'))::integer AS active_reservations,
  COALESCE(sum(party_size) FILTER (WHERE NOT is_demo AND status IN ('pending','confirmed')), 0)::integer AS active_guests
FROM reservations
GROUP BY reservation_date;
