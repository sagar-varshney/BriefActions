-- Cross-meeting agendas contain copied task text. Erase dependent versions too.
BEGIN;
GRANT CREATE ON SCHEMA flow TO flow_purger;
CREATE OR REPLACE FUNCTION flow.series_agenda_erasure_version() RETURNS INTEGER
LANGUAGE sql IMMUTABLE SET search_path=flow,pg_catalog AS $$ SELECT 5 $$;
ALTER FUNCTION flow.series_agenda_erasure_version() OWNER TO flow_purger;
REVOKE ALL ON FUNCTION flow.series_agenda_erasure_version() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION flow.series_agenda_erasure_version() TO flow_app;
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
  DELETE FROM flow.events a WHERE a.kind='series_agenda' AND EXISTS (
    SELECT 1 FROM jsonb_array_elements_text(a.payload::jsonb->'source_run_ids') source(id)
    WHERE source.id=ANY(inputs)
  );
  DELETE FROM flow.annotation_drafts WHERE case_id=ANY(inputs);
  DELETE FROM flow.events WHERE run_id=ANY(inputs);
  INSERT INTO flow.deleted_inputs(run_id) SELECT unnest(inputs) ON CONFLICT DO NOTHING;
END $$;
ALTER FUNCTION flow.erase_input(TEXT) OWNER TO flow_purger;
REVOKE ALL ON FUNCTION flow.erase_input(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION flow.erase_input(TEXT) TO flow_app;
REVOKE CREATE ON SCHEMA flow FROM flow_purger;
COMMIT;
