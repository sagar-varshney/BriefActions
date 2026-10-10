"""One-time authoring record for the manually specified synthetic seed corpus."""
import json
from pathlib import Path

# Each tuple specifies transcript, then canonical task, owner, deadline and
# exact supporting quotes. These annotations aren't derived from an extractor.
DEV = [
('Asha will fix the payment API by 2026-09-18.\nWe discussed customer retention.', [('fix the payment API','Asha','2026-09-18',['Asha will fix the payment API by 2026-09-18.'])]),
('Leo: I will send the invoice tomorrow.', [('send the invoice','Leo','2026-09-16',['Leo: I will send the invoice tomorrow.'])]),
('Maya: We need to review the launch checklist this week.', [('review the launch checklist this week','Unknown','Unknown',['Maya: We need to review the launch checklist this week.'])]),
('Please prepare the budget by Friday.', [('prepare the budget','Unknown','2026-09-18',['Please prepare the budget by Friday.'])]),
('Nina will create the dashboard mockups.\nNina will create the dashboard mockups.', [('create the dashboard mockups','Nina','Unknown',['Nina will create the dashboard mockups.','Nina will create the dashboard mockups.'])]),
('We reviewed the prototype yesterday.\nThe release will improve conversion.\nThe test suite is green.', []),
('Omar will not deploy the backend today.\nCancel the launch; the launch task is cancelled.', []),
('If funding arrives, we could potentially hire designers.\nShould we review the roadmap?', []),
('Could you share the meeting notes?', [('share the meeting notes','Unknown','Unknown',['Could you share the meeting notes?'])]),
('Priya, please schedule the pilot call by September 20.', [('schedule the pilot call','Priya','2026-09-20',['Priya, please schedule the pilot call by September 20.'])]),
('Task: document the onboarding process; owner: Arjun', [('document the onboarding process','Arjun','Unknown',['Task: document the onboarding process; owner: Arjun'])]),
('Ravi needs to draft the campaign copy next week.', [('draft the campaign copy next week','Ravi','Unknown',['Ravi needs to draft the campaign copy next week.'])]),
('Sara will verify the database migration by 2026-02-30.', [('verify the database migration','Sara','Unknown',['Sara will verify the database migration by 2026-02-30.'])]),
('@Kiran will update the release notes today.', [('update the release notes','Kiran','2026-09-15',['@Kiran will update the release notes today.'])]),
('Daniel: I will audit the access list. I will share the findings by Thursday.', [('audit the access list','Daniel','Unknown',['Daniel: I will audit the access list.']),('share the findings','Daniel','2026-09-17',['I will share the findings by Thursday.'])]),
('Ava will test the checkout flow by next Monday.', [('test the checkout flow','Ava','2026-09-21',['Ava will test the checkout flow by next Monday.'])]),
('We met today.\nBen will investigate the memory leak.', [('investigate the memory leak','Ben','Unknown',['Ben will investigate the memory leak.'])]),
('Send the legal approval request by tomorrow.', [('Send the legal approval request','Unknown','2026-09-16',['Send the legal approval request by tomorrow.'])]),
('Elena will prepare the vendor report by Friday.\nElena will prepare the vendor report by Friday.\nJon will prepare the vendor report by Friday.', [('prepare the vendor report','Elena','2026-09-18',['Elena will prepare the vendor report by Friday.','Elena will prepare the vendor report by Friday.']),('prepare the vendor report','Jon','2026-09-18',['Jon will prepare the vendor report by Friday.'])]),
('Uma will fix the cache issue in 3 days.\nWe already completed the API review.', [('fix the cache issue','Uma','2026-09-18',['Uma will fix the cache issue in 3 days.'])]),
]
TEST = [
('Meera will reconcile the supplier invoices by 2026-09-22.\nThe budget was approved.', [('reconcile the supplier invoices','Meera','2026-09-22',['Meera will reconcile the supplier invoices by 2026-09-22.'])]),
('Tomas: I will replace the expired certificate by tomorrow.', [('replace the expired certificate','Tomas','2026-09-16',['Tomas: I will replace the expired certificate by tomorrow.'])]),
('Lina: We must collect the pilot feedback next month.', [('collect the pilot feedback next month','Unknown','Unknown',['Lina: We must collect the pilot feedback next month.'])]),
('Please book the training room by Wednesday.', [('book the training room','Unknown','2026-09-16',['Please book the training room by Wednesday.'])]),
('Ivan will archive the old incident reports.\nIvan will archive the old incident reports.', [('archive the old incident reports','Ivan','Unknown',['Ivan will archive the old incident reports.','Ivan will archive the old incident reports.'])]),
('We used to publish weekly newsletters.\nThe design should reduce confusion.\nYesterday we scheduled the webinar.', []),
('Noah won\'t remove the legacy endpoint.\nThe migration is no longer required.', []),
('Maybe we should migrate the analytics store.\nIf the traffic spikes, I will test the fallback.', []),
('Can you export the attendance list?', [('export the attendance list','Unknown','Unknown',['Can you export the attendance list?'])]),
('Zoe, please submit the expense report by October 2.', [('submit the expense report','Zoe','2026-10-02',['Zoe, please submit the expense report by October 2.'])]),
('Action item: validate the inventory counts; assigned to Fatima', [('validate the inventory counts','Fatima','Unknown',['Action item: validate the inventory counts; assigned to Fatima'])]),
('Wei will present the quarterly metrics this week.', [('present the quarterly metrics this week','Wei','Unknown',['Wei will present the quarterly metrics this week.'])]),
('Sofia will check the backup restore by 2026-13-05.', [('check the backup restore','Sofia','Unknown',['Sofia will check the backup restore by 2026-13-05.'])]),
('@Ethan will deliver the signed contract today.', [('deliver the signed contract','Ethan','2026-09-15',['@Ethan will deliver the signed contract today.'])]),
('Nora: I will implement the retry policy. I will document the rollout by Saturday.', [('implement the retry policy','Nora','Unknown',['Nora: I will implement the retry policy.']),('document the rollout','Nora','2026-09-19',['I will document the rollout by Saturday.'])]),
('Akash will audit the billing permissions by next Tuesday.', [('audit the billing permissions','Akash','2026-09-22',['Akash will audit the billing permissions by next Tuesday.'])]),
('Today the dashboard showed a spike.\nIsha will investigate the queue backlog.', [('investigate the queue backlog','Isha','Unknown',['Isha will investigate the queue backlog.'])]),
('Update the support handbook by tomorrow.', [('Update the support handbook','Unknown','2026-09-16',['Update the support handbook by tomorrow.'])]),
('Luis will review the pricing proposal by Thursday.\nLuis will review the pricing proposal by Thursday.\nHana will review the pricing proposal by Thursday.', [('review the pricing proposal','Luis','2026-09-17',['Luis will review the pricing proposal by Thursday.','Luis will review the pricing proposal by Thursday.']),('review the pricing proposal','Hana','2026-09-17',['Hana will review the pricing proposal by Thursday.'])]),
('Milan will resolve the payment dispute in 2 days.\nWe already sent the receipt.', [('resolve the payment dispute','Milan','2026-09-17',['Milan will resolve the payment dispute in 2 days.'])]),
]

