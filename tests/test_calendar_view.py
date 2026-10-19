from copy import deepcopy
from pathlib import Path
import tempfile
import unittest

from calendar_view import search
from data_controls import DataError, delete_input
from history import HistoryStore
from meeting_history import rename
from task_progress import update


class CalendarTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.history = HistoryStore(Path(self.folder.name)/'history.sqlite3')

    def tearDown(self):
        self.folder.cleanup()

    def create(self, meeting_date, tasks, title='Planning', confirmed=True):
        proposals = [dict(proposal_id=f'task-{i}',task=name,owner='Unknown',deadline=deadline,evidence=[])
                     for i,(name,deadline) in enumerate(tasks)]
        run = self.history.create_run('Private transcript never returned by the calendar.',meeting_date,proposals,title=title)
        if confirmed:
            self.history.finalize(run,[dict(p,accept=True) for p in proposals])
        return run

    def test_meetings_use_original_dates_tasks_use_confirmed_deadlines_and_reads_do_not_mutate(self):
        run = self.create('2026-12-29',[('Next year','2027-01-02'),('No date','Unknown'),('Finished','2027-01-02')])
        review = self.create('2027-01-02',[('Unconfirmed','2027-01-02')],confirmed=False)
        update(self.history,run,'task-2','done',0,'a'*32)
        rename(self.history,run,'Renamed 📋',0)
        before = deepcopy(self.history.get_run(run))
        result = search(self.history,month='2027-01',day='2027-01-02')
        self.assertEqual(result['days'][0]['meetings'],1)
        self.assertEqual(result['days'][0]['tasks'],1)
        self.assertEqual(result['scheduled']['total'],2)
        self.assertEqual({i['run_id'] for i in result['scheduled']['items']},{run,review})
        task = next(i for i in result['scheduled']['items'] if i['kind']=='task')
        self.assertEqual((task['title'],task['event_date'],task['reference_date']),('Renamed 📋','2027-01-02','2026-12-29'))
        self.assertEqual(result['unscheduled']['total'],1)
        self.assertNotIn('Private transcript',str(result))
        self.assertNotIn('evidence',str(result))
        self.assertEqual(search(self.history,month='2026-12',day='2026-12-29')['scheduled']['total'],1)
        self.assertEqual(search(self.history,month='2027-01',day='2027-01-02',status='')['scheduled']['total'],3)
        self.assertEqual(search(self.history,month='2027-01',kind='meetings',status='done')['unscheduled']['total'],0)
        self.assertEqual(search(self.history,month='2027-01',day='2027-01-02',kind='tasks',status='done')['scheduled']['items'][0]['label'],'Finished')
        self.assertEqual(self.history.get_run(run),before)

    def test_busy_days_and_global_unscheduled_work_have_complete_counts_and_bounded_pages(self):
        self.create('2024-02-28',[(f'Due {i}','2024-02-29') for i in range(53)]+[(f'Undated {i}','Unknown') for i in range(55)])
        first = search(self.history,month='2024-02',day='2024-02-29',page_size=50)
        last = search(self.history,month='2024-02',day='2024-02-29',page=999,unscheduled_page=999,page_size=50)
        self.assertEqual(first['days'][-1]['tasks'],53)
        for key,total,last_size in [('scheduled',53,3),('unscheduled',55,5)]:
            self.assertEqual(first[key]['total'],total)
            self.assertEqual(len(first[key]['items']),50)
            self.assertEqual(last[key]['page'],1)
            self.assertEqual(len(last[key]['items']),last_size)
            self.assertEqual(len({i['label'] for i in first[key]['items']+last[key]['items']}),total)
        self.assertEqual(search(self.history,month='2030-01')['unscheduled']['total'],55)

    def test_confirmed_corrections_isolation_deletion_and_month_edges(self):
        run = self.create('2026-10-20',[('Old name','Unknown')],confirmed=False)
        self.history.finalize(run,[dict(proposal_id='task-0',task='Corrected task',owner='Uma',deadline='2026-10-31',accept=True)])
        result = search(self.history,month='2026-10',day='2026-10-31',kind='tasks')
        self.assertEqual(result['scheduled']['items'][0]['label'],'Corrected task')
        self.assertEqual(result['scheduled']['items'][0]['owner'],'Uma')
        other = HistoryStore(Path(self.folder.name)/'other.sqlite3')
        self.assertEqual(search(other,month='2026-10')['days'],[])
        delete_input(self.history,run,'extraction')
        self.assertEqual(search(self.history,month='2026-10')['days'],[])
        for month in ('0001-01','9999-12','2024-02'):
            self.assertEqual(search(self.history,month=month)['scheduled']['total'],0)

    def test_invalid_parameters_do_not_broaden_queries(self):
        for kwargs in ({'month':None},{'month':'0000-01'},{'month':'2026-13'},{'month':'202610'},
                       {'day':'2026-10-32'},{'day':'2026-11-01'},{'day':'20261020'},
                       {'kind':[]},{'status':{}},{'kind':'all OR 1=1'},{'status':'confirmed'},
                       {'page':True},{'page':-1},{'unscheduled_page':100001},{'page_size':51}):
            with self.assertRaises(DataError):
                search(self.history,**({'month':'2026-10'}|kwargs))
