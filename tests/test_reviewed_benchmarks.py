from dataclasses import asdict
from datetime import date
import hashlib
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from annotations import AnnotationStore
from extraction import extract_action_items
from history import HistoryStore
from reviewed_benchmarks import ReviewedBenchmarks
from web_bridge import handle,ApiError

ROOT=Path(__file__).resolve().parents[1]

class MissedActionsTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.store=HistoryStore(Path(self.tmp.name)/'history.db')
        self.env=patch.dict(os.environ,{'FLOW_HISTORY_PATH':str(self.store.path)});self.env.start()
        self.text="Maya will send the report tomorrow.\nAlex: I'll approve the invoice 📄 by Friday."
        self.proposals=[asdict(p) for p in extract_action_items(self.text,date(2026,9,15))]
        self.run_id=self.store.create_run(self.text,'2026-09-15',self.proposals)
    def tearDown(self):self.env.stop();self.tmp.cleanup()
    def item(self):
        start=self.text.index('Alex:');quote=self.text[start:]
        return {'task':'approve the invoice 📄','owner':'Alex','deadline':'2026-09-18','evidence':[{'text':quote,'start':start,'end':len(self.text)}]}
    def add(self,item=None,request_id='a'*32):return handle({'operation':'manual_action','run_id':self.run_id,'item':item or self.item(),'request_id':request_id})
    def test_append_only_addition_idempotent_retry_and_legacy_draft_merge(self):
        decisions=[{k:p[k] for k in ('proposal_id','task','owner','deadline')}|{'accept':True} for p in self.proposals]
        decisions[0]['owner']='Zoe';self.store.save_draft(self.run_id,decisions,0)
        run=self.add();self.assertEqual(len(run['proposals']),2)
        self.assertEqual(run['events'][0]['payload']['proposals'],self.proposals)
        self.assertEqual(run['proposals'][-1]['source'],'manual')
        self.assertEqual(run['draft']['decisions'][0]['owner'],'Zoe');self.assertFalse(run['draft']['decisions'][-1]['accept'])
        retry=self.add();self.assertEqual(len(retry['events']),len(run['events']))
        self.assertEqual(handle({'operation':'runs'})[0]['proposal_count'],2)
    def test_confirm_corrections_manual_source_csv_and_final_lock(self):
        run=self.add();decisions=[dict(p,accept=i==1) for i,p in enumerate(run['proposals'])]
        decisions[1]['task']='Approve supplier invoice 📄'
        final=handle({'operation':'finalize','run_id':self.run_id,'decisions':decisions})
        self.assertEqual(len(final['final_tasks']),1);self.assertEqual(final['final_tasks'][0]['source'],'manual')
        self.assertEqual(final['final_tasks'][0]['evidence'],self.item()['evidence'])
        review=next(e for e in final['events'] if e['kind']=='review')
        self.assertEqual(review['payload']['decisions'][1]['source'],'manual')
        self.assertEqual(review['payload']['decisions'][1]['corrections']['task']['before'],self.item()['task'])
        csv=handle({'operation':'csv','run_id':self.run_id});self.assertIn('manual',csv);self.assertIn("Alex: I'll approve",csv)
        with self.assertRaises(ApiError) as caught:self.add(request_id='b'*32)
        self.assertEqual(caught.exception.status,409)
    def test_invalid_evidence_dates_duplicate_items_and_retry_changes_roll_back(self):
        for change in [{'evidence':[]},{'evidence':[{'text':'invented','start':0,'end':8}]},{'deadline':'2026-02-30'},{'owner':''},{'deadline':'20260918'}]:
            with self.assertRaises(ValueError):self.add(self.item()|change)
        self.assertEqual(len(self.store.get_run(self.run_id)),1)
        self.add()
        with self.assertRaises(ApiError):self.add(request_id='b'*32)
        with self.assertRaises(ApiError):self.add(self.item()|{'owner':'Changed owner'})
        self.assertEqual(len(self.store.get_run(self.run_id)),2)
    def test_each_new_proposal_must_be_decided_and_saved_draft_includes_it(self):
        run=self.add()
        with self.assertRaises(ValueError):self.store.finalize(self.run_id,[dict(self.proposals[0],accept=True)])
        decisions=[dict(p,accept=False) for p in run['proposals']]
        self.store.save_draft(self.run_id,decisions,0)
        self.assertEqual(len(handle({'operation':'run','run_id':self.run_id})['draft']['decisions']),2)
    def test_add_to_empty_extraction_preserves_unknowns(self):
        run_id=self.store.create_run("Alex: I'll approve the invoice 📄 by Friday.",'2026-09-15',[])
        text="Alex: I'll approve the invoice 📄 by Friday."
        item=self.item()|{'owner':'Unknown','deadline':'Unknown','evidence':[{'text':text,'start':0,'end':len(text)}]}
        p=self.store.add_manual(run_id,item,'b'*32)
        self.assertEqual((p['owner'],p['deadline']),('Unknown','Unknown'))
        self.assertEqual(len(self.store.finalize(run_id,[dict(p,accept=True)])),1)

class ReviewedSnapshotTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.store=HistoryStore(Path(self.tmp.name)/'history.db')
        self.annotations=AnnotationStore(self.store);self.bench=ReviewedBenchmarks(self.store)
        data=[('a','Dana will send the report tomorrow.','send the report','Dana','2026-09-17'),
              ('b',"Alex: I'll approve the invoice by Friday.",'approve the invoice','Alex','2026-09-18'),
              ('c','Jon will review the risks today.','review the risks','Jane','2026-09-15')]
        self.case_ids=[]
        for group,text,task,owner,deadline in data:
            c=self.annotations.create(text,'2026-09-15','synthetic',True,True,group);self.case_ids.append(c['id'])
            items=[{'task':task,'owner':owner,'deadline':deadline,'evidence':[{'text':text,'start':0,'end':len(text)}]}]
            for reviewer in ('fixture-one','fixture-two'):self.annotations.submit(c['id'],reviewer,items,True)
        self.snapshot=self.annotations.freeze('seed',.3)['snapshot']
    def tearDown(self):self.tmp.cleanup()
    def test_original_current_same_frozen_inputs_errors_hashes_and_saved_history(self):
        before=[self.store.get_run(cid) for cid in self.case_ids]
        report=self.bench.run(self.snapshot,'all',True,'c'*32)
        self.assertEqual(report['case_count'],3);self.assertEqual(len(report['reports']),2)
        current=report['reports'][1]
        self.assertEqual(current['counts']['gold'],3);self.assertEqual(current['counts']['matched'],2)
        self.assertEqual(current['counts']['owner_correct'],1);self.assertEqual(current['counts']['deadline_correct'],1)
        self.assertEqual(sum(len(d['missed_gold']) for d in current['details']),1)
        self.assertEqual(report['evaluator_sha256'],hashlib.sha256((ROOT/'evaluate.py').read_bytes()).hexdigest())
        self.assertEqual(self.bench.get(report['id']),report)
        self.assertEqual(len(self.bench.listing()),1);self.assertEqual(self.store.list_runs(),[])
        self.assertEqual(before,[self.store.get_run(cid) for cid in self.case_ids])
    def test_heldout_acknowledgment_default_dev_and_idempotent_request(self):
        self.assertEqual(self.bench.run(self.snapshot)['split'],'dev')
        for split in ('all','test'):
            with self.assertRaises(ValueError):self.bench.run(self.snapshot,split)
        first=self.bench.run(self.snapshot,'test',True,'d'*32)
        self.assertEqual(first,self.bench.run(self.snapshot,'test',True,'d'*32))
        with self.assertRaises(ValueError):self.bench.run(self.snapshot,'dev',request_id='d'*32)
        self.assertEqual(len(self.bench.listing()),2)
    def test_only_frozen_snapshots_and_valid_ids_can_be_scored(self):
        with self.assertRaises(KeyError):self.bench.run(self.case_ids[0])
        for value in ('../secret',None):
            with self.assertRaises(ValueError):self.bench.run(value)
        with self.assertRaises(ValueError):self.bench.run(self.snapshot,'unknown')
        self.assertEqual(self.bench.listing(),[])
    def test_extraction_failures_are_retained_in_counts_and_case_outputs(self):
        with patch('reviewed_benchmarks.extract_rules',side_effect=RuntimeError('fixture failure')):
            report=self.bench.run(self.snapshot)
        for extractor in report['reports']:
            self.assertEqual(extractor['counts']['failures'],report['case_count'])
            self.assertTrue(all(r.get('error') for r in extractor['runs']))
    def test_snapshot_listing_preserves_sources_and_split_counts(self):
        listing=self.bench.snapshots();self.assertEqual(len(listing),1)
        self.assertEqual(listing[0]['case_count'],3);self.assertEqual(listing[0]['manifest']['sources'],{'real':0,'synthetic':3})
        self.assertEqual(sum(s['cases'] for s in listing[0]['manifest']['files'].values()),3)
