import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {chromium} from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import {createApp} from '../server/index.mjs';
import {navigate,meetingField} from './browser-helpers.mjs';

const folder=await mkdtemp(path.join(tmpdir(),'briefactions-feedback-'));
const shots=process.env.FLOW_SCREENSHOTS||path.join(folder,'screenshots');await mkdir(shots,{recursive:true});
const server=createApp({historyPath:path.join(folder,'history.sqlite3')});let browser;
const checks=[],releases=[];
async function hold(page,pattern){
 const entered=Promise.withResolvers(),release=Promise.withResolvers();releases.push(release.resolve);
 await page.route(pattern,async route=>{const response=await route.fetch();entered.resolve();await release.promise;await route.fulfill({response});},{times:1});
 return {entered:entered.promise,release:release.resolve};
}
async function scan(page,label){
 const result=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa']).analyze();
 checks.push({label,violations:result.violations});assert.deepEqual(result.violations,[],label);
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),label+' overflow');
 await page.locator('.request-state,.notice.error').first().scrollIntoViewIfNeeded();
 await page.screenshot({path:path.join(shots,label+'.png')});
}
try{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`;
 browser=await chromium.launch({headless:true,...(process.env.FLOW_CHROMIUM_PATH?{executablePath:process.env.FLOW_CHROMIUM_PATH}:{})});
 const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage(),errors=[],writes=[];
 page.on('pageerror',error=>errors.push(error.message));page.on('request',r=>{if(r.method()==='POST'&&new URL(r.url()).pathname.startsWith('/api/'))writes.push(new URL(r.url()).pathname);});
 await page.goto(base+'/meetings');await page.getByRole('button',{name:'Try an example',exact:true}).waitFor();
 await page.getByLabel('Meeting transcript',{exact:true}).fill('Maya will send the launch notes tomorrow.');await page.getByLabel('Meeting date',{exact:true}).fill('2026-10-22');
 const analysis=await hold(page,'**/api/runs');await page.getByRole('button',{name:'Analyze transcript',exact:true}).click();await analysis.entered;
 await page.getByRole('status').filter({hasText:'Analyzing your saved request…'}).waitFor();const analyze=page.getByRole('button',{name:'Analyzing…',exact:true});assert.ok(await analyze.isDisabled());await analyze.evaluate(el=>{el.click();el.click();});assert.equal(writes.filter(p=>p==='/api/runs').length,1);
 await page.getByText('Still waiting for a response. Your input is saved in this browser. You can browse tasks and calendar while it runs.',{exact:true}).waitFor();
 assert.ok(await page.locator('.request-state').evaluate(el=>!el.closest('[aria-busy="true"]')),'Pending feedback must be outside the busy editing region');
 assert.equal(await page.getByRole('heading',{name:/Review action proposals/}).count(),0,'A pending response must not appear completed');
 for(const width of [1440,320])for(const theme of ['light','dark']){await page.setViewportSize({width,height:1000});await page.getByLabel('Color theme').selectOption(theme);await page.emulateMedia({reducedMotion:'reduce'});assert.equal(await page.locator('.request-state svg').evaluate(el=>getComputedStyle(el).animationName),'none');await scan(page,`feedback-pending-${width}-${theme}`);}
 analysis.release();await page.getByRole('heading',{name:/Review action proposals/}).waitFor();assert.equal(await page.locator('.request-state').count(),0);
 const id=new URL(page.url()).pathname.split('/').at(-1);await page.setViewportSize({width:1440,height:1000});
 await (await meetingField(page,'Meeting name')).fill('Invented launch planning');const rename=await hold(page,`**/api/runs/${id}/title`);await page.getByRole('button',{name:'Save meeting name',exact:true}).click();await rename.entered;
 await page.getByRole('status').filter({hasText:'Saving meeting name…'}).waitFor();assert.equal(await page.getByRole('button',{name:'Saving…',exact:true}).count(),0,'Disabled plan controls must not claim a different action is saving');assert.equal(await page.getByText('Meeting name saved.',{exact:true}).count(),0);rename.release();await page.getByRole('status').filter({hasText:'Meeting name saved.'}).waitFor();await page.getByLabel('Meeting name',{exact:true}).fill('Unsubmitted title draft');assert.equal(await page.getByText('Meeting name saved.',{exact:true}).count(),0);await page.getByLabel('Meeting name',{exact:true}).fill('Invented launch planning');
 await page.getByLabel('Keep task 1',{exact:true}).check();const confirmation=await hold(page,`**/api/runs/${id}/finalize`);await page.getByRole('button',{name:'Confirm selected tasks',exact:true}).click();await confirmation.entered;
 await page.getByRole('status').filter({hasText:'Saving your confirmed plan…'}).waitFor();assert.equal(await page.getByRole('heading',{name:'Your confirmed plan',exact:true}).count(),0);assert.ok(await page.getByRole('button',{name:'Saving…',exact:true}).isDisabled());confirmation.release();await page.getByRole('heading',{name:'Your confirmed plan',exact:true}).waitFor();assert.equal(writes.filter(p=>p.endsWith('/finalize')).length,1);

 // Each list has an explicit pending state and blocks duplicate refreshes.
 for(const [name,pattern,refresh,label,empty] of [
  ['My day','**/api/today?**','Refresh My day','Loading your day…','.daily-stat'],
  ['All tasks','**/api/tasks?**','Refresh tasks','Loading tasks…','.dashboard-task'],
  ['Tasks by owner','**/api/owners?**','Refresh owner overview','Loading owner workloads…','.owner-card'],
  ['Calendar','**/api/calendar?**','Refresh calendar','Loading calendar…','.calendar-entry']
 ]){
  const request=await hold(page,pattern);let count=0;const observe=r=>{if(r.url().includes(pattern.split('/api/')[1].split('?')[0]+'?'))count++;};page.on('request',observe);
  await navigate(page,name);await request.entered;await page.getByRole('status').filter({hasText:label}).waitFor();const button=page.getByRole('button',{name:refresh,exact:true});assert.ok(await button.isDisabled());assert.equal(await button.getAttribute('aria-busy'),'true');await button.evaluate(el=>{el.click();el.click();});assert.equal(count,1);assert.equal(await page.locator(empty).count(),0,'Loading must not show old results or a false empty success');
  if(name==='All tasks')await page.getByText('Still waiting for the server. You can switch sections and return.',{exact:true}).waitFor();
  request.release();await page.waitForFunction(text=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent===text);return b&&!b.disabled;},refresh);assert.equal(await page.locator('.request-state').count(),0);page.off('request',observe);
 }

 // A failed read of a saved meeting can be retried without creating another run.
 await navigate(page,'Meeting history');await page.getByRole('button',{name:'Open meeting',exact:true}).waitFor();let opening=0;
 await page.route(`**/api/runs/${id}`,async route=>{opening++;if(opening===1)return route.fulfill({status:503,json:{error:'Meeting temporarily unavailable.'}});return route.continue();});
 const savedCount=(await(await fetch(base+'/api/runs')).json()).length;await page.getByRole('button',{name:'Open meeting',exact:true}).click();await page.getByRole('button',{name:'Retry opening meeting',exact:true}).waitFor();assert.equal(opening,1);await page.getByRole('button',{name:'Retry opening meeting',exact:true}).click();await page.getByRole('heading',{name:'Your confirmed plan',exact:true}).waitFor();assert.equal(opening,2);assert.equal((await(await fetch(base+'/api/runs')).json()).length,savedCount);await page.unroute(`**/api/runs/${id}`);

 // Startup can fail after config has loaded; a reload retry still needs to exist.
 const startup=await context.newPage();let loads=0;startup.on('pageerror',error=>errors.push(error.message));await startup.route(`**/api/runs/${id}`,route=>{loads++;return loads===1?route.fulfill({status:503,json:{error:'Saved meeting load interrupted.'}}):route.continue();});await startup.goto(base+'/meetings/'+id);await startup.getByRole('button',{name:'Retry workspace loading',exact:true}).click();await startup.getByRole('heading',{name:'Your confirmed plan',exact:true}).waitFor();assert.equal(loads,2);await startup.close();

 // Failed comparison reads stop loading, retain their reference, and wait for a click.
 let comparisons=0;const reference='12345678-1234-4234-8234-123456789abc';await page.route('**/api/benchmarks',route=>{comparisons++;return comparisons===1?route.fulfill({status:503,json:{error:'Comparison temporarily unavailable.',request_id:reference}}):route.continue();});
 await navigate(page,'Compare extraction methods');await page.getByRole('alert').filter({hasText:reference}).waitFor();assert.equal(await page.getByRole('status').filter({hasText:'Loading comparisons…'}).count(),0);assert.equal(comparisons,1);
 for(const width of [1440,320])for(const theme of ['light','dark']){await page.setViewportSize({width,height:1000});await page.getByLabel('Color theme').selectOption(theme);await scan(page,`feedback-retry-${width}-${theme}`);}
 await page.getByRole('button',{name:'Retry comparison loading',exact:true}).focus();await page.keyboard.press('Enter');await page.getByRole('region',{name:'Extraction comparison table',exact:true}).waitFor();assert.equal(comparisons,2);await page.setViewportSize({width:1440,height:1000});
 let details=0;await page.route('**/api/benchmarks/*',route=>{details++;return details===1?route.fulfill({status:503,json:{error:'Result details temporarily unavailable.'}}):route.continue();});
 await page.getByRole('region',{name:'Extraction comparison table',exact:true}).getByRole('button').first().click();await page.getByRole('button',{name:'Retry result details',exact:true}).waitFor();assert.equal(await page.getByRole('status').filter({hasText:'Loading result details…'}).count(),0);assert.equal(details,1);await page.getByRole('button',{name:'Retry result details',exact:true}).click();await page.getByRole('heading',{name:/^Inspect:/}).waitFor();assert.equal(details,2);
 assert.deepEqual(errors,[]);console.log('Interaction feedback passed: delayed analysis and confirmation, truthful save success, pending announcements and reduced motion, disabled duplicate refreshes, no false empty results, meeting/startup retry, comparison/detail failures and explicit recovery, support references, and mobile/desktop accessibility in both themes.');
}catch(error){const page=browser?.contexts()[0]?.pages()[0];if(page)await page.screenshot({path:path.join(shots,'feedback-failure.png'),fullPage:true}).catch(()=>{});throw error;}
finally{for(const release of releases)release();await writeFile(path.join(shots,'interaction-feedback-accessibility.json'),JSON.stringify(checks,null,2));await browser?.close();server.closeAllConnections();await server.shutdown();await rm(folder,{recursive:true,force:true});}
