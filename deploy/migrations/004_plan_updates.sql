-- Erasing a source also erases every follow-up containing a copy of that source.
BEGIN;
GRANT CREATE ON SCHEMA flow TO flow_purger;
CREATE OR REPLACE FUNCTION flow.erase_input(input_id TEXT) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=flow,pg_catalog AS $$
DECLARE snapshots TEXT[]; inputs TEXT[];
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(current_setting('flow.owner'),0));
  WITH RECURSIVE descendants(id) AS (
    SELECT input_id
    UNION
    SELECT e.run_id FROM flow.events e JOIN descendants d
      ON e.payload::jsonb #>> '{settings,plan_update,base_run_id}'=d.id
      WHERE e.kind='extraction'
  ) SELECT array_agg(id) INTO inputs FROM descendants;
  SELECT array_agg(payload::jsonb->>'snapshot') INTO snapshots FROM flow.events
    WHERE run_id=ANY(inputs) AND kind='annotation_split';
  DELETE FROM flow.events WHERE kind IN ('annotation_split','reviewed_benchmark')
    AND payload::jsonb->>'snapshot'=ANY(snapshots);
  DELETE FROM flow.annotation_drafts WHERE case_id=ANY(inputs);
  DELETE FROM flow.events WHERE run_id=ANY(inputs);
  INSERT INTO flow.deleted_inputs(run_id) SELECT unnest(inputs) ON CONFLICT DO NOTHING;
END $$;
ALTER FUNCTION flow.erase_input(TEXT) OWNER TO flow_purger;
REVOKE ALL ON FUNCTION flow.erase_input(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION flow.erase_input(TEXT) TO flow_app;
REVOKE CREATE ON SCHEMA flow FROM flow_purger;
COMMIT;
