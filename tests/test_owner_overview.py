"""Owner labels, bounded summaries, current task versions and exact drill-downs on both stores."""
from copy import deepcopy
from pathlib import Path
import tempfile
import unittest
from uuid import uuid4

from data_controls import DataError, delete_input
from history import HistoryStore
from owner_overview import search
from task_dashboard import search as tasks
from task_deadlines import update as deadline
from task_progress import update as progress
from plan_updates import create, save_review


class OwnerOverviewTests(unittest.TestCase):
    def setUp(self):
        self.folder=tempfile.TemporaryDirectory();self.history=HistoryStore(Path(self.folder.name)/'history.sqlite3')

    def tearDown(self):self.folder.cleanup()

    def create(self,items,confirm=True):
        proposals=[dict(proposal_id=f'task-{i}',task=task,owner=owner,deadline=due,evidence=[dict(start=0,end=7,text='Source.')]) for i,(task,owner,due) in enumerate(items)]
        run=self.history.create_run('Source.','2026-12-29',proposals,title='Planning')
        if confirm:self.history.finalize(run,[dict(p,accept=True) for p in proposals])
        return run

    def test_counts_exact_names_joint_labels_missing_owners_and_preview_order(self):
        run=self.create([('Late','Maya','2026-12-28'),('Now','Maya','2026-12-29'),('No date','Maya','Unknown'),('Finished','Maya','2026-12-28'),('Missing','Unknown','2026-12-27'),('Other missing','unknown','Unknown'),('Case variant','maya','2027-01-02'),('Joint label','Maya & Jon','2027-01-03'),('Only completed','Uma','2026-12-28')])
        progress(self.history,run,'task-1','in_progress',0,uuid4().hex)
        for task in ('task-3','task-8'):progress(self.history,run,task,'done',0,uuid4().hex)
        self.create([('Different meeting',' Maya ','2027-01-02')]);self.create([('Draft only','Not confirmed','2026-12-28')],False)
        before=deepcopy(self.history.get_run(run));value=search(self.history,today='2026-12-29')
        self.assertEqual(value['summary'],dict(groups=4,named_owners=3,open_tasks=8,overdue_tasks=2,unassigned_open=2))
        self.assertEqual(value['items'][0]['owner'],'Unknown')
        maya=next(x for x in value['items'] if x['owner']=='Maya')
        self.assertEqual({k:maya[k] for k in ('total','open','done','in_progress','overdue','due_today','undated')},dict(total=5,open=4,done=1,in_progress=1,overdue=1,due_today=1,undated=1))
        self.assertEqual(maya['next_task']['task'],'Late');self.assertNotIn('transcript',str(value));self.assertEqual(self.history.get_run(run),before)
        self.assertEqual(search(self.history,today='2026-12-29',view='all')['total'],5)
        uma=search(self.history,today='2026-12-29',query='Uma',view='all')['items'][0];self.assertIsNone(uma['next_task']);self.assertEqual(uma['overdue'],0)
        exact=tasks(self.history,today='2026-12-29',owner='Maya');self.assertEqual(exact['total'],4);self.assertTrue(all(x['owner'].strip()=='Maya' for x in exact['items']))
        self.assertEqual(tasks(self.history,today='2026-12-29',owner='Unknown')['total'],2)
        self.assertEqual(tasks(self.history,today='2026-12-29',owner='maya')['total'],1)

    def test_corrections_progress_and_followup_replacement_feed_the_same_groups(self):
        run=self.create([('Send report','Maya','2026-12-28'),('Check notes','Unknown','Unknown')])
        deadline(self.history,run,'task-0','2027-01-02','New date.',0,uuid4().hex)
        value=search(self.history,today='2026-12-29');self.assertEqual(value['summary']['overdue_tasks'],0)
        self.assertEqual(next(x for x in value['items'] if x['owner']=='Maya')['next_task']['deadline'],'2027-01-02')
        follow=create(self.history,run,'We discussed the roadmap.','2026-12-30',uuid4().hex);save_review(self.history,follow,[],0,confirm=True)
        value=search(self.history,today='2026-12-29');self.assertEqual(value['summary']['open_tasks'],2)
        self.assertEqual(next(x for x in value['items'] if x['owner']=='Maya')['next_task']['run_id'],follow)
        progress(self.history,follow,'task-0','done',0,uuid4().hex)
        self.assertEqual(search(self.history,today='2026-12-29')['total'],1)
        self.assertEqual(search(self.history,today='2026-12-29',view='all')['summary']['named_owners'],1)
        delete_input(self.history,run,'extraction');self.assertEqual(search(self.history,today='2026-12-29')['total'],0)

    def test_literal_unicode_search_views_and_page_bounds(self):
        self.create([(f'Task {i}',f'Owner {i:02}', '2026-12-28') for i in range(17)]+[('Unicode','Café 東京 10%_','Unknown')])
        first=search(self.history,today='2026-12-29',page_size=12);last=search(self.history,today='2026-12-29',page=999)
        self.assertEqual((first['total'],len(first['items']),last['page'],len(last['items'])),(18,12,1,6))
        self.assertEqual(len({x['owner'] for x in first['items']+last['items']}),18)
        for query in ('CAFÉ','東京','10%_'):self.assertEqual(search(self.history,today='2026-12-29',query=query)['total'],1)
        self.assertEqual(search(self.history,today='2026-12-29',query="%' OR 1=1 --")['total'],0)
        self.assertEqual(search(self.history,today='2026-12-29',view='overdue')['total'],17)
        self.assertEqual(search(self.history,today='2026-12-29',view='unassigned')['total'],0)
        self.assertEqual(tasks(self.history,today='2026-12-29',owner='Café 東京 10%_')['total'],1)

    def test_empty_completed_only_and_other_accounts(self):
        self.assertEqual(search(self.history,today='2026-12-29')['summary']['groups'],0)
        run=self.create([('Finished','Maya','2026-12-28')]);progress(self.history,run,'task-0','done',0,uuid4().hex)
        self.assertEqual(search(self.history,today='2026-12-29')['items'],[])
        self.assertEqual(search(self.history,today='2026-12-29',view='all')['items'][0]['done'],1)
        other=HistoryStore(Path(self.folder.name)/'other.sqlite3');self.assertEqual(search(other,today='2026-12-29',view='all')['total'],0)

    def test_bad_queries_and_owner_filters_fail_explicitly(self):
        for change in ({'today':'2026-02-30'},{'today':'0000-01-01'},{'today':None},{'today':'20261229'},{'query':None},{'query':'x'*201},{'view':[]},{'view':'missing'},{'page':True},{'page':-1},{'page_size':51}):
            with self.assertRaises(DataError):search(self.history,**({'today':'2026-12-29'}|change))
        for owner in (None,[],'x'*10001):
            with self.assertRaises(DataError):tasks(self.history,today='2026-12-29',owner=owner)
