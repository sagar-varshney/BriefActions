"""Deadline corrections must retain exact evidence and resolve ownership safely."""
from dataclasses import asdict
from datetime import date
from pathlib import Path
import unittest

from evaluate import load_dataset, validate_item
from extraction import UNKNOWN, extract_with_changes


REF = date(2026, 9, 15)
ROOT = Path(__file__).resolve().parents[1]


class DeadlineRevisionTests(unittest.TestCase):
    def test_existing_development_case_replaces_date_and_preserves_support(self):
        row = next(row for row in load_dataset(ROOT / 'evaluation/dev.jsonl') if row['id'] == 'dev-26')
        items, changes = extract_with_changes(row['transcript'], REF)
        self.assertEqual(len(items), 1)
        actual = asdict(items[0])
        for field in ('task', 'owner', 'deadline', 'evidence'):
            self.assertEqual(actual[field], row['items'][0][field])
        self.assertEqual([(c['kind'], c['before'], c['after']) for c in changes],
                         [('deadline_revision', '2026-09-18', '2026-09-21')])
        self.assertEqual(changes[0]['evidence'], actual['evidence'])
        validate_item(actual, row['transcript'])

    def test_instead_supports_named_pronoun_and_successive_unicode_revisions(self):
        text = ('Maya: I will send the report 📊 by Friday.\n'
                'Maya: Actually, make that Monday instead!\n'
                'Maya: Reschedule my report to next Tuesday instead.')
        items, changes = extract_with_changes(text, REF)
        self.assertEqual(items[0].deadline, '2026-09-22')
        self.assertEqual([(c['before'], c['after']) for c in changes],
                         [('2026-09-18', '2026-09-21'), ('2026-09-21', '2026-09-22')])
        self.assertEqual(len(items[0].evidence), 3)
        validate_item(asdict(items[0]), text)

    def test_my_reference_uses_speaker_to_distinguish_identical_tasks(self):
        text = ('Bela will submit the risk assessment by Friday.\n'
                'Maya will submit the risk assessment by Friday.\n'
                'Bela: Move my risk assessment deadline to Monday instead.')
        items, changes = extract_with_changes(text, REF)
        self.assertEqual({i.owner: i.deadline for i in items},
                         {'Bela': '2026-09-21', 'Maya': '2026-09-18'})
        self.assertEqual(len(changes), 1)

    def test_unknown_wrong_speaker_and_ambiguous_references_leave_dates_unchanged(self):
        cases = [
            ('Bela will submit the risk assessment by Friday.',
             'Move my risk assessment deadline to Monday instead.'),
            ('Bela will submit the risk assessment by Friday.',
             'Maya: Move my risk assessment deadline to Monday instead.'),
            ('Bela will review report 1 by Friday.\nBela will review report 2 by Friday.',
             'Bela: Move my report deadline to Monday instead.'),
        ]
        for original, directive in cases:
            with self.subTest(directive=directive, original=original):
                items, changes = extract_with_changes(original + '\n' + directive, REF)
                self.assertTrue(all(i.deadline == '2026-09-18' for i in items))
                self.assertEqual([c['kind'] for c in changes], ['unresolved_reference'])

    def test_vague_or_invalid_replacement_clears_obsolete_exact_date(self):
        for replacement in ('next week', '2026-02-30'):
            with self.subTest(replacement=replacement):
                text = ('Bela will submit the risk assessment by Friday.\n'
                        f'Bela: Move my risk assessment deadline to {replacement} instead.')
                items, changes = extract_with_changes(text, REF)
                self.assertEqual(items[0].deadline, UNKNOWN)
                self.assertEqual(changes[0]['after'], UNKNOWN)
                self.assertEqual(len(items[0].evidence), 2)

    def test_negated_hypothetical_and_unsupported_replacements_are_not_applied(self):
        for directive in ("Don't move my risk assessment deadline to Monday instead.",
                          'If approved, move my risk assessment deadline to Monday instead.',
                          'Move my risk assessment deadline to Monday instead of Friday.'):
            with self.subTest(directive=directive):
                items, changes = extract_with_changes(
                    'Bela will submit the risk assessment by Friday.\nBela: ' + directive, REF)
                self.assertEqual(items[0].deadline, '2026-09-18')
                self.assertFalse(any(c['kind'] == 'deadline_revision' for c in changes))
