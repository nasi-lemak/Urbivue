-- Device security: per-sensor credentials. The plaintext key is returned
-- exactly once at issuance; the API stores a SHA-256 digest (for HTTP
-- ingest verification) and a mosquitto-format PBKDF2 hash (exported into
-- the broker's password file).

ALTER TABLE sensors ADD COLUMN ingest_key_hash text;
ALTER TABLE sensors ADD COLUMN mqtt_password_hash text;
ALTER TABLE sensors ADD COLUMN key_issued_at timestamptz;
ALTER TABLE sensors ADD COLUMN key_revoked_at timestamptz;
