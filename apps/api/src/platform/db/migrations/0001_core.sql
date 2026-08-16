-- Phase 0 core schema: users/RBAC, asset registry, audit log.
CREATE EXTENSION IF NOT EXISTS postgis;

-- TimescaleDB is required from Phase 1 (telemetry). Tolerate its absence so
-- Phase 0 also runs against a plain PostGIS database.
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS timescaledb;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'timescaledb extension not available; required from Phase 1 onward';
END
$$;

CREATE TYPE user_role AS ENUM ('admin', 'dispatcher', 'crew', 'viewer');
CREATE TYPE asset_status AS ENUM (
  'active', 'needs_attention', 'under_maintenance', 'out_of_service', 'decommissioned'
);
CREATE TYPE geometry_kind AS ENUM ('point', 'line', 'polygon');

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  display_name text NOT NULL,
  password_hash text NOT NULL,
  role user_role NOT NULL DEFAULT 'viewer',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER users_updated_at BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE asset_types (
  id text PRIMARY KEY,
  module text NOT NULL,
  name text NOT NULL,
  geometry_kind geometry_kind NOT NULL,
  style jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER asset_types_updated_at BEFORE UPDATE ON asset_types
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type_id text NOT NULL REFERENCES asset_types (id),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  geom geometry (Geometry, 4326) NOT NULL,
  status asset_status NOT NULL DEFAULT 'active',
  condition_score int CHECK (condition_score BETWEEN 1 AND 5),
  attributes jsonb NOT NULL DEFAULT '{}',
  parent_id uuid REFERENCES assets (id) ON DELETE SET NULL,
  installed_at date,
  decommissioned_at date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX assets_geom_gix ON assets USING gist (geom);
CREATE INDEX assets_attributes_gin ON assets USING gin (attributes);
CREATE INDEX assets_type_status_idx ON assets (type_id, status);
CREATE TRIGGER assets_updated_at BEFORE UPDATE ON assets
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE audit_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_id uuid REFERENCES users (id),
  actor_email text,
  action text NOT NULL,
  entity text,
  entity_id text,
  detail jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_created_idx ON audit_log (created_at DESC);
