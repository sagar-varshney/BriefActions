from contextlib import contextmanager
from datetime import date
from dataclasses import asdict
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from extraction import extract_action_items
from history import HistoryStore
from performance_metrics import collect, timed
from web_bridge import run_snapshot


class PerformanceTests(unittest.TestCase):
    def test_snapshot_uses_one_storage_scope_with_membership_and_replacement(self):
        with tempfile.TemporaryDirectory() as folder:
            history = HistoryStore(Path(folder)/'history.sqlite3')
            text = 'Maya will send the report tomorrow.'
            proposals = [asdict(p) for p in extract_action_items(text, date(2026,10,22))]
            old = history.create_run(text, '2026-10-22', proposals, {})
            replacement = history.create_run(text, '2026-10-22', proposals, {})
            history.finalize(replacement, [dict(p, accept=True) for p in proposals])
            with history.connection() as conn:
                history._append(conn,old,'plan_superseded',{'run_id':replacement})
            contexts = []
            connection = history.connection

            @contextmanager
            def counted(*args, **kwargs):
                contexts.append(True)
                with connection(*args, **kwargs) as conn:
                    yield conn

            with patch('web_bridge.store',return_value=history), patch.object(history,'connection',counted):
                snapshot = run_snapshot(old)
            self.assertEqual(len(contexts),1)
            self.assertEqual(snapshot['superseded_by'],replacement)
            self.assertTrue(snapshot['superseded_available'])
            self.assertEqual(snapshot['series_membership']['root_id'],old)
            self.assertEqual(snapshot['transcript'],text)

    def test_metrics_are_request_local_even_on_failure_and_nested_scopes_do_not_double_count(self):
        with collect() as first:
            with timed('storage_scope'):
                with timed('storage_scope'):
                    pass
            with self.assertRaises(ValueError):
                with timed('analysis_compute'):
                    raise ValueError('private')
        self.assertEqual(set(first),{'storage_scope','analysis_compute'})
        self.assertTrue(all(isinstance(value,float) and value>=0 for value in first.values()))
        with collect() as second:
            pass
        self.assertEqual(second,{})
        with timed('storage_scope'):
            pass
        self.assertEqual(second,{})
