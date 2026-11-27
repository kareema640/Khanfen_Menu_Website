BEGIN;

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name TEXT NOT NULL CHECK (length(trim(full_name)) BETWEEN 2 AND 120),
  email TEXT NOT NULL,
  email_normalized TEXT GENERATED ALWAYS AS (lower(trim(email))) STORED UNIQUE,
  phone TEXT,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'customer' CHECK (role IN ('customer', 'admin')),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  image_path TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  legacy_id TEXT NOT NULL UNIQUE,
  slug TEXT NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  category_id UUID NOT NULL REFERENCES categories(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  price NUMERIC(12,2) NOT NULL CHECK (price >= 0),
  currency_code CHAR(3) NOT NULL DEFAULT 'USD',
  image_path TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  is_available BOOLEAN NOT NULL DEFAULT TRUE,
  is_featured BOOLEAN NOT NULL DEFAULT FALSE,
  stock_quantity INTEGER CHECK (stock_quantity IS NULL OR stock_quantity >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE addons (
  id TEXT PRIMARY KEY CHECK (id ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  label TEXT NOT NULL,
  price NUMERIC(12,2) NOT NULL CHECK (price >= 0),
  group_key TEXT NOT NULL CHECK (group_key IN ('savory', 'sweet', 'drink')),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE promotions (
  code TEXT PRIMARY KEY CHECK (code = upper(code)),
  description TEXT NOT NULL DEFAULT '',
  discount_type TEXT NOT NULL CHECK (discount_type IN ('percent', 'fixed', 'free_delivery')),
  discount_value NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (discount_value >= 0),
  minimum_subtotal NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (minimum_subtotal >= 0),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  starts_at TIMESTAMPTZ,
  ends_at TIMESTAMPTZ,
  CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at > starts_at)
);

CREATE TABLE restaurant_settings (
  id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  timezone TEXT NOT NULL DEFAULT 'Africa/Cairo',
  currency_code CHAR(3) NOT NULL DEFAULT 'USD',
  delivery_fee NUMERIC(12,2) NOT NULL DEFAULT 5 CHECK (delivery_fee >= 0),
  pickup_fee NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (pickup_fee >= 0),
  large_size_surcharge NUMERIC(12,2) NOT NULL DEFAULT 2 CHECK (large_size_surcharge >= 0),
  reservation_slot_minutes INTEGER NOT NULL DEFAULT 30 CHECK (reservation_slot_minutes BETWEEN 15 AND 240),
  reservation_duration_minutes INTEGER NOT NULL DEFAULT 90 CHECK (reservation_duration_minutes BETWEEN 15 AND 480),
  max_reservations_per_slot INTEGER NOT NULL DEFAULT 2 CHECK (max_reservations_per_slot > 0),
  max_party_size INTEGER NOT NULL DEFAULT 20 CHECK (max_party_size BETWEEN 1 AND 100),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE restaurant_hours (
  weekday SMALLINT PRIMARY KEY CHECK (weekday BETWEEN 0 AND 6),
  opens_at TIME,
  closes_at TIME,
  is_closed BOOLEAN NOT NULL DEFAULT FALSE,
  CHECK (is_closed OR (opens_at IS NOT NULL AND closes_at IS NOT NULL AND closes_at > opens_at))
);

CREATE TABLE orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number TEXT NOT NULL UNIQUE,
  tracking_token_hash TEXT NOT NULL UNIQUE,
  user_id UUID REFERENCES users(id) ON UPDATE CASCADE ON DELETE SET NULL,
  customer_name TEXT NOT NULL CHECK (length(trim(customer_name)) BETWEEN 2 AND 120),
  customer_phone TEXT NOT NULL,
  customer_email TEXT,
  fulfillment TEXT NOT NULL CHECK (fulfillment IN ('delivery', 'pickup')),
  order_status TEXT NOT NULL DEFAULT 'pending' CHECK (order_status IN ('pending','confirmed','preparing','ready_for_pickup','out_for_delivery','delivered','completed','cancelled')),
  payment_status TEXT NOT NULL DEFAULT 'pending' CHECK (payment_status IN ('pending','paid','failed','refunded')),
  payment_method TEXT NOT NULL CHECK (payment_method IN ('cash-delivery','cash-pickup','card','online')),
  delivery_address TEXT,
  delivery_instructions TEXT NOT NULL DEFAULT '',
  pickup_time TEXT,
  customer_notes TEXT NOT NULL DEFAULT '',
  promo_code TEXT,
  subtotal NUMERIC(12,2) NOT NULL CHECK (subtotal >= 0),
  discount_amount NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
  delivery_fee NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (delivery_fee >= 0),
  total_amount NUMERIC(12,2) NOT NULL CHECK (total_amount >= 0),
  currency_code CHAR(3) NOT NULL DEFAULT 'USD',
  estimated_arrival_at TIMESTAMPTZ,
  delivery_location JSONB,
  courier_phone TEXT,
  is_demo BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((fulfillment = 'delivery' AND length(trim(coalesce(delivery_address,''))) >= 5) OR (fulfillment = 'pickup' AND delivery_address IS NULL)),
  CHECK ((fulfillment = 'delivery' AND payment_method IN ('cash-delivery','card','online')) OR (fulfillment = 'pickup' AND payment_method IN ('cash-pickup','card','online')))
);

CREATE TABLE order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id UUID REFERENCES products(id) ON UPDATE CASCADE ON DELETE SET NULL,
  product_legacy_id TEXT NOT NULL,
  product_name_snapshot TEXT NOT NULL,
  product_slug_snapshot TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 99),
  size_name TEXT NOT NULL DEFAULT 'Regular' CHECK (size_name IN ('Regular','Large')),
  unit_price NUMERIC(12,2) NOT NULL CHECK (unit_price >= 0),
  line_total NUMERIC(12,2) NOT NULL CHECK (line_total >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE order_item_options (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_item_id UUID NOT NULL REFERENCES order_items(id) ON DELETE CASCADE,
  option_id TEXT NOT NULL,
  option_label_snapshot TEXT NOT NULL,
  unit_price_snapshot NUMERIC(12,2) NOT NULL CHECK (unit_price_snapshot >= 0)
);

CREATE TABLE payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  amount NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
  currency_code CHAR(3) NOT NULL DEFAULT 'USD',
  payment_method TEXT NOT NULL CHECK (payment_method IN ('cash-delivery','cash-pickup','card','online')),
  payment_status TEXT NOT NULL DEFAULT 'pending' CHECK (payment_status IN ('pending','paid','failed','refunded')),
  provider TEXT,
  provider_reference TEXT,
  non_sensitive_details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_reference)
);

CREATE TABLE order_status_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  previous_status TEXT,
  new_status TEXT NOT NULL CHECK (new_status IN ('pending','confirmed','preparing','ready_for_pickup','out_for_delivery','delivered','completed','cancelled')),
  changed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  note TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE reservations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_number TEXT NOT NULL UNIQUE,
  user_id UUID REFERENCES users(id) ON UPDATE CASCADE ON DELETE SET NULL,
  customer_name TEXT NOT NULL CHECK (length(trim(customer_name)) BETWEEN 2 AND 120),
  customer_phone TEXT NOT NULL,
  customer_email TEXT NOT NULL,
  party_size INTEGER NOT NULL CHECK (party_size BETWEEN 1 AND 100),
  party_size_label TEXT NOT NULL,
  reservation_date DATE NOT NULL,
  reservation_time TIME NOT NULL,
  duration_minutes INTEGER NOT NULL DEFAULT 90 CHECK (duration_minutes BETWEEN 15 AND 480),
  special_requests TEXT NOT NULL DEFAULT '',
  occasion TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','confirmed','rejected','cancelled','completed')),
  pre_order_total NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (pre_order_total >= 0),
  is_demo BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE reservation_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_id UUID NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
  product_id UUID REFERENCES products(id) ON UPDATE CASCADE ON DELETE SET NULL,
  product_legacy_id TEXT NOT NULL,
  product_name_snapshot TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 50),
  unit_price NUMERIC(12,2) NOT NULL CHECK (unit_price >= 0),
  line_total NUMERIC(12,2) NOT NULL CHECK (line_total >= 0)
);

