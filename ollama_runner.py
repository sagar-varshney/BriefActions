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
            'task':{'type':'string'},'owner':{'type':'string'},
            'deadline':{'type':'string','pattern':r'^(Unknown|\d{4}-\d{2}-\d{2})$','description':'An ISO YYYY-MM-DD date or the literal Unknown'},
            'evidence':{'type':'array','minItems':1,'items':{'type':'object','required':['text'],
                'additionalProperties':False,'properties':{'text':{'type':'string','minLength':1}}}}}}}}}


def generate(request, model, url='http://127.0.0.1:11434', timeout=55):
    payload = {'model':model,'system':request['prompt']+'\nRunner-specific evidence contract: output exact quote text only. A deterministic adapter calculates start/end offsets from these quotes; do not count characters yourself.',
               'prompt':json.dumps({'reference_date':request['reference_date'],'transcript':request['transcript'],'output_schema':SCHEMA,
                   'field_contract':{'task':'concise task description','owner':'explicitly assigned name or Unknown','deadline':'YYYY-MM-DD or Unknown','evidence':'exact original quote text; offsets supplied by runner'}},ensure_ascii=False),
               'format':SCHEMA,'stream':False,'options':{'temperature':0,'seed':42,'num_predict':1024}}
    http = Request(url.rstrip('/')+'/api/generate',data=json.dumps(payload).encode(),headers={'Content-Type':'application/json'})
    with urlopen(http,timeout=timeout) as response:
        raw = json.load(response)
    metadata = {'model':raw['model'],'usage':{'input_tokens':raw.get('prompt_eval_count'),'output_tokens':raw.get('eval_count')},
        'provider_duration_ns':raw.get('total_duration'),'raw_model_response':raw['response'],
        'runner_sha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),'generation_options':payload['options'],
        'cost_usd':0.0,'cost_basis':'local API fee only; compute cost excluded'}
    if not raw.get('done') or raw.get('done_reason') == 'length':
        return {**metadata,'items':[],'error':'Incomplete generation'}
    try:
        result = json.loads(raw['response'])
    except json.JSONDecodeError:
        return {**metadata,'items':[],'error':'Model did not return valid JSON'}
    for item in result['items']:
        evidence = []
        for passage in item['evidence']:
            quote = passage['text']
            if not quote or quote not in request['transcript']:
                # Keep the failed output for inspection; contract validation rejects it.
                evidence.append({'text':quote,'start':-1,'end':-1})
                result['grounding_error'] = 'Model quote is not in the transcript'
                continue
            for match in re.finditer(re.escape(quote),request['transcript']):
                span = {'text':quote,'start':match.start(),'end':match.end()}
                if span not in evidence:
                    evidence.append(span)
        item['evidence'] = evidence
    return {**result,**metadata}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--model',required=True)
    parser.add_argument('--url',default='http://127.0.0.1:11434')
    parser.add_argument('--timeout',type=float,default=55)
    args = parser.parse_args()
    json.dump(generate(json.load(sys.stdin),args.model,args.url,args.timeout),sys.stdout)


if __name__ == '__main__':
    main()
