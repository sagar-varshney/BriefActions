"""Development-only extraction audit and end-to-end boundary/review guards."""
from dataclasses import asdict
from datetime import date
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from uuid import uuid4

from evaluate import load_dataset, validate_item
from extraction import extract_action_items, parse_deadline, passages
from history import HistoryStore
from plan_updates import create, compare
from web_bridge import handle

ROOT=Path(__file__).resolve().parents[1]
AUDIT=ROOT/'evaluation'/'audit-v1'

class ExtractionAuditTests(unittest.TestCase):
    def test_frozen_development_annotations_and_exact_outputs(self):
        path=AUDIT/'dev.jsonl';manifest=json.loads((AUDIT/'manifest.json').read_text())
        self.assertEqual(hashlib.sha256(path.read_bytes()).hexdigest(),manifest['splits']['dev']['sha256'])
        rows=load_dataset(path);self.assertEqual(len(rows),28)
        for row in rows:
            with self.subTest(case=row['id']):
                self.assertEqual(row['split'],'dev')
                items=[asdict(item) for item in extract_action_items(row['transcript'],date.fromisoformat(row['reference_date']))]
                self.assertEqual([{k:p[k] for k in ('task','owner','deadline','evidence')} for p in items],[{k:p[k] for k in ('task','owner','deadline','evidence')} for p in row['items']])
                for item in items:validate_item(item,row['transcript'])

    def test_lower_case_pronouns_and_negative_scope(self):
        for contraction in ("i'll",'i’ll'):
            item=extract_action_items(f'Ada: {contraction} send the report tomorrow.',date(2026,10,20))[0]
            self.assertEqual((item.owner,item.deadline),('Ada','2026-10-21'))
        self.assertEqual(extract_action_items('Maya: I won’t send the report.\nWe will not deploy the patch.\nPlease do not send the invoice.',date(2026,10,20)),[])
        self.assertEqual(extract_action_items('we’ll review the already approved report tomorrow.',date(2026,10,20))[0].owner,'Unknown')
        for text in ('Task: already reviewed the budget.', 'Todo: Maya will not send the report.', 'Action item: We already reviewed the notes.', 'Task: If approved, Maya will send the report.', 'Task: Maya and Jon already reviewed the notes.'):
            with self.subTest(text=text):self.assertEqual(extract_action_items(text,date(2026,10,20)),[])
        self.assertEqual(extract_action_items('Task: review the already approved budget tomorrow.',date(2026,10,20))[0].task,'review the already approved budget')
        self.assertEqual(extract_action_items('Task: REVIEW THE already approved budget tomorrow.',date(2026,10,20))[0].task,'REVIEW THE already approved budget')

    def test_internal_punctuation_and_separate_sentences_keep_exact_spans(self):
        text='  • Ada: I’ll check https://example.org/v2.1?mode=qa tomorrow. I will send the notes.\r\n'
        items=extract_action_items(text,date(2026,10,20));self.assertEqual(len(items),2)
        self.assertEqual(items[0].task,'check https://example.org/v2.1?mode=qa')
        self.assertEqual(items[0].deadline,'2026-10-21');self.assertEqual(items[1].deadline,'Unknown')
        for item in items:validate_item(asdict(item),text)
        self.assertEqual(len(list(passages(text))),2)

    def test_extreme_dates_do_not_abort_other_tasks_or_optional_scheduling(self):
        self.assertIsNone(parse_deadline('in '+'9'*5000+' days',date(2026,10,20)))
        self.assertIsNone(parse_deadline('by next Friday',date.max))
        text='\n'.join(f'Maya will review report {n} tomorrow.' for n in range(5))
        with tempfile.TemporaryDirectory() as folder,patch.dict('os.environ',{'FLOW_HISTORY_PATH':str(Path(folder)/'history.db')}):
            run=handle(dict(operation='analyze',transcript=text,reference_date='9999-12-31',clusters=1))
            self.assertEqual(len(run['proposals']),5)
            self.assertTrue(all(p['deadline']=='Unknown' for p in run['proposals']))
            self.assertTrue(any(p['suggested_slot']=='Unknown' for p in run['proposals']))

    def test_followup_uses_audited_rules_and_records_dependency_fingerprints(self):
        with tempfile.TemporaryDirectory() as folder:
            history=HistoryStore(Path(folder)/'history.db')
            items=[asdict(p) for p in extract_action_items('Maya will review release-notes.md tomorrow.',date(2026,10,20))]
            base=history.create_run('Maya will review release-notes.md tomorrow.','2026-10-20',items)
            history.finalize(base,[dict(p,accept=True) for p in items])
            run=create(history,base,'Maya: I’ll review release-notes.md by Friday.','2026-10-21',uuid4().hex)
            settings=history.get_run(run)[0]['payload']['settings']
            row=settings['plan_update']['rows'][0]
            self.assertEqual((row['kind'],row['after']['deadline']),('changed','2026-10-23'))
            expected={name:hashlib.sha256((ROOT/name).read_bytes()).hexdigest() for name in ('plan_updates.py','extraction.py')}
            self.assertEqual(settings['extractor_components'],expected)
            self.assertEqual(settings['extractor_sha256'],hashlib.sha256(json.dumps(expected,sort_keys=True).encode()).hexdigest())
            rows,_=compare(items,"Ada: I’ll investigate why the worker won’t start tomorrow.",date(2026,10,21),0)
            self.assertEqual(rows[-1]['kind'],'added')
