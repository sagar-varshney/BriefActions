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
    conn.execute((ROOT/'deploy/migrations/001_accounts.sql').read_text(),prepare=False)

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
