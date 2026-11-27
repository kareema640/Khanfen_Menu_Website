ALTER TABLE order_items
  ADD COLUMN product_category_snapshot TEXT NOT NULL DEFAULT '';

ALTER TABLE orders
  ADD CONSTRAINT orders_discount_not_above_subtotal CHECK (discount_amount <= subtotal),
  ADD CONSTRAINT orders_total_reconciles CHECK (total_amount = subtotal - discount_amount + delivery_fee),
  ADD CONSTRAINT orders_pickup_has_no_delivery_fee CHECK (fulfillment <> 'pickup' OR delivery_fee = 0);

CREATE INDEX reservations_customer_email_idx ON reservations(lower(customer_email), reservation_date DESC);
CREATE INDEX reviews_customer_created_idx ON reviews(lower(customer_email), created_at DESC) WHERE customer_email IS NOT NULL;
CREATE INDEX idempotency_expires_idx ON idempotency_keys(expires_at);
