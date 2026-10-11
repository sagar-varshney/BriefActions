import hashlib
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from annotations import AnnotationStore
from annotation_drafts import AnnotationDrafts, DraftConflict
from corpus_library import catalogue, corpus_inputs
from history import HistoryStore

ROOT=Path(__file__).resolve().parents[1]

class AnnotationDraftTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.store=HistoryStore(Path(self.tmp.name)/'history.db')
        self.ann=AnnotationStore(self.store);self.drafts=AnnotationDrafts(self.ann)
        self.case=self.ann.create('Person A will send the report 📊 tomorrow.','2028-02-28','synthetic',True,True,'meeting-a')
    def tearDown(self):self.tmp.cleanup()
    def state(self):
        text=self.case['transcript']
        return {'items':[{'task':'send report 📊','owner':'','deadline':'not finished','evidence':[{'text':text,'start':0,'end':len(text)}]}],
            'selection':{'text':'📊','start':text.index('📊'),'end':text.index('📊')+1},'task':'unfinished label','owner':'Unknown','deadline':'2028-','reason':'','comparison_opened':False}
    def save(self,reviewer='Reviewer A',mode='review',version=0,state=None):
        return self.drafts.save(self.case['id'],reviewer,mode,state or self.state(),version,'client-a',1)
    def test_partial_fields_unicode_and_reviewer_case_isolation(self):
        saved=self.save()
        self.assertEqual(saved['version'],1)
        self.assertEqual(self.drafts.get(self.case['id'],' reviewer a ')['state'],self.state())
        self.assertIsNone(self.drafts.get(self.case['id'],'Reviewer B'))
        other=self.ann.create('No actions.','2028-02-28','synthetic',True,True,'meeting-b')
        self.assertIsNone(self.drafts.get(other['id'],'Reviewer A'))
        self.assertEqual(self.ann.get(self.case['id'])['reviews'],[])
        self.assertEqual(len(self.ann.get(self.case['id'])['events']),1)
    def test_stale_writes_and_bad_spans_leave_previous_draft_intact(self):
        self.save()
        with self.assertRaises(DraftConflict):self.save(version=0)
        bad=self.state();bad['selection']['end']+=1
        with self.assertRaises(ValueError):self.save(version=1,state=bad)
        self.assertEqual(self.drafts.get(self.case['id'],'Reviewer A')['version'],1)
    def test_submit_clears_draft_and_blocks_late_autosave(self):
        self.save()
        labels=self.state()['items'];labels[0].update(owner='Person A',deadline='2028-02-29')
        self.ann.submit(self.case['id'],'Reviewer A',labels,True)
        self.assertIsNone(self.drafts.get(self.case['id'],'Reviewer A'))
        with self.assertRaises(DraftConflict):self.save()
        self.assertIsNone(self.drafts.get(self.case['id'],'Reviewer B'))
    def test_review_and_resolution_drafts_are_separate_and_exposure_is_not_independence(self):
        state=self.state();state['comparison_opened']=True;self.save(state=state)
        with self.assertRaises(ValueError):self.ann.submit(self.case['id'],'Reviewer A',[],True)
        self.ann.submit(self.case['id'],'one',[],True)
        labels=self.state()['items'];labels[0].update(owner='Person A',deadline='Unknown')
        self.ann.submit(self.case['id'],'two',labels,True)
        self.save(mode='resolution',state=state)
        self.assertTrue(self.drafts.get(self.case['id'],'Reviewer A','resolution')['state']['comparison_opened'])
        self.ann.submit(self.case['id'],'Reviewer A',[],False,reason='No current commitment after discussion.')
        self.assertIsNone(self.drafts.get(self.case['id'],'Reviewer A','resolution'))
        with self.assertRaises(DraftConflict):self.save(reviewer='other')
    def test_invalid_identity_mode_state_and_metadata_are_rejected(self):
        for params in [('','review',self.state(),0,'a',1),('a','bad',self.state(),0,'a',1),('a','review',[],0,'a',1),('a','review',self.state(),True,'a',1),('a','review',self.state(),0,'',1)]:
            with self.assertRaises(ValueError):self.drafts.save(self.case['id'],*params)

class CorpusImportTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.store=HistoryStore(Path(self.tmp.name)/'history.db');self.ann=AnnotationStore(self.store)
    def tearDown(self):self.tmp.cleanup()
    def test_all_84_inputs_import_once_without_gold_or_explanations(self):
        before={p:hashlib.sha256(p.read_bytes()).hexdigest() for p in [ROOT/'evaluation/dev.jsonl',ROOT/'evaluation/test.jsonl',ROOT/'evaluation/revision-v1/dev.jsonl',ROOT/'evaluation/revision-v1/test.jsonl']}
        self.assertEqual(sum(sum(s['cases'] for s in c['splits'].values()) for c in catalogue()),84)
        first=self.ann.import_corpus('all')
        self.assertEqual((first['imported'],first['existing']),(84,0))
        self.assertEqual(len(self.ann.listing()),84)
        second=self.ann.import_corpus('all')
        self.assertEqual((second['imported'],second['existing']),(0,84))
        self.assertEqual(set(first['case_ids']),set(second['case_ids']))
        for brief in self.ann.listing():
            case=self.ann.get(brief['id']);original=case['events'][0]['payload']
            self.assertNotIn('items',original);self.assertNotIn('rationale',original)
            self.assertFalse(original['gold_labels_imported']);self.assertIsNone(case['gold']);self.assertEqual(case['reviews'],[])
            self.assertEqual(case['source'],'synthetic');self.assertIn(case['origin']['split'],('dev','test'))
        for p,digest in before.items():self.assertEqual(hashlib.sha256(p.read_bytes()).hexdigest(),digest)
    def test_partial_import_dedup_and_whitelist(self):
        self.assertEqual(self.ann.import_corpus('revision-v1','dev')['imported'],12)
        self.assertEqual(self.ann.import_corpus('revision-v1')['imported'],12)
        self.assertEqual(self.ann.import_corpus('all')['imported'],60)
        for name,split in [('../test','all'),('starter-v1','unknown')]:
            with self.assertRaises(ValueError):self.ann.import_corpus(name,split)
        self.assertEqual(len(self.ann.listing()),84)
    def test_hash_failure_does_not_import_any_cases(self):
        with patch('corpus_library.hashlib.sha256') as digest:
            digest.return_value.hexdigest.return_value='tampered'
            with self.assertRaises(ValueError):self.ann.import_corpus('all')
        self.assertEqual(self.ann.listing(),[])
    def test_unreviewed_cases_in_a_source_group_block_partial_freeze(self):
        result=self.ann.import_corpus('starter-v1','dev');case_id=result['case_ids'][0]
        for reviewer in ('one','two'):self.ann.submit(case_id,reviewer,[],True)
        manual=self.ann.create('No action.','2026-10-12','synthetic',True,True,'manual')
        for reviewer in ('one','two'):self.ann.submit(manual['id'],reviewer,[],True)
        with self.assertRaisesRegex(ValueError,'Complete all cases'):self.ann.freeze('seed',.3)
        self.assertFalse(any(e['kind']=='annotation_split' for e in self.ann.get(case_id)['events']))
    def test_existing_manual_transcript_is_reused(self):
        row=corpus_inputs('revision-v1','dev')[0]
        c=self.ann.create(row['transcript'],row['reference_date'],'synthetic',True,True,'manual-copy')
        imported=self.ann.import_corpus('revision-v1','dev')
        self.assertEqual((imported['imported'],imported['existing']),(11,1));self.assertIn(c['id'],imported['case_ids'])
