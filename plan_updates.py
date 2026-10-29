"""Reviewed follow-up plans. Absence is never a cancellation; old plans stay immutable."""
from copy import deepcopy
from dataclasses import asdict
from datetime import date
import hashlib
import json
import re
from pathlib import Path

from data_controls import DataError, identifier
from extraction import (CANCEL, REVISE, UNKNOWN, conditional_commitment, extract_action_items,
                        has_ambiguous_deadline, normalize_task, parse_deadline, passages,
                        same_speaker, strip_task_timing, task_reference_matches)
from task_progress import project as progress
from task_deadlines import project as deadlines, effective_tasks

FIELDS = ('task', 'owner', 'deadline')


def events_in(conn, run_id):
    rows = conn.execute('SELECT kind,payload FROM events WHERE run_id=? ORDER BY event_id', (run_id,)).fetchall()
    events = [{'kind': kind, 'payload': json.loads(payload), 'created_at': ''} for kind, payload in rows]
    if not events or events[0]['kind'] != 'extraction':
        raise KeyError(run_id)
    return events


def current_base(events):
    final = next((e['payload']['tasks'] for e in events if e['kind'] == 'final'), None)
    if final is None:
        raise DataError('Confirm this plan before comparing a follow-up.', 409)
    if any(e['kind'] == 'plan_superseded' for e in events):
        raise DataError('A newer plan has replaced this version. Open the latest plan before comparing another follow-up.', 409)
    return effective_tasks(events)


def compare(tasks, followup, reference, offset):
    slots = [{'before': deepcopy(t), 'after': deepcopy(t), 'evidence': []} for t in tasks]
    warnings, previous = [], None
    for body, speaker, span in passages(followup):
        support = {'text': span.text, 'start': offset + span.start, 'end': offset + span.end}
        if conditional_commitment(body):
            previous = None
            continue
        cancel, revise = CANCEL.match(body.strip()), REVISE.match(body.strip())
        if cancel or revise:
            target = (cancel or revise).group(1).strip(' .!?')
            if re.fullmatch(r'(?:that|it|that task|that deadline)', target, re.I):
                candidates = [previous] if previous and previous['after'] and (not speaker or same_speaker(speaker,previous['after']['owner'])) else []
            else:
                candidates = [s for s in slots if s['after'] and task_reference_matches(target,s['after']['task'],s['after']['owner'],speaker)]
            if len(candidates) != 1:
                warnings.append({'message': 'This reference did not identify one task. Existing tasks were kept; check the passage manually.', 'evidence': [support]})
                previous = None
                continue
            slot = candidates[0]
            slot['evidence'].append(support)
            if cancel:
                slot['after'] = None
                previous = None
            else:
                deadline = parse_deadline('by ' + revise.group(2), reference)
                slot['after']['deadline'] = deadline.isoformat() if deadline else UNKNOWN
                slot['after']['evidence'].append(support)
                previous = slot
            continue
        previous = None
        statement = re.sub(r'^Actually,?\s+', '', body.strip(), flags=re.I)
        found = extract_action_items(f'{speaker}: {statement}' if speaker else statement, reference)
        for item in found:
            after = {key: asdict(item)[key] for key in ('proposal_id', *FIELDS)} | {'evidence': [support]}
            ambiguous_date = has_ambiguous_deadline(statement)
            matching_task = lambda task: normalize_task(strip_task_timing(task) if ambiguous_date else task)
            candidates = [s for s in slots if (s['after'] or s['before']) and matching_task((s['after'] or s['before'])['task']) == matching_task(after['task'])]
            if len(candidates) == 1:
                slot = candidates[0]
                old = slot['after']
                after['proposal_id'] = (old or slot['before'])['proposal_id']
                if old:
                    for key in ('owner', 'deadline'):
                        explicit_invalid_date=key=='deadline' and re.search(r'\b(?:by|before|due(?: on)?|on)\s+20\d{2}[-/]\d{1,2}[-/]\d{1,2}',statement,re.I)
                        if after[key] == UNKNOWN and not explicit_invalid_date and not (key=='deadline' and ambiguous_date):
                            after[key] = old[key]
                    after['evidence'] = old['evidence'] + [support]
                slot['after'] = after
                slot['evidence'].append(support)
            else:
                if candidates:
                    warnings.append({'message': 'Several existing tasks have this wording. The new suggestion is separate; check for duplication.', 'evidence': [support]})
                seed=f'{support["start"]}|{len(slots)}|{after["proposal_id"]}'
                used={(s['after'] or s['before'])['proposal_id'] for s in slots if s['after'] or s['before']}
                after['proposal_id']='update-'+hashlib.sha256(seed.encode()).hexdigest()[:16]
                while after['proposal_id'] in used:
                    seed+='x'
                    after['proposal_id']='update-'+hashlib.sha256(seed.encode()).hexdigest()[:16]
                slot = {'before': None, 'after': after, 'evidence': [support]}
                slots.append(slot)
            previous = slot
    rows = []
    for slot in slots:
        before, after = slot['before'], slot['after']
        if before is None and after is None:
            continue  # A newly mentioned action cancelled in this same follow-up.
        kind = 'added' if before is None else 'cancelled' if after is None else 'changed' if any(before[k] != after[k] for k in FIELDS) else 'unchanged'
        if before and after:
            if before['deadline'] == after['deadline'] and before.get('deadline_correction'):
                after['deadline_correction'] = deepcopy(before['deadline_correction'])
            else:
                after.pop('deadline_correction', None)
        if before and after and before.get('source') == 'manual':
            after['source'] = 'manual'
        rows.append({**slot, 'kind': kind, 'change_id': (before or after)['proposal_id']})
    if len(rows) > 200:
        raise DataError('A plan comparison supports at most 200 tasks. Use a smaller plan or follow-up.', 413)
    return rows, warnings


