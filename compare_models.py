"""Repeat a model × prompt matrix, retain each run and aggregate variation."""
import argparse
import csv
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys
from experiment_summary import write_summary

ROOT = Path(__file__).resolve().parent


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config',type=Path)
    parser.add_argument('--split',choices=['dev','test'],default='dev')
    parser.add_argument('--dataset',type=Path,help='Use a reviewed export or versioned corpus')
    parser.add_argument('--output-dir',type=Path,required=True)
    parser.add_argument('--summarize-only',action='store_true')
    args=parser.parse_args()
    if args.summarize_only:
        write_summary(args.output_dir);return
    if not args.config: parser.error('--config is required')
    config=json.loads(args.config.read_text())
    models=config['models'];prompts=config.get('prompts',['v1','v2']);repeats=config.get('repeats',3)
    if type(repeats) is not int or repeats<1 or not models or not prompts or len(set(prompts))!=len(prompts) or any(p not in {'v1','v2'} for p in prompts):
        parser.error('Require models, distinct v1/v2 prompts, and a positive repeat count')
    labels=[m['label'] for m in models]
    if len(set(labels))!=len(labels) or any(not re.fullmatch(r'[A-Za-z0-9_-]+',label) for label in labels):
        parser.error('Use unique alphanumeric model labels with underscores/hyphens')
    # Preflight all destinations before spending time on model calls.
    outputs=[args.output_dir/f"{m['label']}-{p}-{n+1}-{args.split}.json" for m in models for p in prompts for n in range(repeats)]
    if any(p.exists() for p in outputs): parser.error('A report already exists; choose a new output directory')
    args.output_dir.mkdir(parents=True,exist_ok=True)
    config_sha=hashlib.sha256(args.config.read_bytes()).hexdigest()
    # Interleave models and prompts by repeat to reduce systematic warm-up/order bias.
    summaries=[]
    for n in range(repeats):
        for model in models:
            for prompt in prompts:
                label=f"{model['label']}-{prompt}-{n+1}"
                output=args.output_dir/f'{label}-{args.split}.json'
                command=[sys.executable,str(ROOT/'evaluate.py'),'--extractor','llm','--split',args.split,
                    '--prompt',prompt,'--label',label,'--llm-command',model['command'],'--timeout',str(config.get('timeout_seconds',60)),
                    '--output',str(output.resolve())]
                if args.dataset:command.extend(['--dataset',str(args.dataset.resolve())])
                for key in ('input_usd_per_million','output_usd_per_million'):
                    if key in model:command.extend(['--'+key.replace('_','-'),str(model[key])])
                print(f'Running {label}',flush=True)
                subprocess.run(command,check=True,cwd=ROOT,stdout=subprocess.DEVNULL)
                report=json.loads(output.read_text())
                report.update({'matrix_model':model['label'],'repeat':n+1,'matrix_config_sha256':config_sha,'runner_command':model['command']})
                output.write_text(json.dumps(report,indent=2)+'\n')
                summaries.append({'label':label,'repeat':n+1,'dataset_sha256':report['dataset_sha256'],**report['metrics']})
                with (args.output_dir/'summary.csv').open('w',newline='') as handle:
                    writer=csv.DictWriter(handle,fieldnames=list(summaries[0]));writer.writeheader();writer.writerows(summaries)
                write_summary(args.output_dir)
    print(f'Saved {len(summaries)} reports, summary.csv and repeat-summary.json')


if __name__=='__main__': main()
