"""Run a model × prompt matrix and write comparable reports plus summary CSV."""
import argparse
import csv
import json
from pathlib import Path
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parent


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config',type=Path,required=True)
    parser.add_argument('--split',choices=['dev','test'],default='dev')
    parser.add_argument('--output-dir',type=Path,required=True)
    args = parser.parse_args()
    config = json.loads(args.config.read_text())
    models = config['models']
    prompts = config.get('prompts',['v1','v2'])
    repeats = config.get('repeats',1)
    if type(repeats) is not int or repeats < 1 or not models or any(p not in {'v1','v2'} for p in prompts):
        parser.error('Require models, v1/v2 prompts, and a positive repeat count')
    labels = [m['label'] for m in models]
    if len(set(labels)) != len(labels) or any(not re.fullmatch(r'[A-Za-z0-9_-]+',label) for label in labels):
        parser.error('Use unique alphanumeric model labels with underscores/hyphens')
    args.output_dir.mkdir(parents=True,exist_ok=True)
    summaries = []
    for model in models:
        for prompt in prompts:
            for n in range(repeats):
                label = f"{model['label']}-{prompt}-{n+1}"
                output = args.output_dir/f'{label}-{args.split}.json'
                if output.exists():
                    parser.error(f'Output already exists: {output}; choose a new directory')
                command = [sys.executable,str(ROOT/'evaluate.py'),'--extractor','llm','--split',args.split,
                    '--prompt',prompt,'--label',label,'--llm-command',model['command'],'--timeout',str(config.get('timeout_seconds',60)),
                    '--output',str(output.resolve())]
                for key in ('input_usd_per_million','output_usd_per_million'):
                    if key in model:
                        command.extend(['--'+key.replace('_','-'),str(model[key])])
                print(f'Running {label} on {args.split}',flush=True)
                subprocess.run(command,check=True,cwd=ROOT,stdout=subprocess.DEVNULL)
                report = json.loads(output.read_text())
                summaries.append({'label':label,'dataset_sha256':report['dataset_sha256'],
                    'actual_models':','.join(sorted({run['model'] for run in report['runs'] if run.get('model')})),**report['metrics']})
                with (args.output_dir/'summary.csv').open('w',newline='') as handle:
                    writer = csv.DictWriter(handle,fieldnames=list(summaries[0]))
                    writer.writeheader()
                    writer.writerows(summaries)
    print(f"Saved {len(summaries)} reports and {args.output_dir/'summary.csv'}")


if __name__ == '__main__':
    main()