def create(history, base_run_id, transcript, reference_date, request_id):
    identifier(base_run_id)
    identifier(request_id)
    if not isinstance(transcript, str) or not transcript.strip() or len(transcript) > 100_000:
        raise DataError('Enter a follow-up transcript of at most 100,000 characters.', 400)
    if not isinstance(reference_date, str) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}', reference_date):
        raise DataError('Follow-up date must use YYYY-MM-DD.', 400)
    reference = date.fromisoformat(reference_date)
    fingerprint = hashlib.sha256(json.dumps(['plan-update-v1', base_run_id, transcript, reference_date], ensure_ascii=False).encode()).hexdigest()
    if history.existing_analysis(request_id, fingerprint):
        return request_id
    with history.connection() as conn:
        conn.execute('BEGIN IMMEDIATE')
        # Recheck under the same account write lock as erasure/confirmation.
        if conn.execute('SELECT run_id FROM events WHERE run_id=?', (request_id,)).fetchone():
            row = events_in(conn, request_id)[0]['payload']
            if row.get('settings', {}).get('request_fingerprint') != fingerprint:
                raise DataError('This request ID belongs to different input.', 409)
            return request_id
        events = events_in(conn, base_run_id)
        tasks = current_base(events)
        original = events[0]['payload']
        if reference_date < original['reference_date']:
            raise DataError('The follow-up date must be on or after the previous meeting date.', 400)
        prefix = original['transcript'] + f'\n\n--- Follow-up meeting: {reference_date} ---\n'
        combined = prefix + transcript
        if len(combined) > 100_000:
            raise DataError('The combined plan history exceeds 100,000 characters. Start a separate meeting.', 413)
        rows, warnings = compare(tasks, transcript, reference, len(prefix))
        name = next((e['payload']['title'] for e in reversed(events) if e['kind'] == 'meeting_title'), original.get('title', ''))
        title = ((name or 'Meeting ' + original['reference_date'])[:90] + ' · Update ' + reference_date)[:120]
        update = {'base_run_id': base_run_id, 'followup_start': len(prefix), 'rows': rows, 'warnings': warnings,
                  'base_deadline_versions': {key:value['version'] for key,value in deadlines(events).items()}}
        components = {name: hashlib.sha256(Path(__file__).with_name(name).read_bytes()).hexdigest() for name in ('plan_updates.py','extraction.py')}
        fingerprint_rules = hashlib.sha256(json.dumps(components,sort_keys=True).encode()).hexdigest()
        payload = {'title': title, 'transcript': combined, 'reference_date': reference_date,
                   'proposals': [r['after'] or r['before'] for r in rows],
                   'settings': {'extractor': 'plan-update-rules-v2', 'extractor_sha256': fingerprint_rules, 'extractor_components': components, 'clusters': original.get('settings', {}).get('clusters', 3),
                                'request_fingerprint': fingerprint, 'plan_update': update}}
        if len(json.dumps(payload).encode()) > 3_000_000:
            raise DataError('The comparison is too large. Start a smaller separate meeting.', 413)
        history._append(conn, request_id, 'extraction', payload)
    return request_id


def review_state(events):
    return next((e['payload'] for e in reversed(events) if e['kind'] == 'plan_update_draft'), {'version': 0, 'decisions': []})


