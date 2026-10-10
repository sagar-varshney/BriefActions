"""Contract, scoring, persistence and UI tests; no network or paid model calls."""
from dataclasses import asdict
from datetime import date
import json
from pathlib import Path
import tempfile
import unittest

from evaluate import benchmark, command_extractor, load_dataset, score, validate_item
from extraction import UNKNOWN, extract_action_items
from history import HistoryStore


ROOT = Path(__file__).resolve().parents[1]
REF = date(2026, 9, 15)


class ExtractionContractTests(unittest.TestCase):
    def test_original_pipeline_tests(self):
        from test_flow_engine import test_extracts_action_items_and_metadata, test_pipeline_adds_ml_and_schedule_fields, test_short_summary_is_preserved
        test_extracts_action_items_and_metadata()
        test_pipeline_adds_ml_and_schedule_fields()
        test_short_summary_is_preserved()

    def test_exact_offsets_and_unknown_plural_owner(self):
        text = '  • Maya: We must review the risks next week.\r\n'
        items = extract_action_items(text, REF)
        self.assertEqual(len(items),1)
        self.assertEqual((items[0].owner,items[0].deadline),(UNKNOWN,UNKNOWN))
        validate_item(asdict(items[0]),text)

    def test_contractions_joint_owners_and_context_dates(self):
        items = extract_action_items("Ada: I'll send the report tomorrow.\nBo and Cy will follow up on the contract by Friday.",REF)
        self.assertEqual([(p.owner,p.deadline) for p in items],[('Ada','2026-09-16'),('Bo and Cy','2026-09-18')])

    def test_negative_and_status_sentences(self):
        self.assertEqual(extract_action_items("I won't deploy the patch.\nWe already reviewed the report.\nMaybe we should migrate the store.\nIf approved, I will fix the bug.",REF),[])

    def test_dedup_preserves_distinct_spans_and_conflicts(self):
        text = 'Nina will prepare a budget by Friday.\nNina will prepare the budget by Friday.\nJon will prepare the budget by Friday.\nNina will prepare the budget by tomorrow.'
        items = extract_action_items(text, REF)
        self.assertEqual(len(items),3)
        self.assertEqual(len(items[0].evidence),2)
        self.assertEqual(len({p.proposal_id for p in items}),3)

    def test_numeric_objects_are_not_merged(self):
        self.assertEqual(len(extract_action_items('Asha will review report 1.\nAsha will review report 2.',REF)),2)

    def test_vague_invalid_and_background_dates(self):
        for text in ['Ren will fix the bug next week.','Ren will fix the bug by 2026-02-30.','We met today.\nRen will fix the bug.']:
            self.assertEqual(extract_action_items(text,REF)[0].deadline,UNKNOWN)


    def test_reference_date_month_and_year_boundaries(self):
        items = extract_action_items('Mira will send the invoice tomorrow.\nDev will review the budget by January 3.',date(2026,12,31))
        self.assertEqual([item.deadline for item in items],['2027-01-01','2027-01-03'])
        items = extract_action_items('Mira will send the invoice by Friday.\nDev will review the budget by next Friday.',date(2026,9,18))
        self.assertEqual([item.deadline for item in items],['2026-09-18','2026-09-25'])


class BenchmarkTests(unittest.TestCase):
    def setUp(self):
        self.row = load_dataset(ROOT/'evaluation'/'dev.jsonl')[0]

    def test_corpus_contract_and_disjoint_ids(self):
        dev = load_dataset(ROOT/'evaluation'/'dev.jsonl')
        heldout = load_dataset(ROOT/'evaluation'/'test.jsonl')
        self.assertEqual((len(dev),len(heldout)),(30,30))
        self.assertFalse({r['id'] for r in dev} & {r['id'] for r in heldout})
        self.assertFalse({r['transcript'] for r in dev} & {r['transcript'] for r in heldout})

    def metrics(self, items):
        return score([self.row],[{'items':items}])['metrics']

    def test_perfect_and_duplicate_predictions(self):
        gold = self.row['items']
        self.assertEqual(self.metrics(gold)['task_f1'],1)
        self.assertEqual(self.metrics(gold*2)['task_precision'],.5)

    def test_verbatim_quote_does_not_support_unrelated_task(self):
        wrong = dict(self.row['items'][0], task='book a holiday flight')
        metrics = self.metrics([wrong])
        self.assertEqual(metrics['evidence_validity'],1)
        self.assertEqual(metrics['gold_support_proxy'],0)
        self.assertEqual(metrics['task_recall'],0)

    def test_wrong_metadata_lowers_support(self):
        wrong = dict(self.row['items'][0],owner='Invented person')
        metrics = self.metrics([wrong])
        self.assertEqual(metrics['task_recall'],1)
        self.assertEqual(metrics['owner_accuracy_on_matched'],0)
        self.assertEqual(metrics['gold_support_proxy'],0)

    def test_broken_span_rejected(self):
        wrong = dict(self.row['items'][0],evidence=[{'text':'made up','start':0,'end':7}])
        with self.assertRaises(ValueError):
            validate_item(wrong,self.row['transcript'])
        self.assertEqual(self.metrics([wrong])['evidence_validity'],0)

    def test_failure_counted_and_cost_unknown(self):
        def fail(row):
            raise TimeoutError('timeout')
        runs = benchmark([self.row],fail)
        metrics = score([self.row],runs)['metrics']
        self.assertEqual(metrics['failure_rate'],1)
        self.assertEqual(metrics['task_recall'],0)
        self.assertIsNone(metrics['cost_usd'])

    def test_runner_protocol_and_usage_cost(self):
        import sys
        with tempfile.TemporaryDirectory() as folder:
            script = Path(folder)/'runner.py'
            script.write_text('import json,sys\nrequest=json.load(sys.stdin)\nassert request["reference_date"]=="2026-09-15"\nprint(json.dumps('+repr({'items':self.row['items'],'model':'fixture-only','usage':{'input_tokens':100,'output_tokens':20}})+'))\n')
            extractor = command_extractor(f'{sys.executable} {script}','prompt-version',1,1,2)
            result = extractor(self.row)
            self.assertAlmostEqual(result['cost_usd'],.00014)
            self.assertEqual(result['model'],'fixture-only')



    def test_invalid_runner_items_preserve_trace_and_cost(self):
        import sys
        with tempfile.TemporaryDirectory() as folder:
            script = Path(folder)/'invalid_runner.py'
            invalid = dict(self.row['items'][0],deadline='2026-02-30')
            script.write_text('import json,sys\njson.load(sys.stdin)\nprint(json.dumps('+repr({'items':[invalid],'model':'fixture-only','cost_usd':0.01})+'))\n')
            result = command_extractor(f'{sys.executable} {script}','v2',1)(self.row)
            self.assertEqual(result['items'],[])
            self.assertEqual(result['invalid_items'][0]['deadline'],'2026-02-30')
            self.assertIn('error',result)
            self.assertEqual(result['cost_usd'],0.01)


