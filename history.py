"""Local append-only extraction and review history in SQLite.

The final result is a local task plan. No external tasks are created here.
"""
from __future__ import annotations

from contextlib import contextmanager
from datetime import datetime, timezone, date
import json
from pathlib import Path
import sqlite3
from uuid import uuid4

from extraction import UNKNOWN


class HistoryStore:
    def __init__(self, path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.connection() as conn:
            conn.execute('''CREATE TABLE IF NOT EXISTS events (
                event_id INTEGER PRIMARY KEY AUTOINCREMENT,
                run_id TEXT NOT NULL, kind TEXT NOT NULL,
                created_at TEXT NOT NULL, payload TEXT NOT NULL)''')
            conn.execute('CREATE INDEX IF NOT EXISTS events_run ON events(run_id,event_id)')

    @contextmanager
    def connection(self):
        conn = sqlite3.connect(self.path, timeout=10)
        try:
            with conn:
                yield conn
        finally:
            conn.close()

    def _append(self, conn, run_id, kind, payload):
        conn.execute('INSERT INTO events(run_id,kind,created_at,payload) VALUES (?,?,?,?)',
                     (run_id,kind,datetime.now(timezone.utc).isoformat(),json.dumps(payload)))

    def create_run(self, transcript, reference_date, proposals, settings=None):
        run_id = uuid4().hex
        with self.connection() as conn:
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
            ids={p['proposal_id'] for p in json.loads(rows[0][1])['proposals']}
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

    def finalize(self, run_id, decisions):
        """Commit all corrections/decisions and the final result atomically, once."""
        with self.connection() as conn:
            conn.execute('BEGIN IMMEDIATE')
            rows = conn.execute('SELECT kind,payload FROM events WHERE run_id=? ORDER BY event_id',(run_id,)).fetchall()
            if not rows:
                raise KeyError(run_id)
            if any(kind == 'final' for kind,_ in rows):
                raise ValueError('This run is already finalized; analyze again for a new review')
            original = json.loads(rows[0][1])['proposals']
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
                    final.append({k:after[k] for k in ('proposal_id','task','owner','deadline','evidence')})
            self._append(conn,run_id,'review',{'decisions':changes})
            self._append(conn,run_id,'final',{'tasks':final})
        return final
