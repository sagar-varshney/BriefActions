-- Run once with the database administrator, never a browser key.
BEGIN;
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'flow_app') THEN
    CREATE ROLE flow_app NOLOGIN NOSUPERUSER NOBYPASSRLS;
  END IF;
END $$;
GRANT flow_app TO CURRENT_USER;
CREATE SCHEMA IF NOT EXISTS flow;
REVOKE ALL ON SCHEMA flow FROM PUBLIC;
GRANT USAGE ON SCHEMA flow TO flow_app;
CREATE TABLE IF NOT EXISTS flow.events (
  event_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  run_id TEXT NOT NULL, kind TEXT NOT NULL, created_at TEXT NOT NULL, payload TEXT NOT NULL,
  owner_id UUID NOT NULL DEFAULT nullif(current_setting('flow.owner', true),'')::uuid
);
CREATE INDEX IF NOT EXISTS events_run ON flow.events(owner_id,run_id,event_id);
CREATE TABLE IF NOT EXISTS flow.annotation_drafts (
  case_id TEXT NOT NULL, reviewer_key TEXT NOT NULL, mode TEXT NOT NULL,
  version INTEGER NOT NULL, updated_at TEXT NOT NULL, payload TEXT NOT NULL,
  owner_id UUID NOT NULL DEFAULT nullif(current_setting('flow.owner', true),'')::uuid,
  PRIMARY KEY(owner_id,case_id,reviewer_key,mode)
);
ALTER TABLE flow.events ENABLE ROW LEVEL SECURITY;
ALTER TABLE flow.events FORCE ROW LEVEL SECURITY;
ALTER TABLE flow.annotation_drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE flow.annotation_drafts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS account_events ON flow.events;
CREATE POLICY account_events ON flow.events TO flow_app
  USING (owner_id = nullif(current_setting('flow.owner', true),'')::uuid)
  WITH CHECK (owner_id = nullif(current_setting('flow.owner', true),'')::uuid);
DROP POLICY IF EXISTS account_drafts ON flow.annotation_drafts;
CREATE POLICY account_drafts ON flow.annotation_drafts TO flow_app
  USING (owner_id = nullif(current_setting('flow.owner', true),'')::uuid)
  WITH CHECK (owner_id = nullif(current_setting('flow.owner', true),'')::uuid);
REVOKE ALL ON flow.events,flow.annotation_drafts FROM PUBLIC;
GRANT SELECT,INSERT ON flow.events TO flow_app;
GRANT SELECT,INSERT,UPDATE,DELETE ON flow.annotation_drafts TO flow_app;
GRANT USAGE ON SEQUENCE flow.events_event_id_seq TO flow_app;
-- Bound account growth on shared free-tier storage. The same transaction lock
-- also prevents simultaneous writes from racing the quota calculation.
CREATE OR REPLACE FUNCTION flow.check_storage_budget() RETURNS trigger
LANGUAGE plpgsql SET search_path = flow,pg_catalog AS $$
DECLARE used_bytes BIGINT;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(current_setting('flow.owner'),0));
  IF TG_TABLE_NAME = 'events' THEN
    SELECT coalesce(sum(octet_length(payload)),0) INTO used_bytes FROM flow.events;
    IF used_bytes + octet_length(NEW.payload) > 25000000 THEN
      RAISE EXCEPTION 'Workspace history storage limit reached (25 MB).';
    END IF;
  ELSE
    SELECT coalesce(sum(octet_length(payload)),0) INTO used_bytes FROM flow.annotation_drafts
      WHERE NOT (case_id=NEW.case_id AND reviewer_key=NEW.reviewer_key AND mode=NEW.mode);
    IF used_bytes + octet_length(NEW.payload) > 5000000 THEN
      RAISE EXCEPTION 'Workspace draft storage limit reached (5 MB).';
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS storage_budget ON flow.events;
CREATE TRIGGER storage_budget BEFORE INSERT ON flow.events FOR EACH ROW EXECUTE FUNCTION flow.check_storage_budget();
DROP TRIGGER IF EXISTS storage_budget ON flow.annotation_drafts;
CREATE TRIGGER storage_budget BEFORE INSERT OR UPDATE ON flow.annotation_drafts FOR EACH ROW EXECUTE FUNCTION flow.check_storage_budget();
COMMIT;