class OllamaAdapterTests(unittest.TestCase):
    def test_quote_grounding_usage_and_schema(self):
        from io import BytesIO
        from unittest.mock import patch
        from ollama_runner import generate
        row = load_dataset(ROOT/'evaluation'/'dev.jsonl')[0]
        model_item = {**row['items'][0], 'evidence':[{'text':row['items'][0]['evidence'][0]['text']}]}
        model_item.pop('id')
        response = {'done':True,'model':'fixture-local','response':json.dumps({'items':[model_item]}),'prompt_eval_count':120,'eval_count':30}
        with patch('ollama_runner.urlopen',return_value=BytesIO(json.dumps(response).encode())) as mocked:
            result = generate({'prompt':'fixture','reference_date':row['reference_date'],'transcript':row['transcript']},'fixture-local')
            validate_item(result['items'][0],row['transcript'])
            self.assertEqual(result['usage']['output_tokens'],30)
            self.assertEqual(result['generation_options']['temperature'],0)
            self.assertIn('format',json.loads(mocked.call_args.args[0].data))
            payload = json.loads(mocked.call_args.args[0].data)
            self.assertIn('pattern',payload['format']['properties']['items']['items']['properties']['deadline'])
            self.assertIn('YYYY-MM-DD',payload['prompt'])

    def test_bad_quote_preserves_raw_response_for_validation(self):
        from io import BytesIO
        from unittest.mock import patch
        from ollama_runner import generate
        raw = {'done':True,'model':'fixture-local','response':json.dumps({'items':[{'task':'review risks','owner':'Unknown','deadline':'Unknown','evidence':[{'text':'fabricated quote'}]}]}),'prompt_eval_count':10,'eval_count':20}
        with patch('ollama_runner.urlopen',return_value=BytesIO(json.dumps(raw).encode())):
            result = generate({'prompt':'fixture','reference_date':'2026-09-15','transcript':'Real transcript'},'fixture-local')
            self.assertEqual(result['raw_model_response'],raw['response'])
            self.assertEqual(result['usage']['output_tokens'],20)
            with self.assertRaises(ValueError):
                validate_item(result['items'][0],'Real transcript')

class HistoryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.store = HistoryStore(Path(self.temp.name)/'history.sqlite3')
        self.text = 'Maya will review the risks.\nJon will send the invoice.'
        self.proposals = [asdict(p) for p in extract_action_items(self.text,REF)]
        self.run_id = self.store.create_run(self.text,REF.isoformat(),self.proposals)

    def tearDown(self):
        self.temp.cleanup()

    def decisions(self):
        return [dict(p,accept=False) for p in self.proposals]

    def test_correct_reject_and_trace_final_result(self):
        decisions = self.decisions()
        decisions[0].update(accept=True,owner='Ravi',deadline='2026-09-30')
        tasks = self.store.finalize(self.run_id,decisions)
        self.assertEqual(len(tasks),1)
        self.assertEqual(tasks[0]['owner'],'Ravi')
        events = self.store.get_run(self.run_id)
        self.assertEqual([e['kind'] for e in events],['extraction','review','final'])
        self.assertEqual(events[0]['payload']['proposals'][0]['owner'],'Maya')
        self.assertFalse(events[1]['payload']['decisions'][1]['accept'])
        self.assertEqual(tasks[0]['evidence'],self.proposals[0]['evidence'])

    def test_invalid_review_rolls_back(self):
        decisions = self.decisions()
        decisions[0]['deadline'] = 'not-a-date'
        with self.assertRaises(ValueError):
            self.store.finalize(self.run_id,decisions)
        self.assertEqual(len(self.store.get_run(self.run_id)),1)

    def test_review_is_complete_and_idempotent(self):
        with self.assertRaises(ValueError):
            self.store.finalize(self.run_id,self.decisions()[:1])
        self.assertEqual(self.store.finalize(self.run_id,self.decisions()),[])
        with self.assertRaises(ValueError):
            self.store.finalize(self.run_id,self.decisions())
        self.assertEqual(len(self.store.get_run(self.run_id)),3)


if __name__ == '__main__':
    unittest.main()