CREATE TABLE reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON UPDATE CASCADE ON DELETE SET NULL,
  customer_name TEXT NOT NULL CHECK (length(trim(customer_name)) BETWEEN 2 AND 120),
  customer_email TEXT,
  rating SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  review_text TEXT NOT NULL CHECK (length(trim(review_text)) BETWEEN 20 AND 500),
  photo_url TEXT,
  moderation_status TEXT NOT NULL DEFAULT 'pending' CHECK (moderation_status IN ('pending','approved','rejected')),
  is_demo BOOLEAN NOT NULL DEFAULT FALSE,
  idempotency_key TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON UPDATE CASCADE ON DELETE CASCADE,
  order_id UUID REFERENCES orders(id) ON DELETE CASCADE,
  guest_token_hash TEXT,
  event_key TEXT NOT NULL,
  notification_type TEXT NOT NULL CHECK (notification_type IN ('order_placed','order_status','reservation_status','general')),
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (order_id, event_key)
);

CREATE TABLE idempotency_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key TEXT NOT NULL UNIQUE,
  request_hash TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id UUID,
  response_payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '7 days')
);

CREATE TABLE sessions (
  sid VARCHAR PRIMARY KEY,
  sess JSON NOT NULL,
  expire TIMESTAMP(6) NOT NULL
);

