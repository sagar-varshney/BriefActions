"""Aggregate repeat reports without pooling different data, prompts, or scoring code."""
import hashlib
import json
import math
from pathlib import Path
import statistics


def summarize(reports):
    groups={}
    for report in reports:
        configuration=json.dumps({'matrix_config_sha256':report.get('matrix_config_sha256'), 'actual_models':sorted({r['model'] for r in report['runs'] if r.get('model')}),
            'runner_sha256':sorted({r['runner_sha256'] for r in report['runs'] if r.get('runner_sha256')}),
            'generation_options':sorted({json.dumps(r['generation_options'],sort_keys=True) for r in report['runs'] if r.get('generation_options')}),
            'pricing':report.get('pricing')},sort_keys=True)
        key=(report['matrix_model'],report['prompt_version'],report['prompt_sha256'],report['dataset_sha256'],report['evaluator_sha256'],configuration)
        groups.setdefault(key,[]).append(report)
    output=[]
    for key,group in sorted(groups.items()):
        identities={tuple(r['id'] for r in report['runs']) for report in group}
        if len(identities)!=1 or len({r['repeat'] for r in group})!=len(group):
            raise ValueError('Repeat cases must match exactly; repeat indices must be unique')
        metrics={}
        for name in group[0]['metrics']:
            values=[r['metrics'].get(name) for r in group]
            valid=[v for v in values if type(v) in (int,float) and math.isfinite(v)]
            metrics[name]={'known_runs':len(valid),'mean':statistics.mean(valid) if valid else None,
                'stdev':statistics.stdev(valid) if len(valid)>1 else None,'min':min(valid) if valid else None,'max':max(valid) if valid else None}
        model_ids=sorted({run['model'] for r in group for run in r['runs'] if run.get('model')})
        output.append({'model':key[0],'actual_models':model_ids,'prompt':key[1],'prompt_sha256':key[2],
            'dataset_sha256':key[3],'evaluator_sha256':key[4],'repeats':len(group),'run_configuration':json.loads(key[5]),'metrics':metrics,
            'case_failures':[{'id':case_id,'failed_runs':sum(bool(r['runs'][i].get('error')) for r in group),
                'runs':len(group)} for i,case_id in enumerate(next(iter(identities)))],
            'reports':[r['label'] for r in group]})
    return {'schema_version':1,'kind':'repeat_summary','groups':output,
            'limitations':'Sample standard deviation across runs, not a confidence interval. Local API fees exclude compute; null costs remain unknown.'}


def write_summary(folder):
    folder=Path(folder)
    reports=[json.loads(p.read_text()) for p in sorted(folder.glob('*.json'))]
    reports=[r for r in reports if 'matrix_model' in r and 'runs' in r]
    result=summarize(reports)
    result['aggregator_sha256']=hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
    result['report_sha256']={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(folder.glob('*.json')) if 'matrix_model' in json.loads(p.read_text())}
    (folder/'repeat-summary.json').write_text(json.dumps(result,indent=2)+'\n')
    return result
