"""Private recurring-meeting groups, inherited plan membership, and saved agendas."""
from datetime import date
import hashlib
import json
import re

from data_controls import DataError, identifier
from meeting_history import clean_title
from task_dashboard import projection_sql


def field(pg, alias, key):
    return f"{alias}.payload::jsonb->>'{key}'" if pg else f"json_extract({alias}.payload,'$.{key}')"


def graph_sql(pg):
    parent="e.payload::jsonb #>> '{settings,plan_update,base_run_id}'" if pg else "json_extract(e.payload,'$.settings.plan_update.base_run_id')"
    return f"""WITH RECURSIVE families(run_id,root_id) AS (
      SELECT e.run_id,e.run_id FROM events e WHERE e.kind='extraction' AND {parent} IS NULL
      UNION SELECT e.run_id,f.root_id FROM events e JOIN families f ON {parent}=f.run_id WHERE e.kind='extraction'
    ), links AS MATERIALIZED (
      SELECT l.run_id root_id,l.event_id,{field(pg,'l','series_id')} series_id,{field(pg,'l','version')} version,
        ROW_NUMBER() OVER(PARTITION BY l.run_id ORDER BY l.event_id DESC) position FROM events l WHERE l.kind='meeting_series_link'
    ), bindings AS MATERIALIZED (SELECT * FROM links WHERE position=1),
    groups AS MATERIALIZED (
      SELECT e.run_id id,e.created_at,
        COALESCE((SELECT {field(pg,'n','name')} FROM events n WHERE n.run_id=e.run_id AND n.kind='series_name' ORDER BY n.event_id DESC LIMIT 1),{field(pg,'e','name')}) name,
        COALESCE((SELECT {field(pg,'n','version')} FROM events n WHERE n.run_id=e.run_id AND n.kind='series_name' ORDER BY n.event_id DESC LIMIT 1),'0') version
      FROM events e WHERE e.kind='meeting_series'
    )"""


def group_in(conn, pg, series_id):
    identifier(series_id)
    row=conn.execute(graph_sql(pg)+' SELECT id,name,version,created_at FROM groups WHERE id=?',(series_id,)).fetchone()
    if not row:raise KeyError(series_id)
    return dict(id=row[0],name=row[1],version=int(row[2]),created_at=row[3])


def membership(history, run_id, conn=None):
    identifier(run_id)
    def read(db):
        row=db.execute(graph_sql(bool(history.database_url))+""" SELECT f.root_id,b.version,g.id,g.name FROM families f
          LEFT JOIN bindings b ON b.root_id=f.root_id LEFT JOIN groups g ON g.id=b.series_id WHERE f.run_id=?""",(run_id,)).fetchone()
        if not row:raise KeyError(run_id)
        return dict(root_id=row[0],version=int(row[1] or 0),series=dict(id=row[2],name=row[3]) if row[2] else None)
    if conn:return read(conn)
    with history.connection() as db:return read(db)


def create(history, name, request_id):
    identifier(request_id);name=clean_title(name)
    if not name:raise DataError('Give this meeting series a name.',400)
    with history.connection() as conn:
        conn.execute('BEGIN IMMEDIATE')
        row=conn.execute('SELECT kind,payload FROM events WHERE run_id=? ORDER BY event_id LIMIT 1',(request_id,)).fetchone()
        if row:
            if row[0]!='meeting_series' or json.loads(row[1])['name']!=name:raise DataError('This series request ID belongs to different input.',409)
            return group_in(conn,bool(history.database_url),request_id)
        for (existing,) in conn.execute(graph_sql(bool(history.database_url))+' SELECT name FROM groups'):
            if existing.casefold()==name.casefold():raise DataError('A meeting series with this name already exists. Choose it from the list.',409)
        history._append(conn,request_id,'meeting_series',dict(name=name,request_id=request_id))
        return group_in(conn,bool(history.database_url),request_id)


