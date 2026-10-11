"""Hand-authored synthetic labels, never derived from extractor predictions.

This is a scenario validation set, not independently reviewed real-meeting data.
Do not rewrite frozen files after inspecting test results.
"""
import hashlib
import json
from pathlib import Path

ROOT=Path(__file__).resolve().parent/'revision-v1'

def row(identifier,split,meeting,transcript,labels,rationale):
    items=[]
    for n,(task,owner,deadline,quotes) in enumerate(labels):
        evidence=[]
        for quote in quotes:
            start=transcript.index(quote)
            evidence.append({'text':quote,'start':start,'end':start+len(quote)})
        items.append({'id':f'a{n+1}','task':task,'owner':owner,'deadline':deadline,'evidence':evidence})
    return {'id':identifier,'split':split,'reference_date':meeting,'transcript':transcript,'items':items,
        'source':'synthetic','group':identifier,'annotation_provenance':'Codex-authored manual labels, no independent reviewer','rationale':rationale}


def main():
    if ROOT.exists():raise SystemExit('Corpus already exists; create a new version rather than overwrite labels')
    ROOT.mkdir()
    dev=[]
    def add(meeting,text,labels,reason):dev.append(row(f'revision-dev-{len(dev)+1:02}','dev',meeting,text,labels,reason))
    a='Asha: I will send the launch report by Friday.';b='Asha: Actually, make that Monday.'
    add('2026-10-01',a+'\n'+b,[('send the launch report','Asha','2026-10-05',[a,b])],'Explicit immediate revision replaces Friday; both passages support final deadline.')
    a='Ben: I will prepare the invoice tomorrow.';b='Ben: Cancel that task.'
    add('2026-12-31',a+'\n'+b,[],'Immediate cancellation removes the commitment.')
    a='Cy will review the contract by Friday.';b='Lead: Move the contract to Monday.'
    add('2027-01-07',a+'\n'+b,[('review the contract','Cy','2027-01-11',[a,b])],'Named object uniquely identifies an earlier commitment.')
    a='Dana will draft the release notes tomorrow.';b='Lead: Cancel the release notes task.'
    c='Eli will test the patch today.'
    add('2028-02-28',a+'\n'+c+'\n'+b,[('test the patch','Eli','2028-02-28',[c])],'Cancel only the named action, preserve unrelated work.')
    a='Finn: I will review report 1 tomorrow.';b='Finn: I will review report 2 tomorrow.';c='Finn: Cancel the report task.'
    add('2026-11-30',a+'\n'+b+'\n'+c,[('review report 1','Finn','2026-12-01',[a]),('review report 2','Finn','2026-12-01',[b])],'Ambiguous named reference leaves both tasks for review.')
    a='Gia: I will share the budget by Friday.';b='Gia: Actually, make that next week.'
    add('2027-04-01',a+'\n'+b,[('share the budget','Gia','Unknown',[a,b])],'Vague revision clears obsolete exact deadline.')
    a='Hari: I will submit the audit today.';b='Hari: Actually, make that 2026-02-30.'
    add('2026-02-27',a+'\n'+b,[('submit the audit','Hari','Unknown',[a,b])],'Invalid exact replacement clears deadline rather than inventing a date.')
    a='Iris: I will deploy the fix tomorrow.';b='Iris: The meeting is over.';c='Iris: Cancel that task.'
    add('2026-06-30',a+'\n'+b+'\n'+c,[('deploy the fix','Iris','2026-07-01',[a])],'An intervening non-action clears pronoun context.')
    a='Jules: I will book the room by Friday.';b='Kai: Actually, make that Monday.'
    add('2027-08-05',a+'\n'+b,[('book the room','Jules','2027-08-06',[a])],'Cross-speaker bare pronoun is intentionally unresolved.')
    a='Lena: I will send the agenda tomorrow.';b="Lena: Don't cancel that task."
    add('2028-02-28',a+'\n'+b,[('send the agenda','Lena','2028-02-29',[a])],'Negated cancellation does not remove the task; leap-year relative date.')
    a='Miro: I will send the agenda by Friday.';b='Miro: Actually, make that Monday.';c='Miro: Move that to Tuesday.'
    add('2026-09-30',a+'\n'+b+'\n'+c,[('send the agenda','Miro','2026-10-06',[a,b,c])],'Successive explicit revisions preserve the complete supporting conversation.')
    a='Nora will review the design by December 31.'
    add('2026-12-30',a,[('review the design','Nora','2026-12-31',[a])],'Named date at year boundary.')
    test=[]
    def hold(meeting,text,labels,reason):test.append(row(f'revision-test-{len(test)+1:02}','test',meeting,text,labels,reason))
    a='Omar: I will publish the migration checklist by Thursday.';b='Omar: Actually, make that Tuesday.'
    hold('2027-03-01',a+'\n'+b,[('publish the migration checklist','Omar','2027-03-02',[a,b])],'Immediate revision changes due weekday.')
    a='Pia: I will reconcile the ledger tomorrow.';b='Pia: Drop that task.'
    hold('2027-12-31',a+'\n'+b,[],'Drop cancels an immediate commitment across the year boundary.')
    a='Quin will validate the export by Friday.';b='Chair: Reschedule the export to next Monday.'
    hold('2028-02-25',a+'\n'+b,[('validate the export','Quin','2028-02-28',[a,b])],'Named revision using next Monday.')
    a='Rae will archive the backup tomorrow.';b='Sam will audit the access list today.';c='Chair: Cancel the backup task.'
    hold('2027-02-28',a+'\n'+b+'\n'+c,[('audit the access list','Sam','2027-02-28',[b])],'Named cancellation leaves a separate active task.')
    a='Teo: I will check account 1 today.';b='Teo: I will check account 2 today.';c='Teo: Move the account to Friday.'
    hold('2026-10-12',a+'\n'+b+'\n'+c,[('check account 1','Teo','2026-10-12',[a]),('check account 2','Teo','2026-10-12',[b])],'Ambiguous named revision leaves original exact dates.')
    a='Uma: I will collect the feedback by Wednesday.';b='Uma: Actually, make that next week.'
    hold('2027-05-03',a+'\n'+b,[('collect the feedback','Uma','Unknown',[a,b])],'Vague revision requires unknown exact day.')
    a='Vera: I will deliver the prototype tomorrow.';b='Vera: Move that to 2027-02-29.'
    hold('2027-02-26',a+'\n'+b,[('deliver the prototype','Vera','Unknown',[a,b])],'Invalid non-leap date cannot become an exact deadline.')
    a='Wes: I will investigate the outage tomorrow.';b='Wes: We discussed availability.';c='Wes: Cancel that task.'
    hold('2027-07-31',a+'\n'+b+'\n'+c,[('investigate the outage','Wes','2027-08-01',[a])],'Intervening topic clears immediate reference.')
    a='Xena: I will verify the rollback today.';b='Yuri: Cancel that task.'
    hold('2026-12-01',a+'\n'+b,[('verify the rollback','Xena','2026-12-01',[a])],'Cross-speaker bare reference remains unresolved.')
    a='Zoe: I will submit the expense report tomorrow.';b="Zoe: Do not cancel that task."
    hold('2028-02-29',a+'\n'+b,[('submit the expense report','Zoe','2028-03-01',[a])],'Negated cancellation and leap-day rollover.')
    a='Amir: I will prepare the handoff by Friday.';b='Amir: Actually, make that Monday.';c='Amir: Cancel that task.'
    hold('2027-06-03',a+'\n'+b+'\n'+c,[],'Cancellation after revision removes the current action, retaining an audit.')
    a='Bea will review the payroll by January 2.'
    hold('2027-12-30',a,[('review the payroll','Bea','2028-01-02',[a])],'Named deadline rolls into next year.')
    manifest={'version':1,'provenance':'24 hand-authored synthetic transcripts and manual labels by Codex; not independently reviewed; no real transcripts supplied',
       'split_method':'Scenario cases assigned before benchmark execution; related linguistic patterns occur across splits. Not a blinded or representative accuracy estimate.',
       'policy':'Use dev for extraction feedback. Do not tune on test after evaluating; make a new held-out version.', 'splits':{}}
    for split,rows in [('dev',dev),('test',test)]:
        payload=''.join(json.dumps(r,ensure_ascii=False)+'\n' for r in rows)
        (ROOT/f'{split}.jsonl').write_text(payload)
        manifest['splits'][split]={'transcripts':len(rows),'gold_items':sum(len(r['items']) for r in rows),'sha256':hashlib.sha256(payload.encode()).hexdigest()}
    (ROOT/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')

if __name__=='__main__':main()
