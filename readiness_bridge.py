"""Persistent, read-only storage probes. No transcripts enter this protocol."""
import json
import os
from pathlib import Path
import sqlite3
import sys
from contextlib import closing

URL=os.environ.get('FLOW_DATABASE_URL')
if URL:
    import psycopg

def check():
    if URL:
        with psycopg.connect(URL,connect_timeout=3,prepare_threshold=None) as conn:
            conn.execute('SET TRANSACTION READ ONLY')
            conn.execute('SET LOCAL ROLE flow_app')
            conn.execute("SET LOCAL search_path=flow,pg_catalog")
            conn.execute("SELECT set_config('flow.owner','00000000-0000-0000-0000-000000000000',true)")
            conn.execute("SET LOCAL statement_timeout='2s'")
            for table in ('events','annotation_drafts','deleted_inputs','account_lifecycle'):
                conn.execute(f'SELECT 1 FROM {table} LIMIT 1').fetchone()
            if conn.execute('SELECT flow.series_agenda_erasure_version()').fetchone()[0]!=5:raise ValueError()
    else:
        path=Path(os.environ['FLOW_HISTORY_PATH']).resolve().as_uri()+'?mode=ro'
        with closing(sqlite3.connect(path,uri=True,timeout=2)) as conn:
            for table in ('events','annotation_drafts','deleted_inputs','account_lifecycle'):
                conn.execute(f'SELECT 1 FROM {table} LIMIT 1').fetchone()

for request in sys.stdin:
    try:
        if json.loads(request)!={'operation':'probe'}:raise ValueError()
        check();result={'ok':True}
    except Exception:
        result={'ok':False}
    print(json.dumps(result),flush=True)
