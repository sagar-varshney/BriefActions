"""Mutable unfinished labels, isolated from submitted annotation review events."""
from datetime import datetime, timezone
import json
import re


class DraftConflict(ValueError):
    pass


def reviewer_key(reviewer):
    if not isinstance(reviewer,str) or not reviewer.strip() or len(reviewer)>80:
        raise ValueError('Enter a reviewer identity (at most 80 characters)')
    return reviewer.strip().casefold()


def evidence(value, transcript):
    if not isinstance(value,dict):
        raise ValueError('Evidence must be an object')
    start,end=value.get('start'),value.get('end')
    if type(start) is not int or type(end) is not int or not 0<=start<end<=len(transcript) or transcript[start:end]!=value.get('text'):
        raise ValueError('Draft passages must quote the transcript exactly')
    return {'text':value['text'],'start':start,'end':end}


def draft_state(state, transcript):
    if not isinstance(state,dict):
        raise ValueError('Draft state must be an object')
    clean={}
    for name in ('task','owner','deadline','reason'):
        value=state.get(name,'Unknown' if name in ('owner','deadline') else '')
        if not isinstance(value,str) or len(value)>10000:
            raise ValueError('Draft fields must be strings of at most 10,000 characters')
        clean[name]=value
    if type(state.get('comparison_opened',False)) is not bool:
        raise ValueError('Invalid comparison state')
    clean['comparison_opened']=state.get('comparison_opened',False)
    clean['selection']=evidence(state['selection'],transcript) if state.get('selection') is not None else None
    items=state.get('items',[])
    if not isinstance(items,list) or len(items)>200:
        raise ValueError('Draft must contain at most 200 labels')
    clean['items']=[]
    for item in items:
        if not isinstance(item,dict) or not isinstance(item.get('evidence'),list) or len(item['evidence'])>200:
            raise ValueError('Draft labels need fields and supporting passage objects')
        fields={}
        for name in ('task','owner','deadline'):
            value=item.get(name)
            if not isinstance(value,str) or len(value)>10000:
                raise ValueError('Draft label fields must be strings')
            fields[name]=value
        clean['items'].append({**fields,'evidence':[evidence(e,transcript) for e in item['evidence']]})
    return clean


class AnnotationDrafts:
    def __init__(self,annotations):
        self.annotations=annotations
        self.history=annotations.history
        with self.history.connection() as conn:
            conn.execute('''CREATE TABLE IF NOT EXISTS annotation_drafts (
                case_id TEXT NOT NULL, reviewer_key TEXT NOT NULL, mode TEXT NOT NULL,
                version INTEGER NOT NULL, updated_at TEXT NOT NULL, payload TEXT NOT NULL,
                PRIMARY KEY(case_id,reviewer_key,mode))''')

    def identity(self,case_id,reviewer,mode):
        if mode not in ('review','resolution'):
            raise ValueError('Draft mode must be review or resolution')
        if not isinstance(case_id,str) or not re.fullmatch(r'[a-f0-9]{32}',case_id):
            raise ValueError('Invalid annotation case ID')
        return (case_id,reviewer_key(reviewer),mode)

    def get(self,case_id,reviewer,mode='review'):
        key=self.identity(case_id,reviewer,mode)
        self.annotations.get(case_id)
        with self.history.connection() as conn:
            row=conn.execute('SELECT version,updated_at,payload FROM annotation_drafts WHERE case_id=? AND reviewer_key=? AND mode=?',key).fetchone()
        return {'version':row[0],'updated_at':row[1],**json.loads(row[2])} if row else None

    def save(self,case_id,reviewer,mode,state,version,client_id,edit_id):
        key=self.identity(case_id,reviewer,mode)
        if not isinstance(client_id,str) or not 1<=len(client_id)<=80 or type(edit_id) is not int or edit_id<1:
            raise ValueError('Invalid draft client metadata')
        with self.history.connection() as conn:
            conn.execute('BEGIN IMMEDIATE')
            case=self.annotations.get(case_id)
            if case['resolution'] or any(e['kind']=='annotation_split' for e in case['events']):
                raise DraftConflict('This case is resolved or frozen; unfinished labels cannot change it')
            if mode=='review' and any(r['reviewer'].casefold()==key[1] for r in case['reviews']):
                raise DraftConflict('This reviewer already submitted an immutable review')
            if mode=='resolution' and not case['disagreement']:
                raise DraftConflict('A resolution draft requires disagreeing submitted reviews')
            row=conn.execute('SELECT version FROM annotation_drafts WHERE case_id=? AND reviewer_key=? AND mode=?',key).fetchone()
            current=row[0] if row else 0
            if type(version) is not int or version!=current:
                raise DraftConflict('Draft changed in another tab. Reopen it before restoring your browser copy.')
            payload={'state':draft_state(state,case['transcript']),'client_id':client_id,'edit_id':edit_id}
            stamp=datetime.now(timezone.utc).isoformat()
            conn.execute('''INSERT INTO annotation_drafts VALUES (?,?,?,?,?,?)
                ON CONFLICT(case_id,reviewer_key,mode) DO UPDATE SET
                version=excluded.version,updated_at=excluded.updated_at,payload=excluded.payload''',
                (*key,current+1,stamp,json.dumps(payload)))
        return {'version':current+1,'updated_at':stamp,**payload}
