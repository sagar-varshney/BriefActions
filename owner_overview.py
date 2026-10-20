"""Bounded workload groups from confirmed owner labels, not account identities."""
from datetime import date
import json
import re

from data_controls import DataError
from task_dashboard import projection_sql


def search(history, *, today=None, query='', view='open', page=0, page_size=12):
    try:
        if not isinstance(today,str) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}',today):raise ValueError()
        date.fromisoformat(today)
    except ValueError:
        raise DataError('Choose a valid device date for owner workloads.',400) from None
    if not isinstance(query,str) or len(query)>200:
        raise DataError('Owner search must be at most 200 characters.',400)
    views={'all':'TRUE','open':'open_count>0','overdue':'overdue>0','unassigned':"owner_key='Unknown'"}
    if not isinstance(view,str) or view not in views:
        raise DataError('Invalid owner workload view.',400)
    if type(page) is not int or not 0<=page<=100_000 or type(page_size) is not int or not 1<=page_size<=50:
        raise DataError('Invalid owner page or page size.',400)
    pg=bool(history.database_url)
    lower,contains=('lower','strpos') if pg else ('flow_lower','instr')
    obj='jsonb_build_object' if pg else 'json_object'
    task_keys=('run_id','proposal_id','task','owner','deadline','status','title','reference_date')
    task_json=obj+'('+','.join(f"'{key}',{key}" for key in task_keys)+')'
    sql=f"""WITH tasks AS MATERIALIZED ({projection_sql(pg)}),
      named AS MATERIALIZED (
        SELECT *,CASE WHEN {lower}(trim(owner)) IN ('','unknown') THEN 'Unknown' ELSE trim(owner) END owner_key
        FROM tasks
      ), matching AS MATERIALIZED (
        SELECT * FROM named WHERE ?='' OR {contains}({lower}(CASE WHEN owner_key='Unknown' THEN 'Unassigned' ELSE owner_key END),{lower}(?))>0
      ), grouped AS MATERIALIZED (
        SELECT owner_key,COUNT(*) total,
          SUM(CASE WHEN status<>'done' THEN 1 ELSE 0 END) open_count,
          SUM(CASE WHEN status='done' THEN 1 ELSE 0 END) done,
          SUM(CASE WHEN status='in_progress' THEN 1 ELSE 0 END) in_progress,
          SUM(CASE WHEN status<>'done' AND deadline<>'Unknown' AND deadline<? THEN 1 ELSE 0 END) overdue,
          SUM(CASE WHEN status<>'done' AND deadline=? THEN 1 ELSE 0 END) due_today,
          SUM(CASE WHEN status<>'done' AND deadline='Unknown' THEN 1 ELSE 0 END) undated
        FROM matching GROUP BY owner_key
      ), selected AS MATERIALIZED (SELECT * FROM grouped WHERE {views[view]}),
      counts AS (
        SELECT COUNT(*) groups,COALESCE(SUM(CASE WHEN owner_key<>'Unknown' THEN 1 ELSE 0 END),0) named_owners,
          COALESCE(SUM(open_count),0) open_tasks,COALESCE(SUM(overdue),0) overdue_tasks,
          COALESCE(SUM(CASE WHEN owner_key='Unknown' THEN open_count ELSE 0 END),0) unassigned_open FROM selected
      ), bounds AS (
        SELECT groups total,CASE WHEN groups=0 THEN 0 WHEN ?>((groups-1)/?) THEN (groups-1)/? ELSE ? END page FROM counts
      ), slice AS MATERIALIZED (
        SELECT * FROM selected ORDER BY CASE WHEN owner_key='Unknown' THEN 0 ELSE 1 END,overdue DESC,open_count DESC,owner_key
        LIMIT ? OFFSET (SELECT page FROM bounds)*?
      ), ranked AS (
        SELECT m.*,ROW_NUMBER() OVER(PARTITION BY owner_key ORDER BY CASE WHEN status='done' THEN 1 ELSE 0 END,
          CASE WHEN deadline='Unknown' THEN 1 ELSE 0 END,deadline,event_id DESC,task_index) position
        FROM matching m JOIN slice USING(owner_key)
      ), first_tasks AS (
        SELECT owner_key,{task_json} next_task FROM ranked WHERE position=1 AND status<>'done'
      ) SELECT b.total,b.page,c.groups,c.named_owners,c.open_tasks,c.overdue_tasks,c.unassigned_open,
          s.owner_key,s.total,s.open_count,s.done,s.in_progress,s.overdue,s.due_today,s.undated,n.next_task
        FROM bounds b CROSS JOIN counts c LEFT JOIN slice s ON TRUE LEFT JOIN first_tasks n ON n.owner_key=s.owner_key
        ORDER BY CASE WHEN s.owner_key='Unknown' THEN 0 ELSE 1 END,s.overdue DESC,s.open_count DESC,s.owner_key"""
    with history.connection() as conn:
        if not pg:conn.create_function('flow_lower',1,lambda value:value.lower() if isinstance(value,str) else '',deterministic=True)
        rows=conn.execute(sql,(query.strip(),query.strip(),today,today,page,page_size,page_size,page,page_size,page_size)).fetchall()
    items=[]
    for row in rows:
        if row[7] is None:continue
        item=dict(zip(('owner','total','open','done','in_progress','overdue','due_today','undated'),row[7:15]))
        item['unassigned']=item['owner']=='Unknown'
        item['next_task']=row[15] if isinstance(row[15],dict) or row[15] is None else json.loads(row[15])
        items.append(item)
    return {'today':today,'query':query.strip(),'view':view,'page':rows[0][1],'page_size':page_size,'total':rows[0][0],
            'summary':dict(zip(('groups','named_owners','open_tasks','overdue_tasks','unassigned_open'),rows[0][2:7])),'items':items}
