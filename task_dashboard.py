"""Bounded, account-scoped views of confirmed tasks across saved meetings."""
from datetime import date, timedelta
import re

from data_controls import DataError


def projection_sql(pg,include_superseded=False):
    field = lambda alias, key: f"{alias}.payload::jsonb->>'{key}'" if pg else f"json_extract({alias}.payload,'$.{key}')"
    task_field = lambda key: f"t.value->>'{key}'" if pg else f"json_extract(t.value,'$.{key}')"
    expand = "jsonb_array_elements(f.payload::jsonb->'tasks') WITH ORDINALITY AS t(value,ordinality)" if pg else "json_each(f.payload,'$.tasks') t"
    position = 't.ordinality' if pg else 'CAST(t.key AS INTEGER)'
    return f"""SELECT f.run_id,f.event_id,{position} task_index,
            {task_field('proposal_id')} proposal_id,{task_field('task')} task,
            {task_field('owner')} owner,
            COALESCE((SELECT {field('d','after')} FROM events d WHERE d.run_id=f.run_id
              AND d.kind='task_deadline' AND {field('d','proposal_id')}={task_field('proposal_id')}
              ORDER BY d.event_id DESC LIMIT 1),{task_field('deadline')}) deadline,
            COALESCE((SELECT {field('p','after')} FROM events p WHERE p.run_id=f.run_id
              AND p.kind='task_progress' AND {field('p','proposal_id')}={task_field('proposal_id')}
              ORDER BY p.event_id DESC LIMIT 1),'todo') status,
            COALESCE((SELECT {field('n','title')} FROM events n WHERE n.run_id=f.run_id
              AND n.kind='meeting_title' ORDER BY n.event_id DESC LIMIT 1),{field('e','title')},'') title,
            {field('e','reference_date')} reference_date
          FROM events f JOIN events e ON e.run_id=f.run_id AND e.kind='extraction'
            CROSS JOIN {expand} WHERE f.kind='final'
            {'' if include_superseded else "AND NOT EXISTS(SELECT 1 FROM events replacement WHERE replacement.run_id=f.run_id AND replacement.kind='plan_superseded')"}"""


def search(history, *, today=None, view='all', status='open', query='', owner='', page=0, page_size=12):
    if not isinstance(today, str) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}', today):
        raise DataError('Choose a valid device date for task filters.', 400)
    try:
        end = (date.fromisoformat(today) + timedelta(days=7)).isoformat()
    except (ValueError, OverflowError):
        raise DataError('Choose a valid device date for task filters.', 400) from None
    views = {'all': 'TRUE', 'today': 'due_today', 'overdue': 'overdue',
             'upcoming': 'upcoming', 'unassigned': 'unassigned'}
    statuses = {'': 'TRUE', 'open': "status<>'done'", 'todo': "status='todo'",
                'in_progress': "status='in_progress'", 'done': "status='done'"}
    if not isinstance(view,str) or not isinstance(status,str) or view not in views or status not in statuses:
        raise DataError('Invalid task view or progress filter.', 400)
    if not isinstance(query, str) or len(query) > 200:
        raise DataError('Task search must be at most 200 characters.', 400)
    if not isinstance(owner,str) or len(owner)>10000:
        raise DataError('Invalid task owner filter.',400)
    owner=owner.strip(' ')
    if owner.lower()=='unknown':owner='Unknown'
    if type(page) is not int or not 0 <= page <= 100_000 or type(page_size) is not int or not 1 <= page_size <= 50:
        raise DataError('Invalid task page or page size.', 400)
    pg = bool(history.database_url)
    lower, contains = ('lower', 'strpos') if pg else ('flow_lower', 'instr')
    with history.connection() as conn:
        if not pg:
            conn.create_function('flow_lower', 1, lambda value: value.lower() if isinstance(value, str) else '', deterministic=True)
        rows = conn.execute(f"""WITH tasks AS MATERIALIZED (
          {projection_sql(pg)}
        ), matches AS MATERIALIZED (
          SELECT * FROM tasks WHERE {statuses[status]} AND
            (?='' OR (?='Unknown' AND {lower}(trim(owner)) IN ('','unknown')) OR trim(owner)=?) AND
            (?='' OR {contains}({lower}(task),{lower}(?))>0 OR
              {contains}({lower}(owner),{lower}(?))>0 OR {contains}({lower}(title),{lower}(?))>0)
        ), tagged AS MATERIALIZED (
          SELECT *,status<>'done' AND deadline=? due_today,
            status<>'done' AND deadline<>'Unknown' AND deadline<? overdue,
            status<>'done' AND deadline>? AND deadline<=? upcoming,
            {lower}(trim(owner)) IN ('','unknown') unassigned FROM matches
        ), counts AS (
          SELECT COUNT(*) all_count,
            COALESCE(SUM(CASE WHEN due_today THEN 1 ELSE 0 END),0) today_count,
            COALESCE(SUM(CASE WHEN overdue THEN 1 ELSE 0 END),0) overdue_count,
            COALESCE(SUM(CASE WHEN upcoming THEN 1 ELSE 0 END),0) upcoming_count,
            COALESCE(SUM(CASE WHEN unassigned THEN 1 ELSE 0 END),0) unassigned_count FROM tagged
        ), selected AS MATERIALIZED (SELECT * FROM tagged WHERE {views[view]}),
        bounds AS (
          SELECT total,CASE WHEN total=0 THEN 0 WHEN ?>((total-1)/?) THEN (total-1)/? ELSE ? END page
          FROM (SELECT COUNT(*) total FROM selected) totals
        ), slice AS (
          SELECT * FROM selected ORDER BY CASE WHEN status='done' THEN 1 ELSE 0 END,
            CASE WHEN deadline='Unknown' THEN 1 ELSE 0 END,deadline,event_id DESC,task_index
          LIMIT ? OFFSET (SELECT page FROM bounds)*?
        ) SELECT b.total,b.page,c.*,s.run_id,s.proposal_id,s.task,s.owner,s.deadline,s.status,s.title,s.reference_date
          FROM bounds b CROSS JOIN counts c LEFT JOIN slice s ON TRUE
          ORDER BY CASE WHEN s.status='done' THEN 1 ELSE 0 END,
            CASE WHEN s.deadline='Unknown' THEN 1 ELSE 0 END,s.deadline,s.event_id DESC,s.task_index""",
          (owner,owner,owner)+(query.strip(),)*4 + (today,today,today,end,page,page_size,page_size,page,page_size,page_size)).fetchall()
    total, current = rows[0][:2]
    return {'items': [dict(zip(('run_id','proposal_id','task','owner','deadline','status','title','reference_date'), row[7:]))
                      for row in rows if row[7] is not None],
            'counts': dict(zip(('all','today','overdue','upcoming','unassigned'), rows[0][2:7])),
            'total': total, 'page': current, 'page_size': page_size, 'today': today, 'owner':owner}
