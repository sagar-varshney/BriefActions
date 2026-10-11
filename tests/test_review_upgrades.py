from dataclasses import asdict
from datetime import date
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from annotations import AnnotationStore
from evaluate import load_dataset,validate_item
from experiment_summary import summarize
from extraction import extract_with_changes
from history import HistoryStore
from web_bridge import handle,ApiError

ROOT=Path(__file__).resolve().parents[1]

class ReviewUpgrades(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.store=HistoryStore(Path(self.tmp.name)/'history.db')
        self.ann=AnnotationStore(self.store)
        self.env=patch.dict(os.environ,{'FLOW_HISTORY_PATH':str(self.store.path)});self.env.start()
    def tearDown(self):self.env.stop();self.tmp.cleanup()
    def create(self,group='meeting-a',text='Person A will send the report tomorrow.'):
        return self.ann.create(text,'2028-02-28','synthetic',True,True,group)
    def labels(self,c,deadline='2028-02-29'):
        return [{'task':'send the report','owner':'Person A','deadline':deadline,'evidence':[{'text':c['transcript'],'start':0,'end':len(c['transcript'])}]}]
    def test_permission_duplicates_dates_and_exact_evidence(self):
        with self.assertRaises(ValueError):self.ann.create('secret','2026-10-11','real',False,True,'x')
        c=self.create()
        with self.assertRaises(ValueError):self.create()
        labels=self.labels(c);labels[0]['evidence'][0]['end']-=1
        with self.assertRaises(ValueError):self.ann.submit(c['id'],'a',labels,True)
        self.assertEqual(self.ann.get(c['id'])['reviews'],[])
    def test_independent_agreement_is_order_insensitive(self):
        c=self.create();labels=self.labels(c)
        self.ann.submit(c['id'],'Reviewer A',labels,True)
        with self.assertRaises(ValueError):self.ann.submit(c['id'],'reviewer a',labels,True)
        with self.assertRaises(ValueError):self.ann.submit(c['id'],'Reviewer B',labels,False)
        c=self.ann.submit(c['id'],'Reviewer B',labels,True)
        self.assertEqual(c['status'],'agreed');self.assertEqual(len(c['gold']),1)
    def test_disagreement_requires_recorded_resolution_and_frozen_split(self):
        c=self.create();a=self.labels(c);b=self.labels(c,'Unknown')
        self.ann.submit(c['id'],'a',a,True)
        c=self.ann.submit(c['id'],'b',b,True)
        self.assertEqual(c['status'],'disagreement');self.assertIsNone(c['gold'])
        with self.assertRaises(ValueError):self.ann.submit(c['id'],'judge',a,False,reason='')
        c=self.ann.submit(c['id'],'judge',a,False,reason='Tomorrow follows the meeting date, including leap day.')
        self.assertEqual(c['status'],'resolved')
        d=self.create('meeting-b','Person A will send the report tomorrow!')
        for reviewer in ('a','b'):self.ann.submit(d['id'],reviewer,[],True)
        frozen=self.ann.freeze('seed',.3)
        self.assertEqual(frozen['manifest']['sources'],{'real':0,'synthetic':2})
        self.assertEqual(frozen,self.ann.export(frozen['snapshot']))
        for split,payload in frozen['files'].items():
            path=Path(self.tmp.name)/f'{split}.jsonl';path.write_text(payload);load_dataset(path)
        with self.assertRaises(ValueError):self.ann.submit(d['id'],'c',[],True)
    def test_draft_restore_partial_edits_version_conflict_and_final_lock(self):
        run=handle({'operation':'analyze','transcript':'Maya will review the risks tomorrow.','reference_date':'2026-10-11','clusters':3})
        d=[{**run['proposals'][0],'task':'','deadline':'unfinished','accept':True}]
        saved=handle({'operation':'draft','run_id':run['id'],'decisions':d,'version':0})
        self.assertEqual(saved['version'],1)
        restored=handle({'operation':'run','run_id':run['id']})
        self.assertEqual(restored['draft']['decisions'][0]['task'],'')
        with self.assertRaises(ApiError):handle({'operation':'draft','run_id':run['id'],'decisions':d,'version':0})
        d[0].update(task='Review risks',deadline='Unknown')
        final=handle({'operation':'finalize','run_id':run['id'],'decisions':d})
        self.assertEqual(final['final_tasks'][0]['task'],'Review risks')
        with self.assertRaises(ApiError):handle({'operation':'draft','run_id':run['id'],'decisions':d,'version':1})
    def test_revision_cancellation_audit_ambiguity_and_unicode_spans(self):
        text='Asha: I will send the report by Friday.\nAsha: Actually, make that Monday.\nAsha: Cancel that task.'
        items,changes=extract_with_changes(text,date(2026,10,1))
        self.assertEqual(items,[]);self.assertEqual([c['kind'] for c in changes],['deadline_revision','cancellation'])
        self.assertEqual(len(changes[-1]['evidence']),3)
        for c in changes:
            for e in c['evidence']:self.assertEqual(text[e['start']:e['end']],e['text'])
        text='Person: I will send the report 📊 tomorrow.\nPerson: Move that to Monday.'
        items,changes=extract_with_changes(text,date(2026,10,1))
        validate_item(asdict(items[0]),text)
        self.assertEqual(items[0].deadline,'2026-10-05')
    def test_frozen_corpus_hashes_dates_and_dev_labels(self):
        import hashlib
        root=ROOT/'evaluation'/'revision-v1';manifest=json.loads((root/'manifest.json').read_text())
        for split in ('dev','test'):
            path=root/f'{split}.jsonl'
            self.assertEqual(hashlib.sha256(path.read_bytes()).hexdigest(),manifest['splits'][split]['sha256'])
            rows=load_dataset(path);self.assertEqual(len(rows),12)
        dev=load_dataset(root/'dev.jsonl')
        self.assertGreater(len({r['reference_date'] for r in dev}),8)
        for r in dev:
            items,_=extract_with_changes(r['transcript'],date.fromisoformat(r['reference_date']))
            self.assertEqual([(i.task,i.owner,i.deadline) for i in items],[(i['task'],i['owner'],i['deadline']) for i in r['items']])

class RepeatSummaryTests(unittest.TestCase):
    def report(self,n,value,cost):
        return {'matrix_model':'local','repeat':n,'prompt_version':'v2','prompt_sha256':'prompt','dataset_sha256':'corpus','evaluator_sha256':'score',
            'label':f'local-v2-{n}','metrics':{'task_f1':value,'cost_usd':cost},'runs':[{'id':'a','model':'actual-local',**({'error':'failed'} if n==2 else {})}]}
    def test_variation_unknown_cost_and_case_failures(self):
        s=summarize([self.report(1,.8,None),self.report(2,1,0)])['groups'][0]
        self.assertAlmostEqual(s['metrics']['task_f1']['mean'],.9)
        self.assertGreater(s['metrics']['task_f1']['stdev'],0)
        self.assertEqual(s['metrics']['cost_usd']['known_runs'],1)
        self.assertEqual(s['case_failures'][0]['failed_runs'],1)
    def test_different_fingerprints_do_not_pool_and_duplicate_repeats_fail(self):
        a=self.report(1,.8,0);b=self.report(2,1,0);b['dataset_sha256']='other'
        self.assertEqual(len(summarize([a,b])['groups']),2)
        with self.assertRaises(ValueError):summarize([a,a])
        b=self.report(2,1,0);b['runs'][0]['runner_sha256']='changed-runner'
        self.assertEqual(len(summarize([a,b])['groups']),2)

class MatrixCliTests(unittest.TestCase):
    def test_actual_cli_retains_repeats_and_refuses_overwrite(self):
        import subprocess
        import sys
        import shlex
        with tempfile.TemporaryDirectory() as folder:
            folder=Path(folder)
            runner=folder/'fixture_runner.py';runner.write_text("import json,sys\njson.load(sys.stdin)\nprint(json.dumps({'items':[], 'model':'fixture-only','cost_usd':0.0}))\n")
            dataset=folder/'dev.jsonl';dataset.write_text(json.dumps({'id':'fixture','split':'dev','reference_date':'2026-10-11','transcript':'No committed actions.','items':[]})+'\n')
            config=folder/'config.json';config.write_text(json.dumps({'models':[{'label':'fixture','command':shlex.join([sys.executable,str(runner)])}],'prompts':['v2'],'repeats':2}))
            out=folder/'reports'
            command=[sys.executable,str(ROOT/'compare_models.py'),'--config',str(config),'--dataset',str(dataset),'--output-dir',str(out)]
            result=subprocess.run(command,capture_output=True,text=True)
            self.assertEqual(result.returncode,0,result.stderr)
            summary=json.loads((out/'repeat-summary.json').read_text())
            self.assertEqual(summary['groups'][0]['repeats'],2)
            self.assertEqual(summary['groups'][0]['actual_models'],['fixture-only'])
            self.assertEqual(subprocess.run(command,capture_output=True).returncode,2)