def rename(history, series_id, name, version, request_id):
    name=clean_title(name);identifier(request_id)
    if not name or type(version) is not int or not 0<=version<=1_000_000:raise DataError('Use a name and saved series version.',400)
    with history.connection() as conn:
        conn.execute('BEGIN IMMEDIATE');group=group_in(conn,bool(history.database_url),series_id)
        rows=conn.execute("SELECT payload FROM events WHERE run_id=? AND kind='series_name'",(series_id,)).fetchall()
        prior=next((json.loads(p) for (p,) in rows if json.loads(p)['request_id']==request_id),None)
        if prior:
            if (prior['name'],prior['base_version'])!=(name,version):raise DataError('This series rename request ID belongs to another edit.',409)
            return group
        if group['version']!=version:raise DataError('The series name changed in another tab. Refresh before editing.',409)
        for other,n in conn.execute(graph_sql(bool(history.database_url))+' SELECT id,name FROM groups'):
            if other!=series_id and n.casefold()==name.casefold():raise DataError('A meeting series with this name already exists.',409)
        history._append(conn,series_id,'series_name',dict(name=name,version=version+1,base_version=version,request_id=request_id))
        return group_in(conn,bool(history.database_url),series_id)


def assign_in(history, conn, run_id, series_id, version, request_id):
    identifier(request_id)
    if series_id is not None:identifier(series_id)
    if type(version) is not int or not 0<=version<=1_000_000:raise DataError('Use the saved series membership version.',400)
    current=membership(history,run_id,conn);root=current['root_id']
    prior=next((json.loads(p) for (p,) in conn.execute("SELECT payload FROM events WHERE run_id=? AND kind='meeting_series_link'",(root,)) if json.loads(p)['request_id']==request_id),None)
    if prior:
        if (prior['series_id'],prior['base_version'])!=(series_id,version):raise DataError('This membership request ID belongs to another edit.',409)
        return
    if current['version']!=version:raise DataError('This meeting’s series changed in another tab. Refresh before moving it.',409)
    if series_id is not None:group_in(conn,bool(history.database_url),series_id)
    history._append(conn,root,'meeting_series_link',dict(series_id=series_id,version=version+1,base_version=version,request_id=request_id))


def assign(history, run_id, series_id, version, request_id):
    with history.connection() as conn:
        conn.execute('BEGIN IMMEDIATE');assign_in(history,conn,run_id,series_id,version,request_id)


def listing(history, *, query='', page=0, page_size=12):
    if not isinstance(query,str) or len(query)>200:raise DataError('Series search must be at most 200 characters.',400)
    if type(page) is not int or not 0<=page<=100_000 or type(page_size) is not int or not 1<=page_size<=50:raise DataError('Invalid series page or page size.',400)
    pg=bool(history.database_url);lower,contains=('lower','strpos') if pg else ('flow_lower','instr')
    sql=graph_sql(pg)+f""", tasks AS MATERIALIZED ({projection_sql(pg)}), matches AS MATERIALIZED (
      SELECT g.*,(SELECT COUNT(*) FROM families f JOIN bindings b ON b.root_id=f.root_id WHERE b.series_id=g.id) meetings,
        (SELECT COUNT(*) FROM tasks t JOIN families f ON f.run_id=t.run_id JOIN bindings b ON b.root_id=f.root_id WHERE b.series_id=g.id AND t.status<>'done') open_tasks
      FROM groups g WHERE ?='' OR {contains}({lower}(g.name),{lower}(?))>0
    ), bounds AS (SELECT total,CASE WHEN total=0 THEN 0 WHEN ?>((total-1)/?) THEN (total-1)/? ELSE ? END page FROM (SELECT COUNT(*) total FROM matches) n),
    slice AS (SELECT * FROM matches ORDER BY {lower}(name),id LIMIT ? OFFSET (SELECT page FROM bounds)*?)
    SELECT b.total,b.page,s.id,s.name,s.version,s.created_at,s.meetings,s.open_tasks FROM bounds b LEFT JOIN slice s ON TRUE ORDER BY {lower}(s.name),s.id"""
    with history.connection() as conn:
        if not pg:conn.create_function('flow_lower',1,lambda v:v.lower() if isinstance(v,str) else '',deterministic=True)
        rows=conn.execute(sql,(query.strip(),query.strip(),page,page_size,page_size,page,page_size,page_size)).fetchall()
    return dict(total=int(rows[0][0]),page=int(rows[0][1]),page_size=page_size,items=[dict(id=r[2],name=r[3],version=int(r[4]),created_at=r[5],meetings=int(r[6]),open_tasks=int(r[7])) for r in rows if r[2]])


