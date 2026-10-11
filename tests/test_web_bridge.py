from datetime import date
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from web_bridge import ApiError, handle
from history import HistoryStore
from extraction import extract_action_items
from dataclasses import asdict


class WebBridgeTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.env = patch.dict(os.environ,{'FLOW_HISTORY_PATH':str(Path(self.folder.name)/'history.sqlite3')})
        self.env.start()

    def tearDown(self):
        self.env.stop()
        self.folder.cleanup()

    def create(self):
        return handle({'operation':'analyze','transcript':'Maya will review the risks tomorrow.\nJon will send the invoice.','reference_date':'2026-09-15','clusters':3})

    def test_analyze_correct_confirm_and_csv(self):
        run = self.create()
        self.assertEqual(run['status'],'review')
        self.assertEqual(run['proposals'][0]['deadline'],'2026-09-16')
        self.assertTrue(run['summary'])
        decisions = [dict(p,accept=i==0) for i,p in enumerate(run['proposals'])]
        decisions[0].update(task='Review launch risks',owner='Ravi',deadline='Unknown')
        final = handle({'operation':'finalize','run_id':run['id'],'decisions':decisions})
        self.assertEqual(final['status'],'confirmed')
        self.assertEqual(len(final['final_tasks']),1)
        self.assertEqual(final['final_tasks'][0]['owner'],'Ravi')
        self.assertEqual(final['events'][0]['payload']['proposals'][0]['owner'],'Maya')
        self.assertEqual(final['events'][1]['payload']['decisions'][0]['corrections']['owner']['after'],'Ravi')
        self.assertIn('supporting_transcript_passages',handle({'operation':'csv','run_id':run['id']}))
        with self.assertRaises(ApiError) as caught:
            handle({'operation':'finalize','run_id':run['id'],'decisions':decisions})
        self.assertEqual(caught.exception.status,409)

    def test_validates_input_before_creating_history(self):
        for patch_value in [{'transcript':''},{'clusters':True},{'clusters':9},{'reference_date':'2026-02-30'},{'reference_date':'20260915'}]:
            request = {'operation':'analyze','transcript':'Maya will send the report.','reference_date':'2026-09-15','clusters':3,**patch_value}
            with self.assertRaises((ApiError,ValueError)):
                handle(request)
        self.assertEqual(handle({'operation':'runs'}),[])

    def test_invalid_review_rolls_back_and_unconfirmed_csv_rejected(self):
        run=self.create()
        with self.assertRaises(ApiError):
            handle({'operation':'csv','run_id':run['id']})
        decisions=[dict(p,accept=True,deadline='20260930') for p in run['proposals']]
        with self.assertRaises(ApiError):
            handle({'operation':'finalize','run_id':run['id'],'decisions':decisions})
        self.assertEqual(len(handle({'operation':'run','run_id':run['id']})['events']),1)

    def test_legacy_streamlit_history_loads_without_migration(self):
        text='Ada will send the report.'
        original = HistoryStore(os.environ['FLOW_HISTORY_PATH'])
        run_id=original.create_run(text,'2026-09-15',[asdict(p) for p in extract_action_items(text,date(2026,9,15))],{'extractor':'rules-v2','clusters':3})
        run=handle({'operation':'run','run_id':run_id})
        self.assertEqual(run['summary'],'')
        self.assertEqual(run['transcript'],text)
        self.assertEqual(handle({'operation':'runs'})[0]['id'],run_id)

    def test_retained_benchmarks_and_case_annotations(self):
        listing=handle({'operation':'benchmarks'})
        self.assertEqual(sum(r['dataset_sha256']==listing['manifest']['splits']['test']['sha256'] or r['dataset_sha256']==listing['manifest']['splits']['dev']['sha256'] for r in listing['reports']),10)
        rules=next(r for r in listing['reports'] if r['label']=='rules' and r['dataset']=='test.jsonl')
        report=handle({'operation':'benchmark','report_id':rules['id']})
        self.assertEqual(len(report['cases']),30)
        self.assertAlmostEqual(report['report']['metrics']['task_f1'],.9473684210526316)
        with self.assertRaises(ApiError):
            handle({'operation':'benchmark','report_id':'../../README.md'})
