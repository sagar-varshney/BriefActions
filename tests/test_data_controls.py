from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import os
import json

from history import HistoryStore
from annotations import AnnotationStore
from annotation_drafts import AnnotationDrafts
from data_controls import DataError,account_status,close_account,delete_input,export_lines
from reviewed_benchmarks import ReviewedBenchmarks
from web_bridge import handle,ApiError

class DataControlTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.history=HistoryStore(Path(self.tmp.name)/'history.db')
        self.env=patch.dict(os.environ,{'FLOW_HISTORY_PATH':str(self.history.path)});self.env.start()
        self.input={'operation':'analyze','transcript':'Maya will send the report tomorrow.','reference_date':'2026-09-15','clusters':1,'request_id':'a'*32}
    def tearDown(self):self.env.stop();self.tmp.cleanup()
    def test_retry_after_confirmation_returns_one_existing_run_and_changed_input_conflicts(self):
        run=handle(self.input);handle({'operation':'finalize','run_id':run['id'],'decisions':[dict(p,accept=True) for p in run['proposals']]})
        retry=handle(self.input)
        self.assertEqual(retry['id'],run['id']);self.assertEqual(retry['status'],'confirmed');self.assertEqual(len(self.history.list_runs()),1)
        with self.assertRaises(DataError) as caught:handle(self.input|{'transcript':'Jon will send the invoice.'})
        self.assertEqual(caught.exception.status,409)
        for bad in ['',False,'../a',123]:
            with self.assertRaises(DataError):handle(self.input|{'request_id':bad})
    def test_parallel_commit_of_one_request_is_idempotent(self):
        def create(_):return self.history.create_run('Private.','2026-09-15',[],{'request_fingerprint':'same'},request_id='b'*32)
        with ThreadPoolExecutor(max_workers=2) as pool:self.assertEqual(list(pool.map(create,range(2))),['b'*32]*2)
        self.assertEqual(len(self.history.get_run('b'*32)),1)
    def test_transcript_erasure_removes_final_and_draft_and_prevents_retry_resurrection(self):
        run=handle(self.input);decisions=[dict(p,accept=True) for p in run['proposals']]
        self.history.save_draft(run['id'],decisions,0);self.history.finalize(run['id'],decisions)
        other=self.history.create_run('Keep this.','2026-09-15',[])
        delete_input(self.history,run['id'],'extraction');delete_input(self.history,run['id'],'extraction')
        with self.assertRaises(KeyError):self.history.get_run(run['id'])
        with self.assertRaises(DataError) as caught:handle(self.input)
        self.assertEqual(caught.exception.status,410);self.assertEqual(len(self.history.get_run(other)),1)
        text=str(list(export_lines(self.history)));self.assertNotIn('Maya',text);self.assertNotIn(run['id'],text)
    def test_annotation_erasure_invalidates_dependent_frozen_snapshots_and_reports(self):
        ann=AnnotationStore(self.history);cases=[]
        for group in ('a','b','c'):
            case=ann.create(f'Maya will send the report {group} tomorrow.','2026-09-15','synthetic',True,True,group);cases.append(case)
            labels=[{'task':f'send the report {group}','owner':'Maya','deadline':'2026-09-16','evidence':[{'text':case['transcript'],'start':0,'end':len(case['transcript'])}]}]
            for reviewer in ('one','two'):ann.submit(case['id'],reviewer,labels,True)
        frozen=ann.freeze('seed',.3);bench=ReviewedBenchmarks(self.history);report=bench.run(frozen['snapshot'])
        delete_input(self.history,cases[0]['id'],'annotation_input')
        with self.assertRaises(KeyError):ann.get(cases[0]['id'])
        with self.assertRaises(KeyError):ann.export(frozen['snapshot'])
        with self.assertRaises(KeyError):bench.get(report['id'])
        self.assertEqual(len(ann.listing()),2)
        with self.history.connection() as conn:
            with self.assertRaises(DataError):self.history._append(conn,'c'*32,'reviewed_benchmark',{'snapshot':frozen['snapshot']})
    def test_account_erasure_is_idempotent_and_blocks_pending_writes_and_reads(self):
        run=handle(self.input)
        close_account(self.history);close_account(self.history)
        self.assertEqual(account_status(self.history)['state'],'deleting')
        self.assertEqual(account_status(self.history)['storage']['history']['used_bytes'],0)
        self.assertEqual(account_status(self.history)['storage']['drafts']['used_bytes'],0)
        for work in [lambda:handle(self.input),lambda:self.history.save_draft(run['id'],[],0),lambda:list(export_lines(self.history)),lambda:self.history.list_runs()]:
            with self.assertRaises(DataError):work()
        with self.history.connection(allow_closing=True) as conn:
            self.assertEqual(conn.execute('SELECT COUNT(*) FROM events').fetchone()[0],0)
            self.assertEqual(conn.execute('SELECT COUNT(*) FROM annotation_drafts').fetchone()[0],0)
    def test_export_includes_all_event_types_and_annotation_drafts_and_complete_marker(self):
        handle(self.input);ann=AnnotationStore(self.history)
        case=ann.create('No tasks.','2026-09-15','synthetic',True,True,'a')
        state={'items':[],'selection':None,'task':'unfinished','owner':'Unknown','deadline':'Unknown','reason':'','comparison_opened':False}
        AnnotationDrafts(ann).save(case['id'],'reviewer','review',state,0,'client',1)
        lines=list(export_lines(self.history))
        self.assertEqual(lines[0]['schema'],'flow-workspace-export-v1');self.assertEqual(lines[-1],{'type':'complete','records':3})
        self.assertEqual(sum(line['type']=='annotation_draft' for line in lines),1)
        self.assertEqual(next(line for line in lines if line['type']=='annotation_draft')['payload']['state'],state)
    def test_large_analysis_is_rejected_before_unreviewable_result_is_persisted(self):
        text='\n'.join(f'Maya will review item {i} tomorrow.' for i in range(201))
        with self.assertRaises(ApiError) as caught:handle(self.input|{'transcript':text})
        self.assertEqual(caught.exception.status,413);self.assertEqual(self.history.list_runs(),[])

    def test_storage_counts_utf8_payload_bytes_and_replaced_drafts_and_erasure(self):
        empty=account_status(self.history)['storage']
        self.assertEqual(empty['history']['used_bytes'],0)
        self.assertEqual(empty['drafts']['used_bytes'],0)
        self.assertEqual(empty['history']['limit_bytes'],25_000_000 if self.history.database_url else None)
        self.assertEqual(empty['drafts']['limit_bytes'],5_000_000 if self.history.database_url else None)
        # Raw non-ASCII JSON verifies bytes rather than characters on both stores.
        payload=json.dumps({'transcript':'Maya 📝 café 漢字'},ensure_ascii=False)
        with self.history.connection() as conn:
            conn.execute('INSERT INTO events(run_id,kind,created_at,payload) VALUES (?,?,?,?)',('d'*32,'annotation_input','now',payload))
            conn.execute('INSERT INTO annotation_drafts(case_id,reviewer_key,mode,version,updated_at,payload) VALUES (?,?,?,?,?,?)',('d'*32,'reviewer','review',1,'now',payload))
        usage=account_status(self.history)['storage']
        self.assertEqual(usage['history']['used_bytes'],len(payload.encode('utf8')))
        self.assertEqual(usage['drafts']['used_bytes'],len(payload.encode('utf8')))
        with self.history.connection() as conn:
            conn.execute('UPDATE annotation_drafts SET payload=? WHERE case_id=?',('{}','d'*32))
        self.assertEqual(account_status(self.history)['storage']['drafts']['used_bytes'],2)
        delete_input(self.history,'d'*32,'annotation_input')
        erased=account_status(self.history)['storage']
        self.assertEqual(erased['history']['used_bytes'],0)
        self.assertEqual(erased['drafts']['used_bytes'],0)
