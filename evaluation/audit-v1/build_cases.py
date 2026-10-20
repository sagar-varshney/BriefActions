"""Hand-specified development labels, authored before running audit predictions.

This only calculates exact quote offsets and the manifest; it never imports the
extractor or derives labels from its output. No held-out accuracy is claimed.
"""
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
CASES = [
    ('smart-i', '2026-10-20', 'Maya: I’ll send the launch brief tomorrow.', [('send the launch brief', 'Maya', '2026-10-21', [0])]),
    ('smart-negative', '2026-10-20', 'Maya: I won’t deploy the patch tomorrow.', []),
    ('smart-two-turns', '2028-02-28', 'Ada: I’ll review the budget tomorrow.\nAda: I’ll send the notes by Friday.', [('review the budget','Ada','2028-02-29',[0]),('send the notes','Ada','2028-03-03',[1])]),
    ('smart-plural', '2026-12-31', 'We’ll prepare the annual report tomorrow.', [('prepare the annual report','Unknown','2027-01-01',[0])]),
    ('ascii-named-contraction', '2026-10-20', "Sam'll check the release checklist by Friday.", [('check the release checklist','Sam','2026-10-23',[0])]),
    ('filename', '2026-10-20', 'Jon will review release-notes.md by Friday.', [('review release-notes.md','Jon','2026-10-23',[0])]),
    ('version', '2026-10-20', 'Maya: I will test version 2.4.1 tomorrow.', [('test version 2.4.1','Maya','2026-10-21',[0])]),
    ('email', '2026-10-20', 'Ada will send the invoice to accounts@example.org tomorrow.', [('send the invoice to accounts@example.org','Ada','2026-10-21',[0])]),
    ('url', '2026-10-20', 'Sam will check https://example.org/status by Friday.', [('check https://example.org/status','Sam','2026-10-23',[0])]),
    ('sentence-boundary', '2026-10-20', 'Maya: I will review the brief. I will send the notes tomorrow.', [('review the brief','Maya','Unknown',[0]),('send the notes','Maya','2026-10-21',[1])]),
    ('punctuation-unicode', '2028-02-28', '  • Maya: I’ll test v2.1 📊 tomorrow.\r\n', [('test v2.1 📊','Maya','2028-02-29',[0])]),
    ('negative-in-object', '2026-10-20', "Ada will investigate why the worker won't start tomorrow.", [("investigate why the worker won't start",'Ada','2026-10-21',[0])]),
    ('completed-adjective', '2026-10-20', 'Jon will review the already approved budget by Friday.', [('review the already approved budget','Jon','2026-10-23',[0])]),
    ('yesterday-in-object', '2026-10-20', 'Maya will investigate yesterday’s outage tomorrow.', [('investigate yesterday’s outage','Maya','2026-10-21',[0])]),
    ('cancelled-in-object', '2026-10-20', 'Sam will document the cancelled rollout by Friday.', [('document the cancelled rollout','Sam','2026-10-23',[0])]),
    ('negated-commitment', '2026-10-20', 'Ada will not send the report tomorrow.', []),
    ('hypothetical', '2026-10-20', 'If approved, Maya will deploy the patch tomorrow.', []),
    ('completed-status', '2026-10-20', 'Jon already sent the invoice yesterday.', []),
    ('negated-request', '2026-10-20', 'Please do not deploy the patch tomorrow.', []),
    ('vague-deadline', '2026-10-20', 'Please review the release plan next week.', [('review the release plan next week','Unknown','Unknown',[0])]),
    ('ambiguous-date', '2026-10-20', 'Ada will review the budget by 03/04/2027.', [('review the budget by 03/04/2027','Ada','Unknown',[0])]),
    ('upper-case-verb', '2026-10-20', 'Maya will REVIEW the release notes by Friday.', [('REVIEW the release notes','Maya','2026-10-23',[0])]),
    ('overflow-relative', '9999-12-31', 'Maya will send the report tomorrow.', [('send the report','Maya','Unknown',[0])]),
    ('overflow-interval', '2026-10-20', 'Jon will review the plan in 999999999999999999999 days.', [('review the plan','Jon','Unknown',[0])]),
    ('revision-smart', '2026-10-20', 'Ada: I’ll send the report by Friday.\nAda: Actually, make that Monday.', [('send the report','Ada','2026-10-26',[0,1])]),
    ('cancellation-smart', '2026-10-20', 'Maya: I’ll publish the release notes tomorrow.\nMaya: Cancel that task.', []),
    ('quoted-instruction', '2026-10-20', 'Example: "Maya will send the invoice tomorrow."', []),
    ('duplicate-smart-ascii', '2026-10-20', "Ada: I’ll send the report tomorrow.\nAda: I'll send the report tomorrow.", [('send the report','Ada','2026-10-21',[0,1])]),
]

def build():
    rows=[]
    for name, reference, transcript, labels in CASES:
        # A separate list of exact intended evidence units, independent of the
        # production sentence splitter under audit.
        quotes=[line.strip().lstrip('• ') for line in transcript.splitlines() if line.strip()]
        if name=='sentence-boundary':quotes=['Maya: I will review the brief.','I will send the notes tomorrow.']
        spans=[];offset=0
        for quote in quotes:
            start=transcript.index(quote,offset);offset=start+len(quote)
            spans.append(dict(text=quote,start=start,end=offset))
        items=[dict(id=f'a{i+1}',task=task,owner=owner,deadline=deadline,evidence=[spans[n] for n in indexes]) for i,(task,owner,deadline,indexes) in enumerate(labels)]
        rows.append(dict(id='audit-dev-'+name,split='dev',source='synthetic',reference_date=reference,transcript=transcript,items=items))
    payload=''.join(json.dumps(row,ensure_ascii=False)+'\n' for row in rows)
    (ROOT/'dev.jsonl').write_text(payload,encoding='utf-8')
    manifest=dict(version=1,purpose='Targeted development audit; all cases are available for tuning, no held-out split',provenance='Invented transcripts and directly specified labels authored by an AI assistant; not independently human-reviewed; no real meetings',annotation_method='Task, owner, date and evidence passages specified before running predictions; offsets calculated from original text only',splits=dict(dev=dict(transcripts=len(rows),gold_items=sum(len(r['items']) for r in rows),sha256=hashlib.sha256(payload.encode()).hexdigest())))
    (ROOT/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')

if __name__=='__main__':build()
