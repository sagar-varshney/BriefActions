import csv
import io
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from csv_export import spreadsheet_cell
from history import HistoryStore
from web_bridge import handle


class CsvSecurityTests(unittest.TestCase):
    def test_formula_prefixes_and_leading_controls(self):
        for value in ['=1+1', '+SUM(A1)', '-1+2', '@SUM(A1)', '\ttext', '\rtext', '\ntext',
                      '  =1+1', '\x0b=1+1', '\ufeff=1+1', '＝1+1', '＋1', '－1', '＠SUM(A1)']:
            with self.subTest(value=value):
                self.assertEqual(spreadsheet_cell(value), "'" + value)
        for value in ['Send notes', 'Maya', '2026-10-29', 'Unknown', 'hello, "=1+1"', 'line one\n=1+1', '', None]:
            self.assertEqual(spreadsheet_cell(value), value)

    def test_export_escapes_every_text_column_without_rewriting_history(self):
        with tempfile.TemporaryDirectory() as folder, patch.dict(os.environ, {'FLOW_HISTORY_PATH':str(Path(folder)/'history.sqlite3')}):
            source='=HYPERLINK("https://invalid.example","notes"),\nMaya will send notes.'
            history=HistoryStore(os.environ['FLOW_HISTORY_PATH'])
            item={'proposal_id':'fixture', 'task':'+SUM(A1)', 'owner':'@someone', 'deadline':'Unknown',
                  'evidence':[{'text':source,'start':0,'end':len(source)}]}
            run_id=history.create_run(source,'2026-10-29',[item])
            history.finalize(run_id,[{**item,'accept':True}])
            before=history.get_run(run_id)
            exported=handle({'operation':'csv','run_id':run_id})
            rows=list(csv.DictReader(io.StringIO(exported)))
            self.assertEqual(len(rows),1)
            self.assertEqual(rows[0]['task'],"'+SUM(A1)")
            self.assertEqual(rows[0]['owner'],"'@someone")
            self.assertEqual(rows[0]['supporting_transcript_passages'],"'"+source)
            self.assertEqual(rows[0]['deadline'],'Unknown')
            self.assertEqual(history.get_run(run_id),before)
            self.assertIn('"task"',exported)
            # The later deadline-correction reason is untrusted text as well.
            with patch('web_bridge.run_snapshot',return_value={'final_tasks':[item],'current_tasks':[{**item,'deadline_correction':{'confirmed_deadline':'Unknown','reason':'=1+1'}}]}):
                row=next(csv.DictReader(io.StringIO(handle({'operation':'csv','run_id':run_id}))))
                self.assertEqual(row['deadline_correction_reason'],"'=1+1")
