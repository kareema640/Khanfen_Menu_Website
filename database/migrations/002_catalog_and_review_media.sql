ALTER TABLE categories
  ADD COLUMN parent_id UUID REFERENCES categories(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  ADD COLUMN is_group BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE reviews
  ADD COLUMN photo_mime TEXT CHECK (photo_mime IS NULL OR photo_mime IN ('image/jpeg','image/png')),
  ADD COLUMN photo_data BYTEA,
  ADD COLUMN photo_bytes INTEGER CHECK (photo_bytes IS NULL OR photo_bytes BETWEEN 0 AND 5242880);

CREATE INDEX categories_parent_sort_idx ON categories(parent_id, sort_order);
CREATE INDEX reviews_approved_rating_idx ON reviews(rating) WHERE moderation_status = 'approved' AND is_demo = FALSE;
