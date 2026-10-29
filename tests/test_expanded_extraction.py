"""Synthetic development regressions retained from the 30 October audit."""
from dataclasses import asdict
from datetime import date
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from uuid import uuid4

from evaluate import validate_item
from extraction import extract_with_changes, normalize_task
from history import HistoryStore
from plan_updates import compare, create, save_review
from task_progress import project, update

ROOT = Path(__file__).resolve().parents[1]
REF = date(2026, 9, 15)


class ExpandedExtractionTests(unittest.TestCase):
    def test_all_predeclared_audit_cases_and_exact_support(self):
        cases = json.loads((ROOT/'tests/fixtures/extraction-expanded.json').read_text())
        self.assertEqual(len(cases), 74)
        for case in cases:
            with self.subTest(case=case['id']):
                items, _ = extract_with_changes(case['transcript'], date.fromisoformat(case['reference_date']))
                actual = [asdict(i) for i in items]
                self.assertEqual(len(actual), len(case['expected']))
                for item, expected in zip(actual, case['expected']):
                    for field, value in expected.items():
                        self.assertEqual(item[field], value)
                    validate_item(item, case['transcript'])
                if case['evidence_counts'] is not None:
                    self.assertEqual([len(i['evidence']) for i in actual], case['evidence_counts'])

    def test_merged_reference_preserves_complete_cancellation_evidence(self):
        text = ('Maya: I will send the report by Friday.\n'
                'Maya: I will send the report by Monday.\n'
                'Maya: Make that Friday instead.\n'
                'Maya: Cancel that task.')
        items, changes = extract_with_changes(text, REF)
        self.assertEqual(items, [])
        self.assertEqual([c['kind'] for c in changes], ['deadline_revision', 'cancellation'])
        self.assertEqual(len(changes[-1]['evidence']), 4)
        for c in changes:
            for e in c['evidence']:
                self.assertEqual(text[e['start']:e['end']], e['text'])

    def test_distinct_unicode_objects_marks_and_symbols_keep_distinct_ids(self):
        for left, right in [('東京','大阪'), ('α','β'), ('क','की'), ('📊','🚀')]:
            with self.subTest(objects=(left, right)):
                text = f'Maya will review {left} by Friday.\nMaya will review {right} by Friday.'
                items, _ = extract_with_changes(text, REF)
                self.assertEqual([i.task for i in items], ['review '+left, 'review '+right])
                self.assertEqual(len({i.proposal_id for i in items}), 2)
                for i in items:
                    validate_item(asdict(i), text)

    def test_unicode_canonical_equivalents_merge_without_rewriting_evidence(self):
        text = 'Maya will review café by Friday.\nMaya will review cafe\u0301 by Friday.'
        items, _ = extract_with_changes(text, REF)
        self.assertEqual(len(items), 1)
        self.assertEqual(len(items[0].evidence), 2)
        validate_item(asdict(items[0]), text)

    def test_ordinary_ascii_word_and_filename_keys_remain_compatible(self):
        for task, key in [('Send the report', 'send report'),
                          ('Review release-notes.md', 'review release notes md'),
                          ('Review report_2', 'review report 2')]:
            with self.subTest(task=task):
                self.assertEqual(normalize_task(task), key)

    def test_speaker_case_matching_preserves_cross_owner_and_context_guards(self):
        for directive in ('Maya: Make that Monday instead.', 'Maya: Move my report to Monday instead.'):
            items, _ = extract_with_changes('MAYA: I will send the report by Friday.\n'+directive, REF)
            self.assertEqual(items[0].deadline, '2026-09-21')
            self.assertEqual(items[0].owner, 'MAYA')
        for directive in ('Jon: Make that Monday instead.', 'Maya: Make that Monday instead.'):
            text = 'MAYA: I will send the report by Friday.\n'
            if directive.startswith('Maya:'):
                text += 'The meeting has ended.\n'
            items, changes = extract_with_changes(text+directive, REF)
            self.assertEqual(items[0].deadline, '2026-09-18')
            self.assertEqual(changes[-1]['kind'], 'unresolved_reference')

    def test_alternative_dates_stay_unknown_and_keep_the_choice_for_review(self):
        for phrase in ('by Friday or Monday', 'tomorrow or Friday',
                       'by 2026-11-02 or 2026-11-03', 'by May 5 or May 6'):
            with self.subTest(phrase=phrase):
                text = 'Maya will send the report '+phrase+'.'
                items, _ = extract_with_changes(text, REF)
                self.assertEqual(items[0].deadline, 'Unknown')
                self.assertIn(' or ', items[0].task)
                validate_item(asdict(items[0]), text)
        items, _ = extract_with_changes('Maya will review the report or invoice by Friday.', REF)
        self.assertEqual(items[0].deadline, '2026-09-18')

    def test_ambiguous_revision_clears_obsolete_date_with_both_passages(self):
        text = ('Maya: I will send the report by Friday.\n'
                'Maya: Move my report to Monday or next Tuesday instead.')
        items, changes = extract_with_changes(text, REF)
        self.assertEqual(items[0].deadline, 'Unknown')
        self.assertEqual(changes[0]['before'], '2026-09-18')
        self.assertEqual(changes[0]['after'], 'Unknown')
        self.assertEqual(len(items[0].evidence), 2)
        validate_item(asdict(items[0]), text)

    def test_conditional_work_is_excluded_but_technical_and_quoted_objects_remain(self):
        for ending in ('if the budget is approved', 'unless the client cancels', 'if needed'):
            with self.subTest(condition=ending):
                text = f'Maya will send the report tomorrow {ending}.'
                self.assertEqual(extract_with_changes(text, REF)[0], [])
        for text in ('Task: If approved, Maya will send the report tomorrow.',
                     'Todo: Unless the client cancels, Maya will send the report tomorrow.'):
            self.assertEqual(extract_with_changes(text, REF)[0], [])
        for task in ('review the if statement', 'review the new if expression',
                     'investigate if the worker is ready', "document the phrase 'if the budget is approved'"):
            with self.subTest(task=task):
                items, _ = extract_with_changes(f'Maya will {task} tomorrow.', REF)
                self.assertEqual(items[0].task, task)
                self.assertEqual(items[0].deadline, '2026-09-16')
        items, _ = extract_with_changes('Task: review the if statement tomorrow.', REF)
        self.assertEqual(items[0].task, 'review the if statement')

    def test_followup_uncertainty_clears_dates_and_requires_explicit_approval(self):
        base = [asdict(i) for i in extract_with_changes('Maya will send the report by Friday.', REF)[0]]
        for text in ('Maya will send the report by Friday or Monday.',
                     'Maya: Move my report to Monday or next Tuesday instead.'):
            rows, warnings = compare(base, text, REF, 0)
            self.assertEqual(len(rows), 1)
            self.assertEqual(rows[0]['kind'], 'changed')
            self.assertEqual(rows[0]['after']['deadline'], 'Unknown')
            self.assertEqual(warnings, [])
        for text in ('Maya will send the report tomorrow if the budget is approved.',
                     'Maya: Move my report to Monday if approved.'):
            rows, _ = compare(base, text, REF, 0)
            self.assertEqual(rows[0]['kind'], 'unchanged')

    def test_legacy_unicode_task_id_history_and_progress_survive_followup(self):
        text = 'MAYA will review 東京 by Friday.'
        legacy = asdict(extract_with_changes(text, REF)[0][0])
        legacy['proposal_id'] = hashlib.sha256(b'review|MAYA|2026-09-18').hexdigest()[:16]
        with tempfile.TemporaryDirectory() as folder:
            store = HistoryStore(Path(folder)/'history.sqlite3')
            root = store.create_run(text, REF.isoformat(), [legacy])
            store.finalize(root, [dict(legacy, accept=True)])
            update(store, root, legacy['proposal_id'], 'in_progress', 0, uuid4().hex)
            original = store.get_run(root)
            child = create(store, root, 'Maya: Move my 東京 deadline to Monday instead.', '2026-09-16', uuid4().hex)
            rows = store.get_run(child)[0]['payload']['settings']['plan_update']['rows']
            self.assertEqual(rows[0]['after']['proposal_id'], legacy['proposal_id'])
            self.assertEqual(rows[0]['after']['deadline'], '2026-09-21')
            save_review(store, child, [dict(change_id=rows[0]['change_id'], apply=True, **{k:rows[0]['after'][k] for k in ('task','owner','deadline')})], 0, confirm=True)
            events = store.get_run(child)
            self.assertEqual(project(events)[legacy['proposal_id']]['status'], 'in_progress')
            self.assertEqual(store.get_run(root)[:-1], original)
