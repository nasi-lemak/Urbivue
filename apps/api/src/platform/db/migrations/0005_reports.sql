-- Phase 2: citizen reports.

CREATE TYPE report_status AS ENUM ('new', 'triaged', 'in_progress', 'resolved', 'closed');

CREATE TABLE citizen_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category text NOT NULL,
  module text NOT NULL,
  description text NOT NULL,
  geom geometry (Point, 4326) NOT NULL,
  reporter_contact text,
  status report_status NOT NULL DEFAULT 'new',
  matched_asset_id uuid REFERENCES assets (id),
  duplicate_of_id uuid REFERENCES citizen_reports (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX citizen_reports_geom_gix ON citizen_reports USING gist (geom);
CREATE INDEX citizen_reports_status_idx ON citizen_reports (status, created_at DESC);
CREATE TRIGGER citizen_reports_updated_at BEFORE UPDATE ON citizen_reports
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE work_orders ADD COLUMN citizen_report_id uuid REFERENCES citizen_reports (id);
