"""Follow-up changes, confirmation races, evidence, progress, and erasure on both stores."""
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from dataclasses import asdict
from datetime import date
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from uuid import uuid4

from data_controls import DataError, delete_input, export_lines
from evaluate import validate_item
from extraction import extract_action_items
from history import HistoryStore
from plan_updates import compare, create, save_review
from task_dashboard import search
from task_progress import project, update
from web_bridge import ApiError, handle


class PlanUpdateTests(unittest.TestCase):
    def setUp(self):
        self.folder=tempfile.TemporaryDirectory()
        self.path=str(Path(self.folder.name)/'history.sqlite3')
        self.env=patch.dict(os.environ,{'FLOW_HISTORY_PATH':self.path})
        self.env.start()
        self.history=HistoryStore(self.path)
        self.text='Context: launch notes 📋.\nMaya will send the report by Friday.\nJon will draft the notes.\nLee will check capacity.'
        self.proposals=[asdict(p) for p in extract_action_items(self.text,date(2026,10,16))]
        self.base=self.history.create_run(self.text,'2026-10-16',self.proposals,title='Launch')
        self.history.finalize(self.base,[dict(p,accept=True) for p in self.proposals])

    def tearDown(self):
        self.env.stop();self.folder.cleanup()

    def followup(self,text='Maya: Move send the report to Monday.\nJon: Cancel draft the notes.\nAda: I will review the budget tomorrow.',base=None,request=None):
        run_id=create(self.history,base or self.base,text,'2026-10-17',request or uuid4().hex)
        return handle({'operation':'run','run_id':run_id})

    def decisions(self,run,apply=True):
        return [dict(change_id=r['change_id'],apply=apply,**{k:(r['after'] or r['before'])[k] for k in ('task','owner','deadline')}) for r in run['settings']['plan_update']['rows'] if r['kind']!='unchanged']

    def test_four_types_exact_unicode_evidence_and_reference_dates(self):
        run=self.followup();rows=run['settings']['plan_update']['rows']
        self.assertEqual([r['kind'] for r in rows],['changed','cancelled','unchanged','added'])
        self.assertEqual(rows[0]['before']['deadline'],'2026-10-16')
        self.assertEqual(rows[0]['after']['deadline'],'2026-10-19')
        self.assertEqual(rows[-1]['after']['deadline'],'2026-10-18')
        self.assertEqual(rows[2]['after']['deadline'],'Unknown')
        for row in rows:
            for task in (row['before'],row['after']):
                if task:validate_item(task,run['transcript'])
            for e in row['evidence']:self.assertEqual(run['transcript'][e['start']:e['end']],e['text'])
        self.assertEqual(self.history.get_run(self.base)[0]['payload']['transcript'],self.text)
        self.assertEqual(search(self.history,today='2026-10-17')['total'],3)

    def test_absence_and_ambiguous_references_do_not_remove_tasks(self):
        run=self.followup('Maya: Cancel that task.\nWe discussed the roadmap.')
        self.assertTrue(all(r['kind']=='unchanged' for r in run['settings']['plan_update']['rows']))
        self.assertEqual(len(run['settings']['plan_update']['warnings']),1)
        tasks=deepcopy(self.proposals[:1])*2;tasks[1]['owner']='Ada';tasks[1]['proposal_id']='different'
        rows,warnings=compare(tasks,'Cancel the report.',date(2026,10,17),0)
        self.assertEqual([r['kind'] for r in rows],['unchanged','unchanged']);self.assertEqual(len(warnings),1)
        rows,_=compare(self.proposals,'Do not cancel the report.\nMaybe we should move the report.',date(2026,10,17),0)
        self.assertTrue(all(r['kind']=='unchanged' for r in rows))

    def test_declared_changes_unknowns_and_same_speaker_immediate_reference(self):
        run=self.followup('Maya: I will send the report. Actually, make that Monday.\nPlease prepare the agenda.')
        rows=run['settings']['plan_update']['rows']
        self.assertEqual(rows[0]['after']['deadline'],'2026-10-19')
        self.assertEqual(rows[-1]['after']['owner'],'Unknown')
        self.assertEqual(rows[-1]['after']['deadline'],'Unknown')
        again=self.followup('Ada will send the report tomorrow.')
        row=again['settings']['plan_update']['rows'][0]
        self.assertEqual((row['kind'],row['after']['owner']),('changed','Ada'))
        invalid_date=self.followup('Maya will send the report by 2026-02-30.')
        self.assertEqual(invalid_date['settings']['plan_update']['rows'][0]['after']['deadline'],'Unknown')
        no_date=self.followup('Maya will send the report.')
        self.assertEqual(no_date['settings']['plan_update']['rows'][0]['kind'],'unchanged')
        cancelled_new=self.followup('Ada: I will review the budget. Cancel that task.\nAda: I will send invoices.')
        self.assertEqual(sum(r['kind']=='added' for r in cancelled_new['settings']['plan_update']['rows']),1)

    def test_only_approved_changes_apply_and_final_confirmation_is_retry_safe(self):
        run=self.followup();decisions=self.decisions(run)
        decisions[0]['apply']=False  # Keep the original report deadline.
        decisions[-1]['owner']='Uma'  # A recorded human correction.
        before=self.history.get_run(self.base)
        save_review(self.history,run['id'],decisions,0,confirm=True)
        final=handle({'operation':'run','run_id':run['id']})
        self.assertEqual([(t['task'],t['owner'],t['deadline']) for t in final['final_tasks']],
                         [('send the report','Maya','2026-10-16'),('check capacity','Lee','Unknown'),('review the budget','Uma','2026-10-18')])
        self.assertEqual(self.history.get_run(self.base)[:-1],before)
        self.assertEqual(self.history.get_run(self.base)[-1]['kind'],'plan_superseded')
        self.assertEqual(search(self.history,today='2026-10-17',status='')['total'],3)
        self.assertTrue(all(t['run_id']==run['id'] for t in search(self.history,today='2026-10-17',status='')['items']))
        count=len(final['events']);save_review(self.history,run['id'],decisions,0,confirm=True)
        self.assertEqual(len(self.history.get_run(run['id'])),count)
        with self.assertRaises(DataError):save_review(self.history,run['id'],self.decisions(run,False),0,confirm=True)

    def test_drafts_partial_fields_stale_writes_and_confirmation_validation(self):
        run=self.followup();decisions=self.decisions(run);decisions[0]['deadline']='2026-'
        save_review(self.history,run['id'],decisions,0)
        self.assertEqual(handle({'operation':'run','run_id':run['id']})['update_draft']['decisions'][0]['deadline'],'2026-')
        with self.assertRaises(DataError):save_review(self.history,run['id'],decisions,0)
        with self.assertRaises(DataError):save_review(self.history,run['id'],decisions,1,confirm=True)
        self.assertFalse(any(e['kind']=='final' for e in self.history.get_run(run['id'])))
        self.assertFalse(any(e['kind']=='plan_superseded' for e in self.history.get_run(self.base)))
        decisions[0]['apply']=False  # Invalid edits on a skipped change do not affect the plan.
        save_review(self.history,run['id'],decisions,1,confirm=True)
        with self.assertRaises(DataError):save_review(self.history,run['id'],decisions,1)

    def test_request_recovery_no_unconfirmed_base_and_different_input_conflict(self):
        request=uuid4().hex;run=self.followup(request=request)
        self.assertEqual(self.followup(request=request)['id'],run['id'])
        with self.assertRaises(DataError):self.followup('A different follow-up.',request=request)
        pending=self.history.create_run('No actions.','2026-10-16',[])
        with self.assertRaises(DataError):self.followup(base=pending)
        for text,stamp,rid in [('', '2026-10-17',uuid4().hex),('No tasks.','2026-10-15',uuid4().hex),('No tasks.','2026-02-30',uuid4().hex),('No tasks.','2026-10-17','bad')]:
            with self.assertRaises(ValueError):create(self.history,self.base,text,stamp,rid)
        save_review(self.history,run['id'],self.decisions(run),0,confirm=True)
        self.assertEqual(self.followup(request=request)['id'],run['id'])
        with self.assertRaises(DataError):self.followup()

    def test_competing_followups_cannot_both_replace_the_same_plan(self):
        first=self.followup();second=self.followup('Maya will send the report tomorrow.')
        save_review(self.history,first['id'],self.decisions(first),0,confirm=True)
        with self.assertRaises(DataError):save_review(self.history,second['id'],self.decisions(second),0,confirm=True)
        self.assertFalse(any(e['kind']=='final' for e in self.history.get_run(second['id'])))

    def test_confirmation_carries_latest_progress_and_old_plan_is_read_only(self):
        run=self.followup();task=self.proposals[0]['proposal_id']
        update(self.history,self.base,task,'done',0,uuid4().hex)
        save_review(self.history,run['id'],self.decisions(run),0,confirm=True)
        self.assertEqual(project(self.history.get_run(run['id']))[task]['status'],'done')
        with self.assertRaises(DataError):update(self.history,self.base,task,'todo',1,uuid4().hex)
        self.assertEqual(search(self.history,today='2026-10-17')['total'],2)
        final=next(e['payload']['tasks'] for e in self.history.get_run(self.base) if e['kind']=='final')
        self.assertEqual(final[0]['deadline'],'2026-10-16')

    def test_erasing_source_removes_descendants_and_prevents_retry_resurrection(self):
        child=self.followup();save_review(self.history,child['id'],self.decisions(child),0,confirm=True)
        grandchild=self.followup('Please prepare an agenda.',base=child['id'])
        separate=self.history.create_run('Keep this unrelated input.','2026-10-17',[])
        result=delete_input(self.history,self.base,'extraction')
        self.assertEqual(set(result['deleted_ids']),{self.base,child['id'],grandchild['id']})
        for rid in result['deleted_ids']:
            with self.assertRaises(KeyError):self.history.get_run(rid)
        with self.assertRaises(DataError):self.followup(request=child['id'])
        self.assertTrue(self.history.get_run(separate))
        self.assertNotIn(self.text,json.dumps(list(export_lines(self.history))))
        with self.history.connection() as conn:
            deleted={r[0] for r in conn.execute('SELECT run_id FROM deleted_inputs')}
        self.assertTrue(set(result['deleted_ids'])<=deleted)

    def test_erasing_replacement_does_not_reactivate_historical_tasks(self):
        child=self.followup();save_review(self.history,child['id'],self.decisions(child),0,confirm=True)
        delete_input(self.history,child['id'],'extraction')
        original=handle({'operation':'run','run_id':self.base})
        self.assertEqual(original['superseded_by'],child['id']);self.assertFalse(original['superseded_available'])
        self.assertEqual(search(self.history,today='2026-10-17',status='')['total'],0)

    def test_regular_review_routes_cannot_bypass_change_approval(self):
        run=self.followup()
        for operation in ['draft','finalize','manual_action']:
            with self.assertRaises(ApiError):handle({'operation':operation,'run_id':run['id'],'decisions':[]})
        with self.assertRaises(DataError):save_review(self.history,run['id'],[],0,confirm=True)
        with self.assertRaises(DataError):save_review(self.history,run['id'],self.decisions(run),True)

    def test_combined_source_and_task_limits(self):
        with self.assertRaises(DataError):self.followup('x'*100000)
        with self.assertRaises(DataError):self.followup('\n'.join(f'Maya will review item {i}.' for i in range(201)))

    def test_concurrent_confirmations_have_one_winner(self):
        first=self.followup();second=self.followup('Maya will send the report tomorrow.')
        def confirm(run):
            try:save_review(self.history,run['id'],self.decisions(run),0,confirm=True);return 'confirmed'
            except DataError:return 'conflict'
        with ThreadPoolExecutor(max_workers=2) as pool:
            self.assertEqual(sorted(pool.map(confirm,[first,second])),['confirmed','conflict'])
        self.assertEqual(sum(e['kind']=='plan_superseded' for e in self.history.get_run(self.base)),1)
