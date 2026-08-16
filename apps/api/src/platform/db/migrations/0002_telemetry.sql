-- Phase 1: sensor telemetry, alert rules, incidents.

CREATE TABLE sensors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id uuid REFERENCES assets (id) ON DELETE SET NULL,
  kind text NOT NULL,
  external_id text NOT NULL UNIQUE,
  unit text NOT NULL,
  geom geometry (Point, 4326),
  config jsonb NOT NULL DEFAULT '{}',
  last_seen_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sensors_kind_idx ON sensors (kind);
CREATE TRIGGER sensors_updated_at BEFORE UPDATE ON sensors
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE readings (
  sensor_id uuid NOT NULL REFERENCES sensors (id) ON DELETE CASCADE,
  ts timestamptz NOT NULL,
  value double precision NOT NULL,
  quality text NOT NULL DEFAULT 'good' CHECK (quality IN ('good', 'suspect', 'bad')),
  PRIMARY KEY (sensor_id, ts)
);

-- Convert readings to a hypertable when TimescaleDB is present; degrade to a
-- plain table (with the PK index) otherwise.
DO $$
BEGIN
  PERFORM create_hypertable('readings', 'ts', if_not_exists => TRUE);
EXCEPTION WHEN undefined_function THEN
  RAISE NOTICE 'timescaledb not installed; readings remains a plain table';
END
$$;

CREATE TYPE incident_severity AS ENUM ('info', 'warning', 'critical');
CREATE TYPE incident_status AS ENUM ('open', 'acknowledged', 'resolved');

CREATE TABLE alert_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  module text NOT NULL,
  key text NOT NULL UNIQUE,
  name text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('threshold', 'rate_of_change', 'absence')),
  sensor_kind text NOT NULL,
  params jsonb NOT NULL DEFAULT '{}',
  severity incident_severity NOT NULL DEFAULT 'warning',
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER alert_rules_updated_at BEFORE UPDATE ON alert_rules
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE incidents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id uuid REFERENCES alert_rules (id) ON DELETE SET NULL,
  sensor_id uuid REFERENCES sensors (id) ON DELETE SET NULL,
  asset_id uuid REFERENCES assets (id) ON DELETE SET NULL,
  severity incident_severity NOT NULL,
  status incident_status NOT NULL DEFAULT 'open',
  title text NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}',
  opened_at timestamptz NOT NULL DEFAULT now(),
  acknowledged_at timestamptz,
  acknowledged_by uuid REFERENCES users (id),
  resolved_at timestamptz,
  resolved_by uuid REFERENCES users (id),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX incidents_status_idx ON incidents (status, opened_at DESC);
-- De-duplication: at most one unresolved incident per (rule, sensor).
CREATE UNIQUE INDEX incidents_open_rule_sensor_uq
  ON incidents (rule_id, sensor_id) WHERE status <> 'resolved';
CREATE TRIGGER incidents_updated_at BEFORE UPDATE ON incidents
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
