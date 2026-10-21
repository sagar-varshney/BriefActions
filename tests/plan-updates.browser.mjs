import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {chromium} from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import {createApp} from '../server/index.mjs';
const folder=await mkdtemp(path.join(tmpdir(),'briefactions-change-review-')),shots=process.env.FLOW_SCREENSHOTS||path.join(folder,'screenshots');await mkdir(shots,{recursive:true});
const server=createApp({historyPath:path.join(folder,'history.sqlite3')});let browser;const checks=[];
async function scan(page,label){const result=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa']).analyze();checks.push({label,violations:result.violations});assert.deepEqual(result.violations,[],label);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),label+' overflow');}
try{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`;
 const post=async(url,input)=>{const response=await fetch(base+url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)});assert.ok(response.ok,await response.clone().text());return response.json();};
 const seed=async()=>{const r=await post('/api/runs',{title:'Launch planning',transcript:'Context: launch notes 📋.\nMaya will send the report by Friday.\nJon will draft the notes.\nLee will check capacity.',reference_date:'2026-10-16'});return post(`/api/runs/${r.id}/finalize`,{decisions:r.proposals.map(p=>({...p,accept:true}))});};
 const original=await seed();await post(`/api/runs/${original.id}/progress`,{proposal_id:original.final_tasks[0].proposal_id,status:'in_progress',version:0,request_id:'a'.repeat(32)});
 browser=await chromium.launch({headless:true,...(process.env.FLOW_CHROMIUM_PATH?{executablePath:process.env.FLOW_CHROMIUM_PATH}:{})});
 const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(base+'/meetings/'+original.id);await page.getByRole('heading',{name:'Your confirmed plan',exact:true}).waitFor();
 await page.locator('.followup-panel>summary').click();
 const followup='Maya: Move the report to Monday.\nJon: Cancel the notes.\nAda: I will review the budget tomorrow.';
 await page.getByLabel('Follow-up transcript',{exact:true}).fill(followup);await page.getByLabel('Follow-up meeting date',{exact:true}).fill('2026-10-17');
 await page.reload();await page.getByRole('heading',{name:'Your confirmed plan',exact:true}).waitFor();await page.locator('.followup-panel>summary').click();assert.equal(await page.getByLabel('Follow-up transcript',{exact:true}).inputValue(),followup);
 // A saved interrupted analysis must be recovered before another workflow starts.
 await page.evaluate(id=>localStorage.setItem('flow.pendingAnalysis',JSON.stringify({request_id:'f'.repeat(32),transcript:'Unfinished analysis input.',reference_date:'2026-10-16',clusters:1,source_context:id})),original.id);
 await page.reload();await page.getByRole('status').filter({hasText:'An unfinished analysis is saved.'}).waitFor();await page.locator('.followup-panel>summary').click();await page.getByRole('button',{name:'Compare with this plan',exact:true}).click();await page.getByRole('alert').filter({hasText:'Finish recovering the saved analysis'}).waitFor();assert.equal((await (await fetch(base+'/api/runs')).json()).length,1);
 assert.ok(await page.evaluate(()=>!!localStorage.getItem('flow.pendingAnalysis')));await page.evaluate(()=>localStorage.removeItem('flow.pendingAnalysis'));await page.reload();await page.getByRole('heading',{name:'Your confirmed plan',exact:true}).waitFor();await page.locator('.followup-panel>summary').click();
 // The server commits, but the browser loses the comparison response.
 let lostCreate=false;await page.route('**/api/runs/*/updates',async route=>{const response=await route.fetch();assert.equal(response.status(),201);lostCreate=true;await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Synthetic lost response.'})});});
 await page.getByRole('button',{name:'Retry comparison',exact:true}).click();await page.getByRole('heading',{name:'Review plan changes',exact:true}).waitFor();assert.ok(lostCreate);const child=new URL(page.url()).pathname.split('/').at(-1);assert.notEqual(child,original.id);
 await page.evaluate(id=>localStorage.setItem('flow.pendingAnalysis',JSON.stringify({request_id:'f'.repeat(32),transcript:'Another unfinished analysis.',reference_date:'2026-10-17',clusters:1,source_context:id})),child);
 await page.reload();await page.getByRole('status').filter({hasText:'An unfinished analysis is saved.'}).waitFor();await page.getByRole('button',{name:'Confirm updated plan',exact:true}).click();await page.getByRole('alert').filter({hasText:'Finish recovering the saved analysis before confirming'}).waitFor();assert.equal((await (await fetch(base+'/api/runs/'+child)).json()).status,'review');await page.evaluate(()=>localStorage.removeItem('flow.pendingAnalysis'));await page.reload();await page.getByRole('heading',{name:'Review plan changes',exact:true}).waitFor();
 assert.equal((await (await fetch(base+'/api/tasks?today=2026-10-17&status=')).json()).total,3);
 const group=page.getByRole('group',{name:'Plan change types'});
 for(const [label,number] of [['Added',4],['Changed',1],['Cancelled',2],['Unchanged',3]]){
  const filter=group.getByRole('button',{name:`${label} (1)`,exact:true}),card=page.getByRole('article',{name:`${label} task ${number}`,exact:true});
  assert.equal(await filter.count(),1);assert.equal(await card.locator('.badge').textContent(),label);
  for(const icon of [filter.locator('svg'),card.locator('.badge svg')]){assert.equal(await icon.getAttribute('aria-hidden'),'true');assert.equal(await icon.getAttribute('focusable'),'false');assert.ok(await icon.isVisible());}
 }
 await page.waitForFunction(()=>document.title==='Extract & review · BriefActions');
 assert.equal(await page.getByRole('checkbox',{checked:true}).count(),0);
 await page.getByLabel('Apply added change for task 4',{exact:true}).check();await page.getByLabel('Owner for change 4',{exact:true}).fill('Uma');await page.getByLabel('Deadline for change 4',{exact:true}).fill('2026-');
 await page.getByRole('status').filter({hasText:'Review saved to history.'}).waitFor();
 await page.reload();await page.getByRole('heading',{name:'Review plan changes',exact:true}).waitFor();assert.equal(await page.getByLabel('Deadline for change 4',{exact:true}).inputValue(),'2026-');assert.equal(await page.getByLabel('Owner for change 4',{exact:true}).inputValue(),'Uma');assert.ok(await page.getByLabel('Apply added change for task 4',{exact:true}).isChecked());
 await group.getByRole('button',{name:'Cancelled (1)',exact:true}).click();await page.getByRole('button',{name:'Confirm updated plan',exact:true}).click();await page.getByRole('alert').filter({hasText:'Check the approved change'}).waitFor();await page.waitForFunction(()=>document.activeElement?.getAttribute('aria-label')==='Deadline for change 4');
 await page.getByLabel('Deadline for change 4',{exact:true}).fill('2026-10-18');await page.getByLabel('Apply cancelled change for task 2',{exact:true}).check();
 const changed=page.getByRole('article',{name:'Changed task 1',exact:true});await changed.locator('summary').click();await changed.getByRole('button',{name:'Locate passage 1 for follow-up task 1',exact:true}).click();await page.waitForFunction(()=>document.activeElement?.id==='saved-source');assert.equal(await page.locator('#saved-source mark').textContent(),'Maya: Move the report to Monday.');await page.getByRole('button',{name:'Back to task',exact:true}).click();assert.ok(await changed.getByRole('button',{name:'Locate passage 1 for follow-up task 1',exact:true}).evaluate(e=>e===document.activeElement));
 await group.getByRole('button',{name:'Added (1)',exact:true}).click();assert.equal(await page.getByRole('button',{name:'Back to task',exact:true}).count(),0);await group.getByRole('button',{name:'All (4)',exact:true}).click();await page.getByRole('status').filter({hasText:'Review saved to history.'}).waitFor();
 // Confirmation stays reachable during long reviews, without hiding focused fields.
 for(const [width,height] of [[1440,800],[320,640],[320,400]]){
  await page.setViewportSize({width,height});
  for(const theme of ['light','dark']){
   await page.getByLabel('Color theme').selectOption(theme);
   await page.locator('.plan-change-card').nth(1).evaluate(el=>scrollTo({top:scrollY+el.getBoundingClientRect().top-100,behavior:'instant'}));
   const bar=page.getByRole('region',{name:'Review confirmation',exact:true});
   await page.waitForFunction(()=>{const r=document.querySelector('.plan-confirmation').getBoundingClientRect();return r.top>=0&&Math.abs(r.bottom-(innerHeight-8))<=2;});
   assert.equal(await bar.getByRole('status').textContent(),'2 of 3 changes approved.');
   const reachable=await bar.getByRole('button',{name:'Confirm updated plan',exact:true}).evaluate(el=>{const r=el.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.bottom<=innerHeight&&el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));});assert.ok(reachable,`Sticky confirm is reachable: ${width}x${height} ${theme}`);
   await page.getByLabel('Deadline for change 4',{exact:true}).focus();
   const bounds=await page.evaluate(()=>{const field=document.activeElement.getBoundingClientRect(),bar=document.querySelector('.plan-confirmation').getBoundingClientRect();return {fieldTop:field.top,fieldBottom:field.bottom,barTop:bar.top,headerBottom:Math.max(0,document.querySelector('.workspace-header').getBoundingClientRect().bottom)};});assert.ok(bounds.fieldTop>=bounds.headerBottom&&bounds.fieldBottom<=bounds.barTop,`Focused field stays above controls: ${JSON.stringify(bounds)}`);
   await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.activeElement.tagName),'SUMMARY');
   const clear=await page.evaluate(()=>document.activeElement.getBoundingClientRect().bottom<=document.querySelector('.plan-confirmation').getBoundingClientRect().top);assert.ok(clear,'Keyboard focus must not be hidden under the action bar');
   await page.keyboard.press('Tab');assert.ok(await bar.getByRole('button',{name:'Confirm updated plan',exact:true}).evaluate(el=>el===document.activeElement));
   await scan(page,`sticky-confirmation-${width}-${height}-${theme}`);await page.screenshot({path:path.join(shots,`sticky-confirmation-${width}-${height}-${theme}.png`)});
  }
 }
 for(const width of [1440,320]){await page.setViewportSize({width,height:1000});for(const theme of ['light','dark']){await page.getByLabel('Color theme').selectOption(theme);await scan(page,`plan-changes-${width}-${theme}`);await page.getByRole('heading',{name:'Review plan changes',exact:true}).scrollIntoViewIfNeeded();await page.screenshot({path:path.join(shots,`plan-changes-${width}-${theme}.png`),fullPage:true});}}
 await page.setViewportSize({width:1440,height:1000});
 // Confirmation also recovers a committed result after a lost response.
 let lostConfirm=false;await page.route('**/api/runs/*/update-confirm',async route=>{const response=await route.fetch();assert.equal(response.status(),200);lostConfirm=true;await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Synthetic lost confirmation.'})});});
 await page.getByRole('button',{name:'Confirm updated plan',exact:true}).click();await page.getByRole('heading',{name:'Your confirmed plan',exact:true}).waitFor();assert.ok(lostConfirm);
 const result=await (await fetch(base+'/api/runs/'+child)).json();assert.equal(result.final_tasks.length,3);assert.equal(result.final_tasks.find(t=>t.owner==='Maya').deadline,'2026-10-16');assert.equal(result.task_progress[original.final_tasks[0].proposal_id].status,'in_progress');assert.equal(result.final_tasks.find(t=>t.owner==='Uma').task,'review the budget');assert.ok(!result.final_tasks.some(t=>t.owner==='Jon'));
 await page.getByRole('button',{name:'All tasks',exact:true}).click();await page.getByRole('status').filter({hasText:'3 tasks'}).waitFor();assert.equal(await page.locator('.dashboard-task').count(),3);
 await page.goto(base+'/meetings/'+original.id);await page.getByRole('button',{name:'Open newer plan',exact:true}).waitFor();assert.ok(await page.getByLabel('Progress for task 1',{exact:true}).isDisabled());await page.getByRole('button',{name:'Open newer plan',exact:true}).click();await page.waitForURL(base+'/meetings/'+child);await page.getByRole('heading',{name:'Your confirmed plan',exact:true}).waitFor();assert.equal(new URL(page.url()).pathname,'/meetings/'+child);
 await page.getByText('Review the changes behind this plan',{exact:true}).click();await page.getByRole('heading',{name:'Reviewed plan changes',exact:true}).waitFor();assert.ok(await page.getByLabel('Apply cancelled change for task 2',{exact:true}).isChecked());await scan(page,'confirmed-change-audit');
 // Stale review choices from another tab cannot overwrite the first tab's edits.
 const second=await seed(),comparison=await post(`/api/runs/${second.id}/updates`,{transcript:'Maya will send the report tomorrow.',reference_date:'2026-10-17',request_id:'b'.repeat(32)});
 const other=await context.newPage();await page.goto(base+'/meetings/'+comparison.id);await other.goto(base+'/meetings/'+comparison.id);await page.getByRole('heading',{name:'Review plan changes',exact:true}).waitFor();await other.getByRole('heading',{name:'Review plan changes',exact:true}).waitFor();
 await page.getByLabel('Owner for change 1',{exact:true}).fill('Nora');await page.getByRole('status').filter({hasText:'Review saved to history.'}).waitFor();await other.getByLabel('Owner for change 1',{exact:true}).fill('Stale');await other.getByRole('alert').filter({hasText:'This comparison changed in another tab.'}).waitFor();assert.ok(await other.getByRole('button',{name:'Confirm updated plan',exact:true}).isDisabled());
 await other.getByRole('button',{name:'Use saved review',exact:true}).click();await other.getByRole('status').filter({hasText:'Loaded the saved review'}).waitFor();assert.equal(await other.getByLabel('Owner for change 1',{exact:true}).inputValue(),'Nora');await other.close();
 // Erasure clears copied follow-up records and browser drafts, including after reload.
 // Wait for the real load event: the old heading/hash navigation can otherwise
 // satisfy checks just before reload destroys their JavaScript context.
 await page.goto(base+'/meetings/'+child);await page.getByRole('heading',{name:'Your confirmed plan',exact:true}).waitFor();await page.evaluate(({root,child})=>{localStorage.setItem(`flow.planUpdateReview.${child}.fixture`,JSON.stringify({root,private:'synthetic'}));},{root:original.id,child});
 await page.getByRole('button',{name:'Data & account',exact:true}).click();await page.getByRole('button',{name:`Delete extraction ${original.id.slice(0,8)}`,exact:true}).click();await page.getByLabel('Deletion confirmation').fill('DELETE TRANSCRIPT');await Promise.all([page.waitForEvent('load'),page.getByRole('button',{name:'Delete transcript',exact:true}).click()]);await page.getByRole('heading',{name:'Data & account.',exact:true}).waitFor();await page.waitForFunction(id=>!Object.keys(localStorage).some(k=>k.includes(id)),child);assert.equal((await fetch(base+'/api/runs/'+child)).status,404);assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('flow.erasure')).id),original.id);
 assert.deepEqual(errors,[]);await writeFile(path.join(shots,'plan-change-accessibility.json'),JSON.stringify(checks,null,2));console.log('Plan changes: types, draft recovery, approval/corrections, private links, supersession, progress, stale reviews, lost responses, erasure, keyboard, mobile, and both-theme accessibility passed.');
}finally{await browser?.close();server.closeAllConnections();await server.shutdown();await rm(folder,{recursive:true,force:true});}
