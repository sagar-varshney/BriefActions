"""One JSON request on stdin -> one JSON response; called only by the Node API."""
from datetime import date
import csv
import hashlib
import io
import json
import os
from pathlib import Path
import re
import sys

from history import HistoryStore

ROOT = Path(__file__).resolve().parent
MAX_TRANSCRIPT = 100_000


class ApiError(Exception):
    def __init__(self, message, status=400):
        self.status = status
        super().__init__(message)


def store():
    return HistoryStore(os.environ.get('FLOW_HISTORY_PATH', str(ROOT/'data'/'history.sqlite3')))


def run_snapshot(run_id):
    if not isinstance(run_id, str) or not re.fullmatch(r'[a-f0-9]{32}', run_id):
        raise ApiError('Invalid run ID.')
    events = store().get_run(run_id)
    if events[0]['kind'] != 'extraction':
        raise KeyError(run_id)
    original = events[0]['payload']
    final = next((e['payload']['tasks'] for e in events if e['kind'] == 'final'), None)
    return {'id':run_id, 'created_at':events[0]['created_at'], **original,
            'summary':original.get('settings',{}).get('summary',''),
            'status':'confirmed' if final is not None else 'review', 'final_tasks':final, 'events':events, 'draft':next((e['payload'] for e in reversed(events) if e['kind']=='draft'),None)}


def report_paths():
    return {hashlib.sha256(str(p.relative_to(ROOT)).encode()).hexdigest()[:16]:p
            for p in sorted((ROOT/'evaluation'/'results').rglob('*.json'))
            if 'metrics' in json.loads(p.read_text())}


