import {legacyReviewDefaults,meetingField,navigate} from './browser-helpers.mjs';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {chromium} from 'playwright';
import {createApp,engine} from '../server/index.mjs';

const folder=await mkdtemp(path.join(tmpdir(),'flow-reliability-browser-'));
const shots=process.env.FLOW_SCREENSHOTS || path.join(folder,'screenshots');await mkdir(shots,{recursive:true});
let failAnalysis=false;
const server=createApp({historyPath:path.join(folder,'history.sqlite3'),execute:(request,options)=>failAnalysis && request.operation==='analyze'?Promise.reject(new Error('private exception detail must not appear')):engine(request,options)});let browser;
try{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`;
  browser=await chromium.launch({headless:true,...(process.env.FLOW_CHROMIUM_PATH?{executablePath:process.env.FLOW_CHROMIUM_PATH}:{})});
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await legacyReviewDefaults(page,[]);await page.goto(base+'/meetings');await page.getByRole('button',{name:'Analyze transcript',exact:true}).waitFor();
  await (await meetingField(page,'Meeting transcript')).fill('Maya will send the private report tomorrow.');
  await (await meetingField(page,'Meeting date')).fill('2026-09-15');
  let droppedId;
  await page.route('**/api/runs',async route=>{
    if(route.request().method()!=='POST')return route.continue();
    droppedId=route.request().postDataJSON().request_id;
    const response=await route.fetch();assert.equal(response.status(),201);await route.abort('failed');
  });
  await page.getByRole('button',{name:'Analyze transcript',exact:true}).click();
  await page.getByRole('heading',{name:/Review action proposals/}).waitFor();
  assert.equal((await (await fetch(base+'/api/runs')).json()).length,1);
  assert.equal(await page.evaluate(()=>localStorage.getItem('flow.pendingAnalysis')),null);
  await page.unroute('**/api/runs');
  // Before-write failure: reload and explicitly retry the same persisted request.
  await (await meetingField(page,'Meeting transcript')).fill('Jon will send the invoice tomorrow.');
  let firstId;
  await page.route('**/api/runs',route=>{if(route.request().method()!=='POST')return route.continue();firstId=route.request().postDataJSON().request_id;return route.abort('failed');});
  await page.getByRole('button',{name:'Analyze transcript',exact:true}).click();await page.getByRole('button',{name:'Retry saved analysis'}).waitFor();
  assert.equal((await (await fetch(base+'/api/runs')).json()).length,1);await page.unroute('**/api/runs');await page.reload();
  await page.getByRole('button',{name:'Retry saved analysis'}).waitFor();assert.equal(await (await meetingField(page,'Meeting transcript')).inputValue(),'Jon will send the invoice tomorrow.');
  await navigate(page,'Data & account');await page.getByRole('heading',{name:/Saved transcripts/}).waitFor();await page.getByRole('button',{name:'Extract & review',exact:true}).click();
  await page.getByRole('button',{name:'Retry saved analysis'}).click();await page.getByRole('status').filter({hasText:'Analysis saved. Review the proposals below.'}).waitFor();
  const runs=await (await fetch(base+'/api/runs')).json();assert.equal(runs.length,2);assert.equal(runs[0].id,firstId);assert.notEqual(firstId,droppedId);
  await navigate(page,'Data & account');await page.getByRole('heading',{name:/Saved transcripts/}).waitFor();
  const exportEvent=page.waitForEvent('download');await page.getByRole('button',{name:'Download workspace JSONL'}).click();const lines=(await readFile(await (await exportEvent).path(),'utf8')).trim().split('\n').map(JSON.parse);assert.equal(lines.at(-1).type,'complete');assert.equal(lines.filter(r=>r.kind==='extraction').length,2);
  const remove=page.getByRole('button',{name:`Delete extraction ${firstId.slice(0,8)}`,exact:true});await remove.click();
  assert.ok(await page.getByRole('button',{name:'Cancel',exact:true}).evaluate(el=>el===document.activeElement));
  assert.ok(!await page.getByRole('button',{name:'Delete transcript',exact:true}).isEnabled());
  await page.keyboard.press('Escape');assert.equal(await page.locator('dialog').count(),0);assert.ok(await remove.evaluate(el=>el===document.activeElement));
  await remove.click();await page.getByLabel('Deletion confirmation').fill('DELETE TRANSCRIPT');
  await page.getByRole('button',{name:'Delete transcript',exact:true}).click();await page.getByRole('heading',{name:/Saved transcripts/}).waitFor();
  await page.waitForFunction(()=>document.querySelectorAll('.data-entry').length===1);
  assert.equal((await fetch(base+`/api/runs/${firstId}`)).status,404);
  assert.equal(await page.evaluate(()=>localStorage.getItem('flow.activeRun')),null);
  await page.getByLabel('Color theme').selectOption('dark');await page.screenshot({path:path.join(shots,'desktop-data-controls-dark.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:path.join(shots,'mobile-data-controls-dark.png'),fullPage:true});
  // An export with a missing completion record must never become a downloaded file.
  let badDownload=false;page.on('download',()=>{badDownload=true;});
  await page.route('**/api/account/export',route=>route.fulfill({status:200,contentType:'application/x-ndjson',body:'{"type":"manifest"}\n'}));
  await page.getByRole('button',{name:'Download workspace JSONL'}).click();await page.getByRole('alert').filter({hasText:'The export was interrupted.'}).waitFor();assert.equal(badDownload,false);
  // A real server exception exposes only a support reference and preserves the
  // original analysis request for an explicit retry after the service recovers.
  const context=await browser.newContext(),failurePage=await context.newPage();await failurePage.setViewportSize({width:320,height:800});await failurePage.goto(base+'/meetings');
  await (await meetingField(failurePage,'Meeting transcript')).fill('Maya will send the launch notes tomorrow.');
  await (await meetingField(failurePage,'Meeting date')).fill('2026-09-15');
  failAnalysis=true;const failedResponse=failurePage.waitForResponse(response=>response.url()===base+'/api/runs'&&response.request().method()==='POST');
  await failurePage.getByRole('button',{name:'Analyze transcript',exact:true}).click();const response=await failedResponse,data=await response.json();assert.equal(response.status(),500);assert.match(data.request_id,/^[a-f0-9-]{36}$/);
  await failurePage.getByRole('alert').filter({hasText:`Reference: ${data.request_id}`}).waitFor();assert.ok(await failurePage.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.equal(await failurePage.getByText('private exception detail must not appear').count(),0);
  const unfinished=await failurePage.evaluate(()=>JSON.parse(localStorage.getItem('flow.pendingAnalysis')));assert.notEqual(unfinished.request_id,data.request_id);
  failAnalysis=false;await failurePage.getByRole('button',{name:'Retry saved analysis'}).click();await failurePage.getByRole('status').filter({hasText:'Analysis saved. Review the proposals below.'}).waitFor();
  assert.equal((await (await fetch(base+`/api/runs/${unfinished.request_id}`)).json()).id,unfinished.request_id);assert.equal(await failurePage.evaluate(()=>localStorage.getItem('flow.pendingAnalysis')),null);await context.close();
  assert.deepEqual(errors,[]);console.log('Reliability browser passed: lost-response recovery, reload/same-ID retry, complete export, keyboard confirmation, transcript deletion, erased browser cache, mobile dark layout, rejected incomplete download, and safe failure references with same-request recovery.');
}finally{await browser?.close();server.closeAllConnections();await server.shutdown();await rm(folder,{recursive:true,force:true});}