def _snapshot(history,conn,series_id,today):
    try:
        if not isinstance(today,str) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}',today):raise ValueError()
        date.fromisoformat(today)
    except ValueError:raise DataError('Choose a valid device date for meeting preparation.',400) from None
    identifier(series_id);pg=bool(history.database_url);obj='jsonb_build_object' if pg else 'json_object'
    f=lambda a,k:field(pg,a,k)
    task_keys=('run_id','proposal_id','task','owner','deadline','status','title','reference_date')
    task_json=obj+'('+','.join(f"'{k}',t.{k}" for k in task_keys)+')'
    parent="e.payload::jsonb #>> '{settings,plan_update,base_run_id}'" if pg else "json_extract(e.payload,'$.settings.plan_update.base_run_id')"
    length="jsonb_array_length(e.payload::jsonb->'tasks')" if pg else "json_array_length(e.payload,'$.tasks')"
    sql=graph_sql(pg)+f""", members AS MATERIALIZED (
      SELECT f.* FROM families f JOIN bindings b ON b.root_id=f.root_id WHERE b.series_id=?
    ), all_tasks AS MATERIALIZED ({projection_sql(pg,include_superseded=True)}),
    member_tasks AS MATERIALIZED (SELECT t.* FROM all_tasks t JOIN members m ON m.run_id=t.run_id WHERE NOT EXISTS(SELECT 1 FROM events s WHERE s.run_id=t.run_id AND s.kind='plan_superseded')),
    meetings AS MATERIALIZED (
      SELECT e.run_id id,e.event_id,e.created_at,{f('e','reference_date')} reference_date,
        COALESCE((SELECT {f('n','title')} FROM events n WHERE n.run_id=e.run_id AND n.kind='meeting_title' ORDER BY n.event_id DESC LIMIT 1),{f('e','title')},'') title,
        CASE WHEN EXISTS(SELECT 1 FROM events p WHERE p.run_id=e.run_id AND p.kind='plan_superseded') THEN 'earlier' WHEN EXISTS(SELECT 1 FROM events x WHERE x.run_id=e.run_id AND x.kind='final') THEN 'confirmed' ELSE 'review' END status
      FROM events e JOIN members m ON m.run_id=e.run_id WHERE e.kind='extraction'
    )
    SELECT 'group' kind,{obj}('id',g.id,'name',g.name,'version',CAST(g.version AS INTEGER),'created_at',g.created_at) payload FROM groups g WHERE g.id=?
    UNION ALL SELECT 'task',{task_json} FROM member_tasks t
    UNION ALL SELECT 'meeting',{obj}('id',id,'event_id',event_id,'created_at',created_at,'reference_date',reference_date,'title',title,'status',status) FROM meetings
    UNION ALL SELECT 'change',{obj}('event_id',e.event_id,'run_id',e.run_id,'created_at',e.created_at,'kind',e.kind,'proposal_id',{f('e','proposal_id')},'before',{f('e','before')},'after',{f('e','after')},'reason',{f('e','reason')},'task',t.task,'title',m.title,'reference_date',m.reference_date,'task_count',CASE WHEN e.kind='final' THEN {length} ELSE NULL END)
      FROM events e JOIN meetings m ON m.id=e.run_id LEFT JOIN all_tasks t ON t.run_id=e.run_id AND t.proposal_id={f('e','proposal_id')}
      WHERE e.kind IN ('final','task_deadline','task_progress') AND {f('e','carried_from')} IS NULL
    UNION ALL SELECT 'source',{obj}('id',e.event_id) FROM events e WHERE
      (e.run_id IN (SELECT run_id FROM members) AND e.kind IN ('extraction','final','meeting_title','task_progress','task_deadline','plan_superseded','plan_update_review')) OR
      (e.run_id=? AND e.kind IN ('meeting_series','series_name')) OR e.event_id IN (SELECT b.event_id FROM bindings b WHERE b.series_id=?)
    UNION ALL SELECT 'dependency',{obj}('id',f.run_id) FROM families f WHERE f.root_id IN (SELECT l.run_id FROM events l WHERE l.kind='meeting_series_link' AND {f('l','series_id')}=?)
    UNION ALL SELECT 'agenda',a.payload{('::jsonb' if pg else '')} FROM events a WHERE a.run_id=? AND a.kind='series_agenda' AND a.event_id=(SELECT MAX(event_id) FROM events WHERE run_id=? AND kind='series_agenda')
    UNION ALL SELECT 'agenda_version',{obj}('version',CAST({f('a','version')} AS INTEGER),'subject',{f('a','subject')},'created_at',a.created_at) FROM events a WHERE a.run_id=? AND a.kind='series_agenda'"""
    sql+=f" UNION ALL SELECT 'erasure',{obj}('count',(SELECT COUNT(*) FROM deleted_inputs)) UNION ALL SELECT 'agenda_counter',{obj}('version',COALESCE(MAX(CAST({f('a','version')} AS INTEGER)),0)) FROM events a WHERE a.run_id=? AND a.kind='series_agenda_saved'"
    data={k:[] for k in ('group','task','meeting','change','source','dependency','agenda','agenda_version','erasure','agenda_counter')}
    for kind,payload in conn.execute(sql,(series_id,)*9):
        data[kind].append(payload if isinstance(payload,dict) else json.loads(payload))
    if not data['group']:raise KeyError(series_id)
    sources=sorted({x['id'] for x in data['source']})
    counter=data['agenda_counter'][0]['version']
    draft=data['agenda'][0] if data['agenda'] and data['agenda'][0]['version']==counter else None
    deps=sorted({x['id'] for x in data['dependency']}|set((draft or {}).get('source_run_ids',[])))
    revision=hashlib.sha256(json.dumps([today,series_id,sources,data['erasure'][0]['count']]).encode()).hexdigest()
    return data,draft,deps,revision,max(sources,default=0)


