import {openFullMeeting,legacyReviewDefaults,scrollWorkspace} from './browser-helpers.mjs';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {chromium} from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import {createApp} from '../server/index.mjs';
import {localToday} from '../web/src/reviewTools.js';

const folder=await mkdtemp(path.join(tmpdir(),'briefactions-dashboard-'));
const shots=process.env.FLOW_SCREENSHOTS || path.join(folder,'screenshots');await mkdir(shots,{recursive:true});
const server=createApp({historyPath:path.join(folder,'history.sqlite3')});let browser;const checks=[];
async function scan(page,label){const result=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa']).analyze();checks.push({label,violations:result.violations});assert.deepEqual(result.violations,[],label);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),label+' overflow');}
try{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`;
 const post=async(url,data)=>{const response=await fetch(base+url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});assert.ok(response.ok,await response.clone().text());return response.json();};
 const today=localToday(),shift=days=>{const date=new Date(today+'T12:00:00Z');date.setUTCDate(date.getUTCDate()+days);return date.toISOString().slice(0,10);};
 const create=(title,transcript)=>post('/api/runs',{title,transcript,reference_date:today,clusters:1});
 const confirm=run=>post(`/api/runs/${run.id}/finalize`,{decisions:run.proposals.map(p=>({...p,accept:true}))});
 browser=await chromium.launch({headless:true,...(process.env.FLOW_CHROMIUM_PATH?{executablePath:process.env.FLOW_CHROMIUM_PATH}:{})});
 const context=await browser.newContext({viewport:{width:1440,height:1000},permissions:['clipboard-read','clipboard-write']}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await legacyReviewDefaults(page,[]);await page.goto(base+'/tasks');await page.getByRole('heading',{name:'No tasks in this view',exact:true}).waitFor();
 const launch=await confirm(await create('Launch planning',`Maya will send the report by ${shift(-1)}.\nAda will review the budget by ${today}.\nJon will draft the notes by ${shift(1)}.\nPlease prepare the agenda.`));assert.equal(launch.final_tasks.length,4);
 let customer=await create('Customer planning',`Nora will check capacity by ${shift(8)}.\nLee will send invoices by ${today}.`);
 const passage=customer.proposals[0].evidence[0];customer=await post(`/api/runs/${customer.id}/manual-actions`,{request_id:'a'.repeat(32),item:{task:'Review follow-up notes',owner:'Uma',deadline:'Unknown',evidence:[passage]}});customer=await confirm(customer);
 await post(`/api/runs/${customer.id}/progress`,{proposal_id:customer.final_tasks[1].proposal_id,status:'done',version:0,request_id:'b'.repeat(32)});
 const review=await create('Deadline choices',`Maya will send the summary by ${shift(1)}.\nMaya will send the summary by ${shift(3)}.\nPlease prepare the handover notes soon.`);
 await page.getByRole('button',{name:'Refresh tasks',exact:true}).click();await page.getByRole('status').filter({hasText:'6 tasks'}).waitFor();assert.equal(await page.locator('.dashboard-task').count(),6);
 // Copy one confirmed task without opening it, preserving unknown details.
 const taskText=task=>`Task: ${task.task}\nOwner: ${task.owner}\nDeadline: ${task.deadline}`;
 const agenda=launch.final_tasks.find(task=>task.owner==='Unknown');
 const agendaCard=page.locator('.dashboard-task').filter({has:page.getByRole('heading',{name:agenda.task,exact:true})});
 const copyAgenda=agendaCard.getByRole('button',{name:`Copy task: ${agenda.task}`,exact:true});
 await copyAgenda.focus();await page.keyboard.press('Enter');await agendaCard.getByRole('status').filter({hasText:'Task copied.'}).waitFor();
 assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),taskText(agenda));assert.equal(new URL(page.url()).pathname,'/tasks');assert.ok(await copyAgenda.evaluate(el=>el===document.activeElement));
 const view=name=>page.getByRole('group',{name:'Task views'}).getByRole('button',{name:new RegExp('^'+name+'(?:\\s|$)')});
 for(const [label,task] of [['Today','review the budget'],['Overdue','send the report'],['Upcoming','draft the notes'],['Unassigned','prepare the agenda']]){
  await view(label).click();await page.waitForFunction(expected=>document.querySelectorAll('.dashboard-task').length===1 && document.querySelector('.dashboard-task h2')?.textContent.includes(expected),task);assert.match(await page.locator('.dashboard-task h2').textContent(),new RegExp(task));
 }
 await view('All tasks').click();await page.getByLabel('Search tasks',{exact:true}).fill('Customer');await page.getByRole('status').filter({hasText:'2 tasks'}).waitFor();
 await page.getByLabel('Task status',{exact:true}).selectOption('');await page.getByRole('status').filter({hasText:'3 tasks'}).waitFor();
 await page.getByLabel('Task status',{exact:true}).selectOption('done');await page.getByRole('status').filter({hasText:'1 task ·'}).waitFor();assert.match(await page.locator('.dashboard-task h2').textContent(),/send invoices/);
 // Obsolete search results cannot replace a newer result after filters change.
 const received=Promise.withResolvers(),release=Promise.withResolvers(),fulfilled=Promise.withResolvers();
 await page.route('**/api/tasks?**',async route=>{if(new URL(route.request().url()).searchParams.get('query')!=='slow')return route.continue();const response=await route.fetch();received.resolve();await release.promise;await route.fulfill({response});fulfilled.resolve();});
 await page.getByLabel('Search tasks',{exact:true}).fill('slow');await received.promise;
 await page.getByLabel('Search tasks',{exact:true}).fill('Customer');await page.getByRole('status').filter({hasText:'1 task ·'}).waitFor();release.resolve();await fulfilled.promise;await page.waitForFunction(()=>document.querySelector('.dashboard-task h2')?.textContent.includes('send invoices'));
 await page.getByLabel('Search tasks',{exact:true}).fill('Launch');await page.getByLabel('Task status',{exact:true}).selectOption('open');await view('Upcoming').click();await page.getByRole('status').filter({hasText:'1 task ·'}).waitFor();
 // Escape clears only the search, keeps focus and filters, and respects IME composition.
 const search=page.getByLabel('Search tasks',{exact:true});await search.dispatchEvent('keydown',{key:'Escape',isComposing:true});assert.equal(await search.inputValue(),'Launch','Escape during text composition must not clear the query');
 const cleared=page.waitForResponse(response=>{const url=new URL(response.url());return url.pathname==='/api/tasks'&&url.searchParams.get('query')===''&&url.searchParams.get('status')==='open'&&url.searchParams.get('view')==='upcoming';});
 await search.press('Escape');await cleared;await page.getByRole('status').filter({hasText:'1 task ·'}).waitFor();assert.equal(await search.inputValue(),'');assert.equal(await page.getByLabel('Task status',{exact:true}).inputValue(),'open');assert.equal(await view('Upcoming').getAttribute('aria-pressed'),'true');assert.ok(await search.evaluate(el=>el===document.activeElement),'Clearing search keeps keyboard focus');
 await search.fill('Launch');await page.getByRole('status').filter({hasText:'1 task ·'}).waitFor();
 const target=launch.final_tasks.find(task=>task.owner==='Jon'),taskURL=`/meetings/${launch.id}?task=${target.proposal_id}`;
 await page.getByRole('button',{name:/^Open task & evidence/}).click();await openFullMeeting(page);await page.waitForFunction(id=>document.activeElement?.id===`confirmed-task-${id}`,target.proposal_id);assert.equal(new URL(page.url()).pathname+new URL(page.url()).search,taskURL);
 await page.getByRole('button',{name:'Locate passage 1 for confirmed task 3',exact:true}).click();await page.waitForFunction(()=>document.activeElement?.id==='saved-source');assert.equal(await page.locator('#saved-source mark').textContent(),target.evidence[0].text);
 await page.getByRole('button',{name:'Back to task',exact:true}).click();assert.ok(await page.getByRole('button',{name:'Locate passage 1 for confirmed task 3',exact:true}).evaluate(el=>el===document.activeElement));
 await page.goBack();await page.getByRole('heading',{name:'All tasks',exact:true}).waitFor();assert.equal(await page.getByLabel('Search tasks',{exact:true}).inputValue(),'Launch');assert.equal(await view('Upcoming').getAttribute('aria-pressed'),'true');
 await page.goForward();await page.waitForFunction(id=>document.activeElement?.id===`confirmed-task-${id}`,target.proposal_id);
 await page.reload();await page.waitForFunction(id=>document.activeElement?.id===`confirmed-task-${id}`,target.proposal_id);
 const confirmedCard=page.locator(`#confirmed-task-${target.proposal_id}`);
 await confirmedCard.getByRole('button',{name:`Copy task: ${target.task}`,exact:true}).click();await confirmedCard.getByRole('status').filter({hasText:'Task copied.'}).waitFor();assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),taskText(target));
 await page.getByRole('button',{name:'Copy action plan',exact:true}).click();await page.getByRole('status').filter({hasText:'Action plan copied.'}).waitFor();const copied=await page.evaluate(()=>navigator.clipboard.readText());assert.ok(copied.includes('Owner: Unknown'));assert.ok(copied.includes(target.evidence[0].text));assert.ok(copied.includes('send the report'));
 await page.getByLabel('Group action plan by',{exact:true}).selectOption('deadline');
 const download=page.waitForEvent('download');await page.getByRole('button',{name:'Download Markdown',exact:true}).click();const file=await download;assert.equal(file.suggestedFilename(),`briefactions-plan-${launch.id.slice(0,8)}.md`);const markdown=await readFile(await file.path(),'utf8');assert.match(markdown,/^# Launch planning/);assert.ok(markdown.indexOf('Deadline: '+shift(-1))<markdown.indexOf('Deadline: Unknown'));
 await page.evaluate(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async()=>{throw new Error('Denied');}}}));await page.getByRole('button',{name:'Copy action plan',exact:true}).click();await page.getByRole('alert').filter({hasText:'Clipboard access is unavailable'}).waitFor();await page.getByLabel('Action plan preview',{exact:true}).waitFor();await page.getByRole('button',{name:'Select plan text',exact:true}).click();assert.equal(await page.getByLabel('Action plan preview',{exact:true}).evaluate(el=>el.selectionEnd-el.selectionStart),await page.getByLabel('Action plan preview',{exact:true}).inputValue().then(text=>text.length));
 await confirmedCard.getByRole('button',{name:`Copy task: ${target.task}`,exact:true}).click();
 const taskPreview=confirmedCard.getByLabel('Task text to copy',{exact:true});await taskPreview.waitFor();assert.equal(await taskPreview.inputValue(),taskText(target));assert.ok(await taskPreview.evaluate(el=>el.readOnly&&el===document.activeElement&&el.selectionEnd-el.selectionStart===el.value.length));
 await confirmedCard.getByRole('button',{name:'Select task text',exact:true}).click();assert.equal(await taskPreview.evaluate(el=>el.selectionEnd-el.selectionStart),taskText(target).length);
 await scan(page,'clipboard-fallback');await page.getByLabel('Group action plan by',{exact:true}).selectOption('owner');await page.locator('.plan-export details>summary').click();
 for(const width of [1440,320]){await page.setViewportSize({width,height:1000});for(const theme of ['light','dark']){await page.getByLabel('Color theme').selectOption(theme);await scan(page,`plan-export-${width}-${theme}`);await page.getByRole('region',{name:'Export action plan',exact:true}).scrollIntoViewIfNeeded();await page.screenshot({path:path.join(shots,`action-plan-${width}-${theme}.png`)});}}
 // A manually added task also has a private, reloadable link to the exact card.
 const manual=customer.final_tasks.find(task=>task.source==='manual');await page.goto(base+`/meetings/${customer.id}?task=${manual.proposal_id}`);await page.waitForFunction(id=>document.activeElement?.id===`confirmed-task-${id}`,manual.proposal_id);
 await page.goto(base+`/meetings/${launch.id}?task=missing`);await page.getByRole('status').filter({hasText:'This task is not in the confirmed plan'}).waitFor();
 await page.goto(base+'/meetings/'+review.id);await page.getByRole('heading',{name:/Review action proposals/}).waitFor();await page.getByLabel('Review layout',{exact:true}).selectOption('detailed');
 const reason=page.getByRole('region',{name:'What to check for task 1',exact:true});await reason.waitFor();assert.ok((await reason.innerText()).includes(shift(3)));assert.ok((await page.getByRole('region',{name:'What to check for task 3',exact:true}).innerText()).includes('vague timing'));
 for(const theme of ['light','dark']){await page.getByLabel('Color theme').selectOption(theme);await scan(page,`review-reasons-${theme}`);await page.screenshot({path:path.join(shots,`review-reasons-${theme}.png`)});}
 await page.getByLabel('Deadline 2',{exact:true}).fill(shift(1));assert.equal(await page.getByRole('region',{name:'What to check for task 1',exact:true}).count(),0);
 await page.getByRole('button',{name:'All tasks',exact:true}).click();await page.getByLabel('Search tasks',{exact:true}).fill('');await view('All tasks').click();await page.getByRole('status').filter({hasText:'6 tasks'}).waitFor();
 for(const width of [1440,1180,768,390,320]){await page.setViewportSize({width,height:1000});for(const theme of ['light','dark']){await page.getByLabel('Color theme').selectOption(theme);await scan(page,`task-dashboard-${width}-${theme}`);await scrollWorkspace(page);if([1440,320].includes(width))await page.screenshot({path:path.join(shots,`task-dashboard-${width}-${theme}.png`),fullPage:width===320});}}
 // Missing clipboard support also offers a keyboard-accessible dashboard fallback.
 await page.evaluate(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:undefined}));
 await agendaCard.getByRole('button',{name:`Copy task: ${agenda.task}`,exact:true}).click();const dashboardPreview=agendaCard.getByLabel('Task text to copy',{exact:true});await dashboardPreview.waitFor();assert.equal(await dashboardPreview.inputValue(),taskText(agenda));assert.ok(await dashboardPreview.evaluate(el=>el===document.activeElement&&el.selectionEnd-el.selectionStart===el.value.length));
 for(const width of [1440,320])for(const theme of ['light','dark']){await page.setViewportSize({width,height:1000});await page.getByLabel('Color theme').selectOption(theme);await scan(page,`copy-task-fallback-${width}-${theme}`);await agendaCard.scrollIntoViewIfNeeded();await page.screenshot({path:path.join(shots,`copy-task-fallback-${width}-${theme}.png`)});}
 // Bounded pagination and deleting a source meeting update the dashboard projection.
 await confirm(await create('Pagination fixture',Array.from({length:13},(_,i)=>`Ada will review item ${i}.`).join('\n')));
 await page.getByRole('button',{name:'Refresh tasks',exact:true}).click();await page.getByRole('status').filter({hasText:'19 tasks'}).waitFor();await page.getByRole('button',{name:'Next tasks',exact:true}).click();await page.getByRole('status').filter({hasText:'Page 2 of 2'}).waitFor();assert.equal(await page.locator('.dashboard-task').count(),7);
 await post(`/api/runs/${launch.id}/delete`,{confirmation:'DELETE TRANSCRIPT'});await page.getByLabel('Search tasks',{exact:true}).fill('Launch');await page.getByRole('heading',{name:'No tasks in this view',exact:true}).waitFor();
 assert.deepEqual(errors,[]);console.log('Task dashboard and plan handoff passed: confirmed-only account projection, open/completed and date/owner views, search/stale-response isolation, pagination/deletion, exact task links/back/forward/reload/manual evidence, clipboard recovery, grouped safe Markdown downloads, actionable review explanations, and desktop/mobile accessibility in both themes.');
}catch(error){const page=browser?.contexts()[0]?.pages()[0];if(page){await page.screenshot({path:path.join(shots,'dashboard-failure.png'),fullPage:true}).catch(()=>{});await writeFile(path.join(shots,'dashboard-failure.txt'),await page.locator('body').innerText().catch(()=>''));}throw error;}finally{await writeFile(path.join(shots,'task-dashboard-accessibility.json'),JSON.stringify(checks,null,2));await browser?.close();server.closeAllConnections();await server.shutdown();await rm(folder,{recursive:true,force:true});}
