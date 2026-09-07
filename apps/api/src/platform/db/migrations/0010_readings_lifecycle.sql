-- Readings lifecycle: compress old chunks, drop ancient ones.
--
-- Chunks older than 7 days are columnar-compressed (segmented per sensor, so
-- per-sensor history scans stay fast); raw data older than 365 days is dropped
-- entirely. Adjust retention on a live system with:
--   SELECT remove_retention_policy('readings');
--   SELECT add_retention_policy('readings', INTERVAL '730 days');
--
-- Like 0002, this degrades to a no-op on plain Postgres (no TimescaleDB) —
-- there the manual DELETE in docs/DEPLOYMENT.md §5 remains the fallback.

DO $$
BEGIN
  ALTER TABLE readings SET (
    timescaledb.compress,
    timescaledb.compress_segmentby = 'sensor_id',
    timescaledb.compress_orderby = 'ts DESC'
  );
  PERFORM add_compression_policy('readings', INTERVAL '7 days', if_not_exists => TRUE);
  PERFORM add_retention_policy('readings', INTERVAL '365 days', if_not_exists => TRUE);
EXCEPTION
  WHEN undefined_function OR undefined_object OR invalid_parameter_value THEN
    RAISE NOTICE 'timescaledb not installed; skipping readings compression/retention';
END
$$;
