import copy
from concurrent.futures import ThreadPoolExecutor
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from history import HistoryStore
from task_progress import update
from data_controls import DataError, delete_input, export_lines
from web_bridge import handle

class TaskProgressTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.history=HistoryStore(Path(self.tmp.name)/'history.sqlite3')
        self.env=patch.dict(os.environ,{'FLOW_HISTORY_PATH':str(self.history.path)});self.env.start()
        self.proposals=[dict(proposal_id='task-1',task='Send report',owner='Maya',deadline='Unknown',evidence=[]),dict(proposal_id='task-2',task='Send invoice',owner='Jon',deadline='2026-10-15',evidence=[])]
        self.rid=self.history.create_run('Original conversation.','2026-10-14',self.proposals)
    def tearDown(self):self.env.stop();self.tmp.cleanup()
    def confirm(self):self.history.finalize(self.rid,[dict(p,accept=i==0) for i,p in enumerate(self.proposals)])
    def snapshot(self):return handle({'operation':'run','run_id':self.rid})
    def test_progress_preserves_confirmed_tasks_and_lost_response_retry_cannot_roll_back(self):
        self.confirm();before=copy.deepcopy(self.snapshot());self.assertEqual(before['task_progress']['task-1'],{'status':'todo','version':0})
        update(self.history,self.rid,'task-1','in_progress',0,'a'*32)
        update(self.history,self.rid,'task-1','done',1,'b'*32)
        update(self.history,self.rid,'task-1','in_progress',0,'a'*32)
        after=self.snapshot();self.assertEqual(after['task_progress']['task-1']['status'],'done');self.assertEqual(after['task_progress']['task-1']['version'],2)
        self.assertEqual(after['final_tasks'],before['final_tasks']);self.assertEqual(after['events'][:-2],before['events']);self.assertEqual(after['proposals'],before['proposals'])
        lines=list(export_lines(self.history));self.assertTrue(any(x.get('kind')=='task_progress' for x in lines))
        with self.assertRaises(DataError):update(self.history,self.rid,'task-1','todo',0,'a'*32)
    def test_validation_stale_updates_unconfirmed_and_rejected_tasks(self):
        with self.assertRaises(DataError):update(self.history,self.rid,'task-1','done',0,'a'*32)
        self.confirm()
        for proposal,status,version,request in [('task-2','done',0,'a'*32),('missing','done',0,'a'*32),('task-1','unknown',0,'a'*32),('task-1','done',True,'a'*32),('task-1','done',0,'invalid')]:
            with self.assertRaises(DataError):update(self.history,self.rid,proposal,status,version,request)
        update(self.history,self.rid,'task-1','todo',0,'a'*32);self.assertEqual(len(self.snapshot()['events']),3)
        update(self.history,self.rid,'task-1','done',0,'b'*32)
        with self.assertRaises(DataError) as caught:update(self.history,self.rid,'task-1','in_progress',0,'c'*32)
        self.assertEqual(caught.exception.status,409)
    def test_concurrent_updates_have_one_winner(self):
        self.confirm()
        def change(value):
            try:update(self.history,self.rid,'task-1',value,0,('a' if value=='done' else 'b')*32);return 200
            except DataError as e:return e.status
        with ThreadPoolExecutor(max_workers=2) as pool:self.assertEqual(sorted(pool.map(change,['done','in_progress'])),[200,409])
    def test_other_account_and_deleted_input_cannot_be_updated(self):
        self.confirm();other=HistoryStore(Path(self.tmp.name)/'other.sqlite3')
        with self.assertRaises(KeyError):update(other,self.rid,'task-1','done',0,'a'*32)
        delete_input(self.history,self.rid,'extraction')
        with self.assertRaises((KeyError,DataError)):update(self.history,self.rid,'task-1','done',0,'a'*32)
