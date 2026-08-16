-- Phase 4: public facility ratings (toilets first; any asset can be rated).

CREATE TABLE facility_ratings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id uuid NOT NULL REFERENCES assets (id) ON DELETE CASCADE,
  stars int NOT NULL CHECK (stars BETWEEN 1 AND 5),
  comment text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX facility_ratings_asset_idx ON facility_ratings (asset_id, created_at DESC);
