"""Local annotation workbench. Reviewer identities are self-reported, not authenticated."""
from datetime import date
import hashlib
import json
import re
from uuid import uuid4

from evaluate import validate_item
from extraction import UNKNOWN


def canonical(items):
    return sorted([{'task':i['task'].strip(), 'owner':i['owner'].strip(), 'deadline':i['deadline'],
                    'evidence':sorted(i['evidence'], key=lambda e:(e['start'],e['end']))} for i in items],
                  key=lambda i:json.dumps(i,sort_keys=True))


def validated(items, transcript):
    if not isinstance(items,list) or len(items)>200:
        raise ValueError('Annotations must be a list with at most 200 items')
    result=[]
    for n,item in enumerate(items):
        if not isinstance(item,dict) or not isinstance(item.get('evidence'),list) or any(not isinstance(e,dict) for e in item['evidence']):
            raise ValueError('Each label needs fields and exact evidence objects')
        validate_item(item,transcript)
        if item['deadline'] != UNKNOWN and not re.fullmatch(r'\d{4}-\d{2}-\d{2}',item['deadline']):
            raise ValueError('Deadline must be YYYY-MM-DD or Unknown')
        result.append({'id':f'a{n+1}', **{k:item[k].strip() for k in ('task','owner','deadline')},
                       'evidence':[{k:e[k] for k in ('text','start','end')} for e in item['evidence']]})
    if len(canonical(result)) != len({json.dumps(i,sort_keys=True) for i in canonical(result)}):
        raise ValueError('Duplicate annotations must be merged')
    return result


