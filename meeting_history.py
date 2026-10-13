"""Account-scoped meeting names and bounded search over saved extraction inputs."""
from datetime import date
import re

from data_controls import DataError, identifier


def clean_title(value):
    if not isinstance(value,str) or len(value)>120 or re.search(r'[\x00-\x1f\x7f]',value):
        raise DataError('Meeting name must be at most 120 characters on one line.',400)
    return value.strip()


def rename(history,run_id,title,version):
    identifier(run_id);title=clean_title(title)
    if type(version) is not int or version<0:raise DataError('Invalid meeting name version.',400)
    with history.connection() as conn:
        conn.execute('BEGIN IMMEDIATE')
        rows=conn.execute('SELECT kind,payload FROM events WHERE run_id=? ORDER BY event_id',(run_id,)).fetchall()
        if not rows or rows[0][0]!='extraction':raise KeyError(run_id)
        import json
        original=json.loads(rows[0][1])
        last=next((json.loads(p) for kind,p in reversed(rows) if kind=='meeting_title'),None)
        current=last['version'] if last else 0
        current_title=last['title'] if last else original.get('title','')
        if title==current_title:return current
        if version!=current:raise DataError('Meeting name changed in another tab. Reopen the run before saving again.',409)
        history._append(conn,run_id,'meeting_title',{'title':title,'version':current+1})
        return current+1


def search(history,query='',status='',date_from='',date_to='',page=0,page_size=12):
    if not isinstance(query,str) or len(query)>200:raise DataError('Search must be at most 200 characters.',400)
    if status not in ('','review','confirmed'):raise DataError('Invalid review status.',400)
    for value in (date_from,date_to):
        if not isinstance(value,str):raise DataError('Invalid meeting date filter.',400)
        if value:
            try:
                if not re.fullmatch(r'\d{4}-\d{2}-\d{2}',value):raise ValueError()
                date.fromisoformat(value)
            except ValueError:raise DataError('Date filters must use valid YYYY-MM-DD dates.',400) from None
    if date_from and date_to and date_from>date_to:raise DataError('From date must be on or before the to date.',400)
    if type(page) is not int or not 0<=page<=100_000 or type(page_size) is not int or not 1<=page_size<=50:
        raise DataError('Invalid history page or page size.',400)
    pg=bool(history.database_url)
    field=lambda alias,key:f"{alias}.payload::jsonb->>'{key}'" if pg else f"json_extract({alias}.payload,'$.{key}')"
    title=f"COALESCE((SELECT {field('t','title')} FROM events t WHERE t.run_id=e.run_id AND t.kind='meeting_title' ORDER BY t.event_id DESC LIMIT 1),{field('e','title')},'')"
    reference=field('e','reference_date');transcript=field('e','transcript')
    length="jsonb_array_length(e.payload::jsonb->'proposals')" if pg else "json_array_length(e.payload,'$.proposals')"
    lower='lower' if pg else 'flow_lower';contains='strpos' if pg else 'instr'
    with history.connection() as conn:
        if not pg:conn.create_function('flow_lower',1,lambda value:value.lower() if isinstance(value,str) else '',deterministic=True)
        rows=conn.execute(f"""WITH summaries AS MATERIALIZED (
          SELECT e.event_id,e.run_id,e.created_at,{reference} reference_date,{title} title,
            {transcript} transcript,
            {length}+(SELECT COUNT(*) FROM events m WHERE m.run_id=e.run_id AND m.kind='manual_proposal') proposal_count,
            CASE WHEN EXISTS(SELECT 1 FROM events f WHERE f.run_id=e.run_id AND f.kind='final') THEN 'confirmed' ELSE 'review' END status
          FROM events e WHERE e.kind='extraction'
        ), matches AS MATERIALIZED (
          SELECT * FROM summaries WHERE (?='' OR {contains}({lower}(title),{lower}(?))>0 OR {contains}({lower}(transcript),{lower}(?))>0)
            AND (?='' OR status=?) AND (?='' OR reference_date>=?) AND (?='' OR reference_date<=?)
        ), totals AS (SELECT COUNT(*) total FROM matches), bounds AS (
          SELECT total,CASE WHEN total=0 THEN 0 WHEN ?>((total-1)/?) THEN (total-1)/? ELSE ? END page FROM totals
        ), slice AS (
          SELECT * FROM matches ORDER BY event_id DESC LIMIT ? OFFSET (SELECT page FROM bounds)*?
        ) SELECT b.total,b.page,s.run_id,s.created_at,s.reference_date,s.title,substr(s.transcript,1,140),s.proposal_count,s.status
          FROM bounds b LEFT JOIN slice s ON TRUE ORDER BY s.event_id DESC""",
          (query.strip(),query.strip(),query.strip(),status,status,date_from,date_from,date_to,date_to,page,page_size,page_size,page,page_size,page_size)).fetchall()
    total,current=rows[0][:2]
    return {'items':[dict(zip(('id','created_at','reference_date','title','preview','proposal_count','status'),row[2:])) for row in rows if row[2] is not None],
            'total':total,'page':current,'page_size':page_size}
