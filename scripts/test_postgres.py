"""Run the existing storage/workflow regression suite against real Postgres."""
import os
from pathlib import Path
import sys
import unittest
from concurrent.futures import ThreadPoolExecutor
from uuid import uuid4, uuid5, NAMESPACE_URL

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
import psycopg
from history import HistoryStore
from annotations import AnnotationStore
from annotation_drafts import AnnotationDrafts

url=os.environ['FLOW_TEST_DATABASE_URL']
with psycopg.connect(url,autocommit=True) as conn:
    for migration in sorted((ROOT/'deploy/migrations').glob('*.sql')):conn.execute(migration.read_text(),prepare=False)

original=HistoryStore.__init__
namespace=uuid4()
def hosted(self,path,**kwargs):
    original(self,path,database_url=url,owner=str(uuid5(namespace,str(path))))
HistoryStore.__init__=hosted
suite=unittest.TestLoader().discover(str(ROOT/'tests'),pattern='test_*.py')
result=unittest.TextTestRunner(verbosity=2).run(suite)
HistoryStore.__init__=original
if not result.wasSuccessful():sys.exit(1)

# An account cannot fetch another account's IDs, drafts, or change ownership.
a,b=str(uuid4()),str(uuid4())
one=HistoryStore('/unused',database_url=url,owner=a)
two=HistoryStore('/unused',database_url=url,owner=b)
run=one.create_run('Private meeting.','2026-09-15',[])
assert not two.list_runs()
try:two.get_run(run)
except KeyError:pass
else:raise AssertionError('Cross-account event leak')
case=AnnotationStore(one).create('Private meeting.','2026-09-15','synthetic',True,True,'private')
drafts=AnnotationDrafts(AnnotationStore(one))
drafts.save(case['id'],'reviewer','review',{'items':[],'selection':None,'task':'private','owner':'Unknown','deadline':'Unknown','reason':'','comparison_opened':False},0,'client',1)
with two.connection() as conn:
    assert conn.execute('SELECT COUNT(*) FROM annotation_drafts').fetchone()[0]==0
    try:
        conn.execute('INSERT INTO events(run_id,kind,created_at,payload,owner_id) VALUES (?,?,?,?,?)',('bad','extraction','now','{}',a))
    except psycopg.errors.InsufficientPrivilege:pass
    else:raise AssertionError('RLS accepted forged owner')
with one.connection() as conn:
    assert conn.execute('SELECT current_user').fetchone()[0]=='flow_app'
    try:conn.execute('DELETE FROM events')
    except psycopg.errors.InsufficientPrivilege:pass
    else:raise AssertionError('Event deletion allowed')
with psycopg.connect(url) as conn:
    conn.execute('SET LOCAL ROLE flow_app')
    assert conn.execute('SELECT COUNT(*) FROM flow.events').fetchone()[0]==0

# Concurrent saves must not both accept version 0.
one.create_run('No actions.','2026-09-15',[])
def save_racing():
    try:return one.save_draft(run,[],0,'client',1)['version']
    except ValueError:return 'conflict'
with ThreadPoolExecutor(max_workers=2) as pool:
    assert sorted(pool.map(lambda _:save_racing(),range(2)),key=str)==[1,'conflict']
with one.connection() as conn:
    try:conn.execute('INSERT INTO events(run_id,kind,created_at,payload) VALUES (?,?,?,?)',('budget','extraction','now','x'*25_000_001))
    except psycopg.errors.RaiseException as error:assert str(error).startswith('Workspace history storage limit reached')
    else:raise AssertionError('History storage quota bypassed')
print('Postgres: workflow regression suite, RLS isolation, forged/missing-owner denial, append-only permissions, concurrent draft conflict, and history quota passed.')

# Even privileged erasure functions retain row security across account boundaries.
with two.connection() as conn:conn.execute('SELECT flow.erase_input(?)',(run,))
assert one.get_run(run)
other=two.create_run('Other account remains.','2026-09-15',[])
from data_controls import close_account,DataError
close_account(one)
with one.connection(allow_closing=True) as conn:assert conn.execute('SELECT COUNT(*) FROM events').fetchone()[0]==0
assert two.get_run(other)
try:one.create_run('Must not return.','2026-09-15',[])
except DataError:pass
else:raise AssertionError('Closed account accepted a write')
print('Postgres: erasure functions preserve cross-account isolation and closed-account writes are blocked.')

# Warm workers reuse the same physical connection across different account
# transactions. Exercise the production cache with real RLS, not mocked claims.
from storage import reusable_connections
c,d=str(uuid4()),str(uuid4())
first=HistoryStore('/unused',database_url=url,owner=c)
second=HistoryStore('/unused',database_url=url,owner=d)
with reusable_connections():
    saved=first.create_run('Warm-worker isolation fixture.','2026-10-21',[])
    with first.connection() as conn:
        pid=conn.execute('SELECT pg_backend_pid()').fetchone()[0]
        assert conn.execute('SELECT current_user').fetchone()[0]=='flow_app'
    with second.connection() as conn:
        assert conn.execute('SELECT pg_backend_pid()').fetchone()[0]==pid
        assert not conn.execute('SELECT 1 FROM events WHERE run_id=?',(saved,)).fetchone()
        assert conn.execute("SELECT current_setting('flow.owner')").fetchone()[0]==d
    with first.connection() as outer:
        with second.connection() as inner:
            assert inner.execute('SELECT pg_backend_pid()').fetchone()[0]!=pid
            assert not inner.execute('SELECT 1 FROM events WHERE run_id=?',(saved,)).fetchone()
        assert outer.execute("SELECT current_setting('flow.owner')").fetchone()[0]==c
    try:HistoryStore('/unused',database_url=url,owner=None).list_runs()
    except ValueError:pass
    else:raise AssertionError('A warm connection accepted a missing account')
    try:
        with second.connection() as conn:
            conn.execute('SELECT 1/0')
    except psycopg.errors.DivisionByZero:pass
    else:raise AssertionError('Expected failed transaction')
    with first.connection() as conn:
        next_pid=conn.execute('SELECT pg_backend_pid()').fetchone()[0]
        assert next_pid!=pid, 'Failed connections must be discarded'
        assert conn.execute('SELECT run_id FROM events WHERE run_id=?',(saved,)).fetchone()
    # A pooler may close an idle session. Reconnect before any application write;
    # no failed/ambiguous application operation is replayed.
    with psycopg.connect(url,autocommit=True) as admin:
        admin.execute('SELECT pg_terminate_backend(%s)',(next_pid,))
    with second.connection() as conn:
        assert conn.execute('SELECT pg_backend_pid()').fetchone()[0]!=next_pid
        assert not conn.execute('SELECT 1 FROM events WHERE run_id=?',(saved,)).fetchone()
    assert first.get_run(saved)
assert first.get_run(saved), 'Writes must be committed before entering the idle cache'
print('Postgres: warm connection reuse, transaction-local account/role reset, failed-transaction discard, stale-session reconnect, and committed persistence passed.')
