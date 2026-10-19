"""A bounded, read-only calendar of account-scoped meetings and current tasks."""
import calendar
from datetime import date
import json
import re

from data_controls import DataError
from task_dashboard import projection_sql


def search(history, *, month=None, day=None, kind='all', status='open', page=0, unscheduled_page=0, page_size=12):
    try:
        if not isinstance(month, str) or not re.fullmatch(r'\d{4}-\d{2}', month):
            raise ValueError()
        start = date.fromisoformat(month + '-01')
        end = start.replace(day=calendar.monthrange(start.year, start.month)[1])
        day = day if day is not None else start.isoformat()
        if not isinstance(day, str) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}', day) or date.fromisoformat(day).isoformat()[:7] != month:
            raise ValueError()
        if not start.isoformat() <= day <= end.isoformat():
            raise ValueError()
    except (ValueError, TypeError):
        raise DataError('Choose a valid month and a date within that month.', 400) from None
    statuses = {'open': "status<>'done'", '': 'TRUE', 'todo': "status='todo'", 'in_progress': "status='in_progress'", 'done': "status='done'"}
    if not isinstance(kind, str) or kind not in ('all', 'meetings', 'tasks') or not isinstance(status, str) or status not in statuses:
        raise DataError('Invalid calendar event or task status filter.', 400)
    if any(type(v) is not int or not 0 <= v <= 100_000 for v in (page, unscheduled_page)) or type(page_size) is not int or not 1 <= page_size <= 50:
        raise DataError('Invalid calendar page or page size.', 400)
    pg = bool(history.database_url)
    field = lambda alias, key: f"{alias}.payload::jsonb->>'{key}'" if pg else f"json_extract({alias}.payload,'$.{key}')"
    obj = 'jsonb_build_object' if pg else 'json_object'
    item_keys = ('kind','event_date','run_id','proposal_id','label','owner','deadline','status','title','reference_date')
    item_json = obj + '(' + ','.join(f"'{key}',{key}" for key in item_keys) + ')'
    sql = f"""WITH tasks AS MATERIALIZED ({projection_sql(pg)}),
      meetings AS MATERIALIZED (
        SELECT e.run_id,{field('e','reference_date')} reference_date,
          COALESCE((SELECT {field('n','title')} FROM events n WHERE n.run_id=e.run_id AND n.kind='meeting_title' ORDER BY n.event_id DESC LIMIT 1),{field('e','title')},'') title,
          CASE WHEN EXISTS(SELECT 1 FROM events f WHERE f.run_id=e.run_id AND f.kind='final') THEN 'confirmed' ELSE 'review' END status
        FROM events e WHERE e.kind='extraction'
      ), entries AS MATERIALIZED (
        SELECT 'meeting' kind,reference_date event_date,run_id,NULL proposal_id,title label,NULL owner,NULL deadline,status,title,reference_date FROM meetings WHERE ?<>'tasks'
        UNION ALL
        SELECT 'task',deadline,run_id,proposal_id,task,owner,deadline,status,title,reference_date FROM tasks WHERE ?<>'meetings' AND {statuses[status]}
      ), days AS (
        SELECT event_date,SUM(CASE WHEN kind='meeting' THEN 1 ELSE 0 END) meetings,SUM(CASE WHEN kind='task' THEN 1 ELSE 0 END) tasks,
          MIN(CASE WHEN kind='meeting' THEN label END) meeting_preview,MIN(CASE WHEN kind='task' THEN label END) task_preview
        FROM entries WHERE event_date>=? AND event_date<=? GROUP BY event_date
      ), selected AS MATERIALIZED (SELECT * FROM entries WHERE event_date=?),
      undated AS MATERIALIZED (SELECT * FROM entries WHERE kind='task' AND event_date='Unknown'),
      totals AS (SELECT 'scheduled' section,COUNT(*) total,? requested FROM selected UNION ALL SELECT 'unscheduled',COUNT(*),? FROM undated),
      bounds AS (SELECT section,total,CASE WHEN total=0 THEN 0 WHEN requested>((total-1)/?) THEN (total-1)/? ELSE requested END page FROM totals),
      scheduled_slice AS (SELECT * FROM selected ORDER BY kind,run_id,proposal_id LIMIT ? OFFSET (SELECT page FROM bounds WHERE section='scheduled')*?),
      undated_slice AS (SELECT * FROM undated ORDER BY run_id,proposal_id LIMIT ? OFFSET (SELECT page FROM bounds WHERE section='unscheduled')*?)
      SELECT 'day' section,{obj}('date',event_date,'meetings',meetings,'tasks',tasks,'meeting_preview',meeting_preview,'task_preview',task_preview) payload FROM days
      UNION ALL SELECT section,{obj}('total',total,'page',page,'page_size',?) FROM bounds
      UNION ALL SELECT 'scheduled_item',{item_json} FROM scheduled_slice
      UNION ALL SELECT 'unscheduled_item',{item_json} FROM undated_slice"""
    with history.connection() as conn:
        rows = conn.execute(sql, (kind,kind,start.isoformat(),end.isoformat(),day,page,unscheduled_page,page_size,page_size,page_size,page_size,page_size,page_size,page_size)).fetchall()
    result = {'month': month, 'day': day, 'days': [], 'scheduled': {'items': []}, 'unscheduled': {'items': []}}
    for section, payload in rows:
        value = payload if isinstance(payload, dict) else json.loads(payload)
        if section == 'day':
            result['days'].append(value)
        elif section.endswith('_item'):
            result[section[:-5]]['items'].append(value)
        else:
            result[section].update(value)
    result['days'].sort(key=lambda item: item['date'])
    return result
