"""Editable follow-up messages, separate from confirmed tasks and transcript evidence."""
import hashlib
import json
import re

from data_controls import DataError, identifier
from task_deadlines import effective_tasks
from task_progress import project


def revision(events):
    title = next((e['payload']['title'] for e in reversed(events) if e['kind']=='meeting_title'), events[0]['payload'].get('title',''))
    # Only message inputs affect freshness; saving a draft does not invalidate itself.
    source = [title, events[0]['payload']['reference_date'], effective_tasks(events), project(events),
              any(e['kind']=='plan_superseded' for e in events)]
    return hashlib.sha256(json.dumps(source,sort_keys=True,ensure_ascii=False).encode()).hexdigest()


def save(history, run_id, *, subject=None, body=None, version=None, source_revision=None, request_id=None):
    identifier(run_id)
    if not isinstance(subject,str) or not 1<=len(subject.strip())<=300 or '\n' in subject or '\r' in subject:
        raise DataError('Give the follow-up a single-line subject (up to 300 characters).',400)
    if not isinstance(body,str) or not 1<=len(body.strip())<=100_000:
        raise DataError('Write a follow-up message (up to 100,000 characters).',400)
    if type(version) is not int or not 0<=version<=1_000_000:
        raise DataError('Use the saved follow-up draft version.',400)
    if not isinstance(source_revision,str) or not re.fullmatch(r'[a-f0-9]{64}',source_revision):
        raise DataError('Use the task details attached to this draft.',400)
    identifier(request_id)
    fields=dict(subject=subject,body=body,source_revision=source_revision,base_version=version)
    with history.connection() as conn:
        conn.execute('BEGIN IMMEDIATE')
        rows=conn.execute('SELECT kind,payload,created_at FROM events WHERE run_id=? ORDER BY event_id',(run_id,)).fetchall()
        if not rows or rows[0][0]!='extraction':raise KeyError(run_id)
        events=[dict(kind=kind,payload=json.loads(payload),created_at=stamp) for kind,payload,stamp in rows]
        drafts=[e['payload'] for e in events if e['kind']=='followup_draft']
        prior=next((d for d in drafts if d['request_id']==request_id),None)
        if prior:
            if any(prior[k]!=value for k,value in fields.items()):
                raise DataError('This follow-up request ID belongs to another edit.',409)
            return prior  # Recover a lost response without rolling back later drafts.
        if not any(e['kind']=='final' for e in events):
            raise DataError('Confirm the plan before drafting a follow-up.',409)
        if any(e['kind']=='plan_superseded' for e in events):
            raise DataError('This is an earlier plan. Open the latest plan to draft a follow-up.',409)
        current=drafts[-1]['version'] if drafts else 0
        if current!=version:raise DataError('The follow-up draft changed in another tab. Reload the saved draft before continuing.',409)
        if revision(events)!=source_revision:
            raise DataError('Task details changed. Refresh the meeting and check the draft against the current tasks.',409)
        value=fields|dict(version=current+1,request_id=request_id)
        history._append(conn,run_id,'followup_draft',value)
    return value