def handle(request):
    op = request.get('operation')
    if op.startswith('annotation_'):
        from annotations import AnnotationStore
        annotations=AnnotationStore(store())
        if op=='annotation_list': return annotations.listing()
        if op=='annotation_create':
            return annotations.create(request.get('transcript'),request.get('reference_date'),request.get('source'),
                                      request.get('permission'),request.get('anonymized'),request.get('group'))
        if op=='annotation_get': return annotations.get(request.get('case_id'))
        if op=='annotation_submit':
            return annotations.submit(request.get('case_id'),request.get('reviewer'),request.get('items'),request.get('independent'),request.get('reason'))
        if op=='annotation_freeze': return annotations.freeze(request.get('seed'),request.get('test_fraction',.3))
        if op=='annotation_export': return annotations.export(request.get('snapshot'))
        raise ApiError('Unknown annotation operation',404)
    if op == 'draft':
        run_snapshot(request.get('run_id'))
        try:
            return store().save_draft(request.get('run_id'),request.get('decisions'),request.get('version'),request.get('client_id'),request.get('edit_id'))
        except ValueError as error:
            raise ApiError(str(error),409 if 'another tab' in str(error) or 'finalized' in str(error) else 400) from error
    if op == 'health':
        # Import now so readiness checks the extraction runtime, not just Python.
        import flow_engine
        return {'status':'ready', 'engine':'rules-v3', 'python_version':sys.version.split()[0]}
    if op == 'config':
        from sample_data import SAMPLE_TRANSCRIPT
        return {'sample_transcript':SAMPLE_TRANSCRIPT, 'sample_reference_date':'2026-09-15',
                'today':date.today().isoformat(), 'max_transcript':MAX_TRANSCRIPT}
    if op == 'analyze':
        transcript = request.get('transcript')
        if not isinstance(transcript,str) or not transcript.strip():
            raise ApiError('Paste a transcript to begin.')
        if len(transcript) > MAX_TRANSCRIPT:
            raise ApiError('Transcript exceeds 100,000 characters.')
        reference = request.get('reference_date')
        if not isinstance(reference,str) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}',reference):
            raise ApiError('Meeting date must use YYYY-MM-DD.')
        meeting_date = date.fromisoformat(reference)
        clusters = request.get('clusters',3)
        if type(clusters) is not int or not 1 <= clusters <= 6:
            raise ApiError('Maximum groups must be an integer from 1 to 6.')
        from flow_engine import run_pipeline
        frame, summary, silhouette = run_pipeline(transcript, clusters, meeting_date)
        from extraction import extract_with_changes
        _, conversation_changes = extract_with_changes(transcript,meeting_date)
        settings = {'conversation_changes':conversation_changes,'extractor':'rules-v3','extractor_sha256':hashlib.sha256((ROOT/'extraction.py').read_bytes()).hexdigest(),
                    'clusters':clusters,'summary':summary,'silhouette':silhouette,'interface':'react-node-v1'}
        run_id = store().create_run(transcript,reference,frame.to_dict('records'),settings)
        return run_snapshot(run_id)
    if op == 'runs':
        # One query, including old Streamlit runs, without loading every transcript.
        with store().connection() as conn:
            rows = conn.execute("SELECT e.run_id,e.created_at,e.payload,EXISTS(SELECT 1 FROM events f WHERE f.run_id=e.run_id AND f.kind='final') FROM events e WHERE e.kind='extraction' ORDER BY e.event_id DESC").fetchall()
        result = []
        for run_id, stamp, payload, confirmed in rows:
            original = json.loads(payload)
            result.append({'id':run_id,'created_at':stamp,'reference_date':original['reference_date'],
                           'preview':original['transcript'][:140],'proposal_count':len(original['proposals']),
                           'status':'confirmed' if confirmed else 'review'})
        return result
    if op == 'run':
        return run_snapshot(request.get('run_id'))
    if op == 'finalize':
        run_id = request.get('run_id')
        snapshot = run_snapshot(run_id)
        if snapshot['status'] == 'confirmed':
            raise ApiError('This plan is already confirmed. Analyze again to create a new run.',409)
        decisions = request.get('decisions')
        if not isinstance(decisions,list) or any(not isinstance(d,dict) for d in decisions):
            raise ApiError('Review decisions must be a list of objects.')
        for decision in decisions:
            deadline = decision.get('deadline', 'Unknown')
            if not isinstance(deadline,str) or (deadline.strip() != 'Unknown' and not re.fullmatch(r'\d{4}-\d{2}-\d{2}',deadline.strip())):
                raise ApiError('Deadlines must be YYYY-MM-DD or Unknown.')
        try:
            store().finalize(run_id,decisions)
        except ValueError as error:
            if 'already' in str(error).lower():
                raise ApiError('This plan is already confirmed.',409) from error
            raise
        return run_snapshot(run_id)
    if op == 'csv':
        snapshot = run_snapshot(request.get('run_id'))
        if snapshot['final_tasks'] is None:
            raise ApiError('Confirm the plan before exporting tasks.',409)
        output = io.StringIO()
        fields = ['proposal_id','task','owner','deadline','supporting_transcript_passages']
        writer = csv.DictWriter(output,fieldnames=fields)
        writer.writeheader()
        for task in snapshot['final_tasks']:
            writer.writerow({k:task[k] for k in fields[:-1]} | {'supporting_transcript_passages':'\n\n'.join(e['text'] for e in task['evidence'])})
        return output.getvalue()
    if op == 'benchmarks':
        reports = []
        for report_id,path in report_paths().items():
            report = json.loads(path.read_text())
            reports.append({'id':report_id,**{k:v for k,v in report.items() if k not in ('runs','details')},'case_count':len(report['runs'])})
        from baseline_extractor import TRAINING_EXAMPLES
        return {'training_data':[{'task':task,'category':category} for task,category in TRAINING_EXAMPLES], 'reports':reports,'manifest':json.loads((ROOT/'evaluation'/'corpus_manifest.json').read_text()), 'additional_corpora':[json.loads((ROOT/'evaluation'/'revision-v1'/'manifest.json').read_text())], 'repeat_summaries':[json.loads(p.read_text()) for p in sorted((ROOT/'evaluation'/'results').rglob('repeat-summary.json'))]}
    if op == 'benchmark':
        path = report_paths().get(request.get('report_id'))
        if path is None:
            raise ApiError('Experiment not found.',404)
        report = json.loads(path.read_text())
        dataset = report['dataset']
        cases = []
        candidates=[ROOT/'evaluation'/dataset, ROOT/'evaluation'/'revision-v1'/dataset] if dataset in ('dev.jsonl','test.jsonl') else []
        for corpus in candidates:
            if corpus.exists() and hashlib.sha256(corpus.read_bytes()).hexdigest()==report['dataset_sha256']:
                cases=[json.loads(line) for line in corpus.read_text().splitlines() if line.strip()]
                break
        return {'report':report,'cases':cases}
    raise ApiError('Unknown operation.',404)


def main():
    try:
        request = json.load(sys.stdin)
        if not isinstance(request,dict):
            raise ApiError('Request must be an object.')
        result = {'ok':True,'data':handle(request)}
    except ApiError as error:
        result = {'ok':False,'status':error.status,'error':str(error)}
    except KeyError:
        result = {'ok':False,'status':404,'error':'Saved run not found.'}
    except (ValueError,TypeError) as error:
        result = {'ok':False,'status':400,'error':str(error)}
    except Exception as error:
        print(f'{type(error).__name__}: {error}',file=sys.stderr)
        result = {'ok':False,'status':500,'error':'The extraction engine could not complete this request. Check Python dependencies and the server log.'}
    print(json.dumps(result,allow_nan=False))


if __name__ == '__main__':
    main()
