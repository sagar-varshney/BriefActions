-- Stable identity binds an erasure ledger to its own application database.
BEGIN;
CREATE TABLE IF NOT EXISTS flow.backup_metadata (
  singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK(singleton),
  database_id UUID NOT NULL DEFAULT gen_random_uuid()
);
INSERT INTO flow.backup_metadata(singleton) VALUES(TRUE) ON CONFLICT DO NOTHING;
REVOKE ALL ON flow.backup_metadata FROM PUBLIC,flow_app,flow_purger;
COMMIT;
