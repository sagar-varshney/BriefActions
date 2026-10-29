import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {chromium} from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import {createApp} from '../server/index.mjs';
import {loadConfig} from '../server/config.mjs';
import {meetingField,navigate} from './browser-helpers.mjs';

const folder=await mkdtemp(path.join(tmpdir(),'briefactions-corrected-extraction-'));
const shots=process.env.FLOW_SCREENSHOTS||path.join(folder,'screenshots');await mkdir(shots,{recursive:true});
const server=createApp({config:loadConfig({}),historyPath:path.join(folder,'history.sqlite3')});
const checks=[],errors=[];let browser,page;
async function scan(label){const result=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa']).analyze();checks.push({label,violations:result.violations});assert.deepEqual(result.violations,[],label);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),label+' overflow');}
async function choose(index,run){const button=page.getByRole('button',{name:`Review task ${index+1}: ${run.proposals[index].task}`,exact:true});if(await button.isVisible())await button.click();else await page.getByLabel('Go to task',{exact:true}).selectOption(run.proposals[index].proposal_id);await page.getByLabel(`Task ${index+1}`,{exact:true}).waitFor();}
const saved=()=>page.locator('.save-feedback').getByText('Saved',{exact:true}).waitFor();
try{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`;
 const post=async(url,data)=>{const response=await fetch(base+url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});assert.ok(response.ok,await response.clone().text());return response.json();};
 const get=async url=>(await fetch(base+url)).json();
 browser=await chromium.launch({headless:true,...(process.env.FLOW_CHROMIUM_PATH?{executablePath:process.env.FLOW_CHROMIUM_PATH}:{})});
 const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'});page=await context.newPage();page.setDefaultTimeout(15000);page.on('pageerror',error=>errors.push(error.message));
 await page.goto(base+'/meetings');await page.getByRole('button',{name:'Analyze transcript',exact:true}).waitFor();
 const transcript='MAYA will review 東京 by Friday.\nMAYA will review 大阪 by Friday.';
 await(await meetingField(page,'Meeting transcript')).fill(transcript);await(await meetingField(page,'Meeting date')).fill('2026-09-15');
 const created=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/runs'&&r.request().method()==='POST');
 await page.getByRole('button',{name:'Analyze transcript',exact:true}).click();const run=await(await created).json();
 await page.getByRole('heading',{name:/Review action proposals/}).waitFor();assert.equal(run.proposals.length,2);assert.equal(new Set(run.proposals.map(p=>p.proposal_id)).size,2);
 for(const width of [1440,390]){
  await page.setViewportSize({width,height:1000});
  for(const theme of ['light','dark']){
   await page.getByLabel('Color theme').selectOption(theme);
   for(const [i,text] of [[0,'review 東京'],[1,'review 大阪']]){await choose(i,run);assert.equal(await page.getByLabel(`Task ${i+1}`,{exact:true}).inputValue(),text);assert.equal(await page.getByLabel(`Deadline ${i+1}`,{exact:true}).inputValue(),'2026-09-18');}
   await choose(0,run);await page.getByRole('button',{name:'Locate passage 1 for task 1',exact:true}).click();await page.waitForFunction(()=>document.activeElement?.id==='saved-source');assert.equal(await page.locator('#saved-source mark').textContent(),run.proposals[0].evidence[0].text);await page.getByRole('button',{name:'Back to task',exact:true}).click();
   await scan(`unicode-review-${width}-${theme}`);
  }
 }
 await page.setViewportSize({width:1440,height:1000});await choose(0,run);await page.getByRole('button',{name:'Keep & next',exact:true}).click();await page.getByLabel('Task 2',{exact:true}).waitFor();await page.getByRole('button',{name:'Keep task',exact:true}).click();await saved();
 await page.getByRole('button',{name:'Review selection',exact:true}).click();await page.getByRole('dialog',{name:'Review your selection',exact:true}).getByRole('button',{name:'Confirm selected tasks',exact:true}).click();await page.getByRole('heading',{name:'Your confirmed plan',exact:true}).waitFor();
 const original=await get(`/api/runs/${run.id}`);assert.equal(original.final_tasks.length,2);
 await page.locator('.followup-panel>summary').click();
 const followup='Maya: Move my 東京 deadline to Monday or next Tuesday instead.\nMaya: I will send the summary tomorrow if approved.';
 await page.getByLabel('Follow-up transcript',{exact:true}).fill(followup);await page.getByLabel('Follow-up meeting date',{exact:true}).fill('2026-09-16');await page.getByRole('button',{name:'Compare with this plan',exact:true}).click();await page.getByRole('heading',{name:'Review plan changes',exact:true}).waitFor();
 const child=new URL(page.url()).pathname.split('/').at(-1);assert.equal(await page.getByLabel('Deadline for change 1',{exact:true}).inputValue(),'Unknown');
 const comparison=await get(`/api/runs/${child}`);assert.deepEqual(comparison.settings.plan_update.rows.map(r=>r.kind),['changed','unchanged']);assert.equal(comparison.settings.plan_update.rows[0].after.owner,'MAYA');
 assert.equal((await get('/api/calendar?month=2026-09&day=2026-09-18')).scheduled.total,2);
 await page.getByLabel('Apply changed change for task 1',{exact:true}).check();await page.getByRole('status').filter({hasText:'Review saved to history.'}).waitFor();await page.getByRole('button',{name:'Confirm updated plan',exact:true}).click();await page.getByRole('heading',{name:'Your confirmed plan',exact:true}).waitFor();
 const final=await get(`/api/runs/${child}`);assert.equal(final.final_tasks.length,2);assert.equal(final.final_tasks[0].deadline,'Unknown');assert.equal(final.final_tasks[0].evidence.length,2);assert.equal((await get(`/api/runs/${run.id}`)).final_tasks[0].deadline,'2026-09-18');
 await navigate(page,'Calendar');const calendarReady=()=>page.getByRole('status').filter({hasText:/meetings? and \d+ task deadlines?/}).waitFor();await calendarReady();await page.getByLabel('Calendar month',{exact:true}).fill('2026-09');await calendarReady();await page.getByLabel('Selected calendar date',{exact:true}).fill('2026-09-18');await calendarReady();
 await page.getByRole('region',{name:'Unscheduled tasks',exact:true}).getByText('1 unscheduled task',{exact:true}).waitFor();assert.equal(await page.locator('.calendar-detail .calendar-entry').count(),1);
 for(const width of [1440,390]){await page.setViewportSize({width,height:1000});for(const theme of ['light','dark']){await page.getByLabel('Color theme').selectOption(theme);await scan(`uncertain-calendar-${width}-${theme}`);}}
 const ambiguous=await post('/api/runs',{transcript:'Maya will send the report by Friday or Monday.',reference_date:'2026-09-15'});await page.goto(base+'/meetings/'+ambiguous.id);await page.getByRole('heading',{name:/Review action proposals/}).waitFor();assert.equal(await page.getByLabel('Deadline 1',{exact:true}).inputValue(),'Unknown');assert.ok((await page.getByLabel('Task 1',{exact:true}).inputValue()).includes('Friday or Monday'));await page.getByRole('group',{name:'Needs attention for task 1',exact:true}).getByRole('button',{name:'Deadline missing: go to deadline for task 1',exact:true}).waitFor();await scan('ambiguous-task-needs-review');await page.screenshot({path:path.join(shots,'uncertain-deadline-review.png')});
 for(const [name,text] of [
  ['cancelled','Maya: I will send the report by Friday.\nMaya: I will send the report by Monday.\nMaya: Make that Friday instead.\nMaya: Cancel that task.'],
  ['conditional','Maya will send the report tomorrow if the budget is approved.'],
 ]){
  const empty=await post('/api/runs',{transcript:text,reference_date:'2026-09-15'});assert.equal(empty.proposals.length,0);if(name==='cancelled')assert.deepEqual(empty.settings.conversation_changes.map(c=>c.kind),['deadline_revision','cancellation']);
  await page.goto(base+'/meetings/'+empty.id);await page.getByRole('heading',{name:/Review action proposals/}).waitFor();assert.equal(await page.locator('.proposal-card').count(),0);await scan(name+'-no-unwanted-proposal');
 }
 assert.deepEqual(errors,[]);console.log('Extraction correction browser checks passed: distinct Unicode proposals, exact source navigation, case-only follow-up ownership, uncertain dates and explicit confirmation, Calendar, visible review choices, merged cancellation and conditional exclusion; responsive accessibility in both themes.');
}catch(error){if(page){await page.screenshot({path:path.join(shots,'extraction-corrections-failure.png'),fullPage:true}).catch(()=>{});await writeFile(path.join(shots,'extraction-corrections-failure.txt'),await page.locator('body').innerText().catch(()=>''));}throw error;}
finally{await writeFile(path.join(shots,'extraction-corrections-accessibility.json'),JSON.stringify(checks,null,2));await browser?.close();server.closeAllConnections();await server.shutdown();await rm(folder,{recursive:true,force:true});}
