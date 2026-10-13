import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {chromium} from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import {createApp,pythonBinary} from '../server/index.mjs';

const folder=await mkdtemp(path.join(tmpdir(),'flow-drafts-history-')),historyPath=path.join(folder,'history.sqlite3');
const shots=process.env.FLOW_SCREENSHOTS || path.join(folder,'screenshots');await mkdir(shots,{recursive:true});
const server=createApp({historyPath});let browser;
try{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`;
 browser=await chromium.launch({headless:true,...(process.env.FLOW_CHROMIUM_PATH?{executablePath:process.env.FLOW_CHROMIUM_PATH}:{})});
 const context=await browser.newContext(),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(base);await page.getByRole('button',{name:'Try an example',exact:true}).waitFor();
 const input='Maya will send the café report tomorrow.';
 await page.getByLabel('Meeting transcript',{exact:true}).fill(input);await page.getByLabel('Meeting date',{exact:true}).fill('2026-10-13');await page.getByLabel('Meeting name',{exact:true}).fill('Sprint café');await page.getByLabel('Maximum groups').selectOption('2');
 await page.reload();await page.getByRole('status').filter({hasText:'Restored transcript draft'}).waitFor();
 assert.equal(await page.getByLabel('Meeting transcript',{exact:true}).inputValue(),input);assert.equal(await page.getByLabel('Meeting date',{exact:true}).inputValue(),'2026-10-13');assert.equal(await page.getByLabel('Meeting name',{exact:true}).inputValue(),'Sprint café');assert.equal(await page.getByLabel('Maximum groups').inputValue(),'2');
 assert.equal((await (await fetch(base+'/api/runs')).json()).length,0);
 await page.route('**/api/account',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Workspace temporarily unavailable.'})}));await page.reload();await page.getByRole('alert').filter({hasText:'temporarily unavailable'}).waitFor();assert.equal(await page.getByLabel('Meeting transcript',{exact:true}).inputValue(),input);assert.equal(await page.getByLabel('Meeting name',{exact:true}).inputValue(),'Sprint café');await page.unroute('**/api/account');await page.reload();await page.getByRole('status').filter({hasText:'Restored transcript draft'}).waitFor();
 // Independent tabs share account storage but cannot overwrite each other's input drafts.
 const other=await context.newPage();await other.goto(base);await other.getByRole('button',{name:'Try an example',exact:true}).waitFor();assert.equal(await other.getByLabel('Meeting transcript',{exact:true}).inputValue(),'');
 await other.getByLabel('Meeting transcript',{exact:true}).fill('Tab two only.');await other.reload();await other.getByRole('status').filter({hasText:'Restored transcript draft'}).waitFor();assert.equal(await other.getByLabel('Meeting transcript',{exact:true}).inputValue(),'Tab two only.');
 await page.reload();await page.getByRole('status').filter({hasText:'Restored transcript draft'}).waitFor();assert.equal(await page.getByLabel('Meeting transcript',{exact:true}).inputValue(),input);
 await page.getByRole('button',{name:'Analyze transcript',exact:true}).click();await page.getByRole('heading',{name:/Review action proposals/}).waitFor();
 const rid=await page.evaluate(()=>localStorage.getItem('flow.activeRun'));
 await page.getByLabel('Task 1',{exact:true}).fill('Send reviewed café report');await page.getByLabel('Keep task 1',{exact:true}).check();await page.getByRole('button',{name:'Confirm selected tasks',exact:true}).click();await page.getByRole('heading',{name:'Your confirmed plan',exact:true}).waitFor();
 const before=await (await fetch(base+`/api/runs/${rid}`)).json();
 await page.getByLabel('Meeting name',{exact:true}).fill('Release planning');await page.getByRole('button',{name:'Save meeting name',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.result-meta').textContent.includes('Release planning'));
 const named=await (await fetch(base+`/api/runs/${rid}`)).json();assert.equal(named.title,'Release planning');assert.equal(named.events[0].payload.title,'Sprint café');assert.deepEqual(named.final_tasks,before.final_tasks);assert.deepEqual(named.events.slice(0,-1),before.events);
 // Park an unsubmitted meeting, open a saved plan, then resume without overwriting either input.
 await page.getByRole('button',{name:'New meeting',exact:true}).click();assert.equal(await page.getByLabel('Meeting transcript',{exact:true}).inputValue(),'');
 await page.getByLabel('Meeting transcript',{exact:true}).fill('Jon will review the board notes.');await page.getByLabel('Meeting name',{exact:true}).fill('Unsubmitted board');
 await page.getByRole('button',{name:'Run history',exact:true}).click();await page.getByRole('button',{name:'Open run',exact:true}).click();await page.getByRole('heading',{name:'Your confirmed plan',exact:true}).waitFor();assert.equal(await page.getByLabel('Meeting transcript',{exact:true}).inputValue(),input);
 await page.getByRole('button',{name:'New meeting',exact:true}).click();assert.equal(await page.getByLabel('Meeting transcript',{exact:true}).inputValue(),'Jon will review the board notes.');await page.reload();await page.getByRole('status').filter({hasText:'Restored transcript draft'}).waitFor();assert.equal(await page.getByLabel('Meeting name',{exact:true}).inputValue(),'Unsubmitted board');
 await page.getByRole('button',{name:'Discard transcript draft',exact:true}).click();await page.reload();await page.getByRole('button',{name:'Try an example',exact:true}).waitFor();assert.equal(await page.getByLabel('Meeting transcript',{exact:true}).inputValue(),'');
 // Storage failures must be visible and must not permit replacing unsaved input with another run.
 await page.evaluate(()=>{window.originalStorageSet=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k.includes('flow.inputDraft.'))throw new DOMException('Blocked','QuotaExceededError');return window.originalStorageSet.call(this,k,v);};});
 await page.getByLabel('Meeting transcript',{exact:true}).fill('Unsaved text while storage is blocked.');await page.getByRole('status').filter({hasText:'could not be saved'}).waitFor();await page.getByRole('button',{name:'Run history',exact:true}).click();await page.getByRole('button',{name:'Open run',exact:true}).click();assert.ok(await page.getByRole('heading',{name:'Your run history.',exact:true}).isVisible());
 await page.evaluate(()=>{Storage.prototype.setItem=window.originalStorageSet;});await page.getByRole('button',{name:'Extract & review',exact:true}).click();assert.equal(await page.getByLabel('Meeting transcript',{exact:true}).inputValue(),'Unsaved text while storage is blocked.');await page.getByRole('button',{name:'Discard transcript draft',exact:true}).click();
 const seed=spawnSync(pythonBinary(),['-B','-c',"import sys; from history import HistoryStore; h=HistoryStore(sys.argv[1]); [h.create_run('Meeting fixture '+str(i),'2026-09-15',[],title='Planning '+str(i)) for i in range(26)]",historyPath],{encoding:'utf8'});assert.equal(seed.status,0,seed.stderr);
 await page.getByRole('button',{name:'Run history',exact:true}).click();await page.getByRole('status').filter({hasText:'27 meetings'}).waitFor();assert.equal(await page.locator('.history-card').count(),12);
 await page.getByRole('button',{name:'Next meetings',exact:true}).click();await page.getByText('Page 2 of 3',{exact:true}).waitFor();assert.equal(await page.locator('.history-card').count(),12);
 await page.getByRole('button',{name:'Next meetings',exact:true}).click();await page.getByText('Page 3 of 3',{exact:true}).waitFor();assert.equal(await page.locator('.history-card').count(),3);
 await page.getByLabel('Search meetings',{exact:true}).fill('CAFÉ');await page.getByRole('status').filter({hasText:'1 meeting · Page 1 of 1'}).waitFor();assert.equal(await page.locator('.history-card h3').textContent(),'Release planning');
 await page.getByLabel('Review status',{exact:true}).selectOption('review');await page.getByRole('heading',{name:'No meetings match your search.',exact:true}).waitFor();await page.getByRole('button',{name:'Clear filters',exact:true}).click();
 await page.getByLabel('From meeting date',{exact:true}).fill('2026-10-01');await page.getByLabel('To meeting date',{exact:true}).fill('2026-10-31');await page.getByRole('status').filter({hasText:'1 meeting · Page 1 of 1'}).waitFor();
 await page.getByLabel('To meeting date',{exact:true}).fill('2026-09-01');await page.getByRole('alert').filter({hasText:'From date must be on or before'}).waitFor();await page.getByRole('button',{name:'Clear filters',exact:true}).click();await page.getByRole('status').filter({hasText:'27 meetings'}).waitFor();
 // A delayed old query cannot overwrite the results for the latest words.
 let release;const held=new Promise(resolve=>release=resolve);await page.route('**/api/runs/search?**',async route=>{if(new URL(route.request().url()).searchParams.get('query')!=='slow')return route.continue();await held;await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({items:[{id:rid,title:'Stale result',status:'confirmed',reference_date:'2026-10-13',created_at:before.created_at,preview:'Old query',proposal_count:1}],total:1,page:0,page_size:12})});});
 const slow=page.waitForRequest(r=>new URL(r.url()).searchParams.get('query')==='slow');await page.getByLabel('Search meetings',{exact:true}).fill('slow');await slow;
 await page.getByLabel('Search meetings',{exact:true}).fill('Release');await page.getByRole('heading',{name:'Release planning',exact:true}).waitFor();const oldResponse=page.waitForResponse(r=>new URL(r.url()).searchParams.get('query')==='slow');release();await (await oldResponse).finished();await page.unrouteAll({behavior:'wait'});await page.waitForLoadState('networkidle');assert.equal(await page.getByRole('heading',{name:'Stale result',exact:true}).count(),0);
 for(const width of [1440,320]){await page.setViewportSize({width,height:900});for(const theme of ['light','dark']){await page.getByLabel('Color theme').selectOption(theme);const scan=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa']).analyze();assert.deepEqual(scan.violations,[],`${width} ${theme} history accessibility`);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:path.join(shots,`meeting-history-${width}-${theme}.png`),fullPage:true});}}
 assert.deepEqual(errors,[]);console.log('Drafts and meeting history passed: typing/reload recovery, no pre-analysis server save, tab isolation, named analyses, audited renames preserving final tasks, parked new draft, explicit discard, storage failure protection, paginated search/date/status filters, invalid filters, stale response isolation, and desktop/mobile accessibility in both themes.');
}finally{await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await rm(folder,{recursive:true,force:true});}
