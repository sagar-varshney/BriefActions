"""Explicit erasure and exports, separate from append-only review history."""
from datetime import datetime, timezone
import json
import re

class DataError(ValueError):
    def __init__(self,message,status=409):
        self.status=status
        super().__init__(message)

def identifier(value):
    if not isinstance(value,str) or not re.fullmatch(r'[a-f0-9]{32}',value):
        raise DataError('Invalid saved input ID.',400)
    return value

def account_status(history):
    # Match the database quotas: UTF-8 payload bytes, not physical disk size.
    size='octet_length(payload)' if history.database_url else 'length(CAST(payload AS BLOB))'
    with history.connection(allow_closing=True) as conn:
        state,events,drafts=conn.execute(f"""SELECT
            COALESCE((SELECT state FROM account_lifecycle),'active'),
            (SELECT COALESCE(SUM({size}),0) FROM events),
            (SELECT COALESCE(SUM({size}),0) FROM annotation_drafts)""").fetchone()
    return {'state':state,'storage':{
        'history':{'used_bytes':events,'limit_bytes':25_000_000 if history.database_url else None},
        'drafts':{'used_bytes':drafts,'limit_bytes':5_000_000 if history.database_url else None},
        'measured':'utf8_payload_bytes'}}

def delete_input(history,run_id,kind):
    identifier(run_id)
    if kind not in ('extraction','annotation_input','meeting_series'):raise DataError('Invalid input type.',400)
    with history.connection() as conn:
        conn.execute('BEGIN IMMEDIATE')
        row=conn.execute('SELECT kind FROM events WHERE run_id=? ORDER BY event_id',(run_id,)).fetchone()
        if not row:
            if conn.execute('SELECT run_id FROM deleted_inputs WHERE run_id=?',(run_id,)).fetchone():
                return {'deleted':True,'deleted_ids':[r[0] for r in conn.execute('SELECT run_id FROM deleted_inputs')]}
            raise KeyError(run_id)
        if row[0]!=kind:raise KeyError(run_id)
        # Follow-up plans contain copied source evidence. Erase descendants too.
        children={}
        for child,payload in conn.execute("SELECT run_id,payload FROM events WHERE kind='extraction'"):
            parent=json.loads(payload).get('settings',{}).get('plan_update',{}).get('base_run_id')
            children.setdefault(parent,[]).append(child)
        victims={run_id}
        pending=[run_id]
        while pending:
            for child in children.get(pending.pop(),[]):
                if child not in victims:victims.add(child);pending.append(child)
        if history.database_url:
            conn.execute('SELECT flow.erase_input(?)',(run_id,))
        else:
            # Agenda text can retain tasks from meetings no longer in the group.
            dependent_agendas=[eid for eid,p in conn.execute("SELECT event_id,payload FROM events WHERE kind='series_agenda'") if victims.intersection(json.loads(p).get('source_run_ids',[]))]
            for eid in dependent_agendas:conn.execute('DELETE FROM events WHERE event_id=?',(eid,))
            snapshots=[json.loads(p)['snapshot'] for (p,) in conn.execute("SELECT payload FROM events WHERE run_id=? AND kind='annotation_split'",(run_id,))]
            for snapshot in snapshots:
                dependent_events=[eid for eid,k,p in conn.execute("SELECT event_id,kind,payload FROM events WHERE kind IN ('annotation_split','reviewed_benchmark')") if json.loads(p).get('snapshot')==snapshot]
                for eid in dependent_events:conn.execute('DELETE FROM events WHERE event_id=?',(eid,))
            for victim in victims:
                conn.execute('DELETE FROM events WHERE run_id=?',(victim,))
                conn.execute('DELETE FROM annotation_drafts WHERE case_id=?',(victim,))
                conn.execute('INSERT INTO deleted_inputs(run_id) VALUES (?) ON CONFLICT(run_id) DO NOTHING',(victim,))
    return {'deleted':True,'deleted_ids':sorted(victims)}

def close_account(history):
    with history.connection(allow_closing=True) as conn:
        conn.execute('BEGIN IMMEDIATE')
        if history.database_url:
            conn.execute('SELECT flow.erase_account()')
        else:
            conn.execute("INSERT INTO account_lifecycle(id,state) VALUES (1,'deleting') ON CONFLICT(id) DO UPDATE SET state='deleting'")
            conn.execute('DELETE FROM annotation_drafts')
            conn.execute('DELETE FROM events')
            conn.execute('DELETE FROM deleted_inputs')
    return {'state':'deleting'}

def export_lines(history):
    """One SQL statement supplies a consistent snapshot; no whole-export RAM buffer."""
    with history.connection() as conn:
        rows=conn.execute("""SELECT 'event',event_id,run_id,kind,created_at,payload,'','','' FROM events
            UNION ALL SELECT 'annotation_draft',0,case_id,'',updated_at,payload,reviewer_key,mode,CAST(version AS TEXT)
            FROM annotation_drafts ORDER BY 1,2,3,7,8""")
        yield {'type':'manifest','schema':'flow-workspace-export-v1','exported_at':datetime.now(timezone.utc).isoformat(),'account_id':history.owner,'scope':'application history and server-saved drafts'}
        count=0
        for record,eid,rid,kind,stamp,payload,reviewer,mode,version in rows:
            value={'type':record,'id':rid,'created_at':stamp,'payload':json.loads(payload)}
            if record=='event':value.update(event_id=eid,kind=kind)
            else:value.update(reviewer_key=reviewer,mode=mode,version=int(version))
            count+=1
            yield value
        yield {'type':'complete','records':count}
