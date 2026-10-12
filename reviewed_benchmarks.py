"""Local, retained rule comparisons on immutable reviewed annotation snapshots."""
from datetime import datetime,timezone
import hashlib
import json
from pathlib import Path
import re
from uuid import uuid4

from annotations import AnnotationStore
from evaluate import benchmark, extract_rules, score

ROOT=Path(__file__).resolve().parent


def digest(value):
    return hashlib.sha256(value).hexdigest()


class ReviewedBenchmarks:
    def __init__(self,history):
        self.history=history
        self.annotations=AnnotationStore(history)

    def snapshots(self):
        with self.history.connection() as conn:
            rows=conn.execute("SELECT created_at,payload FROM events WHERE kind='annotation_split' ORDER BY event_id DESC").fetchall()
        seen=set();result=[]
        for created,payload in rows:
            snapshot=json.loads(payload)['snapshot']
            if snapshot in seen:continue
            seen.add(snapshot)
            exported=self.annotations.export(snapshot)
            cases=[json.loads(line) for text in exported['files'].values() for line in text.splitlines()]
            result.append({'id':snapshot,'created_at':created,'case_count':len(cases),'manifest':exported['manifest'],
                'bundled_cases':sum(bool(c.get('origin')) for c in cases)})
        return result

    def listing(self):
        with self.history.connection() as conn:
            rows=conn.execute("SELECT run_id,payload FROM events WHERE kind='reviewed_benchmark' ORDER BY event_id DESC").fetchall()
        return [{k:r[k] for k in ('id','snapshot','split','created_at','dataset_sha256','case_count')} |
                {'reports':[{k:report[k] for k in ('label','counts','metrics')} for report in r['reports']]}
                for _,payload in rows for r in [json.loads(payload)]]

    def get(self,report_id):
        if not isinstance(report_id,str) or not re.fullmatch(r'[a-f0-9]{32}',report_id):
            raise ValueError('Invalid reviewed benchmark ID')
        events=self.history.get_run(report_id)
        if len(events)!=1 or events[0]['kind']!='reviewed_benchmark':raise KeyError(report_id)
        return events[0]['payload']

    def run(self,snapshot,split='dev',acknowledge_heldout=False,request_id=None):
        if not isinstance(snapshot,str) or not re.fullmatch(r'[a-f0-9]{32}',snapshot):
            raise ValueError('Select a frozen reviewed snapshot')
        if split not in ('dev','test','all'):raise ValueError('Split must be dev, test, or all')
        if split!='dev' and acknowledge_heldout is not True:
            raise ValueError('Explicitly acknowledge held-out scoring before running it')
        report_id=request_id or uuid4().hex
        if not isinstance(report_id,str) or not re.fullmatch(r'[a-f0-9]{32}',report_id):raise ValueError('Invalid request ID')
        try:
            existing=self.get(report_id)
        except KeyError:
            existing=None
        if existing:
            if (existing['snapshot'],existing['split'])!=(snapshot,split):raise ValueError('Request ID belongs to another comparison')
            return existing
        exported=self.annotations.export(snapshot)
        content=''.join(exported['files'][s] for s in ('dev','test') if split in (s,'all'))
        rows=[json.loads(line) for line in content.splitlines()]
        if not rows:raise ValueError('This snapshot has no cases in the selected split')
        if len(rows)>200 or sum(len(r['transcript']) for r in rows)>1_000_000:
            raise ValueError('A comparison supports at most 200 cases and 1,000,000 transcript characters')
        cases=[{k:r[k] for k in ('id','split','transcript','reference_date','items','source','group','annotation_provenance','origin')} for r in rows]
        reports=[]
        for baseline in (True,False):
            runs=benchmark(rows,lambda row:extract_rules(row,baseline))
            report=score(rows,runs)
            report.update({'label':'Original rules' if baseline else 'Current rules','extractor':'baseline' if baseline else 'rules',
                'extractor_sha256':digest((ROOT/('baseline_extractor.py' if baseline else 'extraction.py')).read_bytes()),'runs':runs})
            reports.append(report)
        result={'id':report_id,'snapshot':snapshot,'split':split,'case_count':len(rows),'dataset_sha256':digest(content.encode()),
            'created_at':datetime.now(timezone.utc).isoformat(),'manifest':exported['manifest'],'cases':cases,'reports':reports,
            'evaluator_sha256':digest((ROOT/'evaluate.py').read_bytes()),'runner_sha256':digest(Path(__file__).read_bytes()),
            'heldout_acknowledged':split!='dev','limitations':'Lexical task matching and annotated-span support proxy, not semantic entailment. Reviewer identities and independence are self-attested. Bundled examples are previously evaluated. Latency covers extraction only; API fees exclude compute.'}
        # Bound the worker response before persisting an unusably large result.
        if len(json.dumps(result).encode())>7_000_000:raise ValueError('Report is too large; use a smaller reviewed snapshot')
        with self.history.connection() as conn:
            conn.execute('BEGIN IMMEDIATE')
            row=conn.execute('SELECT kind,payload FROM events WHERE run_id=?',(report_id,)).fetchone()
            if row:
                existing=json.loads(row[1])
                if row[0]!='reviewed_benchmark' or (existing['snapshot'],existing['split'])!=(snapshot,split):
                    raise ValueError('Request ID is already in use')
                return existing
            self.history._append(conn,report_id,'reviewed_benchmark',result)
        return result
