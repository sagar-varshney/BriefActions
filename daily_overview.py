"""A bounded, account-scoped start page, derived from saved plans and reviews."""
from datetime import date, timedelta
import json
import re

from data_controls import DataError
from task_dashboard import projection_sql


def overview(history, *, today=None, limit=4):
    try:
        if not isinstance(today,str) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}',today):
            raise ValueError()
        end=(date.fromisoformat(today)+timedelta(days=7)).isoformat()
    except (ValueError,OverflowError):
        raise DataError('Choose a valid device date for My day.',400) from None
    if type(limit) is not int or not 1<=limit<=12:
        raise DataError('Invalid My day preview size.',400)
    pg=bool(history.database_url)
    field=lambda alias,key:f"{alias}.payload::jsonb->>'{key}'" if pg else f"json_extract({alias}.payload,'$.{key}')"
    followup="jsonb_typeof(e.payload::jsonb->'settings'->'plan_update')='object'" if pg else "json_type(e.payload,'$.settings.plan_update')='object'"
    obj='jsonb_build_object' if pg else 'json_object'
    keys=('run_id','proposal_id','task','owner','deadline','status','title','reference_date','review_kind')
    item=obj+'('+','.join(f"'{key}',{key}" for key in keys)+",'position',position)"
    sql=f"""WITH tasks AS MATERIALIZED ({projection_sql(pg)}),
      open_tasks AS MATERIALIZED (SELECT * FROM tasks WHERE status<>'done'),
      dated AS MATERIALIZED (
        SELECT *,CASE WHEN deadline<? THEN 'overdue' WHEN deadline=? THEN 'today' ELSE 'upcoming' END section
        FROM open_tasks WHERE deadline<>'Unknown' AND deadline<=?
      ), reviews AS MATERIALIZED (
        SELECT e.run_id,e.event_id,{field('e','reference_date')} reference_date,
          COALESCE((SELECT {field('n','title')} FROM events n WHERE n.run_id=e.run_id AND n.kind='meeting_title' ORDER BY n.event_id DESC LIMIT 1),{field('e','title')},'') title,
          CASE WHEN {followup} THEN 'followup' ELSE 'tasks' END review_kind
        FROM events e WHERE e.kind='extraction' AND NOT EXISTS(SELECT 1 FROM events f WHERE f.run_id=e.run_id AND f.kind='final')
      ), entries AS MATERIALIZED (
        SELECT section,run_id,proposal_id,task,owner,deadline,status,title,reference_date,NULL review_kind,deadline sort_date,event_id,task_index FROM dated
        UNION ALL
        SELECT 'reviews',run_id,NULL,NULL,NULL,NULL,'review',title,reference_date,review_kind,'',event_id,0 FROM reviews
      ), ranked AS (
        SELECT *,ROW_NUMBER() OVER(PARTITION BY section ORDER BY sort_date,event_id DESC,task_index) position FROM entries
      )
      SELECT 'count' kind,section,{obj}('total',COUNT(*)) payload FROM entries GROUP BY section
      UNION ALL SELECT 'item',section,{item} FROM ranked WHERE position<=?
      UNION ALL SELECT 'meta','meta',{obj}('open_tasks',(SELECT COUNT(*) FROM open_tasks),'undated',(SELECT COUNT(*) FROM open_tasks WHERE deadline='Unknown'),'saved_meetings',(SELECT COUNT(*) FROM events WHERE kind='extraction'))"""
    with history.connection() as conn:
        rows=conn.execute(sql,(today,today,end,limit)).fetchall()
    result={'today':today,'upcoming_through':end,'limit':limit,'sections':{key:{'total':0,'items':[]} for key in ('overdue','today','upcoming','reviews')}}
    for kind,section,payload in rows:
        value=payload if isinstance(payload,dict) else json.loads(payload)
        if kind=='meta':result['meta']=value
        elif kind=='count':result['sections'][section].update(value)
        else:result['sections'][section]['items'].append(value)
    for section in result['sections'].values():
        section['items'].sort(key=lambda item:item['position'])
        for item in section['items']:item.pop('position')
    return result