# Longer development scenarios expose contextual limitations beyond template cases.
DEV += [
('Nikhil will follow up on the vendor contract by Friday.\nThe procurement review is still open.', [('follow up on the vendor contract','Nikhil','2026-09-18',['Nikhil will follow up on the vendor contract by Friday.'])]),
('Maya and Arjun will prepare the incident summary by tomorrow.', [('prepare the incident summary','Maya and Arjun','2026-09-16',['Maya and Arjun will prepare the incident summary by tomorrow.'])]),
("Asha: I'll write the regression tests today.\nThe old tests were removed.", [('write the regression tests','Asha','2026-09-15',["Asha: I'll write the regression tests today."])]),
('Dina: I already shared the slides. I will confirm the speaker list by Friday.', [('confirm the speaker list','Dina','2026-09-18',['I will confirm the speaker list by Friday.'])]),
('Owen said he would review the old roadmap last quarter.\nThe team discussed whether to publish it.', []),
('Bela will submit the risk assessment by Friday.\nBela: Move my risk assessment deadline to Monday instead.', [('submit the risk assessment','Bela','2026-09-21',['Bela will submit the risk assessment by Friday.','Bela: Move my risk assessment deadline to Monday instead.'])]),
('Vikram will update the compliance register by 04/05.\nWe did not agree whether this means April or May.', [('update the compliance register','Vikram','Unknown',['Vikram will update the compliance register by 04/05.'])]),
('Task: review the support escalation process; owner: Anita; due on 2026-09-24', [('review the support escalation process','Anita','2026-09-24',['Task: review the support escalation process; owner: Anita; due on 2026-09-24'])]),
('Ren: Can you check the recovery procedure?\nWe should avoid changing the policy during the outage.', [('check the recovery procedure','Unknown','Unknown',['Ren: Can you check the recovery procedure?'])]),
('Eli will prepare a budget by Friday.\nEli will prepare the budget by Friday.', [('prepare the budget','Eli','2026-09-18',['Eli will prepare a budget by Friday.','Eli will prepare the budget by Friday.'])]),
]
# Contextual held-out cases differ from the short development templates.
# Do not tune extraction after inspecting held-out results.
TEST += [
('Manager: The renewal account needs attention.\nSanjay: I can take ownership of the renewal checklist.\nManager: Please finish it by Friday.\nSanjay: Agreed.', [('finish the renewal checklist','Sanjay','2026-09-18',['Sanjay: I can take ownership of the renewal checklist.','Manager: Please finish it by Friday.','Sanjay: Agreed.'])]),
('Helen will publish the outage summary by Thursday.\nHelen: Actually, make that Friday for the outage summary.', [('publish the outage summary','Helen','2026-09-18',['Helen will publish the outage summary by Thursday.','Helen: Actually, make that Friday for the outage summary.'])]),
('Anil will migrate the reporting database by Tuesday.\nAnil: Cancel my database migration task; the vendor is handling it.', []),
('Grace will update the customer FAQ by October 1.\nGrace: I will refresh the customer frequently asked questions by October 1.', [('update the customer FAQ','Grace','2026-10-01',['Grace will update the customer FAQ by October 1.','Grace: I will refresh the customer frequently asked questions by October 1.'])]),
('Jules will send the security questionnaire.\nSam will send the security questionnaire.\nThey own different supplier accounts.', [('send the security questionnaire','Jules','Unknown',['Jules will send the security questionnaire.']),('send the security questionnaire','Sam','Unknown',['Sam will send the security questionnaire.'])]),
('We discussed a sample sentence: "Raj will deploy the service tomorrow."\nThis was a training example, not an assignment.', []),
('Farah: I will not deploy the patch, but I will review its test results today.', [('review the patch test results','Farah','2026-09-15',['Farah: I will not deploy the patch, but I will review its test results today.'])]),
('Kunal and Mira will coordinate the audit meeting by Friday.\nThe customer did not request additional attendees.', [('coordinate the audit meeting','Kunal and Mira','2026-09-18',['Kunal and Mira will coordinate the audit meeting by Friday.'])]),
("Oscar: I'll add a retention chart to the monthly report by Thursday.\nThe monthly report is otherwise ready.", [('add a retention chart to the monthly report','Oscar','2026-09-17',["Oscar: I'll add a retention chart to the monthly report by Thursday."])]),
('Daria will fix the export bug by tomorrow.\nDaria will fix the export bug by next Friday.\nThese are two reports with conflicting dates; no one confirmed which deadline is correct.', [('fix the export bug','Daria','2026-09-16',['Daria will fix the export bug by tomorrow.']),('fix the export bug','Daria','2026-09-25',['Daria will fix the export bug by next Friday.'])]),
]

def records(rows, split):
    for n, (transcript, annotations) in enumerate(rows, 1):
        items = []
        for j, (task, owner, deadline, quotes) in enumerate(annotations, 1):
            evidence = []
            cursor = 0
            for quote in quotes:
                # Distinct occurrences of an identical quote keep distinct spans.
                try:
                    start = transcript.index(quote, cursor)
                except ValueError:
                    start = transcript.index(quote)
                evidence.append({'text':quote,'start':start,'end':start+len(quote)})
                cursor = start + len(quote)
            items.append({'id':f'{split}-{n:02d}-a{j}','task':task,'owner':owner,'deadline':deadline,'evidence':evidence})
        yield {'id':f'{split}-{n:02d}','split':split,'reference_date':'2026-09-15','source':'synthetic; authored and annotated by Codex; not independently reviewed','transcript':transcript,'items':items}

if __name__ == '__main__':
    root = Path(__file__).parent
    for split, rows in [('dev',DEV),('test',TEST)]:
        (root/f'{split}.jsonl').write_text(''.join(json.dumps(r,ensure_ascii=False)+'\n' for r in records(rows,split)))
