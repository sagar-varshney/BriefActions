import copy
from concurrent.futures import ThreadPoolExecutor
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from history import HistoryStore
from meeting_history import search,rename
from data_controls import DataError,delete_input
from web_bridge import handle

class MeetingHistoryTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.history=HistoryStore(Path(self.tmp.name)/'history.sqlite3')
        self.env=patch.dict(os.environ,{'FLOW_HISTORY_PATH':str(self.history.path)});self.env.start()
    def tearDown(self):self.env.stop();self.tmp.cleanup()
    def test_names_are_versioned_immutable_events_and_same_name_retry_is_idempotent(self):
        rid=self.history.create_run('Original evidence.','2026-09-15',[],title='Planning')
        self.history.finalize(rid,[]);before=copy.deepcopy(self.history.get_run(rid))
        self.assertEqual(rename(self.history,rid,'  Release planning  ',0),1)
        self.assertEqual(rename(self.history,rid,'Release planning',0),1)
        self.assertEqual(self.history.get_run(rid)[:-1],before)
        snapshot=handle({'operation':'run','run_id':rid})
        self.assertEqual(snapshot['title'],'Release planning');self.assertEqual(snapshot['title_version'],1);self.assertEqual(snapshot['final_tasks'],[])
        with self.assertRaises(DataError) as caught:rename(self.history,rid,'Stale change',0)
        self.assertEqual(caught.exception.status,409)
        rename(self.history,rid,'',1)
        self.assertEqual(search(self.history)['items'][0]['title'],'')
    def test_concurrent_name_changes_cannot_overwrite_each_other(self):
        rid=self.history.create_run('Meeting input.','2026-09-15',[])
        def change(title):
            try:return rename(self.history,rid,title,0)
            except DataError as error:return error.status
        with ThreadPoolExecutor(max_workers=2) as pool:
            self.assertEqual(sorted(pool.map(change,['One name','Other name'])),[1,409])
        self.assertEqual(len(self.history.get_run(rid)),2)

    def test_literal_unicode_text_title_status_dates_and_stable_pages(self):
        ids=[self.history.create_run(f'Café meeting {i} costs 10%_ dollars.','2026-09-15' if i%2 else '2026-10-12',[],title=f'Planning {i}') for i in range(15)]
        self.history.finalize(ids[0],[])
        first=search(self.history,page_size=12);second=search(self.history,page=1,page_size=12)
        self.assertEqual(first['total'],15);self.assertEqual([r['id'] for r in first['items']],list(reversed(ids))[0:12]);self.assertEqual([r['id'] for r in second['items']],list(reversed(ids))[12:])
        self.assertEqual(search(self.history,'CAFÉ')['total'],15)
        self.assertEqual(search(self.history,'10%_')['total'],15)
        self.assertEqual(search(self.history,"%' OR 1=1 --")['total'],0)
        self.assertEqual(search(self.history,'Planning 14')['items'][0]['id'],ids[14])
        self.assertEqual(search(self.history,status='confirmed')['items'][0]['id'],ids[0])
        self.assertEqual(search(self.history,status='review')['total'],14)
        self.assertEqual(search(self.history,date_from='2026-10-01',date_to='2026-10-31')['total'],8)
        self.assertEqual(search(self.history,page=100)['page'],1)
        delete_input(self.history,ids[-1],'extraction')
        self.assertEqual(search(self.history,'Planning 14')['total'],0)
    def test_invalid_filters_and_names_fail_before_writes(self):
        rid=self.history.create_run('Legacy input.','2026-09-15',[])
        for kwargs in ({'query':'x'*201},{'status':'done'},{'date_from':'2026-02-30'},{'date_from':'2026-10-12','date_to':'2026-09-01'},{'page':True},{'page_size':51},{'page':-1}):
            with self.assertRaises(DataError):search(self.history,**kwargs)
        for title in (None,123,'x'*121,'two\nlines','secret\x00text'):
            with self.assertRaises(DataError):rename(self.history,rid,title,0)
        self.assertEqual(len(self.history.get_run(rid)),1)
        self.assertEqual(handle({'operation':'run','run_id':rid})['title'],'')
    def test_search_and_rename_cannot_cross_account_storage(self):
        other=HistoryStore(Path(self.tmp.name)/'other.sqlite3')
        rid=self.history.create_run('Alice private material.','2026-09-15',[],title='Alice-only meeting')
        other.create_run('Bob material.','2026-09-15',[])
        self.assertEqual(search(other,'Alice')['total'],0)
        with self.assertRaises(KeyError):rename(other,rid,'Unauthorized',0)
        self.assertEqual(search(self.history)['items'][0]['title'],'Alice-only meeting')
    def test_named_analysis_retries_keep_name_and_legacy_empty_name_fingerprint(self):
        req={'operation':'analyze','transcript':'Maya will send the report tomorrow.','reference_date':'2026-09-15','clusters':1,'request_id':'a'*32,'title':'Sprint planning'}
        saved=handle(req);self.assertEqual(saved['title'],'Sprint planning');self.assertEqual(handle(req)['id'],saved['id'])
        with self.assertRaises(DataError):handle(req|{'title':'Other meeting'})
        legacy=req|{'request_id':'b'*32,'title':''};handle(legacy);legacy.pop('title');self.assertEqual(handle(legacy)['id'],'b'*32)
