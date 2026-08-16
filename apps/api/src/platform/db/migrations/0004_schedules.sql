-- Phase 1: recurring maintenance schedules generating preventive work orders.

CREATE TABLE schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  module text NOT NULL,
  key text NOT NULL UNIQUE,
  name text NOT NULL,
  asset_type_id text NOT NULL REFERENCES asset_types (id),
  template_key text REFERENCES inspection_templates (key),
  interval_days int NOT NULL CHECK (interval_days > 0),
  priority work_order_priority NOT NULL DEFAULT 'medium',
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER schedules_updated_at BEFORE UPDATE ON schedules
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE work_orders ADD COLUMN schedule_id uuid REFERENCES schedules (id);
CREATE INDEX work_orders_schedule_idx ON work_orders (schedule_id, asset_id, created_at DESC);
