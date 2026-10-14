"""Versioned follow-through events; confirmed tasks and evidence remain immutable."""
import json
import re
from data_controls import DataError, identifier

STATUSES = ('todo', 'in_progress', 'done')

def project(events):
    tasks = next((e['payload']['tasks'] for e in events if e['kind']=='final'), [])
    result = {t['proposal_id']:{'status':'todo','version':0} for t in tasks}
    for event in events:
        if event['kind']=='task_progress':
            p=event['payload']
            if p['proposal_id'] in result:
                result[p['proposal_id']]={'status':p['after'],'version':p['version'],'updated_at':event['created_at']}
    return result

def update(history, run_id, proposal_id, status, version, request_id):
    identifier(run_id)
    if not isinstance(proposal_id,str) or not 1<=len(proposal_id)<=128:
        raise DataError('Invalid task ID.',400)
    if status not in STATUSES or type(version) is not int or version<0:
        raise DataError('Use a valid task status and version.',400)
    if not isinstance(request_id,str) or not re.fullmatch(r'[a-f0-9]{32}',request_id):
        raise DataError('Use a stable request ID for task progress.',400)
    with history.connection() as conn:
        conn.execute('BEGIN IMMEDIATE')
        rows=conn.execute('SELECT kind,payload FROM events WHERE run_id=? ORDER BY event_id',(run_id,)).fetchall()
        if not rows or rows[0][0]!='extraction':raise KeyError(run_id)
        events=[{'kind':k,'payload':json.loads(p),'created_at':''} for k,p in rows]
        states=project(events)
        if not any(e['kind']=='final' for e in events):raise DataError('Confirm the plan before tracking tasks.',409)
        if proposal_id not in states:raise DataError('This task is not in the confirmed plan.',404)
        prior=next((e['payload'] for e in events if e['kind']=='task_progress' and e['payload']['request_id']==request_id),None)
        if prior:
            if (prior['proposal_id'],prior['after'],prior['base_version'])!=(proposal_id,status,version):
                raise DataError('This progress request ID belongs to another change.',409)
            return  # A lost-response retry never overwrites newer progress.
        current=states[proposal_id]
        if current['version']!=version:raise DataError('Task progress changed in another tab. Refresh progress before trying again.',409)
        if current['status']==status:return
        history._append(conn,run_id,'task_progress',{'proposal_id':proposal_id,'before':current['status'],'after':status,
            'base_version':version,'version':version+1,'request_id':request_id})
