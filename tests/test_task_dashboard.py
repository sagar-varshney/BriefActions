import copy
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from history import HistoryStore
from task_dashboard import search
from task_progress import update
from meeting_history import rename
from data_controls import DataError, delete_input
from web_bridge import handle


class TaskDashboardTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.history=HistoryStore(Path(self.tmp.name)/'history.sqlite3')
        self.env=patch.dict(os.environ,{'FLOW_HISTORY_PATH':str(self.history.path)})
        self.env.start()

    def tearDown(self):
        self.env.stop();self.tmp.cleanup()

    def create(self, name, tasks, confirm=True):
        proposals=[dict(proposal_id=f'task-{i}',task=task,owner=owner,deadline=deadline,evidence=[])
                   for i,(task,owner,deadline) in enumerate(tasks)]
        rid=self.history.create_run('Private original transcript not returned in task search.','2026-12-29',proposals,title=name)
        if confirm:self.history.finalize(rid,[dict(p,accept=True) for p in proposals])
        return rid

    def test_counts_filters_calendar_boundaries_progress_and_read_only_projection(self):
        rid=self.create('Release',[
            ('Overdue task','Maya','2026-12-28'),('Today task','Ada','2026-12-29'),
            ('Next year task','Unknown','2027-01-02'),('Last upcoming day','Ada','2027-01-05'),
            ('Outside week','Ada','2027-01-06'),('Unknown date','Unknown','Unknown'),
            ('Finished task','Ada','2026-12-28')])
        self.create('Unconfirmed',[('Must not appear','Maya','2026-12-29')],False)
        self.create('Empty',[])
        update(self.history,rid,'task-6','done',0,'a'*32)
        update(self.history,rid,'task-1','in_progress',0,'b'*32)
        before=copy.deepcopy(self.history.get_run(rid))
        result=search(self.history,today='2026-12-29')
        self.assertEqual(result['counts'],{'all':6,'today':1,'overdue':1,'upcoming':2,'unassigned':2})
        self.assertEqual(result['total'],6)
        self.assertEqual(result['items'][-1]['deadline'],'Unknown')
        self.assertFalse(any('transcript' in item or 'events' in item for item in result['items']))
        expected={'today':['Today task'],'overdue':['Overdue task'],
                  'upcoming':['Next year task','Last upcoming day'],'unassigned':['Next year task','Unknown date']}
        for view,tasks in expected.items():
            self.assertEqual([r['task'] for r in search(self.history,today='2026-12-29',view=view)['items']],tasks)
        self.assertEqual(search(self.history,today='2026-12-29',status='done')['total'],1)
        self.assertEqual(search(self.history,today='2026-12-29',status='done',view='overdue')['total'],0)
        self.assertEqual(search(self.history,today='2026-12-29',status='in_progress')['items'][0]['task'],'Today task')
        self.assertEqual(search(self.history,today='2026-12-29',status='')['total'],7)
        self.assertEqual(self.history.get_run(rid),before)

    def test_current_confirmed_values_names_literal_search_and_stable_pagination(self):
        rid=self.create('Old name',[(f'Café task {i} 10%_','Maya','2026-12-29') for i in range(15)])
        rename(self.history,rid,'Renamed meeting',0)
        first=search(self.history,today='2026-12-29',query='CAFÉ',page_size=12)
        last=search(self.history,today='2026-12-29',query='10%_',page=99)
        self.assertEqual(first['total'],15);self.assertEqual(len(first['items']),12)
        self.assertEqual(last['page'],1);self.assertEqual(len(last['items']),3)
        self.assertEqual(len({r['proposal_id'] for r in first['items']+last['items']}),15)
        self.assertEqual(search(self.history,today='2026-12-29',query='renamed')['total'],15)
        self.assertEqual(search(self.history,today='2026-12-29',query='maya')['total'],15)
        self.assertEqual(search(self.history,today='2026-12-29',query="%' OR 1=1 --")['total'],0)
        self.assertEqual(search(self.history,today='2026-12-29',query='original transcript')['total'],0)
        bridge=handle({'operation':'task_search','today':'2026-12-29','page':1})
        self.assertEqual(bridge['items'],last['items'])

    def test_rejected_proposals_corrections_other_accounts_and_deletion(self):
        rid=self.history.create_run('Original.','2026-12-29',[
            dict(proposal_id='keep',task='Original task',owner='Maya',deadline='Unknown',evidence=[]),
            dict(proposal_id='reject',task='Rejected task',owner='Maya',deadline='Unknown',evidence=[])])
        self.history.finalize(rid,[dict(proposal_id='keep',task='Corrected task',owner='Jon',deadline='2026-12-29',accept=True),
                                  dict(proposal_id='reject',accept=False)])
        result=search(self.history,today='2026-12-29')
        self.assertEqual(result['total'],1)
        self.assertEqual(result['items'][0]['task'],'Corrected task')
        self.assertEqual(result['items'][0]['owner'],'Jon')
        other=HistoryStore(Path(self.tmp.name)/'other.sqlite3')
        self.assertEqual(search(other,today='2026-12-29')['total'],0)
        delete_input(self.history,rid,'extraction')
        result=search(self.history,today='2026-12-29')
        self.assertEqual(result['total'],0);self.assertEqual(result['page'],0)
        self.assertEqual(result['counts'],dict.fromkeys(('all','today','overdue','upcoming','unassigned'),0))

    def test_invalid_filters_never_fall_back_to_an_unbounded_query(self):
        for kwargs in ({'today':'2026-02-30'},{'today':'20261229'},{'view':'missing'},
                       {'status':'confirmed'},{'status':[]},{'view':{}},{'query':'x'*201},
                       {'query':None},{'page':True},{'page':-1},{'page':100001},{'page_size':51}):
            with self.assertRaises(DataError):search(self.history,**({'today':'2026-12-29'}|kwargs))
