"""Destructive restore drills use two newly created, disposable CI databases only."""
from dataclasses import asdict
from datetime import date
import os
from pathlib import Path
import sys
import tempfile
from uuid import uuid4

ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT))
import psycopg
from psycopg import sql
from psycopg.conninfo import conninfo_to_dict,make_conninfo
from scripts.backup import BackupError,encrypt,records,restore
from history import HistoryStore
from annotations import AnnotationStore
from annotation_drafts import AnnotationDrafts
from reviewed_benchmarks import ReviewedBenchmarks
from extraction import extract_action_items
from data_controls import delete_input,close_account,DataError

admin_url=os.environ['FLOW_TEST_DATABASE_URL']
names=['flow_backup_'+uuid4().hex,'flow_restore_'+uuid4().hex]
urls=[make_conninfo(**(conninfo_to_dict(admin_url)|{'dbname':name})) for name in names]
key=bytes(range(32))  # Public synthetic fixture, not an operational secret.
created=[]
try:
    with psycopg.connect(admin_url,autocommit=True) as conn:
        for name in names:
            conn.execute(sql.SQL('CREATE DATABASE {}').format(sql.Identifier(name)));created.append(name)
    for url in urls:
        with psycopg.connect(url,autocommit=True) as conn:
            for migration in sorted((ROOT/'deploy/migrations').glob('*.sql')):conn.execute(migration.read_text(),prepare=False)
    source,target=urls;alice,bob=str(uuid4()),str(uuid4())
    store=HistoryStore('/unused',database_url=source,owner=alice)
    other=HistoryStore('/unused',database_url=source,owner=bob)
    text='Maya will send the report tomorrow.'
    proposals=[asdict(p) for p in extract_action_items(text,date(2026,10,12))]
    keep=store.create_run(text,'2026-10-12',proposals)
    decisions=[dict(p,accept=True) for p in proposals];decisions[0]['task']='Send reviewed report'
    store.save_draft(keep,decisions,0,'fixture',1);store.finalize(keep,decisions)
    erased=store.create_run('Erased after backup.','2026-10-12',[])
    bob_run=other.create_run('Account erased after backup.','2026-10-12',[])
    annotations=AnnotationStore(store);cases=[]
    for group in ['one','two','three']:
        case=annotations.create(text+'\nContext: '+group+'.','2026-10-12','synthetic',True,True,group);cases.append(case['id'])
        items=[{k:proposals[0][k] for k in ('task','owner','deadline','evidence')}]
        for reviewer in ['fixture-one','fixture-two']:annotations.submit(case['id'],reviewer,items,True)
    snapshot=annotations.freeze('backup-fixture',.3)['snapshot']
    report=ReviewedBenchmarks(store).run(snapshot,'dev')
    draft_case=annotations.create(text,'2026-10-12','synthetic',True,True,'unfinished')
    AnnotationDrafts(annotations).save(draft_case['id'],'fixture','review',{'items':[],'selection':None,'task':'unfinished edit','owner':'Unknown','deadline':'Unknown','reason':'','comparison_opened':False},0,'fixture',1)
    with tempfile.TemporaryDirectory() as folder:
        backup=Path(folder)/'application.flowbak';ledger=Path(folder)/'ledger.flowbak'
        encrypt(records(source,'backup'),backup,key)
        # Ledger must come from the current source, after any intervening user deletions.
        delete_input(store,erased,'extraction');delete_input(store,cases[0],'annotation_input');close_account(other)
        encrypt(records(source,'ledger'),ledger,key)
        # An authenticated but invalid row set must roll back every insert and trigger change.
        from scripts.backup import decrypted,line,json_lines
        import hashlib
        with decrypted(backup,key) as stream:
            values=[value for _,value in json_lines(stream)]
        row=next(value for value in values if value.get('table')=='events')
        values.insert(-1,row);values[-1]['counts']['events']+=1
        values[-1]['sha256']=hashlib.sha256(b''.join(line(v) for v in values if v['type']=='row')).hexdigest()
        duplicate=Path(folder)/'duplicate.flowbak';encrypt((line(value) for value in values),duplicate,key)
        try:restore(duplicate,target,key,ledger)
        except psycopg.errors.UniqueViolation:pass
        else:raise AssertionError('Duplicate event ID was accepted')
        with psycopg.connect(target) as conn:
            assert conn.execute('SELECT count(*) FROM flow.events').fetchone()[0]==0
            assert not conn.execute("SELECT 1 FROM pg_trigger WHERE tgrelid='flow.events'::regclass AND tgenabled='D'").fetchone()
        counts=restore(backup,target,key,ledger)
        assert counts['events']>=10
        restored=HistoryStore('/unused',database_url=target,owner=alice)
        self_snapshot=restored.get_run(keep)
        assert self_snapshot==store.get_run(keep), 'Original input, evidence, corrections, final plan or IDs changed'
        for rid in [erased,cases[0]]:
            try:restored.get_run(rid)
            except KeyError:pass
            else:raise AssertionError('Post-backup erased transcript was restored')
        assert not ReviewedBenchmarks(restored).listing(), 'Dependent frozen comparison survived erasure'
        restored_annotations=AnnotationStore(restored)
        assert restored_annotations.get(cases[1])['reviews']==annotations.get(cases[1])['reviews']
        assert AnnotationDrafts(restored_annotations).get(draft_case['id'],'fixture','review')['state']['task']=='unfinished edit'
        closed=HistoryStore('/unused',database_url=target,owner=bob)
        try:closed.list_runs()
        except DataError:pass
        else:raise AssertionError('Deleted account was reactivated')
        charlie=HistoryStore('/unused',database_url=target,owner=str(uuid4()))
        assert not charlie.list_runs(), 'Cross-account leak after restore'
        new_id=restored.create_run('After restore.','2026-10-12',[])
        assert restored.get_run(new_id)[0]['event_id']>max(e['event_id'] for e in self_snapshot)
        before=restored.list_runs()
        try:restore(backup,target,key,ledger)
        except BackupError as error:assert 'contains application data' in str(error)
        else:raise AssertionError('Nonempty restore target was overwritten')
        assert restored.list_runs()==before
        wrong_ledger=Path(folder)/'wrong-ledger.flowbak';encrypt(records(target,'ledger'),wrong_ledger,key)
        # Target inherited source identity, so use an unrelated ID in an authenticated fixture.
        with decrypted(wrong_ledger,key) as stream:
            rows=[value for _,value in json_lines(stream)]
        rows[0]['database_id']=str(uuid4());wrong_ledger.unlink();encrypt((line(row) for row in rows),wrong_ledger,key)
        try:restore(backup,target,key,wrong_ledger)
        except BackupError as error:assert 'another database' in str(error)
        else:raise AssertionError('Foreign erasure ledger accepted')
        old_ledger=Path(folder)/'old-ledger.flowbak';rows[0]['database_id']=values[0]['database_id'];rows[0]['created_at']='2000-01-01T00:00:00+00:00';encrypt((line(row) for row in rows),old_ledger,key)
        try:restore(backup,target,key,old_ledger)
        except BackupError as error:assert 'predates' in str(error)
        else:raise AssertionError('Older erasure ledger accepted')
        damaged=Path(folder)/'damaged.flowbak';damaged.write_bytes(backup.read_bytes()[:-1])
        try:restore(damaged,target,key,ledger)
        except BackupError:pass
        else:raise AssertionError('Damaged file was accepted')
        assert restored.list_runs()==before
        with psycopg.connect(source) as conn:
            conn.execute('SET LOCAL ROLE flow_app')
            from scripts.backup import admin
            try:admin(conn)
            except BackupError:pass
            else:raise AssertionError('RLS-scoped backup silently accepted')
    print('Encrypted Postgres restore drill passed: every account, immutable history/evidence, drafts, reviews, sequence, RLS, later transcript/account erasure and dependent report purge, foreign-ledger rejection, damaged-file rejection, and nonempty-target protection.')
finally:
    with psycopg.connect(admin_url,autocommit=True) as conn:
        for name in created:conn.execute(sql.SQL('DROP DATABASE {} WITH (FORCE)').format(sql.Identifier(name)))