class AnnotationStore:
    def __init__(self, history):
        self.history=history

    def create(self, transcript, reference_date, source, permission, anonymized, group):
        if source not in ('synthetic','real'):
            raise ValueError('Source must be synthetic or real')
        if permission is not True or anonymized is not True:
            raise ValueError('Confirm permission and a manual anonymization check before importing')
        if not isinstance(transcript,str) or not transcript.strip() or len(transcript)>100000:
            raise ValueError('Transcript must contain 1–100,000 characters')
        if not isinstance(reference_date,str) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}',reference_date):
            raise ValueError('Meeting date must be YYYY-MM-DD')
        date.fromisoformat(reference_date)
        if not isinstance(group,str) or not group.strip() or len(group)>100:
            raise ValueError('Use a source/meeting group to keep related transcripts in one split')
        digest=hashlib.sha256(transcript.encode()).hexdigest()
        with self.history.connection() as conn:
            conn.execute('BEGIN IMMEDIATE')
            frozen_groups={json.loads(p)['group'] for case_id,p in conn.execute("SELECT run_id,payload FROM events WHERE kind='annotation_input' AND run_id IN (SELECT run_id FROM events WHERE kind='annotation_split')")}
            if group.strip() in frozen_groups:
                raise ValueError('This source group already appears in a frozen split; use a genuinely new source group')
            for (payload,) in conn.execute("SELECT payload FROM events WHERE kind='annotation_input'"):
                if json.loads(payload)['transcript_sha256']==digest:
                    raise ValueError('This transcript has already been imported')
            case_id=uuid4().hex
            self.history._append(conn,case_id,'annotation_input',{'transcript':transcript,
                'reference_date':reference_date,'source':source,'group':group.strip(),
                'permission_attested':True,'anonymization_attested':True,'transcript_sha256':digest})
        return self.get(case_id)

    def import_corpus(self, corpus_id, split='all'):
        from corpus_library import corpus_inputs, LIBRARY
        selected=list(LIBRARY) if corpus_id=='all' else [corpus_id]
        # Verify every requested split before opening a write transaction.
        inputs=[row for corpus in selected for row in corpus_inputs(corpus,split)]
        imported=[];existing=[]
        with self.history.connection() as conn:
            conn.execute('BEGIN IMMEDIATE')
            current=[(cid,json.loads(payload)) for cid,payload in conn.execute("SELECT run_id,payload FROM events WHERE kind='annotation_input'")]
            origins={(p['origin']['corpus_id'],p['origin']['case_id']):cid for cid,p in current if p.get('origin')}
            transcripts={(p['transcript_sha256'],p['reference_date']):cid for cid,p in current}
            frozen={cid for (cid,) in conn.execute("SELECT DISTINCT run_id FROM events WHERE kind='annotation_split'")}
            frozen_groups={p['group'] for cid,p in current if cid in frozen}
            for row in inputs:
                origin=row['origin'];source_id=(origin['corpus_id'],origin['case_id'])
                digest=hashlib.sha256(row['transcript'].encode()).hexdigest()
                duplicate=origins.get(source_id) or transcripts.get((digest,row['reference_date']))
                if duplicate:
                    existing.append(duplicate);continue
                group='library:'+origin['corpus_id']
                if group in frozen_groups:
                    raise ValueError('This corpus group is already frozen; import all related inputs before freezing it')
                cid=uuid4().hex
                self.history._append(conn,cid,'annotation_input',{'transcript':row['transcript'],
                    'reference_date':row['reference_date'],'source':'synthetic','group':group,
                    'transcript_sha256':digest,'origin':origin,
                    'permission_basis':'Bundled synthetic project corpus; requested library import',
                    'gold_labels_imported':False})
                imported.append(cid);origins[source_id]=cid;transcripts[(digest,row['reference_date'])]=cid
        return {'imported':len(imported),'existing':len(existing),'case_ids':imported+existing}

    def get(self, case_id):
        if not isinstance(case_id,str) or not re.fullmatch(r'[a-f0-9]{32}',case_id):
            raise ValueError('Invalid annotation case ID')
        events=self.history.get_run(case_id)
        if events[0]['kind']!='annotation_input':
            raise KeyError(case_id)
        reviews=[{'reviewer':e['payload']['reviewer'],'created_at':e['created_at'],
                  'items':e['payload']['items']} for e in events if e['kind']=='annotation_review']
        resolution=next((e['payload'] for e in events if e['kind']=='annotation_resolution'),None)
        disagreement=len(reviews)>=2 and any(canonical(r['items'])!=canonical(reviews[0]['items']) for r in reviews[1:])
        gold=resolution['items'] if resolution else reviews[0]['items'] if len(reviews)>=2 and not disagreement else None
        return {'id':case_id, **events[0]['payload'], 'reviews':reviews,'resolution':resolution,
                'disagreement':disagreement,'gold':gold,'events':events,
                'status':'resolved' if resolution else 'disagreement' if disagreement else 'agreed' if gold is not None else 'needs reviews'}

    def listing(self):
        with self.history.connection() as conn:
            ids=[row[0] for row in conn.execute("SELECT run_id FROM events WHERE kind='annotation_input' ORDER BY event_id DESC")]
        return [{k:c[k] for k in ('id','reference_date','source','group','status','disagreement')} | {'origin':c.get('origin')} |
                {'review_count':len(c['reviews']), 'preview':c['transcript'][:100]} for c in map(self.get,ids)]

    def submit(self, case_id, reviewer, items, independent, reason=None):
        if not isinstance(reviewer,str) or not reviewer.strip() or len(reviewer)>80:
            raise ValueError('Enter a reviewer identity (at most 80 characters)')
        reviewer=reviewer.strip()
        from annotation_drafts import AnnotationDrafts
        AnnotationDrafts(self)
        with self.history.connection() as conn:
            conn.execute('BEGIN IMMEDIATE')
            case=self.get(case_id)
            if any(e['kind']=='annotation_split' for e in case['events']):
                raise ValueError('This case is frozen in an evaluation split')
            if case['resolution']:
                raise ValueError('This case is already resolved')
            clean=validated(items,case['transcript'])
            if reason is not None:
                if len(case['reviews'])<2 or not case['disagreement']:
                    raise ValueError('A resolution requires at least two disagreeing reviews')
                if not isinstance(reason,str) or not reason.strip():
                    raise ValueError('Record why the disagreement was resolved this way')
                kind='annotation_resolution'
                payload={'reviewer':reviewer,'items':clean,'reason':reason.strip()}
            else:
                if independent is not True:
                    raise ValueError('Attest that labels were made without viewing other reviews')
                if any(r['reviewer'].casefold()==reviewer.casefold() for r in case['reviews']):
                    raise ValueError('Each reviewer can submit only one independent review')
                draft=conn.execute("SELECT payload FROM annotation_drafts WHERE case_id=? AND reviewer_key=? AND mode='review'",(case_id,reviewer.casefold())).fetchone()
                if draft and json.loads(draft[0])['state']['comparison_opened']:
                    raise ValueError('This draft has viewed comparison labels; use a separate independent reviewer session')
                kind='annotation_review'
                payload={'reviewer':reviewer,'items':clean,'independent_attested':True}
            self.history._append(conn,case_id,kind,payload)
            conn.execute('DELETE FROM annotation_drafts WHERE case_id=? AND reviewer_key=? AND mode=?',(case_id,reviewer.casefold(),'resolution' if reason is not None else 'review'))
            if kind=='annotation_review' and case['reviews'] and canonical(clean)!=canonical(case['reviews'][0]['items']):
                self.history._append(conn,case_id,'annotation_disagreement',{'reviewers':[case['reviews'][0]['reviewer'],reviewer],
                    'first_labels':canonical(case['reviews'][0]['items']),'other_labels':canonical(clean)})
        return self.get(case_id)

    def freeze(self, seed, test_fraction):
        if not isinstance(seed,str) or not seed.strip():
            raise ValueError('Provide a split seed')
        if type(test_fraction) not in (int,float) or not .1<=test_fraction<=.5:
            raise ValueError('Held-out fraction must be 0.1–0.5')
        with self.history.connection() as conn:
            conn.execute('BEGIN IMMEDIATE')
            all_cases=[self.get(c['id']) for c in self.listing()]
            cases=[c for c in all_cases if c['gold'] is not None and not any(e['kind']=='annotation_split' for e in c['events'])]
            if len(cases)<2 or len({c['group'] for c in cases})<2:
                raise ValueError('Review at least two source groups before freezing a split')
            if any(e['kind']=='annotation_split' for c in cases for e in c['events']):
                raise ValueError('These cases already have a frozen split; export the existing snapshot')
            selected_groups={c['group'] for c in cases}
            if any(c['group'] in selected_groups and c['gold'] is None for c in all_cases):
                raise ValueError('Complete all cases in each selected source group before freezing its split')
            groups=sorted({c['group'] for c in cases},key=lambda g:hashlib.sha256(f'{seed}|{g}'.encode()).hexdigest())
            held=set(groups[:max(1,round(len(groups)*test_fraction))])
            snapshot=uuid4().hex
            for c in cases:
                self.history._append(conn,c['id'],'annotation_split',{'snapshot':snapshot,'seed':seed,
                    'test_fraction':test_fraction,'split':'test' if c['group'] in held else 'dev'})
        return self.export(snapshot)

    def export(self,snapshot):
        rows=[]
        split_settings=None
        for brief in self.listing():
            c=self.get(brief['id'])
            split=next((e['payload'] for e in c['events'] if e['kind']=='annotation_split' and e['payload']['snapshot']==snapshot),None)
            if split:
                split_settings=split
                rows.append({'id':c['id'],'split':split['split'],'transcript':c['transcript'],
                    'reference_date':c['reference_date'],'items':c['gold'],'source':c['source'],'group':c['group'],'origin':c.get('origin'),
                    'annotation_provenance':{'reviewers':[r['reviewer'] for r in c['reviews']], 'submitted_reviews':c['reviews'],
                       'independence':'self-attested; identity not authenticated','resolution':c['resolution']}})
        if not rows:
            raise KeyError(snapshot)
        rows.sort(key=lambda r:r['id'])
        contents={s:''.join(json.dumps(r,ensure_ascii=False)+'\n' for r in rows if r['split']==s) for s in ('dev','test')}
        return {'snapshot':snapshot,'files':contents,'manifest':{'snapshot':snapshot,'seed':split_settings['seed'],'test_fraction':split_settings['test_fraction'],'split_method':'seeded source groups, immutable assignments',
            'sources':{s:sum(r['source']==s for r in rows) for s in ('real','synthetic')},
            'files':{s:{'sha256':hashlib.sha256(t.encode()).hexdigest(),'cases':sum(r['split']==s for r in rows)} for s,t in contents.items()}}}
