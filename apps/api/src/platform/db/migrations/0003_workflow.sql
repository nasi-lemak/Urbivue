-- Phase 1: inspections and work orders.

CREATE TABLE inspection_templates (
  key text PRIMARY KEY,
  asset_type_id text NOT NULL REFERENCES asset_types (id),
  name text NOT NULL,
  items jsonb NOT NULL DEFAULT '[]',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER inspection_templates_updated_at BEFORE UPDATE ON inspection_templates
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE inspections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id uuid NOT NULL REFERENCES assets (id),
  template_key text NOT NULL REFERENCES inspection_templates (key),
  inspector_id uuid REFERENCES users (id),
  performed_at timestamptz NOT NULL DEFAULT now(),
  responses jsonb NOT NULL DEFAULT '{}',
  condition_score int CHECK (condition_score BETWEEN 1 AND 5),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX inspections_asset_idx ON inspections (asset_id, performed_at DESC);

CREATE TYPE work_order_status AS ENUM (
  'open', 'assigned', 'in_progress', 'done', 'verified', 'cancelled'
);
CREATE TYPE work_order_kind AS ENUM ('corrective', 'preventive', 'emergency');
CREATE TYPE work_order_priority AS ENUM ('low', 'medium', 'high', 'urgent');

CREATE SEQUENCE work_order_code_seq;

CREATE TABLE work_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE
    DEFAULT ('WO-' || lpad(nextval('work_order_code_seq')::text, 5, '0')),
  asset_id uuid REFERENCES assets (id),
  incident_id uuid REFERENCES incidents (id),
  inspection_id uuid REFERENCES inspections (id),
  kind work_order_kind NOT NULL DEFAULT 'corrective',
  priority work_order_priority NOT NULL DEFAULT 'medium',
  status work_order_status NOT NULL DEFAULT 'open',
  title text NOT NULL,
  description text,
  assignee_id uuid REFERENCES users (id),
  opened_by uuid REFERENCES users (id),
  assigned_at timestamptz,
  started_at timestamptz,
  done_at timestamptz,
  verified_at timestamptz,
  cancelled_at timestamptz,
  completion_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX work_orders_status_idx ON work_orders (status, created_at DESC);
CREATE INDEX work_orders_asset_idx ON work_orders (asset_id);
CREATE TRIGGER work_orders_updated_at BEFORE UPDATE ON work_orders
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
