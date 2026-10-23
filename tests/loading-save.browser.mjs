import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {chromium} from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import {createApp} from '../server/index.mjs';
import {navigate} from './browser-helpers.mjs';

const folder=await mkdtemp(path.join(tmpdir(),'briefactions-loading-save-')),shots=process.env.FLOW_SCREENSHOTS||path.join(folder,'screenshots');await mkdir(shots,{recursive:true});
const server=createApp({historyPath:path.join(folder,'history.sqlite3')});let browser;const releases=[],checks=[];
async function hold(page,pattern){const entered=Promise.withResolvers(),release=Promise.withResolvers();releases.push(release.resolve);await page.route(pattern,async route=>{const response=await route.fetch();entered.resolve();await release.promise;await route.fulfill({response});},{times:1});return {entered:entered.promise,release:release.resolve};}
async function scan(page,label){const result=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa']).analyze();checks.push({label,violations:result.violations});assert.deepEqual(result.violations,[],label);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),label+' overflow');await page.screenshot({path:path.join(shots,label+'.png'),fullPage:true});}
try{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`;
 const post=async(url,body)=>{const response=await fetch(base+url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});assert.ok(response.ok,await response.clone().text());return response.json();};
 const get=async url=>(await fetch(base+url)).json();
 const run=await post('/api/runs',{transcript:'Maya will send the report tomorrow.',reference_date:'2026-10-23',title:'Invented loading and save test'});
 const example=await post('/api/annotations',{transcript:'Maya will send the notes.',reference_date:'2026-10-23',source:'synthetic',group:'Save feedback test',permission:true,anonymized:true});
 const manifest=JSON.parse(await readFile(new URL('../dist/.vite/manifest.json',import.meta.url),'utf8')),asset=name=>'/'+manifest[Object.keys(manifest).find(key=>key.endsWith('/'+name+'.jsx'))].file;
 browser=await chromium.launch({headless:true,...(process.env.FLOW_CHROMIUM_PATH?{executablePath:process.env.FLOW_CHROMIUM_PATH}:{})});
 const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage(),errors=[],requests=[];
 let expectedChunkFailure=false,simulateChunkFailure=false;
 page.on('requestfailed',request=>{if(simulateChunkFailure&&new URL(request.url()).pathname===asset('WorkspaceApp'))expectedChunkFailure=true;});
 page.on('pageerror',error=>{if(simulateChunkFailure&&/Failed to fetch dynamically imported module|Importing a module script failed/.test(error.message))expectedChunkFailure=true;else errors.push(error.message);});page.on('request',request=>requests.push(new URL(request.url()).pathname));
 await page.goto(base+'/');await page.getByRole('region',{name:'Try a conversation. See the plan.',exact:true}).waitFor();await page.waitForLoadState('networkidle');
 for(const name of ['WorkspaceApp','AnnotationReviewer','BenchmarkPage'])assert.ok(!requests.includes(asset(name)),name+' is not downloaded by the landing page');
 assert.deepEqual(requests.filter(url=>url.startsWith('/api/')&&url!=='/api/auth-config'),[],'The public page does not load private data');
 await page.goto(base+'/meetings/'+run.id);await page.getByRole('heading',{name:/Review action proposals/}).waitFor();
 for(const name of ['AnnotationReviewer','BenchmarkPage'])assert.ok(!requests.includes(asset(name)),name+' is not downloaded by the meeting workspace');
 const owner=page.getByLabel('Owner 1',{exact:true}),feedback=page.locator('.review-save-state .save-feedback');
 const first=await hold(page,`**/api/runs/${run.id}/draft`);await owner.fill('Alex');await first.entered;
 await owner.fill('Bea');const second=await hold(page,`**/api/runs/${run.id}/draft`);first.release();await second.entered;
 await feedback.getByText('Saving…',{exact:true}).waitFor();assert.equal(await feedback.getByText('Saved',{exact:true}).count(),0,'An older response cannot mark newer edits saved');
 second.release();await feedback.getByText('Saved',{exact:true}).waitFor();assert.equal((await get('/api/runs/'+run.id)).draft.decisions[0].owner,'Bea');
 await page.route(`**/api/runs/${run.id}/draft`,route=>route.fulfill({status:503,json:{error:'Invented save outage.'}}),{times:1});await owner.fill('Casey');
 await feedback.getByText('Couldn’t save',{exact:true}).waitFor();assert.match(await feedback.innerText(),/Draft kept in this browser/);
 for(const width of [320,1440])for(const theme of ['light','dark']){await page.setViewportSize({width,height:1000});await page.getByLabel('Color theme').selectOption(theme);await scan(page,`save-retry-${width}-${theme}`);await feedback.screenshot({path:path.join(shots,`save-feedback-${width}-${theme}.png`)});}
 const retry=await hold(page,`**/api/runs/${run.id}/draft`);await feedback.getByRole('button',{name:'Retry saving draft',exact:true}).click();await retry.entered;await feedback.getByText('Saving…',{exact:true}).waitFor();retry.release();await feedback.getByText('Saved',{exact:true}).waitFor();assert.equal((await get('/api/runs/'+run.id)).draft.decisions[0].owner,'Casey');
 // A blocked local cache must never be reported as a successful browser save.
 await page.evaluate(()=>{window.originalSetItem=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){if(key.includes('flow.draft.'))throw new DOMException('Blocked','QuotaExceededError');return window.originalSetItem.call(this,key,value);};});
 await page.route(`**/api/runs/${run.id}/draft`,route=>route.fulfill({status:503,json:{error:'Invented save outage.'}}),{times:1});await owner.fill('Drew');await feedback.getByText('Couldn’t save',{exact:true}).waitFor();assert.match(await feedback.innerText(),/Browser storage is unavailable/);assert.doesNotMatch(await feedback.innerText(),/Draft kept in this browser/);
 await page.evaluate(()=>{Storage.prototype.setItem=window.originalSetItem;});await feedback.getByRole('button',{name:'Retry saving draft',exact:true}).click();await feedback.getByText('Saved',{exact:true}).waitFor();
 // A failed workspace download can recover on reload, including a dirty browser draft.
 await owner.fill('Emery');simulateChunkFailure=true;
 await page.route('**'+asset('WorkspaceApp'),route=>route.abort('failed'),{times:1});await page.reload();await page.getByRole('heading',{name:'This section couldn’t load.',exact:true}).waitFor();assert.ok(expectedChunkFailure);simulateChunkFailure=false;
 await page.getByRole('button',{name:'Reload page',exact:true}).click();await page.getByRole('heading',{name:/Review action proposals/}).waitFor();assert.equal(await owner.inputValue(),'Emery');await feedback.getByText('Saved',{exact:true}).waitFor();assert.equal((await get('/api/runs/'+run.id)).draft.decisions[0].owner,'Emery');
 // A late section download must not steal focus from a newer navigation choice.
 const moduleHold=await hold(page,'**'+asset('BenchmarkPage'));await navigate(page,'Compare extraction methods');await moduleHold.entered;await page.getByRole('status').filter({hasText:'Loading Compare extraction methods…'}).waitFor();await navigate(page,'All tasks');moduleHold.release();await page.getByRole('heading',{name:'All tasks',exact:true}).waitFor();await page.waitForLoadState('networkidle');assert.equal(await page.evaluate(()=>document.activeElement.textContent),'All tasks');
 await navigate(page,'Compare extraction methods');await page.getByRole('region',{name:'Extraction comparison table',exact:true}).waitFor();await page.waitForFunction(()=>document.activeElement?.tagName==='H1'&&document.activeElement.textContent==='Compare extraction methods.');assert.ok(requests.includes(asset('BenchmarkPage')));
 await navigate(page,'Label & review examples');await page.getByRole('button',{name:'Label example '+example.id.slice(0,6),exact:true}).click();await page.getByLabel('Reviewer identity',{exact:true}).fill('Save feedback reviewer');await page.getByRole('button',{name:'Start or resume review',exact:true}).click();
 const expected=page.getByLabel('Expected task',{exact:true});await expected.waitFor();
 const a=await hold(page,`**/api/annotations/${example.id}/draft`);await expected.fill('Send notes');await a.entered;await expected.fill('Send reviewed notes');const b=await hold(page,`**/api/annotations/${example.id}/draft`);a.release();await b.entered;await page.locator('.save-feedback').getByText('Saving…',{exact:true}).waitFor();assert.equal(await page.locator('.save-feedback').getByText('Saved',{exact:true}).count(),0);b.release();await page.locator('.save-feedback').getByText('Saved',{exact:true}).waitFor();
 await page.route(`**/api/annotations/${example.id}/draft`,route=>route.fulfill({status:503,json:{error:'Invented annotation outage.'}}),{times:1});await expected.fill('Send final notes');await page.locator('.save-feedback').getByText('Couldn’t save',{exact:true}).waitFor();await page.getByRole('button',{name:'Retry saving draft',exact:true}).click();await page.locator('.save-feedback').getByText('Saved',{exact:true}).waitFor();
 // Follow-up reviews use the same pending/saved/error language without applying changes.
 const source=await post('/api/runs',{transcript:'Maya will send the report tomorrow.',reference_date:'2026-10-23',title:'Invented follow-up save test'});
 await post(`/api/runs/${source.id}/finalize`,{decisions:source.proposals.map(p=>({...p,accept:true}))});
 const followup=await post(`/api/runs/${source.id}/updates`,{transcript:'Maya: Move the report to Monday.',reference_date:'2026-10-24',request_id:crypto.randomUUID().replaceAll('-','')});
 await page.goto(base+'/meetings/'+followup.id);await page.getByRole('heading',{name:'Review plan changes',exact:true}).waitFor();const changeOwner=page.getByLabel('Owner for change 1',{exact:true}),changeFeedback=page.locator('.plan-comparison .save-feedback');
 await page.route(`**/api/runs/${followup.id}/update-draft`,route=>route.fulfill({status:503,json:{error:'Invented follow-up save outage.'}}),{times:1});await changeOwner.fill('Finley');await changeFeedback.getByText('Couldn’t save',{exact:true}).waitFor();
 const changeSave=await hold(page,`**/api/runs/${followup.id}/update-draft`);await page.getByRole('button',{name:'Retry saving review',exact:true}).click();await changeSave.entered;assert.ok(await page.getByRole('button',{name:'Retry saving review',exact:true}).isDisabled());await changeFeedback.getByText('Saving…',{exact:true}).waitFor();changeSave.release();await changeFeedback.getByText('Saved',{exact:true}).waitFor();assert.equal((await get('/api/runs/'+followup.id)).status,'review','Saving a draft must not confirm the plan');
 // Calendar empty-state actions preserve a parked input and reset filters only on demand.
 await navigate(page,'Extract & review');await page.getByRole('button',{name:'New meeting',exact:true}).click();await page.getByLabel('Meeting transcript',{exact:true}).fill('Parked transcript for a later meeting.');await navigate(page,'Calendar');await page.getByLabel('Calendar month',{exact:true}).fill('2100-01');await page.getByRole('heading',{name:'Your next plan can start here.',exact:true}).waitFor();
 for(const width of [320,1440])for(const theme of ['light','dark']){await page.setViewportSize({width,height:1000});await page.getByLabel('Color theme').selectOption(theme);await scan(page,`loading-empty-calendar-${width}-${theme}`);}
 await page.getByLabel('Show calendar events',{exact:true}).selectOption('tasks');await page.getByRole('button',{name:'Show all events this month',exact:true}).click();assert.equal(await page.getByLabel('Calendar task status',{exact:true}).inputValue(),'');assert.equal(await page.getByLabel('Show calendar events',{exact:true}).inputValue(),'all');assert.equal(await page.getByLabel('Calendar month',{exact:true}).inputValue(),'2100-01');
 await page.getByRole('button',{name:'Add a meeting',exact:true}).click();assert.equal(await page.getByLabel('Meeting transcript',{exact:true}).inputValue(),'Parked transcript for a later meeting.');
 await navigate(page,'Calendar');await page.getByRole('button',{name:'View all confirmed tasks',exact:true}).click();await page.getByRole('heading',{name:'All tasks',exact:true}).waitFor();assert.equal(await page.getByLabel('Task status',{exact:true}).inputValue(),'');
 assert.deepEqual(errors,[]);console.log('Loading/save checks passed: on-demand download graph, explicit chunk-failure recovery, late-navigation focus, stale save responses, local-storage failures, review/annotation retries, persisted edits, and actionable responsive calendar empty states.');
}catch(error){const page=browser?.contexts()[0]?.pages()[0];if(page){await page.screenshot({path:path.join(shots,'loading-save-failure.png'),fullPage:true}).catch(()=>{});await writeFile(path.join(shots,'loading-save-failure.txt'),await page.locator('body').innerText().catch(()=>''));}throw error;}
finally{for(const release of releases)release();await writeFile(path.join(shots,'loading-save-accessibility.json'),JSON.stringify(checks,null,2));await browser?.close();server.closeAllConnections();await server.shutdown();await rm(folder,{recursive:true,force:true});}
