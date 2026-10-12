BEGIN;
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='flow_purger') THEN
    CREATE ROLE flow_purger NOLOGIN NOSUPERUSER NOBYPASSRLS;
  END IF;
END $$;
GRANT flow_purger TO CURRENT_USER;
GRANT USAGE,CREATE ON SCHEMA flow TO flow_purger;
CREATE TABLE IF NOT EXISTS flow.deleted_inputs (
  run_id TEXT NOT NULL,owner_id UUID NOT NULL DEFAULT nullif(current_setting('flow.owner',true),'')::uuid,
  PRIMARY KEY(owner_id,run_id)
);
CREATE TABLE IF NOT EXISTS flow.account_lifecycle (
  owner_id UUID PRIMARY KEY DEFAULT nullif(current_setting('flow.owner',true),'')::uuid,
  state TEXT NOT NULL CHECK(state='deleting')
);
ALTER TABLE flow.deleted_inputs ENABLE ROW LEVEL SECURITY;
ALTER TABLE flow.deleted_inputs FORCE ROW LEVEL SECURITY;
ALTER TABLE flow.account_lifecycle ENABLE ROW LEVEL SECURITY;
ALTER TABLE flow.account_lifecycle FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS account_deleted ON flow.deleted_inputs;
CREATE POLICY account_deleted ON flow.deleted_inputs TO flow_app,flow_purger
  USING(owner_id=nullif(current_setting('flow.owner',true),'')::uuid)
  WITH CHECK(owner_id=nullif(current_setting('flow.owner',true),'')::uuid);
DROP POLICY IF EXISTS account_lifecycle ON flow.account_lifecycle;
CREATE POLICY account_lifecycle ON flow.account_lifecycle TO flow_app,flow_purger
  USING(owner_id=nullif(current_setting('flow.owner',true),'')::uuid)
  WITH CHECK(owner_id=nullif(current_setting('flow.owner',true),'')::uuid);
DROP POLICY IF EXISTS account_events ON flow.events;
CREATE POLICY account_events ON flow.events TO flow_app,flow_purger
  USING(owner_id=nullif(current_setting('flow.owner',true),'')::uuid)
  WITH CHECK(owner_id=nullif(current_setting('flow.owner',true),'')::uuid);
DROP POLICY IF EXISTS account_drafts ON flow.annotation_drafts;
CREATE POLICY account_drafts ON flow.annotation_drafts TO flow_app,flow_purger
  USING(owner_id=nullif(current_setting('flow.owner',true),'')::uuid)
  WITH CHECK(owner_id=nullif(current_setting('flow.owner',true),'')::uuid);
REVOKE ALL ON flow.deleted_inputs,flow.account_lifecycle FROM PUBLIC;
GRANT SELECT ON flow.deleted_inputs,flow.account_lifecycle TO flow_app;
GRANT SELECT,DELETE ON flow.events,flow.annotation_drafts TO flow_purger;
GRANT SELECT,INSERT,DELETE ON flow.deleted_inputs TO flow_purger;
GRANT SELECT,INSERT ON flow.account_lifecycle TO flow_purger;

CREATE OR REPLACE FUNCTION flow.erase_input(input_id TEXT) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=flow,pg_catalog AS $$
DECLARE snapshots TEXT[];
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(current_setting('flow.owner'),0));
  SELECT array_agg(payload::jsonb->>'snapshot') INTO snapshots FROM flow.events
    WHERE run_id=input_id AND kind='annotation_split';
  DELETE FROM flow.events WHERE kind IN ('annotation_split','reviewed_benchmark')
    AND payload::jsonb->>'snapshot'=ANY(snapshots);
  DELETE FROM flow.annotation_drafts WHERE case_id=input_id;
  DELETE FROM flow.events WHERE run_id=input_id;
  INSERT INTO flow.deleted_inputs(run_id) VALUES(input_id) ON CONFLICT DO NOTHING;
END $$;
ALTER FUNCTION flow.erase_input(TEXT) OWNER TO flow_purger;
REVOKE ALL ON FUNCTION flow.erase_input(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION flow.erase_input(TEXT) TO flow_app;

CREATE OR REPLACE FUNCTION flow.erase_account() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=flow,pg_catalog AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(current_setting('flow.owner'),0));
  INSERT INTO flow.account_lifecycle(state) VALUES('deleting') ON CONFLICT DO NOTHING;
  DELETE FROM flow.annotation_drafts;
  DELETE FROM flow.events;
  DELETE FROM flow.deleted_inputs;
END $$;
ALTER FUNCTION flow.erase_account() OWNER TO flow_purger;
REVOKE ALL ON FUNCTION flow.erase_account() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION flow.erase_account() TO flow_app;
REVOKE CREATE ON SCHEMA flow FROM flow_purger;

CREATE OR REPLACE FUNCTION flow.guard_erasure() RETURNS trigger
LANGUAGE plpgsql SET search_path=flow,pg_catalog AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(current_setting('flow.owner'),0));
  IF EXISTS(SELECT FROM flow.account_lifecycle) THEN RAISE EXCEPTION 'Account deletion is pending.'; END IF;
  IF TG_TABLE_NAME='events' THEN
    IF EXISTS(SELECT FROM flow.deleted_inputs WHERE run_id=NEW.run_id) THEN RAISE EXCEPTION 'Saved input was deleted.'; END IF;
    IF NEW.kind='reviewed_benchmark' AND NOT EXISTS(SELECT FROM flow.events WHERE kind='annotation_split' AND payload::jsonb->>'snapshot'=NEW.payload::jsonb->>'snapshot') THEN
      RAISE EXCEPTION 'Reviewed snapshot was deleted.';
    END IF;
  ELSE
    IF EXISTS(SELECT FROM flow.deleted_inputs WHERE run_id=NEW.case_id) THEN RAISE EXCEPTION 'Saved input was deleted.'; END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS erasure_guard ON flow.events;
CREATE TRIGGER erasure_guard BEFORE INSERT ON flow.events FOR EACH ROW EXECUTE FUNCTION flow.guard_erasure();
DROP TRIGGER IF EXISTS erasure_guard ON flow.annotation_drafts;
CREATE TRIGGER erasure_guard BEFORE INSERT OR UPDATE ON flow.annotation_drafts FOR EACH ROW EXECUTE FUNCTION flow.guard_erasure();
COMMIT;
