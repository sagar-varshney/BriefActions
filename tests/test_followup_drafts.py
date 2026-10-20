from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from pathlib import Path
import tempfile
import unittest
from uuid import uuid4

from data_controls import DataError,delete_input,export_lines
from followup_drafts import revision,save
from history import HistoryStore
from meeting_history import rename
from plan_updates import create,save_review
from task_deadlines import update as deadline
from task_progress import update as progress


class FollowupDraftTests(unittest.TestCase):
    def setUp(self):
        self.folder=tempfile.TemporaryDirectory();self.history=HistoryStore(Path(self.folder.name)/'history.sqlite3')
        self.task=dict(proposal_id='report',task='Send report',owner='Maya',deadline='Unknown',evidence=[dict(start=0,end=7,text='Source.')])
        self.run=self.history.create_run('Source.','2026-10-20',[self.task],title='Planning')

    def tearDown(self):self.folder.cleanup()

    def confirm(self):self.history.finalize(self.run,[dict(self.task,accept=True)])

    def args(self,**changes):
        return dict(subject='Follow-up: Planning',body='Maya: send the report. Deadline: Unknown.',version=0,source_revision=revision(self.history.get_run(self.run)),request_id=uuid4().hex)|changes

    def test_versioned_edits_safe_retry_history_and_immutable_plan(self):
        self.confirm();before=deepcopy(self.history.get_run(self.run));first=self.args()
        one=save(self.history,self.run,**first);self.assertEqual(one['version'],1)
        self.assertEqual(revision(self.history.get_run(self.run)),first['source_revision'])
        second=self.args(body='Edited follow-up 📋',version=1);two=save(self.history,self.run,**second)
        self.assertEqual(save(self.history,self.run,**first),one)
        events=self.history.get_run(self.run)
        self.assertEqual(events[:-2],before);self.assertEqual(events[-1]['payload'],two)
        self.assertEqual(len([e for e in events if e['kind']=='followup_draft']),2)
        self.assertTrue(any(e.get('kind')=='followup_draft' for e in export_lines(self.history)))
        with self.assertRaises(DataError):save(self.history,self.run,**(first|{'body':'Different request body'}))
        with self.assertRaises(DataError):save(self.history,self.run,**self.args(version=0))

    def test_task_progress_deadline_title_and_supersession_invalidate_source(self):
        self.confirm();old=self.args()
        progress(self.history,self.run,'report','in_progress',0,uuid4().hex)
        with self.assertRaises(DataError):save(self.history,self.run,**old)
        old=self.args();deadline(self.history,self.run,'report','2026-10-25','New date.',0,uuid4().hex)
        with self.assertRaises(DataError):save(self.history,self.run,**old)
        old=self.args();rename(self.history,self.run,'New title',0)
        with self.assertRaises(DataError):save(self.history,self.run,**old)
        save(self.history,self.run,**self.args())
        follow=create(self.history,self.run,'No new commitments.','2026-10-21',uuid4().hex);save_review(self.history,follow,[],0,confirm=True)
        with self.assertRaises(DataError):save(self.history,self.run,**self.args(version=1))

    def test_concurrent_edits_accept_one_writer_and_isolate_other_accounts(self):
        self.confirm();args=self.args()
        def attempt(i):
            try:save(self.history,self.run,**(args|dict(body=f'Writer {i}',request_id=uuid4().hex)));return 200
            except DataError as e:return e.status
        with ThreadPoolExecutor(max_workers=2) as pool:self.assertEqual(sorted(pool.map(attempt,range(2))),[200,409])
        other=HistoryStore(Path(self.folder.name)/'other.sqlite3')
        with self.assertRaises(KeyError):save(other,self.run,**args)
        delete_input(self.history,self.run,'extraction')
        with self.assertRaises((KeyError,DataError)):save(self.history,self.run,**args)

    def test_confirmation_and_field_validation_are_required(self):
        with self.assertRaises(DataError):save(self.history,self.run,**self.args())
        self.confirm()
        for change in (dict(subject=''),dict(subject='x'*301),dict(subject='Subject\nBcc: x'),dict(body=''),dict(body='x'*100001),dict(version=True),dict(version=-1),dict(source_revision='bad'),dict(request_id='bad')):
            with self.assertRaises(DataError):save(self.history,self.run,**self.args(**change))
