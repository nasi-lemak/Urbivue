-- Zones: named administrative/operational polygons (wards, catchments,
-- collection routes). Assets, sensors, incidents, and reports relate to
-- zones spatially — no foreign keys to maintain as boundaries change.

CREATE TABLE zones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  kind text NOT NULL
    CHECK (kind IN ('ward', 'catchment', 'collection_route', 'custom')),
  geom geometry (Geometry, 4326) NOT NULL
    CHECK (ST_GeometryType(geom) IN ('ST_Polygon', 'ST_MultiPolygon')),
  attributes jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX zones_geom_gix ON zones USING gist (geom);
CREATE TRIGGER zones_updated_at BEFORE UPDATE ON zones
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
