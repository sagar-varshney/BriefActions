"""Audited deadline overrides; extraction, evidence and confirmed events stay intact."""
from copy import deepcopy
from datetime import date
import json
import re

from data_controls import DataError, identifier


def project(events):
    tasks = next((e['payload']['tasks'] for e in events if e['kind'] == 'final'), [])
    result = {t['proposal_id']: {'deadline': t['deadline'], 'version': 0} for t in tasks}
    for event in events:
        if event['kind'] == 'task_deadline':
            p = event['payload']
            if p['proposal_id'] in result:
                result[p['proposal_id']] = {'deadline': p['after'], 'version': p['version'],
                    'reason': p['reason'], 'before': p['before'], 'updated_at': event['created_at']}
    return result


def effective_tasks(events):
    tasks = next((e['payload']['tasks'] for e in events if e['kind'] == 'final'), None)
    if tasks is None:
        return None
    result = deepcopy(tasks)
    states = project(events)
    for task in result:
        state = states[task['proposal_id']]
        if state['version']:
            task['deadline_correction'] = {**state, 'confirmed_deadline': task['deadline']}
            task['deadline'] = state['deadline']
    return result


def update(history, run_id, proposal_id, deadline, reason, version, request_id):
    identifier(run_id)
    if not isinstance(proposal_id, str) or not re.fullmatch(r'[a-zA-Z0-9_-]{1,128}', proposal_id):
        raise DataError('Invalid task ID.', 400)
    if not isinstance(deadline, str):
        raise DataError('Use a real date in YYYY-MM-DD format, or Unknown.', 400)
    deadline = deadline.strip()
    if deadline != 'Unknown':
        try:
            if not re.fullmatch(r'\d{4}-\d{2}-\d{2}', deadline):
                raise ValueError()
            date.fromisoformat(deadline)
        except ValueError:
            raise DataError('Use a real date in YYYY-MM-DD format, or Unknown.', 400) from None
    if not isinstance(reason, str) or not 1 <= len(reason.strip()) <= 500:
        raise DataError('Give a reason for the correction (1–500 characters).', 400)
    reason = reason.strip()
    if type(version) is not int or version < 0:
        raise DataError('Use the saved deadline version.', 400)
    if not isinstance(request_id, str) or not re.fullmatch(r'[a-f0-9]{32}', request_id):
        raise DataError('Use a stable request ID for the deadline correction.', 400)
    with history.connection() as conn:
        conn.execute('BEGIN IMMEDIATE')
        rows = conn.execute('SELECT kind,payload FROM events WHERE run_id=? ORDER BY event_id', (run_id,)).fetchall()
        if not rows or rows[0][0] != 'extraction':
            raise KeyError(run_id)
        events = [{'kind': k, 'payload': json.loads(p), 'created_at': ''} for k, p in rows]
        if not any(e['kind'] == 'final' for e in events):
            raise DataError('Confirm the plan before correcting a deadline.', 409)
        states = project(events)
        if proposal_id not in states:
            raise DataError('This task is not in the confirmed plan.', 404)
        prior = next((e['payload'] for e in events if e['kind'] == 'task_deadline' and e['payload']['request_id'] == request_id), None)
        if prior:
            if (prior['proposal_id'], prior['after'], prior['reason'], prior['base_version']) != (proposal_id, deadline, reason, version):
                raise DataError('This deadline request ID belongs to another correction.', 409)
            return  # Recover a lost response without rolling back a later correction.
        if any(e['kind'] == 'plan_superseded' for e in events):
            raise DataError('This is an earlier plan version. Open the latest plan to correct deadlines.', 409)
        current = states[proposal_id]
        if current['version'] != version:
            raise DataError('This deadline changed in another tab. Refresh the saved tasks before trying again.', 409)
        if current['deadline'] == deadline:
            raise DataError('Choose a different deadline, or cancel the correction.', 400)
        history._append(conn, run_id, 'task_deadline', {'proposal_id': proposal_id,
            'before': current['deadline'], 'after': deadline, 'reason': reason,
            'base_version': version, 'version': version + 1, 'request_id': request_id})