def clean_decisions(rows, decisions, *, final=False):
    editable = {r['change_id']: r for r in rows if r['kind'] != 'unchanged'}
    if not isinstance(decisions, list) or len(decisions) != len(editable) or any(not isinstance(d, dict) for d in decisions):
        raise DataError('Review each proposed change exactly once.', 400)
    if any(not isinstance(d.get('change_id'), str) for d in decisions) or {d['change_id'] for d in decisions} != set(editable):
        raise DataError('Review each proposed change exactly once.', 400)
    result = []
    for d in decisions:
        row = editable[d['change_id']]
        if type(d.get('apply')) is not bool:
            raise DataError('Choose explicitly whether to apply a change.', 400)
        clean = {'change_id': d['change_id'], 'apply': d['apply']}
        for key in FIELDS:
            value = d.get(key, (row['after'] or row['before'])[key])
            if not isinstance(value, str) or len(value) > 10000:
                raise DataError('Invalid review field.', 400)
            if final and d['apply'] and row['after']:
                value = value.strip()
                if not value:
                    raise DataError('Task, owner, and deadline cannot be empty. Use Unknown for missing metadata.', 400)
                if key == 'deadline' and value != UNKNOWN:
                    if not re.fullmatch(r'\d{4}-\d{2}-\d{2}', value):
                        raise DataError('Deadlines must be YYYY-MM-DD or Unknown.', 400)
                    date.fromisoformat(value)
            clean[key] = value
        result.append(clean)
    return sorted(result, key=lambda d: d['change_id'])


def save_review(history, run_id, decisions, version, *, confirm=False):
    identifier(run_id)
    with history.connection() as conn:
        conn.execute('BEGIN IMMEDIATE')
        events = events_in(conn, run_id)
        update = events[0]['payload'].get('settings', {}).get('plan_update')
        if not update:
            raise DataError('This meeting is not a follow-up comparison.', 409)
        clean = clean_decisions(update['rows'], decisions, final=confirm)
        fingerprint = hashlib.sha256(json.dumps(clean, sort_keys=True).encode()).hexdigest()
        confirmed = next((e['payload'] for e in events if e['kind'] == 'plan_update_review'), None)
        if confirmed:
            if confirm and confirmed['fingerprint'] == fingerprint:
                return  # Lost-response retry of this exact confirmed review.
            raise DataError('This updated plan is already confirmed.', 409)
        current = review_state(events)['version']
        if type(version) is not int or version != current:
            raise DataError('The comparison review changed in another tab. Reload it before editing.', 409)
        if not confirm:
            history._append(conn, run_id, 'plan_update_draft', {'version': current + 1, 'decisions': clean})
            return
        base_events = events_in(conn, update['base_run_id'])
        current_base(base_events)
        expected = update.get('base_deadline_versions', {})
        if any(value['version'] != expected.get(key, 0) for key,value in deadlines(base_events).items()):
            raise DataError('A deadline was corrected after this comparison began. Start a new follow-up comparison from the latest plan.', 409)
        states = progress(base_events)
        by_id = {d['change_id']: d for d in clean}
        final_tasks = []
        for row in update['rows']:
            d = by_id.get(row['change_id'])
            task = deepcopy(row['after'] if d and d['apply'] else row['before'])
            if task is None:
                continue
            if d and d['apply']:
                task.update({key: d[key] for key in FIELDS})
                if row['before'] and task['deadline'] != row['before']['deadline']:
                    task.pop('deadline_correction', None)
                elif row['before'] and row['before'].get('deadline_correction'):
                    task['deadline_correction'] = deepcopy(row['before']['deadline_correction'])
            from evaluate import validate_item
            validate_item(task, events[0]['payload']['transcript'])
            final_tasks.append(task)
        history._append(conn, run_id, 'plan_update_review', {'decisions': clean, 'fingerprint': fingerprint, 'base_run_id': update['base_run_id']})
        history._append(conn, run_id, 'final', {'tasks': final_tasks})
        for task in final_tasks:
            state = states.get(task['proposal_id'], {'status': 'todo'})
            if state['status'] != 'todo':
                history._append(conn, run_id, 'task_progress', {'proposal_id': task['proposal_id'], 'before': 'todo', 'after': state['status'],
                                'base_version': 0, 'version': 1, 'request_id': hashlib.sha256(f'{run_id}|{task["proposal_id"]}'.encode()).hexdigest()[:32], 'carried_from': update['base_run_id']})
        history._append(conn, update['base_run_id'], 'plan_superseded', {'run_id': run_id})