def preparation(history,series_id,*,today=None,view='tasks',page=0,page_size=8,conn=None):
    if not isinstance(view,str) or view not in ('tasks','meetings','changes','agendas'):raise DataError('Invalid meeting preparation view.',400)
    if type(page) is not int or not 0<=page<=100_000 or type(page_size) is not int or not 1<=page_size<=12:raise DataError('Invalid preparation page or page size.',400)
    if conn:data,draft,deps,revision,highwater=_snapshot(history,conn,series_id,today)
    else:
        with history.connection() as db:data,draft,deps,revision,highwater=_snapshot(history,db,series_id,today)
    tasks=sorted([t for t in data['task'] if t['status']!='done'],key=lambda t:(t['deadline']=='Unknown',t['deadline'],t['run_id'],t['proposal_id']))
    meetings=sorted(data['meeting'],key=lambda m:(m['reference_date'],m['event_id']),reverse=True)
    changes=sorted([c for c in data['change'] if c['event_id']>(draft or {}).get('prepared_event_id',0)],key=lambda c:c['event_id'],reverse=True)
    agendas=sorted(data['agenda_version'],key=lambda a:a['version'],reverse=True)
    items={'tasks':tasks,'meetings':meetings,'changes':changes,'agendas':agendas}[view]
    page=min(page,max(0,(len(items)-1)//page_size))
    lines=[f"Agenda for {data['group'][0]['name']}",'',f'1. Review unfinished commitments ({len(tasks)})']
    for t in tasks:lines.append(f"• {t['task']} — Owner: {t['owner']}; deadline: {t['deadline']}; {'In progress' if t['status']=='in_progress' else 'To do'}.")
    if not tasks:lines.append('No open confirmed tasks.')
    missing=[t for t in tasks if t['owner'].strip().lower() in ('','unknown') or t['deadline']=='Unknown']
    lines+=['','2. Resolve missing details']+([f"• {t['task']} — owner: {t['owner']}; deadline: {t['deadline']}." for t in missing] or ['No missing owners or deadlines in open tasks.'])
    lines+=['','3. New topics','• Add topics to discuss.','',f'Prepared from current confirmed plans on {today}. Review before sharing.']
    body='\n'.join(lines)
    return dict(series=data['group'][0],today=today,view=view,total=len(items),page=page,page_size=page_size,items=items[page*page_size:(page+1)*page_size],
                counts=dict(open_tasks=len(tasks),overdue=sum(t['deadline']!='Unknown' and t['deadline']<today for t in tasks),undated=sum(t['deadline']=='Unknown' for t in tasks),reviews=sum(m['status']=='review' for m in meetings),meetings=len(meetings),changes=len(changes),agendas=len(agendas)),
                agenda=draft,agenda_version=data['agenda_counter'][0]['version'],source_run_ids=deps,source_revision=revision,source_event_id=highwater,
                suggestion=dict(subject=f"Agenda: {data['group'][0]['name']}",body=body) if len(body)<=100_000 else None,
                suggestion_error='' if len(body)<=100_000 else 'This series has too much open work for one generated agenda. Start a blank agenda and choose the topics to discuss.')


def save_agenda(history,series_id,*,subject=None,body=None,version=None,source_revision=None,request_id=None,today=None):
    identifier(request_id)
    if not isinstance(subject,str) or not 1<=len(subject.strip())<=300 or re.search(r'[\r\n]',subject):raise DataError('Use an agenda title of 1–300 characters on one line.',400)
    if not isinstance(body,str) or not 1<=len(body.strip())<=100_000:raise DataError('Write an agenda of up to 100,000 characters.',400)
    if type(version) is not int or not 0<=version<=1_000_000 or not isinstance(source_revision,str) or not re.fullmatch(r'[a-f0-9]{64}',source_revision):raise DataError('Use the saved agenda version and preparation details.',400)
    with history.connection() as conn:
        conn.execute('BEGIN IMMEDIATE');group_in(conn,bool(history.database_url),series_id)
        if history.database_url:
            # A deployment must not save cross-meeting copies without their purge rule.
            if conn.execute('SELECT flow.series_agenda_erasure_version()').fetchone()[0]!=5:
                raise DataError('Meeting preparation storage needs its database migration.',503)
        values=[json.loads(p) for (p,) in conn.execute("SELECT payload FROM events WHERE run_id=? AND kind='series_agenda'",(series_id,))]
        prior=next((p for p in values if p['request_id']==request_id),None)
        if prior:
            if (prior['subject'],prior['body'],prior['base_version'],prior['source_revision'],prior['today'])!=(subject,body,version,source_revision,today):raise DataError('This agenda request ID belongs to another edit.',409)
            return
        snapshot=preparation(history,series_id,today=today,conn=conn)
        if version!=snapshot['agenda_version']:raise DataError('The agenda changed in another tab. Refresh before saving.',409)
        if source_revision!=snapshot['source_revision']:raise DataError('Preparation details changed. Refresh and check the agenda against current tasks.',409)
        history._append(conn,series_id,'series_agenda',dict(subject=subject,body=body,version=version+1,base_version=version,source_revision=source_revision,request_id=request_id,today=today,prepared_event_id=snapshot['source_event_id'],source_run_ids=snapshot['source_run_ids']))
        # This non-content marker keeps versions monotonic when private text is erased.
        history._append(conn,series_id,'series_agenda_saved',dict(version=version+1,request_id=request_id))


def agenda_version(history,series_id,version):
    if type(version) is not int or version<1:raise DataError('Choose a saved agenda version.',400)
    with history.connection() as conn:
        group_in(conn,bool(history.database_url),series_id)
        for payload,stamp in conn.execute("SELECT payload,created_at FROM events WHERE run_id=? AND kind='series_agenda' ORDER BY event_id DESC",(series_id,)):
            value=json.loads(payload)
            if value['version']==version:return value|dict(created_at=stamp)
    raise KeyError(series_id)
