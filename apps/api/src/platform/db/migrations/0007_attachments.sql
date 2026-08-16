-- Hardening: photo/file attachments for inspections, work orders, and
-- citizen reports. Files live on disk (ATTACHMENTS_DIR); rows are metadata.

CREATE TABLE attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_kind text NOT NULL
    CHECK (entity_kind IN ('inspection', 'work_order', 'citizen_report')),
  entity_id uuid NOT NULL,
  original_name text NOT NULL,
  mime text NOT NULL,
  size_bytes int NOT NULL,
  storage_path text NOT NULL,
  uploaded_by uuid REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX attachments_entity_idx ON attachments (entity_kind, entity_id);
