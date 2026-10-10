"""Reproducible extraction benchmark, with offline rules and external LLM runners."""
from __future__ import annotations

import argparse
from dataclasses import asdict
from datetime import date
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
import shlex
import subprocess
import time
import sys

from extraction import UNKNOWN, passages

ROOT = Path(__file__).resolve().parent
STOP = set('a an the to of for and by on will shall should must needs need has have i we you they he she please task action item today tomorrow this next week'.split())


def load_dataset(path):
    rows = [json.loads(line) for line in Path(path).read_text().splitlines() if line.strip()]
    ids = set()
    for row in rows:
        if row['id'] in ids:
            raise ValueError('Duplicate transcript ID')
        ids.add(row['id'])
        date.fromisoformat(row['reference_date'])
        item_ids = set()
        for item in row['items']:
            if item['id'] in item_ids:
                raise ValueError('Duplicate annotation ID')
            item_ids.add(item['id'])
            validate_item(item, row['transcript'])
    return rows


def validate_item(item, transcript):
    for field in ('task', 'owner', 'deadline'):
        if not isinstance(item.get(field), str) or not item[field].strip():
            raise ValueError(f'{field} must be a nonempty string; use Unknown when missing')
    if item['deadline'] != UNKNOWN:
        date.fromisoformat(item['deadline'])
    if not isinstance(item.get('evidence'), list) or not item['evidence']:
        raise ValueError('Evidence is required')
    for passage in item['evidence']:
        start, end = passage.get('start'), passage.get('end')
        if type(start) is not int or type(end) is not int or not 0 <= start < end <= len(transcript):
            raise ValueError('Invalid evidence span')
        if transcript[start:end] != passage.get('text'):
            raise ValueError('Evidence must quote the original transcript exactly')


def tokens(task):
    task = re.sub(r'\b20\d{2}[-/]\d{1,2}[-/]\d{1,2}\b', '', task.lower())
    return set(re.findall(r'[a-z]+', task)) - STOP


def similarity(prediction, gold):
    p, g = tokens(prediction), tokens(gold)
    common = len(p & g)
    if not p or not g or common / len(g) < .6 or common / len(p) < .45:
        return 0
    return 2 * common / (len(p) + len(g))


def match_items(predictions, gold):
    """Maximum-cardinality, then lexical similarity; evidence breaks ambiguous ties.

    Owner/deadline correctness never influences assignment. Without a support
    tie-break, identical tasks assigned to different people can be swapped.
    """
    import numpy as np
    from scipy.optimize import linear_sum_assignment
    if not predictions or not gold:
        return []
    weights = np.zeros((len(predictions), len(gold) + len(predictions)))
    for i, p in enumerate(predictions):
        for j, g in enumerate(gold):
            value = similarity(p['task'], g['task'])
            if value:
                overlaps = any(pe.get('start') == ge['start'] and pe.get('end') == ge['end'] for pe in p.get('evidence',[]) for ge in g['evidence'])
                weights[i,j] = len(predictions) + 1 + value + .000001 * overlaps
    left, right = linear_sum_assignment(-weights)
    return [(int(i),int(j)) for i,j in zip(left,right) if j < len(gold) and weights[i,j] > 0]


def safe_ratio(n, d):
    return n / d if d else None


