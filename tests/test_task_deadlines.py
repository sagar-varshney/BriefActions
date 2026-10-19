"""Deadline overrides, atomic retries, projection parity and follow-up races on both stores."""
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
import csv
from dataclasses import asdict
from datetime import date
import io
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from uuid import uuid4

from calendar_view import search as calendar
from daily_overview import overview
from data_controls import DataError, delete_input, export_lines
from extraction import extract_action_items
from history import HistoryStore
from plan_updates import create, save_review
from task_dashboard import search
from task_deadlines import update, effective_tasks, project
from task_progress import update as progress
from web_bridge import handle


class TaskDeadlineTests(unittest.TestCase):
    def setUp(self):
        self.folder=tempfile.TemporaryDirectory();self.path=str(Path(self.folder.name)/'history.sqlite3')
        self.env=patch.dict(os.environ,{'FLOW_HISTORY_PATH':self.path});self.env.start()
        self.history=HistoryStore(self.path)
        text='Launch 📋.\nMaya will send the report tomorrow.\nJon will review the notes.'
        self.items=[asdict(p) for p in extract_action_items(text,date(2026,10,20))]
        self.run=self.history.create_run(text,'2026-10-20',self.items,title='Deadline planning')
        self.history.finalize(self.run,[dict(p,accept=True) for p in self.items])
        self.task=self.items[0]['proposal_id']

    def tearDown(self):
        self.env.stop();self.folder.cleanup()

    def change(self,deadline='2026-10-23',version=0,request=None,reason='Customer agreed a later date.'):
        return update(self.history,self.run,self.task,deadline,reason,version,request or uuid4().hex)

    def snapshot(self):
        return handle({'operation':'run','run_id':self.run})

    def test_immutable_confirmation_and_source_with_current_task_calendar_daily_and_exports(self):
        progress(self.history,self.run,self.task,'in_progress',0,uuid4().hex)
        before=deepcopy(self.snapshot());self.change()
        after=self.snapshot()
        for key in ('final_tasks','proposals','transcript','task_progress'):self.assertEqual(after[key],before[key])
        self.assertEqual(after['events'][:-1],before['events'])
        self.assertEqual(after['current_tasks'][0]['deadline'],'2026-10-23')
        correction=after['current_tasks'][0]['deadline_correction']
        self.assertEqual(correction['confirmed_deadline'],'2026-10-21');self.assertTrue(correction['updated_at'])
        self.assertEqual(after['events'][-1]['payload']['before'],'2026-10-21')
        self.assertEqual(search(self.history,today='2026-10-21',view='today')['total'],0)
        self.assertEqual(search(self.history,today='2026-10-23',view='today')['items'][0]['deadline'],'2026-10-23')
        day=overview(self.history,today='2026-10-23');self.assertEqual(day['sections']['today']['total'],1)
        month=calendar(self.history,month='2026-10',day='2026-10-23',kind='tasks');self.assertEqual(month['scheduled']['total'],1)
        csv_task=list(csv.DictReader(io.StringIO(handle({'operation':'csv','run_id':self.run}))))[0]
        self.assertEqual((csv_task['deadline'],csv_task['confirmed_deadline'],csv_task['deadline_correction_reason']),('2026-10-23','2026-10-21','Customer agreed a later date.'))
        self.assertTrue(any(e.get('kind')=='task_deadline' for e in export_lines(self.history)))

    def test_unknown_dates_repeated_corrections_and_old_request_retry_never_rolls_back(self):
        first=uuid4().hex;self.change('Unknown',request=first)
        self.assertEqual(overview(self.history,today='2026-10-23')['meta']['undated'],2)
        self.change('2027-01-02',1,reason='New year plan.')
        count=len(self.snapshot()['events']);self.change('Unknown',request=first)
        self.assertEqual(len(self.snapshot()['events']),count)
        self.assertEqual(project(self.history.get_run(self.run))[self.task]['version'],2)
        self.assertEqual(search(self.history,today='2026-12-30',view='upcoming')['items'][0]['deadline'],'2027-01-02')
        for kwargs in ({'reason':'Different reason.'},{'deadline':'2026-10-24'},{'version':1}):
            with self.assertRaises(DataError):self.change(request=first,**kwargs)
        with self.assertRaises(DataError):self.change('2027-01-02',2)

    def test_input_validation_unconfirmed_and_missing_tasks(self):
        for deadline,reason,version,request in [('2026-02-30','Reason',0,'a'*32),('2026-1-02','Reason',0,'a'*32),('0000-01-01','Reason',0,'a'*32),(None,'Reason',0,'a'*32),('2026-10-23',' ',0,'a'*32),('2026-10-23','x'*501,0,'a'*32),('2026-10-23',None,0,'a'*32),('2026-10-23','Reason',True,'a'*32),('2026-10-23','Reason',-1,'a'*32),('2026-10-23','Reason',0,'bad')]:
            with self.assertRaises(DataError):update(self.history,self.run,self.task,deadline,reason,version,request)
        with self.assertRaises(DataError):update(self.history,self.run,'missing','2026-10-23','Reason',0,uuid4().hex)
        draft=self.history.create_run('Not confirmed.','2026-10-20',self.items)
        with self.assertRaises(DataError):update(self.history,draft,self.task,'2026-10-23','Reason',0,uuid4().hex)
        self.change(' 2028-02-29 ',reason='  Leap-day plan 📋.  ')
        self.assertEqual(self.snapshot()['current_tasks'][0]['deadline'],'2028-02-29')
        self.assertEqual(self.snapshot()['events'][-1]['payload']['reason'],'Leap-day plan 📋.')

    def test_concurrent_deadline_changes_have_one_winner_independent_of_progress(self):
        def change(day):
            try:self.change(day);return 200
            except DataError as error:return error.status
        with ThreadPoolExecutor(max_workers=2) as pool:self.assertEqual(sorted(pool.map(change,['2026-10-23','2026-10-24'])),[200,409])
        progress(self.history,self.run,self.task,'done',0,uuid4().hex)
        self.assertEqual(self.snapshot()['task_deadlines'][self.task]['version'],1)
        self.assertEqual(overview(self.history,today='2026-10-23')['sections']['today']['total'],0)

    def test_followups_carry_current_date_and_reason_and_superseded_retry_is_safe(self):
        request=uuid4().hex;self.change(request=request)
        follow=create(self.history,self.run,'We discussed the roadmap.','2026-10-22',uuid4().hex)
        save_review(self.history,follow,[],0,confirm=True)
        newer=handle({'operation':'run','run_id':follow})
        self.assertEqual(newer['final_tasks'][0]['deadline'],'2026-10-23')
        self.assertEqual(newer['current_tasks'][0]['deadline_correction']['reason'],'Customer agreed a later date.')
        self.change(request=request)  # Already applied before supersession.
        with self.assertRaises(DataError):self.change('2026-10-24',1)
        update(self.history,follow,self.task,'Unknown','Date no longer agreed.',0,uuid4().hex)
        self.assertEqual(search(self.history,today='2026-10-23',view='today')['total'],0)

    def test_stale_followup_cannot_replace_a_later_correction(self):
        follow=create(self.history,self.run,'Maya: Move the report to Friday.','2026-10-22',uuid4().hex)
        rows=handle({'operation':'run','run_id':follow})['settings']['plan_update']['rows']
        decisions=[dict(change_id=r['change_id'],apply=True,**{k:r['after'][k] for k in ('task','owner','deadline')}) for r in rows if r['kind']!='unchanged']
        self.change('2026-10-26')
        with self.assertRaises(DataError) as caught:save_review(self.history,follow,decisions,0,confirm=True)
        self.assertEqual(caught.exception.status,409)
        self.assertIsNone(handle({'operation':'run','run_id':follow})['final_tasks'])
        self.assertEqual(search(self.history,today='2026-10-26',view='today')['total'],1)

    def test_reviewed_followup_date_retains_reason_only_when_the_corrected_date_is_kept(self):
        self.change()
        follow=create(self.history,self.run,'Maya will send the report by 2026-10-27.','2026-10-22',uuid4().hex)
        row=handle({'operation':'run','run_id':follow})['settings']['plan_update']['rows'][0]
        self.assertNotIn('deadline_correction',row['after'])
        decision=dict(change_id=row['change_id'],apply=True,task=row['after']['task'],owner=row['after']['owner'],deadline='2026-10-23')
        save_review(self.history,follow,[decision],0,confirm=True)
        current=handle({'operation':'run','run_id':follow})['current_tasks'][0]
        self.assertEqual(current['deadline_correction']['reason'],'Customer agreed a later date.')
        newer=create(self.history,follow,'Maya will send the report by 2026-10-28.','2026-10-23',uuid4().hex)
        row=handle({'operation':'run','run_id':newer})['settings']['plan_update']['rows'][0]
        save_review(self.history,newer,[dict(change_id=row['change_id'],apply=True,**{key:row['after'][key] for key in ('task','owner','deadline')})],0,confirm=True)
        self.assertNotIn('deadline_correction',handle({'operation':'run','run_id':newer})['current_tasks'][0])

    def test_confirmation_racing_correction_cannot_silently_lose_it(self):
        follow=create(self.history,self.run,'We discussed the roadmap.','2026-10-22',uuid4().hex)
        def operation(action):
            try:
                if action=='confirm':save_review(self.history,follow,[],0,confirm=True)
                else:self.change()
                return 200
            except DataError as error:return error.status
        with ThreadPoolExecutor(max_workers=2) as pool:self.assertEqual(sorted(pool.map(operation,['confirm','correct'])),[200,409])

    def test_other_accounts_erasure_and_rejected_tasks(self):
        other=HistoryStore(Path(self.folder.name)/'other.sqlite3')
        with self.assertRaises(KeyError):update(other,self.run,self.task,'2026-10-23','Reason',0,uuid4().hex)
        delete_input(self.history,self.run,'extraction')
        with self.assertRaises((KeyError,DataError)):self.change()
        self.assertEqual(overview(self.history,today='2026-10-23')['meta']['saved_meetings'],0)
