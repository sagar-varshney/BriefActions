from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from pathlib import Path
import tempfile
import unittest
from uuid import uuid4

from data_controls import DataError,delete_input,export_lines
from history import HistoryStore
from meeting_series import create,rename,assign,membership,listing,preparation,save_agenda,agenda_version
from plan_updates import create as followup,save_review
from task_deadlines import update as deadline
from task_progress import update as progress


class MeetingSeriesTests(unittest.TestCase):
    def setUp(self):
        self.folder=tempfile.TemporaryDirectory();self.history=HistoryStore(Path(self.folder.name)/'history.sqlite3')
        self.series=create(self.history,'Weekly planning 📋',uuid4().hex)

    def tearDown(self):self.folder.cleanup()

    def meeting(self,tasks=None,confirmed=True,series=True):
        proposals=[dict(proposal_id=f'task-{i}',task=t,owner=o,deadline=d,evidence=[dict(start=0,end=7,text='Source.')]) for i,(t,o,d) in enumerate(tasks or [('Send report','Maya','2026-10-19')])]
        run=self.history.create_run('Source.','2026-10-20',proposals,title='Planning',series_id=self.series['id'] if series else None)
        if confirmed:self.history.finalize(run,[dict(p,accept=True) for p in proposals])
        return run

    def prep(self,**kwargs):return preparation(self.history,self.series['id'],today='2026-10-20',**kwargs)

    def payload(self,value=None,**kwargs):
        value=value or self.prep()
        return dict(subject=value['suggestion']['subject'],body=value['suggestion']['body'],version=value['agenda_version'],source_revision=value['source_revision'],request_id=uuid4().hex,today=value['today'])|kwargs

    def test_series_names_versions_retries_and_literal_search(self):
        request=uuid4().hex;one=create(self.history,'Café 東京 10%_',request)
        self.assertEqual(create(self.history,'Café 東京 10%_',request),one)
        with self.assertRaises(DataError):create(self.history,'Other title',request)
        with self.assertRaises(DataError):create(self.history,'CAFÉ 東京 10%_',uuid4().hex)
        rename_id=uuid4().hex;two=rename(self.history,one['id'],'New series',0,rename_id)
        self.assertEqual(two['version'],1);self.assertEqual(rename(self.history,one['id'],'New series',0,rename_id),two)
        with self.assertRaises(DataError):rename(self.history,one['id'],'Stale',0,uuid4().hex)
        self.assertEqual(listing(self.history,query='new SERIES')['total'],1)
        self.assertEqual(listing(self.history,query="%' OR 1=1 --")['total'],0)

    def test_membership_follows_full_lineage_and_current_plans_do_not_duplicate(self):
        run=self.meeting();original=deepcopy(self.history.get_run(run))
        self.assertEqual(membership(self.history,run)['series']['id'],self.series['id'])
        child=followup(self.history,run,'No new commitments.','2026-10-21',uuid4().hex);save_review(self.history,child,[],0,confirm=True)
        self.assertEqual(self.prep()['counts']['open_tasks'],1);self.assertEqual(self.prep()['items'][0]['run_id'],child)
        self.assertEqual(self.prep()['counts']['meetings'],2)
        other=create(self.history,'Other series',uuid4().hex);request=uuid4().hex
        assign(self.history,child,other['id'],1,request);assign(self.history,child,other['id'],1,request)
        self.assertEqual(membership(self.history,run)['series']['id'],other['id']);self.assertEqual(membership(self.history,child)['version'],2)
        self.assertEqual(self.prep()['counts']['open_tasks'],0)
        self.assertEqual(self.history.get_run(run)[:len(original)],original)
        with self.assertRaises(DataError):assign(self.history,run,None,1,uuid4().hex)

    def test_tasks_use_current_dates_progress_and_complete_agenda_not_only_preview(self):
        run=self.meeting([(f'Review item {i}','Unknown' if i==0 else 'Maya','Unknown' if i==0 else '2026-10-19') for i in range(21)])
        self.meeting([('Not confirmed','Jon','2026-10-19')],confirmed=False)
        before=deepcopy(self.history.get_run(run));value=self.prep()
        self.assertEqual(value['counts'],dict(open_tasks=21,overdue=20,undated=1,reviews=1,meetings=2,changes=1,agendas=0))
        self.assertEqual(len(value['items']),8);self.assertEqual(value['total'],21)
        self.assertIn('Review item 20',value['suggestion']['body']);self.assertIn('Review item 0',value['suggestion']['body']);self.assertNotIn('Not confirmed',value['suggestion']['body'])
        self.assertNotIn('Source.',str(value));self.assertNotIn('evidence',str(value));self.assertEqual(self.history.get_run(run),before)
        self.assertEqual(self.prep(page=999)['page'],2)
        deadline(self.history,run,'task-1','2026-10-25','Agreed new date.',0,uuid4().hex)
        progress(self.history,run,'task-2','done',0,uuid4().hex)
        updated=self.prep();self.assertEqual(updated['counts']['open_tasks'],20);self.assertEqual(updated['counts']['overdue'],18)
        self.assertIn('2026-10-25',updated['suggestion']['body']);self.assertNotIn('• Review item 2 —',updated['suggestion']['body'])
        self.assertNotEqual(updated['source_revision'],value['source_revision'])

    def test_saved_agendas_are_versioned_retry_safe_and_mark_the_update_baseline(self):
        run=self.meeting();first=self.payload();save_agenda(self.history,self.series['id'],**first)
        value=self.prep();self.assertEqual(value['agenda_version'],1);self.assertEqual(value['counts']['changes'],0)
        self.assertEqual(value['source_revision'],first['source_revision'])
        second=self.payload(value,body='Personal edited agenda');save_agenda(self.history,self.series['id'],**second)
        save_agenda(self.history,self.series['id'],**first)
        self.assertEqual(self.prep()['agenda']['body'],'Personal edited agenda')
        self.assertEqual(agenda_version(self.history,self.series['id'],1)['body'],first['body'])
        self.assertTrue(any(x.get('kind')=='series_agenda' for x in export_lines(self.history)))
        with self.assertRaises(DataError):save_agenda(self.history,self.series['id'],**(first|dict(body='Conflicting retry')))
        progress(self.history,run,'task-0','in_progress',0,uuid4().hex)
        self.assertEqual(self.prep()['counts']['changes'],1)
        with self.assertRaises(DataError):save_agenda(self.history,self.series['id'],**self.payload(value,version=2))

    def test_concurrent_membership_and_agenda_edits_accept_one_writer(self):
        run=self.meeting(series=False);other=create(self.history,'Other',uuid4().hex)
        def bind(sid):
            try:assign(self.history,run,sid,0,uuid4().hex);return 200
            except DataError as e:return e.status
        with ThreadPoolExecutor(max_workers=2) as pool:self.assertEqual(sorted(pool.map(bind,[self.series['id'],other['id']])),[200,409])
        base=self.payload()
        def save(i):
            try:save_agenda(self.history,self.series['id'],**(base|dict(body=f'Writer {i}',request_id=uuid4().hex)));return 200
            except DataError as e:return e.status
        with ThreadPoolExecutor(max_workers=2) as pool:self.assertEqual(sorted(pool.map(save,range(2))),[200,409])

    def test_transcript_erasure_removes_agendas_even_after_moving_its_meeting(self):
        run=self.meeting();first=self.payload(body='Sensitive copied report text.');save_agenda(self.history,self.series['id'],**first)
        assign(self.history,run,None,1,uuid4().hex)
        second=self.payload(body='Sensitive copied report text kept in edited draft.');save_agenda(self.history,self.series['id'],**second)
        before=self.prep();delete_input(self.history,run,'extraction');after=self.prep()
        self.assertIsNone(after['agenda']);self.assertEqual(after['agenda_version'],2);self.assertEqual(after['counts']['agendas'],0)
        self.assertNotEqual(after['source_revision'],before['source_revision']);self.assertNotIn('Sensitive copied report',str(list(export_lines(self.history))))
        with self.assertRaises(DataError):save_agenda(self.history,self.series['id'],**first)
        with self.assertRaises(KeyError):agenda_version(self.history,self.series['id'],1)
        save_agenda(self.history,self.series['id'],**self.payload(after,body='Fresh agenda after erasure.'))
        self.assertEqual(self.prep()['agenda_version'],3)

    def test_series_deletion_keeps_conversations_and_blocks_resurrection(self):
        run=self.meeting();body='Private agenda wording.';save_agenda(self.history,self.series['id'],**self.payload(body=body))
        delete_input(self.history,self.series['id'],'meeting_series')
        self.assertEqual(listing(self.history)['total'],0);self.assertIsNone(membership(self.history,run)['series'])
        self.assertTrue(self.history.get_run(run));self.assertNotIn(body,str(list(export_lines(self.history))))
        with self.assertRaises(KeyError):self.prep()
        with self.assertRaises(DataError):create(self.history,'Weekly planning 📋',self.series['id'])

    def test_isolation_validation_empty_groups_and_atomic_initial_membership(self):
        other=HistoryStore(Path(self.folder.name)/'other.sqlite3');run=self.meeting()
        self.assertEqual(listing(other)['total'],0)
        with self.assertRaises(KeyError):preparation(other,self.series['id'],today='2026-10-20')
        with self.assertRaises(KeyError):assign(other,run,self.series['id'],0,uuid4().hex)
        before=len(self.history.list_runs())
        with self.assertRaises(KeyError):self.history.create_run('No actions.','2026-10-20',[],series_id=uuid4().hex)
        self.assertEqual(len(self.history.list_runs()),before)
        for change in (dict(today='2026-02-30'),dict(today=None),dict(view=[]),dict(view='bad'),dict(page=True),dict(page_size=13)):
            with self.assertRaises(DataError):preparation(self.history,self.series['id'],**(dict(today='2026-10-20')|change))
        for change in (dict(query=None),dict(query='x'*201),dict(page=True),dict(page_size=51)):
            with self.assertRaises(DataError):listing(self.history,**change)
        for change in (dict(subject=''),dict(subject='two\nlines'),dict(body=''),dict(body='x'*100001),dict(version=True),dict(source_revision='bad'),dict(request_id='bad')):
            with self.assertRaises(DataError):save_agenda(self.history,self.series['id'],**self.payload(**change))
