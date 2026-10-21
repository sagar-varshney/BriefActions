import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {chromium} from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import {createApp} from '../server/index.mjs';
import {meetingField} from './browser-helpers.mjs';
const deferred=()=>{let resolve;return {promise:new Promise(r=>{resolve=r;}),resolve:()=>resolve()};};
const folder=await mkdtemp(path.join(tmpdir(),'briefactions-responsive-')),analysis=deferred(),entered=deferred(),saving=deferred(),saveEntered=deferred();
const server=createApp({historyPath:path.join(folder,'history.sqlite3')});let browser;
try{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`;
 browser=await chromium.launch({headless:true,...(process.env.FLOW_CHROMIUM_PATH?{executablePath:process.env.FLOW_CHROMIUM_PATH}:{})});
 const context=await browser.newContext(),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(base+'/meetings');await (await meetingField(page,'Meeting transcript')).fill('Maya will send the report tomorrow.');await (await meetingField(page,'Meeting date')).fill('2026-10-22');
 await page.route('**/api/runs',async route=>{if(route.request().method()!=='POST')return route.continue();entered.resolve();await analysis.promise;return route.continue();});
 await page.getByRole('button',{name:'Analyze transcript',exact:true}).click();await entered.promise;
 assert.ok(await page.getByRole('button',{name:'Calendar',exact:true}).isEnabled());assert.ok(await page.getByRole('button',{name:'Data & account',exact:true}).isDisabled());
 await page.getByRole('button',{name:'Calendar',exact:true}).click();await page.getByRole('heading',{name:'Calendar',exact:true}).waitFor();await page.getByRole('status').filter({hasText:'Your transcript is being analyzed.'}).waitFor();
 assert.equal(await page.locator('main').getAttribute('aria-busy'),'false');
 for(const width of [1440,320])for(const theme of ['light','dark']){
  await page.setViewportSize({width,height:900});await page.getByLabel('Color theme').selectOption(theme);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  assert.deepEqual((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze()).violations,[]);
  if(process.env.FLOW_SCREENSHOTS){await mkdir(process.env.FLOW_SCREENSHOTS,{recursive:true});await page.screenshot({path:path.join(process.env.FLOW_SCREENSHOTS,`analysis-browsing-${width}-${theme}.png`),fullPage:true});}
 }
 await page.setViewportSize({width:1440,height:900});
 await page.getByRole('button',{name:'All tasks',exact:true}).click();await page.getByRole('heading',{name:'All tasks',exact:true}).waitFor();
 await page.getByRole('button',{name:'Calendar',exact:true}).click();await page.getByLabel('Calendar month',{exact:true}).fill('2026-10');
 await page.getByRole('status').filter({hasText:'0 meetings and 0 task deadlines this month'}).waitFor();
 analysis.resolve();await page.getByRole('button',{name:'Open analysis result',exact:true}).waitFor();assert.equal(new URL(page.url()).pathname,'/calendar');
 await page.getByRole('status').filter({hasText:'1 meeting and 0 task deadlines this month'}).waitFor();
 await page.getByRole('button',{name:'Open analysis result',exact:true}).click();await page.getByRole('heading',{name:/Review action proposals/}).waitFor();
 const runs=await(await fetch(base+'/api/runs')).json();assert.equal(runs.length,1);const run=await(await fetch(base+`/api/runs/${runs[0].id}`)).json();
 const confirmed=await fetch(base+`/api/runs/${run.id}/finalize`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({decisions:run.proposals.map(p=>({...p,accept:true}))})});assert.equal(confirmed.status,200);
 await page.reload();const progress=page.getByLabel('Progress for task 1',{exact:true});await progress.waitFor();
 await page.route('**/api/runs/*/progress',async route=>{saveEntered.resolve();await saving.promise;return route.continue();});
 await progress.selectOption('done');await saveEntered.promise;
 await page.getByRole('status').filter({hasText:'Saving your task update to the workspace…'}).waitFor();
 assert.equal(await progress.inputValue(),'todo');assert.equal(await page.getByText('1 of 1 done',{exact:true}).count(),0);
 saving.resolve();await page.getByText('Task progress saved.',{exact:true}).waitFor();assert.equal(await progress.inputValue(),'done');await page.getByText('1 of 1 done',{exact:true}).waitFor();
 assert.deepEqual(errors,[]);console.log('Responsiveness browser passed: browse during analysis, no completion redirect, recover exact result, truthful pending save and confirmed progress.');
}finally{analysis.resolve();saving.resolve();await browser?.close();server.closeAllConnections();await server.shutdown();await rm(folder,{recursive:true,force:true});}
