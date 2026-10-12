"""Local append-only extraction and review history in SQLite.

The final result is a local task plan. No external tasks are created here.
"""
from __future__ import annotations

from contextlib import contextmanager
from datetime import datetime, timezone, date
import json
import re
from pathlib import Path
import sqlite3
from uuid import uuid4

from extraction import UNKNOWN, normalize_task


def proposals_from_events(events):
    if not events or events[0]["kind"]!="extraction":raise KeyError("extraction")
    return events[0]["payload"]["proposals"]+[e["payload"]["proposal"] for e in events if e["kind"]=="manual_proposal"]


class HistoryStore:
    def __init__(self, path, *, database_url=None, owner=None):
        self.path = Path(path)
        self.database_url, self.owner = database_url, owner
        if database_url:
            return  # Hosted schemas are installed by the deployment migration.
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.connection(allow_closing=True) as conn:
            conn.execute('''CREATE TABLE IF NOT EXISTS events (
                event_id INTEGER PRIMARY KEY AUTOINCREMENT,
                run_id TEXT NOT NULL, kind TEXT NOT NULL,
                created_at TEXT NOT NULL, payload TEXT NOT NULL)''')
            conn.execute('CREATE INDEX IF NOT EXISTS events_run ON events(run_id,event_id)')
            conn.execute('CREATE TABLE IF NOT EXISTS deleted_inputs(run_id TEXT PRIMARY KEY)')
            conn.execute('CREATE TABLE IF NOT EXISTS account_lifecycle(id INTEGER PRIMARY KEY,state TEXT NOT NULL)')
            conn.execute('''CREATE TABLE IF NOT EXISTS annotation_drafts (
                case_id TEXT NOT NULL,reviewer_key TEXT NOT NULL,mode TEXT NOT NULL,
                version INTEGER NOT NULL,updated_at TEXT NOT NULL,payload TEXT NOT NULL,
                PRIMARY KEY(case_id,reviewer_key,mode))''')

    @contextmanager
    def connection(self,allow_closing=False):
        if self.database_url:
            from storage import postgres_connection
            with postgres_connection(self.database_url, self.owner,allow_closing) as conn:
                yield conn
            return
        conn = sqlite3.connect(self.path, timeout=10)
        try:
            with conn:
                if not allow_closing:
                    from data_controls import DataError
                    try:row=conn.execute('SELECT state FROM account_lifecycle').fetchone()
                    except sqlite3.OperationalError:row=None  # First local schema initialization.
                    if row and row[0]=='deleting':raise DataError('Account deletion is pending. Retry it from Data & account.')
                yield conn
        finally:
            conn.close()

    def _append(self, conn, run_id, kind, payload):
        from data_controls import DataError
        row=conn.execute('SELECT state FROM account_lifecycle').fetchone()
        if row and row[0]=='deleting':raise DataError('Account deletion is pending. Retry it from Data & account.')
        if conn.execute('SELECT run_id FROM deleted_inputs WHERE run_id=?',(run_id,)).fetchone():
            raise DataError('This input was deleted and cannot be restored by a retry.',410)
        if kind=='reviewed_benchmark' and not any(json.loads(p).get('snapshot')==payload['snapshot'] for (p,) in conn.execute("SELECT payload FROM events WHERE kind='annotation_split'")):
            raise DataError('The reviewed snapshot was deleted.',410)
        conn.execute('INSERT INTO events(run_id,kind,created_at,payload) VALUES (?,?,?,?)',
                     (run_id,kind,datetime.now(timezone.utc).isoformat(),json.dumps(payload)))

    def existing_analysis(self,request_id,fingerprint):
        from data_controls import DataError,identifier
        identifier(request_id)
        with self.connection() as conn:
            if conn.execute('SELECT run_id FROM deleted_inputs WHERE run_id=?',(request_id,)).fetchone():raise DataError('This analysis was deleted. Start a new analysis.',410)
            row=conn.execute('SELECT kind,payload FROM events WHERE run_id=? ORDER BY event_id',(request_id,)).fetchone()
        if row:
            if row[0]!='extraction' or json.loads(row[1]).get('settings',{}).get('request_fingerprint')!=fingerprint:
                raise DataError('This request ID belongs to different input.',409)
            return request_id
        return None

    def create_run(self, transcript, reference_date, proposals, settings=None,request_id=None):
        run_id = request_id or uuid4().hex
        with self.connection() as conn:
            conn.execute('BEGIN IMMEDIATE')
            if request_id:
                from data_controls import DataError
                if conn.execute('SELECT run_id FROM deleted_inputs WHERE run_id=?',(run_id,)).fetchone():raise DataError('This analysis was deleted. Start a new analysis.',410)
                row=conn.execute('SELECT kind,payload FROM events WHERE run_id=? ORDER BY event_id',(run_id,)).fetchone()
                if row:
                    if row[0]!='extraction' or json.loads(row[1]).get('settings',{}).get('request_fingerprint')!=settings.get('request_fingerprint'):raise DataError('This request ID belongs to different input.',409)
                    return run_id
            self._append(conn,run_id,'extraction',{'transcript':transcript,'reference_date':reference_date,
                          'settings':settings or {},'proposals':proposals})
        return run_id

    def get_run(self, run_id):
        with self.connection() as conn:
            rows = conn.execute('SELECT event_id,kind,created_at,payload FROM events WHERE run_id=? ORDER BY event_id',(run_id,)).fetchall()
        if not rows:
            raise KeyError(run_id)
        return [{'event_id':eid,'kind':kind,'created_at':created,'payload':json.loads(payload)} for eid,kind,created,payload in rows]

    def list_runs(self):
        with self.connection() as conn:
            return conn.execute("SELECT run_id,created_at FROM events WHERE kind='extraction' ORDER BY event_id DESC").fetchall()

    def save_draft(self, run_id, decisions, version, client_id=None, edit_id=None):
        """Save incomplete edits; only confirmation requires valid final dates."""
        with self.connection() as conn:
            conn.execute('BEGIN IMMEDIATE')
            rows=conn.execute('SELECT kind,payload FROM events WHERE run_id=? ORDER BY event_id',(run_id,)).fetchall()
            if not rows or rows[0][0]!='extraction':
                raise KeyError(run_id)
            if any(k=='final' for k,_ in rows):
                raise ValueError('This run is already finalized')
            drafts=[json.loads(p) for k,p in rows if k=='draft']
            current=drafts[-1]['version'] if drafts else 0
            if type(version) is not int or version!=current:
                raise ValueError('Draft changed in another tab; reopen the run before editing')
            ids={p['proposal_id'] for p in proposals_from_events([{'kind':k,'payload':json.loads(p)} for k,p in rows])}
            if not isinstance(decisions,list) or len(decisions)!=len(ids) or any(not isinstance(d,dict) for d in decisions):
                raise ValueError('Draft must include every proposal once')
            if {d.get('proposal_id') for d in decisions}!=ids:
                raise ValueError('Draft must include every proposal once')
            clean=[]
            for d in decisions:
                if type(d.get('accept')) is not bool or any(not isinstance(d.get(k),str) or len(d[k])>10000 for k in ('task','owner','deadline')):
                    raise ValueError('Invalid draft fields')
                clean.append({k:d[k] for k in ('proposal_id','accept','task','owner','deadline')})
            if client_id is not None and (not isinstance(client_id,str) or len(client_id)>80 or type(edit_id) is not int or edit_id<1):
                raise ValueError('Invalid draft client metadata')
            payload={'version':current+1,'decisions':clean,'client_id':client_id,'edit_id':edit_id}
            self._append(conn,run_id,'draft',payload)
        return payload

    def add_manual(self,run_id,item,request_id):
        from evaluate import validate_item
        if not isinstance(request_id,str) or not re.fullmatch(r'[a-f0-9]{32}',request_id):
            raise ValueError('Use a stable request ID when adding an action')
        if not isinstance(item,dict) or not isinstance(item.get('evidence'),list) or not 1<=len(item['evidence'])<=20 or any(not isinstance(e,dict) for e in item['evidence']):
            raise ValueError('Highlight at least one exact supporting passage (at most 20)')
        with self.connection() as conn:
            conn.execute('BEGIN IMMEDIATE')
            rows=conn.execute('SELECT kind,payload FROM events WHERE run_id=? ORDER BY event_id',(run_id,)).fetchall()
            events=[{'kind':k,'payload':json.loads(p)} for k,p in rows]
            proposals=proposals_from_events(events)
            if any(e['kind']=='final' for e in events):raise ValueError('This plan is already confirmed')
            clean={}
            for name in ('task','owner','deadline'):
                value=item.get(name)
                if not isinstance(value,str) or not value.strip() or len(value)>10000:raise ValueError('Task, owner, and deadline must be nonempty; use Unknown for missing fields')
                clean[name]=value.strip()
            if clean['deadline']!=UNKNOWN and not re.fullmatch(r'\d{4}-\d{2}-\d{2}',clean['deadline']):raise ValueError('Deadlines must be YYYY-MM-DD or Unknown')
            clean['evidence']=[{k:e.get(k) for k in ('text','start','end')} for e in item['evidence']]
            validate_item(clean,events[0]['payload']['transcript'])
            clean['proposal_id']='manual-'+request_id
            prior=next((p for p in proposals if p['proposal_id']==clean['proposal_id']),None)
            if prior:
                if any(prior[k]!=clean[k] for k in ('task','owner','deadline','evidence')):raise ValueError('Request ID belongs to another action')
                return prior
            if len(proposals)>=200:raise ValueError('A run supports at most 200 proposals')
            for p in proposals:
                if normalize_task(p['task'])==normalize_task(clean['task']) and (p['owner'].casefold()==clean['owner'].casefold() or UNKNOWN in (p['owner'],clean['owner'])) and (p['deadline']==clean['deadline'] or UNKNOWN in (p['deadline'],clean['deadline'])):
                    raise ValueError('This action already appears in the proposals; edit that proposal instead')
            clean.update(source='manual',category='User added')
            self._append(conn,run_id,'manual_proposal',{'proposal':clean})
        return clean

    def finalize(self, run_id, decisions):
        """Commit all corrections/decisions and the final result atomically, once."""
        with self.connection() as conn:
            conn.execute('BEGIN IMMEDIATE')
            rows = conn.execute('SELECT kind,payload FROM events WHERE run_id=? ORDER BY event_id',(run_id,)).fetchall()
            if not rows:
                raise KeyError(run_id)
            if any(kind == 'final' for kind,_ in rows):
                raise ValueError('This run is already finalized; analyze again for a new review')
            original = proposals_from_events([{'kind':k,'payload':json.loads(p)} for k,p in rows])
            proposals = {p['proposal_id']:p for p in original}
            if len(decisions) != len(proposals) or {d['proposal_id'] for d in decisions} != set(proposals):
                raise ValueError('Review must decide each proposal exactly once')
            final = []
            changes = []
            for decision in decisions:
                if type(decision.get('accept')) is not bool:
                    raise ValueError('Accept must be an explicit boolean')
                before = proposals[decision['proposal_id']]
                after = dict(before)
                for key in ('task','owner','deadline'):
                    value = decision.get(key, before[key])
                    if not isinstance(value,str) or not value.strip():
                        raise ValueError(f'{key} cannot be empty; use Unknown for missing metadata')
                    after[key] = value.strip()
                if after['deadline'] != UNKNOWN:
                    date.fromisoformat(after['deadline'])
                changes.append({'proposal_id':decision['proposal_id'],'accept':decision['accept'],
                                'corrections':{k:{'before':before[k],'after':after[k]} for k in ('task','owner','deadline') if before[k] != after[k]}})
                if decision['accept']:
                    # Scheduling/classification are proposals based on original values;
                    # discard them so consumers recompute them from accepted corrections.
                    final.append({k:after[k] for k in ('proposal_id','task','owner','deadline','evidence')} | ({'source':'manual'} if before.get('source')=='manual' else {}))
                if before.get('source')=='manual':changes[-1]['source']='manual'
            self._append(conn,run_id,'review',{'decisions':changes})
            self._append(conn,run_id,'final',{'tasks':final})
        return final
