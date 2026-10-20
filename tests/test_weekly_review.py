from copy import deepcopy
from pathlib import Path
import json
import tempfile
import unittest
from unittest.mock import patch
from datetime import datetime
from uuid import uuid4

from data_controls import DataError,delete_input
from history import HistoryStore
from plan_updates import create,save_review
from task_deadlines import update as deadline
from task_progress import update as progress
from weekly_review import overview


class WeeklyReviewTests(unittest.TestCase):
    def setUp(self):
        self.folder=tempfile.TemporaryDirectory();self.history=HistoryStore(Path(self.folder.name)/'history.sqlite3')

    def tearDown(self):self.folder.cleanup()

    def create(self,items,confirm=True):
        proposals=[dict(proposal_id=f'task-{i}',task=task,owner=owner,deadline=due,evidence=[dict(start=0,end=7,text='Source.')]) for i,(task,owner,due) in enumerate(items)]
        run=self.history.create_run('Source.','2026-10-20',proposals,title='Weekly planning')
        if confirm:self.history.finalize(run,[dict(p,accept=True) for p in proposals])
        return run

    def mark(self,run,task,status,version,stamp):
        with patch('history.datetime') as clock:
            clock.now.return_value=datetime.fromisoformat(stamp)
            progress(self.history,run,task,status,version,uuid4().hex)

    def test_timezone_boundary_current_counts_corrections_and_read_only_snapshot(self):
        run=self.create([('At start','Maya','Unknown'),('Before start','Jon','2026-10-19'),('At end','Lee','Unknown'),('Overdue','Maya','2026-10-19'),('Today','Unknown','2026-10-20'),('Next week','Ada','2026-10-27'),('Later','Maya','2026-10-28'),('No deadline','Unknown','Unknown')])
        # Asia/Kolkata: October 14 00:00 through October 21 00:00.
        for task,stamp in [('task-0','2026-10-13T18:30:00+00:00'),('task-1','2026-10-13T18:29:59+00:00'),('task-2','2026-10-20T18:30:00+00:00')]:self.mark(run,task,'done',0,stamp)
        self.create([('Only proposed','Maya','2026-10-19')],False)
        before=deepcopy(self.history.get_run(run));value=overview(self.history,today='2026-10-20',time_zone='Asia/Kolkata')
        self.assertEqual(value['counts'],dict(completed=1,overdue=1,upcoming=2,reviews=1,undated=1))
        self.assertEqual(value['items'][0]['task'],'At start');self.assertEqual(value['period_start'],'2026-10-14')
        self.assertEqual(self.history.get_run(run),before);self.assertNotIn('Source.',str(value));self.assertNotIn('evidence',str(value))
        self.assertEqual(json.loads(json.dumps(value)),value);self.assertTrue(all(type(n) is int for n in value['counts'].values()))
        deadline(self.history,run,'task-3','2026-10-25','New date.',0,uuid4().hex)
        value=overview(self.history,today='2026-10-20',time_zone='Asia/Kolkata',view='upcoming')
        self.assertEqual(value['counts']['overdue'],0);self.assertEqual(value['total'],3)
        self.assertEqual(next(t for t in value['items'] if t['task']=='Overdue')['deadline'],'2026-10-25')

    def test_daylight_saving_boundary_and_reopened_tasks(self):
        run=self.create([('Start','Maya','Unknown'),('Before','Maya','Unknown'),('Reopened','Maya','Unknown')])
        # The seven local dates span the November 1 fall-back in New York.
        self.mark(run,'task-0','done',0,'2026-10-28T04:00:00+00:00')
        self.mark(run,'task-1','done',0,'2026-10-28T03:59:59+00:00')
        self.mark(run,'task-2','done',0,'2026-11-01T06:30:00+00:00')
        self.mark(run,'task-2','todo',1,'2026-11-02T15:00:00+00:00')
        value=overview(self.history,today='2026-11-03',time_zone='America/New_York')
        self.assertEqual(value['counts']['completed'],1);self.assertEqual(value['items'][0]['task'],'Start')
        self.mark(run,'task-2','done',2,'2026-11-03T15:00:00+00:00')
        self.assertEqual(overview(self.history,today='2026-11-03',time_zone='America/New_York')['counts']['completed'],2)

    def test_carried_completions_use_original_date_and_current_plan_only(self):
        run=self.create([('Old completion','Maya','Unknown'),('Recent completion','Jon','Unknown')])
        self.mark(run,'task-0','done',0,'2026-10-01T12:00:00+00:00')
        self.mark(run,'task-1','done',0,'2026-10-19T12:00:00+00:00')
        active=run
        for i in range(3):
            active=create(self.history,active,'No new commitments.','2026-10-20',uuid4().hex);save_review(self.history,active,[],0,confirm=True)
        value=overview(self.history,today='2026-10-20')
        self.assertEqual(value['counts']['completed'],1);self.assertEqual(value['items'][0]['run_id'],active)
        self.assertEqual(value['items'][0]['completed_at'],'2026-10-19T12:00:00+00:00')
        delete_input(self.history,run,'extraction');self.assertEqual(overview(self.history,today='2026-10-20')['total'],0)

    def test_pagination_complete_counts_empty_and_other_accounts(self):
        empty=overview(self.history,today='2026-10-20');self.assertEqual(empty['items'],[])
        run=self.create([(f'Late {i}','Maya','2026-10-19') for i in range(21)])
        first=overview(self.history,today='2026-10-20',view='overdue');last=overview(self.history,today='2026-10-20',view='overdue',page=999)
        self.assertEqual((first['total'],len(first['items']),last['page'],len(last['items'])),(21,8,2,5))
        self.assertEqual(last['counts']['overdue'],21)
        other=HistoryStore(Path(self.folder.name)/'other.sqlite3');self.assertEqual(overview(other,today='2026-10-20'),empty)
        draft=create(self.history,run,'No new commitments.','2026-10-20',uuid4().hex)
        value=overview(self.history,today='2026-10-20',view='reviews');self.assertEqual(value['items'][0]['review_kind'],'followup')
        self.assertEqual(value['items'][0]['run_id'],draft)

    def test_invalid_dates_zones_and_filters_fail_explicitly(self):
        for change in (dict(today=None),dict(today='0001-01-01'),dict(today='9999-12-31'),dict(today='2026-02-30'),dict(time_zone='../../etc/passwd'),dict(time_zone=[]),dict(time_zone='Not/AZone'),dict(view='bad'),dict(view=[]),dict(page=True),dict(page=-1),dict(page_size=51)):
            with self.assertRaises(DataError):overview(self.history,**(dict(today='2026-10-20')|change))
