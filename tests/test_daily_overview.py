from copy import deepcopy
from pathlib import Path
import tempfile
import unittest

from daily_overview import overview
from data_controls import DataError,delete_input
from history import HistoryStore
from meeting_history import rename
from task_progress import update


class DailyOverviewTests(unittest.TestCase):
    def setUp(self):
        self.folder=tempfile.TemporaryDirectory()
        self.history=HistoryStore(Path(self.folder.name)/'history.sqlite3')

    def tearDown(self):
        self.folder.cleanup()

    def create(self,tasks,confirmed=True,title='Planning',settings=None):
        proposals=[dict(proposal_id=f'task-{i}',task=name,owner=owner,deadline=deadline,evidence=[]) for i,(name,owner,deadline) in enumerate(tasks)]
        rid=self.history.create_run('Private transcript, not part of the overview.','2026-12-29',proposals,title=title,settings=settings)
        if confirmed:self.history.finalize(rid,[dict(p,accept=True) for p in proposals])
        return rid

    def test_priorities_all_owners_unknowns_progress_renames_and_read_only_results(self):
        run=self.create([('Late','Maya','2026-12-28'),('Today','Ada','2026-12-29'),('New year','Unknown','2027-01-02'),('Week edge','Jon','2027-01-05'),('Later','Ada','2027-01-06'),('No date','Unknown','Unknown'),('Finished','Maya','2026-12-28')])
        update(self.history,run,'task-6','done',0,'a'*32);update(self.history,run,'task-1','in_progress',0,'b'*32);rename(self.history,run,'Renamed 📋',0)
        self.create([('Only proposed','Sam','2026-12-29')],False,'Awaiting review')
        before=deepcopy(self.history.get_run(run));result=overview(self.history,today='2026-12-29')
        self.assertEqual({key:data['total'] for key,data in result['sections'].items()},{'overdue':1,'today':1,'upcoming':2,'reviews':1})
        self.assertEqual(result['meta'],{'open_tasks':6,'undated':1,'saved_meetings':2})
        self.assertEqual(result['upcoming_through'],'2027-01-05')
        self.assertEqual(result['sections']['today']['items'][0]['status'],'in_progress')
        self.assertEqual(result['sections']['today']['items'][0]['title'],'Renamed 📋')
        self.assertEqual(result['sections']['upcoming']['items'][0]['owner'],'Unknown')
        self.assertNotIn('Private transcript',str(result));self.assertNotIn('evidence',str(result))
        self.assertEqual(self.history.get_run(run),before)

    def test_complete_counts_with_bounded_previews_and_saved_review_types(self):
        run=self.create([(f'Overdue {i}','Ada','2026-12-28') for i in range(30)])
        for i in range(6):self.create([],False,f'Review {i}',{'plan_update':{}} if i==5 else {})
        result=overview(self.history,today='2026-12-29')
        self.assertEqual(result['sections']['overdue']['total'],30);self.assertEqual(len(result['sections']['overdue']['items']),4)
        self.assertEqual(result['sections']['reviews']['total'],6);self.assertEqual(len(result['sections']['reviews']['items']),4)
        self.assertEqual(result['sections']['reviews']['items'][0]['title'],'Review 5')
        self.assertEqual(result['sections']['reviews']['items'][0]['review_kind'],'followup')
        self.assertEqual(len(overview(self.history,today='2026-12-29',limit=12)['sections']['overdue']['items']),12)
        delete_input(self.history,run,'extraction');self.assertEqual(overview(self.history,today='2026-12-29')['meta']['open_tasks'],0)

    def test_empty_workspace_completed_only_and_account_isolation(self):
        empty=overview(self.history,today='2026-12-29');self.assertEqual(empty['meta']['saved_meetings'],0)
        run=self.create([('Complete','Maya','2026-12-29')]);update(self.history,run,'task-0','done',0,'c'*32)
        result=overview(self.history,today='2026-12-29');self.assertEqual(result['meta']['saved_meetings'],1);self.assertEqual(result['meta']['open_tasks'],0)
        self.assertTrue(all(not group['total'] for group in result['sections'].values()))
        other=HistoryStore(Path(self.folder.name)/'other.sqlite3');self.assertEqual(overview(other,today='2026-12-29'),empty)

    def test_invalid_queries_and_date_boundaries_are_explicit(self):
        for kwargs in ({'today':None},{'today':'2026-02-29'},{'today':'20261229'},{'today':'9999-12-31'},{'limit':True},{'limit':0},{'limit':13},{'limit':'4'}):
            with self.assertRaises(DataError):overview(self.history,**({'today':'2026-12-29'}|kwargs))
        self.assertEqual(overview(self.history,today='2024-02-28')['upcoming_through'],'2024-03-06')