def score(rows, runs):
    counts = dict(predicted=0, gold=0, matched=0, owner_correct=0, deadline_correct=0,
                  owner_known_correct=0, owner_known_total=0, deadline_known_correct=0,
                  deadline_known_total=0, evidence_valid=0, supported=0, failures=0)
    details = []
    for row, run in zip(rows, runs):
        predictions = run.get('items', [])
        gold = row['items']
        pairs = match_items(predictions, gold)
        counts['predicted'] += len(predictions)
        counts['gold'] += len(gold)
        counts['matched'] += len(pairs)
        counts['failures'] += bool(run.get('error'))
        counts['owner_known_total'] += sum(g['owner'] != UNKNOWN for g in gold)
        counts['deadline_known_total'] += sum(g['deadline'] != UNKNOWN for g in gold)
        valid = set()
        for i, p in enumerate(predictions):
            try:
                validate_item(p, row['transcript'])
                valid.add(i)
            except (ValueError, TypeError, KeyError):
                pass
        counts['evidence_valid'] += len(valid)
        matches = []
        for i, j in pairs:
            p, g = predictions[i], gold[j]
            owner_ok = p.get('owner', '').casefold() == g['owner'].casefold()
            deadline_ok = p.get('deadline') == g['deadline']
            counts['owner_correct'] += owner_ok
            counts['deadline_correct'] += deadline_ok
            counts['owner_known_correct'] += owner_ok and g['owner'] != UNKNOWN
            counts['deadline_known_correct'] += deadline_ok and g['deadline'] != UNKNOWN
            # Every cited span must belong to this action's annotated support.
            supported = owner_ok and deadline_ok and i in valid and all(any(e['start'] >= ge['start'] and e['end'] <= ge['end'] for ge in g['evidence']) for e in p.get('evidence', []))
            counts['supported'] += supported
            matches.append({'prediction':i,'gold_id':g['id'],'owner_correct':owner_ok,'deadline_correct':deadline_ok,'gold_support_proxy':supported})
        details.append({'id':row['id'],'matches':matches,'false_positives':[i for i in range(len(predictions)) if i not in {p[0] for p in pairs}], 'missed_gold':[g['id'] for j,g in enumerate(gold) if j not in {p[1] for p in pairs}]})
    precision = safe_ratio(counts['matched'], counts['predicted'])
    recall = safe_ratio(counts['matched'], counts['gold'])
    f1 = 2 * precision * recall / (precision + recall) if precision is not None and recall is not None and precision + recall else 0
    latencies = sorted(run['latency_ms'] for run in runs if run.get('latency_ms') is not None)
    costs = [run.get('cost_usd') for run in runs]
    metrics = {'task_precision':precision,'task_recall':recall,'task_f1':f1,
        'owner_accuracy_on_matched':safe_ratio(counts['owner_correct'],counts['matched']),
        'deadline_accuracy_on_matched':safe_ratio(counts['deadline_correct'],counts['matched']),
        'known_owner_end_to_end':safe_ratio(counts['owner_known_correct'],counts['owner_known_total']),
        'known_deadline_end_to_end':safe_ratio(counts['deadline_known_correct'],counts['deadline_known_total']),
        'evidence_validity':safe_ratio(counts['evidence_valid'],counts['predicted']),
        'gold_support_proxy':safe_ratio(counts['supported'],counts['predicted']),
        'latency_p50_ms':latencies[len(latencies)//2] if latencies else None,
        'latency_p95_ms':latencies[min(len(latencies)-1, int(.95*len(latencies)))] if latencies else None,
        'cost_usd':sum(costs) if costs and all(c is not None for c in costs) else None,
        'failure_rate':safe_ratio(counts['failures'],len(rows))}
    return {'counts':counts,'metrics':metrics,'details':details}


def extract_rules(row, baseline=False):
    if baseline:
        from baseline_extractor import extract_action_items
    else:
        from extraction import extract_action_items
    items = [asdict(item) for item in extract_action_items(row['transcript'],date.fromisoformat(row['reference_date']))]
    if baseline:
        # Attach the sentence it selected, without changing original detection or fields.
        units = list(passages(row['transcript']))
        from baseline_extractor import _clean_task
        for item in items:
            item['owner'] = UNKNOWN if item['owner'] == 'Unassigned' else item['owner']
            item['deadline'] = UNKNOWN if item['deadline'] == 'Not specified' else item['deadline']
            item['evidence'] = [asdict(e) for _,_,e in units if _clean_task(e.text) == item['task']]
    return {'items':items,'cost_usd':0.0}


def benchmark(rows, extractor, progress=None):
    runs = []
    for row in rows:
        start = time.perf_counter()
        try:
            result = extractor(row)
            if not isinstance(result.get('items'),list):
                raise ValueError('Runner response must contain an items list')
            # Malformed LLM records fail the transcript rather than silently dropping them.
            for item in result['items']:
                if not isinstance(item,dict) or not isinstance(item.get('task'),str):
                    raise ValueError('Malformed action item')
        except Exception as exc:
            result = {'items':[], 'error':f'{type(exc).__name__}: extraction failed'}
        result['latency_ms'] = (time.perf_counter() - start) * 1000
        result['id'] = row['id']
        runs.append(result)
        if progress:
            progress(row,len(runs),result)
    return runs


def command_extractor(command, prompt, timeout, input_rate=None, output_rate=None):
    def extract(row):
        request = {'prompt':prompt,'transcript':row['transcript'],'reference_date':row['reference_date'],
                   'response_contract':{'items':[{'task':'string','owner':'name or Unknown','deadline':'YYYY-MM-DD or Unknown','evidence':[{'text':'exact quote','start':'0-based integer','end':'exclusive integer'}]}], 'model':'actual model identifier','usage':{'input_tokens':'integer','output_tokens':'integer'}}}
        completed = subprocess.run(shlex.split(command),input=json.dumps(request),capture_output=True,text=True,timeout=timeout,check=True)
        try:
            result = json.loads(completed.stdout)
        except json.JSONDecodeError:
            return {'items':[],'error':'Invalid JSON from runner','raw_response':completed.stdout}
        usage = result.get('usage', {})
        if input_rate is not None and output_rate is not None:
            values = [usage.get('input_tokens'),usage.get('output_tokens')]
            if all(type(v) is int and v >= 0 for v in values):
                result['cost_usd'] = (values[0]*input_rate + values[1]*output_rate)/1_000_000
        try:
            if not isinstance(result.get('model'),str) or not result['model'].strip():
                raise ValueError('Runner must report actual model identifier')
            if not isinstance(result.get('items'),list):
                raise ValueError('Runner must return an items list')
            for item in result['items']:
                validate_item(item,row['transcript'])
        except (ValueError,TypeError,KeyError) as error:
            result['invalid_items'] = result.get('items')
            result['items'] = []
            result['error'] = f'Invalid runner response: {type(error).__name__}'
        return result
    return extract


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--split',choices=['dev','test'],default='dev')
    parser.add_argument('--dataset',type=Path)
    parser.add_argument('--extractor',choices=['baseline','rules','llm'],default='rules')
    parser.add_argument('--llm-command',help='Executable that reads the request JSON on stdin and writes response JSON to stdout; no shell')
    parser.add_argument('--prompt',choices=['v1','v2'],default='v2')
    parser.add_argument('--label',default=None,help='Experiment name, e.g. model-name-prompt-v2')
    parser.add_argument('--timeout',type=float,default=60)
    parser.add_argument('--input-usd-per-million',type=float)
    parser.add_argument('--output-usd-per-million',type=float)
    parser.add_argument('--output',type=Path,required=True)
    args = parser.parse_args()
    dataset = args.dataset or ROOT/'evaluation'/f'{args.split}.jsonl'
    rows = load_dataset(dataset)
    prompt = (ROOT/'evaluation'/'prompts'/f'{args.prompt}.txt').read_text()
    if args.extractor == 'llm' and not args.llm_command:
        parser.error('--llm-command is required for LLM runs')
    extractor = command_extractor(args.llm_command,prompt,args.timeout,args.input_usd_per_million,args.output_usd_per_million) if args.extractor == 'llm' else lambda row: extract_rules(row,args.extractor == 'baseline')
    progress = (lambda row,n,result: print(f"{args.label or args.extractor}: {n}/{len(rows)} {row['id']} {'failed' if result.get('error') else 'ok'}",file=sys.stderr,flush=True)) if args.extractor == 'llm' else None
    runs = benchmark(rows,extractor,progress)
    report = score(rows,runs)
    report.update({'schema_version':1,'created_at':datetime.now(timezone.utc).isoformat(),
        'evaluator_sha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        'label':args.label or args.extractor,'extractor':args.extractor,
        'dataset_sha256':hashlib.sha256(dataset.read_bytes()).hexdigest(),
        'dataset':dataset.name,'splits':sorted({row['split'] for row in rows}),
        'extractor_sha256':hashlib.sha256((ROOT/('baseline_extractor.py' if args.extractor == 'baseline' else 'extraction.py')).read_bytes()).hexdigest() if args.extractor != 'llm' else None,
        'prompt_version':args.prompt if args.extractor == 'llm' else None,
        'prompt_sha256':hashlib.sha256(prompt.encode()).hexdigest() if args.extractor == 'llm' else None,
        'pricing':{'input_usd_per_million':args.input_usd_per_million,'output_usd_per_million':args.output_usd_per_million},
        'runs':runs})
    args.output.parent.mkdir(parents=True,exist_ok=True)
    args.output.write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps({'label':report['label'],'counts':report['counts'],'metrics':report['metrics']},indent=2))


if __name__ == '__main__':
    main()
