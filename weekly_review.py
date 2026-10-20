"""Read-only weekly follow-through, using device-zone completion dates and current plans."""
from datetime import date, datetime, time, timedelta, timezone
import json
import re
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from data_controls import DataError
from task_dashboard import projection_sql


def overview(history, *, today=None, time_zone='UTC', view='completed', page=0, page_size=8):
    try:
        if not isinstance(today,str) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}',today):raise ValueError()
        day=date.fromisoformat(today);start=day-timedelta(days=6);after=day+timedelta(days=1);soon=day+timedelta(days=7)
        if not isinstance(time_zone,str) or not 1<=len(time_zone)<=100:raise ValueError()
        zone=ZoneInfo(time_zone)
        begin=datetime.combine(start,time.min,zone).astimezone(timezone.utc).isoformat()
        end=datetime.combine(after,time.min,zone).astimezone(timezone.utc).isoformat()
    except (ValueError,OverflowError,ZoneInfoNotFoundError):
        raise DataError('Choose a valid device date and time zone for the weekly review.',400) from None
    if not isinstance(view,str) or view not in ('completed','overdue','upcoming','reviews'):
        raise DataError('Invalid weekly review view.',400)
    if type(page) is not int or not 0<=page<=100_000 or type(page_size) is not int or not 1<=page_size<=50:
        raise DataError('Invalid weekly review page or page size.',400)
    pg=bool(history.database_url)
    field=lambda alias,key:f"{alias}.payload::jsonb->>'{key}'" if pg else f"json_extract({alias}.payload,'$.{key}')"
    obj='jsonb_build_object' if pg else 'json_object'
    followup="jsonb_typeof(e.payload::jsonb->'settings'->'plan_update')='object'" if pg else "json_type(e.payload,'$.settings.plan_update')='object'"
    keys=('run_id','proposal_id','task','owner','deadline','status','title','reference_date','review_kind','completed_at')
    item=obj+'('+','.join(f"'{key}',s.{key}" for key in keys)+')'
    # An inherited Done event is a copy, not a new completion. Follow carried_from
    # to the original transition, including chains from before this feature existed.
    sql=f"""WITH RECURSIVE tasks AS MATERIALIZED ({projection_sql(pg)}),
      progress AS MATERIALIZED (
        SELECT run_id,created_at,{field('p','proposal_id')} proposal_id,{field('p','carried_from')} carried_from,
          ROW_NUMBER() OVER(PARTITION BY run_id,{field('p','proposal_id')} ORDER BY event_id DESC) position
        FROM events p WHERE kind='task_progress'
      ), latest AS MATERIALIZED (SELECT * FROM progress WHERE position=1),
      completion(run_id,proposal_id,created_at,carried_from) AS (
        SELECT t.run_id,t.proposal_id,p.created_at,p.carried_from FROM tasks t JOIN latest p ON p.run_id=t.run_id AND p.proposal_id=t.proposal_id WHERE t.status='done'
        UNION
        SELECT c.run_id,c.proposal_id,p.created_at,p.carried_from FROM completion c
          JOIN latest p ON p.run_id=c.carried_from AND p.proposal_id=c.proposal_id
      ), entries AS MATERIALIZED (
        SELECT 'completed' section,t.run_id,t.proposal_id,t.task,t.owner,t.deadline,t.status,t.title,t.reference_date,
          NULL review_kind,c.created_at completed_at,c.created_at sort_date,t.event_id,t.task_index
          FROM tasks t JOIN completion c ON c.run_id=t.run_id AND c.proposal_id=t.proposal_id
          WHERE c.carried_from IS NULL AND c.created_at>=? AND c.created_at<?
        UNION ALL
        SELECT CASE WHEN deadline<? THEN 'overdue' ELSE 'upcoming' END,run_id,proposal_id,task,owner,deadline,status,title,reference_date,
          NULL,NULL,deadline,event_id,task_index FROM tasks WHERE status<>'done' AND deadline<>'Unknown' AND deadline<=?
        UNION ALL
        SELECT 'reviews',e.run_id,NULL,NULL,NULL,NULL,'review',
          COALESCE((SELECT {field('n','title')} FROM events n WHERE n.run_id=e.run_id AND n.kind='meeting_title' ORDER BY n.event_id DESC LIMIT 1),{field('e','title')},''),
          {field('e','reference_date')},CASE WHEN {followup} THEN 'followup' ELSE 'tasks' END,NULL,'',e.event_id,0
          FROM events e WHERE e.kind='extraction' AND NOT EXISTS(SELECT 1 FROM events f WHERE f.run_id=e.run_id AND f.kind='final')
      ), selected AS MATERIALIZED (SELECT * FROM entries WHERE section=?),
      bounds AS (
        SELECT total,CASE WHEN total=0 THEN 0 WHEN ?>((total-1)/?) THEN (total-1)/? ELSE ? END page FROM (SELECT COUNT(*) total FROM selected) totals
      ), slice AS (
        SELECT * FROM selected ORDER BY CASE WHEN section='completed' THEN sort_date ELSE '' END DESC,
          CASE WHEN section<>'completed' THEN sort_date ELSE '' END,event_id DESC,task_index
          LIMIT ? OFFSET (SELECT page FROM bounds)*?
      )
      SELECT b.total,b.page,{obj}(
        'completed',(SELECT COUNT(*) FROM entries WHERE section='completed'),
        'overdue',(SELECT COUNT(*) FROM entries WHERE section='overdue'),
        'upcoming',(SELECT COUNT(*) FROM entries WHERE section='upcoming'),
        'reviews',(SELECT COUNT(*) FROM entries WHERE section='reviews'),
        'undated',(SELECT COUNT(*) FROM tasks WHERE status<>'done' AND deadline='Unknown')) counts,
        CASE WHEN s.run_id IS NULL THEN NULL ELSE {item} END item
      FROM bounds b LEFT JOIN slice s ON TRUE
      ORDER BY CASE WHEN s.section='completed' THEN s.sort_date ELSE '' END DESC,
        CASE WHEN s.section<>'completed' THEN s.sort_date ELSE '' END,s.event_id DESC,s.task_index"""
    with history.connection() as conn:
        rows=conn.execute(sql,(begin,end,today,soon.isoformat(),view,page,page_size,page_size,page,page_size,page_size)).fetchall()
    decode=lambda value:value if isinstance(value,dict) else json.loads(value)
    return dict(today=today,period_start=start.isoformat(),period_end=today,time_zone=time_zone,
                upcoming_through=soon.isoformat(),view=view,page=int(rows[0][1]),page_size=page_size,
                total=int(rows[0][0]),counts=decode(rows[0][2]),items=[decode(row[3]) for row in rows if row[3] is not None])
