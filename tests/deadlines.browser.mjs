import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {chromium} from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import {createApp} from '../server/index.mjs';
import {navigate} from './browser-helpers.mjs';

const folder=await mkdtemp(path.join(tmpdir(),'briefactions-deadlines-browser-')),shots=process.env.FLOW_SCREENSHOTS||path.join(folder,'screenshots');await mkdir(shots,{recursive:true});
const server=createApp({historyPath:path.join(folder,'history.sqlite3')});let browser;
try{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`;
 const post=async(url,body)=>{const r=await fetch(base+url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});assert.ok(r.ok,await r.clone().text());return r.json();};
 browser=await chromium.launch({headless:true,...(process.env.FLOW_CHROMIUM_PATH?{executablePath:process.env.FLOW_CHROMIUM_PATH}:{})});
 const context=await browser.newContext({viewport:{width:1440,height:1000},permissions:['clipboard-read','clipboard-write']}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(base+'/meetings');await page.getByRole('button',{name:'Analyze transcript',exact:true}).waitFor();
 const today=await page.evaluate(()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;}),shift=n=>{const d=new Date(today+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10);};
 let run=await post('/api/runs',{title:'Deadline planning 📋',transcript:`Maya will send the report by ${shift(1)}.\nJon will review the notes.`,reference_date:today});
 run=await post(`/api/runs/${run.id}/finalize`,{decisions:run.proposals.map(p=>({...p,accept:true}))});const task=run.final_tasks[0],card=()=>page.locator(`#confirmed-task-${task.proposal_id}`);
 await page.goto(base+`/meetings/${run.id}?task=${task.proposal_id}`);await page.getByRole('heading',{name:'Your confirmed plan',exact:true}).waitFor();
 await card().getByRole('button',{name:`Copy task: ${task.task}`,exact:true}).click();await card().getByRole('status').filter({hasText:'Task copied.'}).waitFor();
 const edit=async()=>{await card().getByRole('button',{name:'Correct deadline for task 1',exact:true}).click();await page.getByLabel('New deadline for task 1',{exact:true}).waitFor();};
 const fill=async(day,reason)=>{await page.getByLabel('New deadline for task 1',{exact:true}).fill(day);await page.getByLabel('Reason for correction for task 1',{exact:true}).fill(reason);};
 await edit();assert.ok(await page.getByRole('button',{name:'Save deadline correction',exact:true}).isDisabled());await fill(shift(2),'Customer agreed the new date.');
 for(const width of [1440,768,390,320])for(const theme of ['light','dark']){await page.setViewportSize({width,height:1000});await page.getByLabel('Color theme').selectOption(theme);const result=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze();assert.deepEqual(result.violations,[],`${width}-${theme}`);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));if([1440,320].includes(width))await page.screenshot({path:path.join(shots,`deadline-editor-${width}-${theme}.png`),fullPage:width===320});}
 await page.setViewportSize({width:1440,height:1000});await page.getByRole('button',{name:'Save deadline correction',exact:true}).click();await page.getByRole('status').filter({hasText:'Deadline corrected. Calendar'}).waitFor();assert.ok((await card().innerText()).includes(shift(2)));assert.ok((await card().innerText()).includes('Originally confirmed: '+shift(1)));
 assert.equal(await card().getByText('Task copied.',{exact:true}).count(),0,'A changed deadline must clear the previous copy confirmation');
 await card().getByRole('button',{name:`Copy task: ${task.task}`,exact:true}).click();await card().getByRole('status').filter({hasText:'Task copied.'}).waitFor();assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),`Task: ${task.task}\nOwner: ${task.owner}\nDeadline: ${shift(2)}`);
 await card().getByRole('button',{name:/^Locate passage/}).click();await page.waitForFunction(()=>document.activeElement?.id==='saved-source');assert.equal(await page.locator('#saved-source mark').textContent(),task.evidence[0].text);
 await navigate(page,'My day');await page.getByRole('status').filter({hasText:'Overview ready for'}).waitFor();assert.ok((await page.locator('.daily-list').innerText()).includes(task.task));
 await navigate(page,'Calendar');await page.getByLabel('Calendar month',{exact:true}).fill(shift(2).slice(0,7));await page.getByLabel('Selected calendar date',{exact:true}).fill(shift(2));await page.locator('.calendar-detail').getByRole('heading',{name:task.task,exact:true}).waitFor();
 await page.locator('.calendar-detail').getByRole('button',{name:'Open task & evidence',exact:true}).click();await page.getByRole('heading',{name:'Your confirmed plan',exact:true}).waitFor();
 // A committed write with a lost response survives reload and retries exactly once.
 await page.route('**/api/runs/*/deadline',async route=>{await route.fetch();await route.abort('failed');});await edit();await fill(shift(3),'Confirmed after customer call.');await page.getByRole('button',{name:'Save deadline correction',exact:true}).click();await page.getByRole('button',{name:'Retry deadline correction',exact:true}).waitFor();await page.reload();await page.getByRole('button',{name:'Retry deadline correction',exact:true}).waitFor();await page.unroute('**/api/runs/*/deadline');await page.getByRole('button',{name:'Retry deadline correction',exact:true}).click();await page.getByRole('status').filter({hasText:'Deadline corrected. Calendar'}).waitFor();
 let current=await (await fetch(base+`/api/runs/${run.id}`)).json();assert.equal(current.events.filter(e=>e.kind==='task_deadline').length,2);assert.equal(current.current_tasks[0].deadline,shift(3));assert.equal(current.final_tasks[0].deadline,task.deadline);
 // A concurrent correction must be refreshed, never silently overwritten by an open form.
 await edit();await fill(shift(4),'Stale form.');await post(`/api/runs/${run.id}/deadline`,{proposal_id:task.proposal_id,deadline:shift(5),reason:'Other tab agreed a date.',version:2,request_id:'d'.repeat(32)});await page.getByRole('button',{name:'Save deadline correction',exact:true}).click();await page.getByRole('alert').filter({hasText:'changed in another tab'}).waitFor();await page.getByRole('button',{name:'Cancel correction',exact:true}).click();await page.getByRole('button',{name:'Refresh task progress',exact:true}).click();await card().getByText('Other tab agreed a date.',{exact:false}).waitFor();
 // A delayed copy completion for an older deadline must not confirm the current text.
 await page.evaluate(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:()=>new Promise(resolve=>{window.finishTaskCopy=resolve;})}}));
 await card().getByRole('button',{name:`Copy task: ${task.task}`,exact:true}).click();await page.waitForFunction(()=>typeof window.finishTaskCopy==='function');
 await edit();await page.getByLabel('No known deadline',{exact:true}).check();await page.getByLabel('Reason for correction for task 1',{exact:true}).fill('No date is agreed yet.');await page.getByRole('button',{name:'Save deadline correction',exact:true}).click();await page.getByRole('status').filter({hasText:'Deadline corrected. Calendar'}).waitFor();
 await page.evaluate(()=>window.finishTaskCopy());await card().getByRole('button',{name:`Copy task: ${task.task}`,exact:true}).waitFor();assert.equal(await card().getByText('Task copied.',{exact:true}).count(),0,'Late clipboard completion must not restore stale success feedback');
 await page.getByRole('heading',{name:'Corrected task deadline',exact:true}).first().waitFor();await page.getByLabel('Filter tasks by due date',{exact:true}).selectOption('unknown');assert.equal(await page.locator('.confirmed-card').count(),2);
 await page.locator('.plan-export>details>summary').click();const exported=await page.getByLabel('Action plan preview',{exact:true}).inputValue();assert.ok(exported.includes('Deadline: Unknown'));assert.ok(exported.includes('Deadline correction reason: No date is agreed yet.'));
 await page.reload();await page.getByRole('heading',{name:'Your confirmed plan',exact:true}).waitFor();assert.ok((await card().innerText()).includes('No date is agreed yet.'));assert.deepEqual(errors,[]);
 console.log('Deadline browser checks passed: required reason/date, Unknown, responsive accessibility, immutable evidence, calendar and daily views, auditable exports, lost-response/reload retry, concurrent conflict and history.');
}finally{await browser?.close();server.closeAllConnections();await server.shutdown();await rm(folder,{recursive:true,force:true});}