CREATE INDEX users_role_active_idx ON users(role, is_active);
CREATE INDEX categories_active_order_idx ON categories(is_active, sort_order);
CREATE INDEX products_category_active_idx ON products(category_id, is_active, is_available);
CREATE INDEX products_featured_active_idx ON products(is_featured, is_active, is_available);
CREATE INDEX orders_status_created_idx ON orders(order_status, created_at DESC);
CREATE INDEX orders_type_created_idx ON orders(fulfillment, created_at DESC);
CREATE INDEX orders_user_created_idx ON orders(user_id, created_at DESC) WHERE user_id IS NOT NULL;
CREATE INDEX orders_tracking_hash_idx ON orders(tracking_token_hash);
CREATE INDEX order_items_order_idx ON order_items(order_id);
CREATE INDEX order_items_product_idx ON order_items(product_id) WHERE product_id IS NOT NULL;
CREATE INDEX payments_order_created_idx ON payments(order_id, created_at DESC);
CREATE INDEX reservations_date_time_status_idx ON reservations(reservation_date, reservation_time, status);
CREATE INDEX reservations_created_idx ON reservations(created_at DESC);
CREATE INDEX reviews_public_created_idx ON reviews(moderation_status, created_at DESC) WHERE is_demo = FALSE;
CREATE INDEX notifications_user_unread_idx ON notifications(user_id, read_at, created_at DESC) WHERE user_id IS NOT NULL;
CREATE INDEX notifications_guest_token_idx ON notifications(guest_token_hash) WHERE guest_token_hash IS NOT NULL;
CREATE INDEX order_status_history_order_created_idx ON order_status_history(order_id, created_at);
CREATE INDEX sessions_expire_idx ON sessions(expire);
CREATE INDEX idempotency_expire_idx ON idempotency_keys(expires_at);

INSERT INTO restaurant_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
INSERT INTO restaurant_hours (weekday, opens_at, closes_at, is_closed)
SELECT day, '08:00'::time, '12:00'::time, FALSE FROM generate_series(0,6) AS day
ON CONFLICT (weekday) DO NOTHING;

INSERT INTO addons (id,label,price,group_key,sort_order) VALUES
('bacon','Crispy turkey bacon',2,'savory',1),
('avocado','Avocado',1.5,'savory',2),
('hashbrown','Hash brown',1,'savory',3),
('nutella','Extra Nutella drizzle',1.5,'sweet',1),
('strawberries','Fresh strawberries',2,'sweet',2),
('icecream','Vanilla ice cream scoop',2.5,'sweet',3),
('espresso','Extra espresso shot',1.5,'drink',1),
('oatmilk','Oat / Almond milk',1,'drink',2),
('syrup','Caramel / Vanilla syrup',1,'drink',3)
ON CONFLICT (id) DO NOTHING;

INSERT INTO promotions (code,description,discount_type,discount_value,minimum_subtotal) VALUES
('KHANFEM10','10% off subtotal','percent',10,0),
('MORNING15','15% off subtotal','percent',15,0),
('FREEDEL','Waive delivery fee','free_delivery',0,0),
('SAVE5','$5 off eligible subtotal','fixed',5,20)
ON CONFLICT (code) DO NOTHING;

COMMIT;
