-- Run these parameterized examples in a PostgreSQL client that supports bind parameters.
-- Replace $1/$2 with quoted YYYY-MM-DD values when running a query directly in plain psql.

-- 1. Inclusive date-range totals by day. Revenue means paid, non-demo, non-cancelled orders.
SELECT day, placed_orders, paid_orders, paid_revenue, pending_cash_value
FROM reporting_daily_sales
WHERE ($1::date IS NULL OR day >= $1::date)
  AND ($2::date IS NULL OR day <= $2::date)
ORDER BY day;

-- 2. Date-range totals by week (weeks start Monday) and month.
SELECT date_trunc('week', day)::date AS week_start,
       sum(placed_orders)::bigint AS placed_orders,
       sum(paid_orders)::bigint AS paid_orders,
       sum(paid_revenue)::numeric(14,2) AS paid_revenue
FROM reporting_daily_sales
WHERE ($1::date IS NULL OR day >= $1::date)
  AND ($2::date IS NULL OR day <= $2::date)
GROUP BY 1 ORDER BY 1;

SELECT date_trunc('month', day)::date AS month_start,
       sum(placed_orders)::bigint AS placed_orders,
       sum(paid_orders)::bigint AS paid_orders,
       sum(paid_revenue)::numeric(14,2) AS paid_revenue
FROM reporting_daily_sales
WHERE ($1::date IS NULL OR day >= $1::date)
  AND ($2::date IS NULL OR day <= $2::date)
GROUP BY 1 ORDER BY 1;

-- 3. Product performance from immutable item snapshots.
SELECT product_id, product_name, quantity_ordered, item_sales, order_count
FROM reporting_product_sales
ORDER BY quantity_ordered DESC, item_sales DESC;

-- 4. Product sales joined to the snapshotted category slug (not the product's current category).
SELECT category_slug, quantity_ordered, item_sales, order_count
FROM reporting_category_sales
ORDER BY item_sales DESC;

-- 5. Customers with at least :minimum_orders eligible non-demo orders.
-- Customer identity is derived from email; the result contains personal data and must remain owner-only.
SELECT lower(trim(customer_email)) AS customer_email, count(*)::bigint AS order_count,
       sum(total_amount) FILTER (WHERE payment_status='paid')::numeric(14,2) AS paid_revenue
FROM orders
WHERE is_demo=FALSE AND order_status<>'cancelled' AND customer_email IS NOT NULL
GROUP BY lower(trim(customer_email))
HAVING count(*) >= $1
ORDER BY order_count DESC, paid_revenue DESC;

-- 6. Products never ordered in eligible non-demo orders; preserves currently active products with zero sales.
SELECT p.legacy_id, p.name, c.slug AS category_slug
FROM products p JOIN categories c ON c.id=p.category_id
LEFT JOIN reporting_product_sales s ON s.product_id=p.legacy_id AND s.quantity_ordered>0
WHERE p.is_active=TRUE AND s.product_id IS NULL
ORDER BY c.sort_order, p.name;

-- 7. Reservation totals, active guests, and statuses by day (demo reservations excluded).
SELECT day, reservations, active_reservations, active_guests
FROM reporting_reservations_daily
WHERE ($1::date IS NULL OR day >= $1::date)
  AND ($2::date IS NULL OR day <= $2::date)
ORDER BY day;

-- 8. Review summary. Public display uses only approved, non-demo reviews.
SELECT count(*)::integer AS review_count,
       round(avg(rating)::numeric,2) AS average_rating
FROM reviews WHERE moderation_status='approved' AND is_demo=FALSE;
