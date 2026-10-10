"""LLM benchmark adapter for an existing local Ollama model.

Protocol: JSON request on stdin, JSON response on stdout. No model downloads.
API reference: https://docs.ollama.com/api/generate
"""
import argparse
import json
import hashlib
from pathlib import Path
import re
import sys
from urllib.request import Request, urlopen

SCHEMA = {'type':'object','required':['items'],'additionalProperties':False,'properties':{
    'items':{'type':'array','items':{'type':'object','required':['task','owner','deadline','evidence'],
        'additionalProperties':False,'properties':{
            'task':{'type':'string'},'owner':{'type':'string'},'deadline':{'type':'string'},
            'evidence':{'type':'array','minItems':1,'items':{'type':'object','required':['text'],
                'additionalProperties':False,'properties':{'text':{'type':'string','minLength':1}}}}}}}}}


def generate(request, model, url='http://127.0.0.1:11434', timeout=55):
    payload = {'model':model,'system':request['prompt']+'\nRunner-specific evidence contract: output exact quote text only. A deterministic adapter calculates start/end offsets from these quotes; do not count characters yourself.',
               'prompt':json.dumps({'reference_date':request['reference_date'],'transcript':request['transcript'],'output_schema':SCHEMA},ensure_ascii=False),
               'format':SCHEMA,'stream':False,'options':{'temperature':0,'seed':42}}
    http = Request(url.rstrip('/')+'/api/generate',data=json.dumps(payload).encode(),headers={'Content-Type':'application/json'})
    with urlopen(http,timeout=timeout) as response:
        raw = json.load(response)
    if not raw.get('done') or raw.get('done_reason') == 'length':
        raise ValueError('Incomplete generation')
    result = json.loads(raw['response'])
    result['raw_model_response'] = raw['response']
    for item in result['items']:
        evidence = []
        for passage in item['evidence']:
            quote = passage['text']
            if not quote or quote not in request['transcript']:
                raise ValueError('Model quote is not in the transcript')
            for match in re.finditer(re.escape(quote),request['transcript']):
                span = {'text':quote,'start':match.start(),'end':match.end()}
                if span not in evidence:
                    evidence.append(span)
        item['evidence'] = evidence
    result['model'] = raw['model']
    result['usage'] = {'input_tokens':raw.get('prompt_eval_count'),'output_tokens':raw.get('eval_count')}
    result['provider_duration_ns'] = raw.get('total_duration')
    result['runner_sha256'] = hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
    result['generation_options'] = payload['options']
    # API fee only; hardware/electricity costs are not measured.
    result['cost_usd'] = 0.0
    result['cost_basis'] = 'local API fee only; compute cost excluded'
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--model',required=True)
    parser.add_argument('--url',default='http://127.0.0.1:11434')
    parser.add_argument('--timeout',type=float,default=55)
    args = parser.parse_args()
    json.dump(generate(json.load(sys.stdin),args.model,args.url,args.timeout),sys.stdout)


if __name__ == '__main__':
    main()
