import {navigate,meetingField} from './browser-helpers.mjs';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {chromium} from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import {createApp} from '../server/index.mjs';
import {loadConfig} from '../server/config.mjs';

const folder=await mkdtemp(path.join(tmpdir(),'flow-import-a11y-'));
const shots=process.env.FLOW_SCREENSHOTS || path.join(folder,'screenshots');await mkdir(shots,{recursive:true});
const server=createApp({historyPath:path.join(folder,'history.sqlite3')});
const authServer=createApp({config:{...loadConfig(),authMode:'supabase',supabaseUrl:'https://test-project.supabase.co',supabaseKey:'sb_publishable_test'},historyPath:path.join(folder,'auth.sqlite3'),verifyAccount:async()=>null});
let browser;const checks=[];
async function scan(page,label){
  const result=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa']).analyze();
  checks.push({label,violations:result.violations,incomplete:result.incomplete.map(({id,impact,nodes})=>({id,impact,targets:nodes.map(n=>n.target)}))});
  if(result.violations.length)console.error(label,JSON.stringify(result.violations.map(({id,nodes})=>({id,nodes:nodes.map(n=>({target:n.target,summary:n.failureSummary}))})),null,2));
  assert.equal(result.violations.length,0,`${label}: accessibility violations`);
}
try{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));await new Promise(resolve=>authServer.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}`,authBase=`http://127.0.0.1:${authServer.address().port}`;
  browser=await chromium.launch({headless:true,...(process.env.FLOW_CHROMIUM_PATH?{executablePath:process.env.FLOW_CHROMIUM_PATH}:{})});
  const context=await browser.newContext({viewport:{width:1440,height:1000}});const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base);await page.getByRole('button',{name:'Try an example',exact:true}).waitFor();
  assert.equal(await (await meetingField(page,'Meeting transcript')).inputValue(),'');
  assert.equal(await (await meetingField(page,'Meeting date')).inputValue(),'');
  await page.getByRole('button',{name:'Paste my transcript',exact:true}).click();
  assert.equal(await page.evaluate(()=>document.activeElement.id),'transcript');
  await page.getByRole('button',{name:'Import a file',exact:true}).click();
  assert.equal(await page.evaluate(()=>document.activeElement.id),'transcript-file');
  assert.ok(await page.locator('.transcript-import').evaluate(el=>el.open));
  await page.getByRole('button',{name:'Try an example',exact:true}).click();
  await page.getByRole('status').filter({hasText:'Synthetic example meeting'}).waitFor();
  assert.equal((await (await fetch(base+'/api/runs')).json()).length,0);
  await page.reload();await page.getByRole('status').filter({hasText:'Restored transcript draft'}).waitFor();
  assert.ok((await (await meetingField(page,'Meeting transcript')).inputValue()).length>0);
  await page.getByRole('button',{name:'Discard transcript draft',exact:true}).click();
  await page.getByRole('button',{name:'Try an example',exact:true}).waitFor();
  assert.equal(await (await meetingField(page,'Meeting transcript')).inputValue(),'');
  for(const width of [1440,320]){await page.setViewportSize({width,height:800});for(const theme of ['light','dark']){await page.getByLabel('Color theme').selectOption(theme);await scan(page,`welcome-${width}-${theme}`);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:path.join(shots,`welcome-${width}-${theme}.png`),fullPage:true});}}
  await (await meetingField(page,'Meeting transcript')).fill('Ready.');
  // First Tab exposes the skip link; it focuses the main landmark on Enter.
  await page.reload();await page.getByRole('button',{name:'Analyze transcript',exact:true}).waitFor();
  await page.keyboard.press('Tab');assert.ok(await page.getByRole('link',{name:'Skip to workspace'}).evaluate(el=>el===document.activeElement));
  await page.keyboard.press('Enter');assert.equal(await page.evaluate(()=>document.activeElement.id),'workspace-main');
  await page.locator('summary').filter({hasText:'Import a transcript file'}).click();
  const upload=page.getByLabel('Transcript file',{exact:true});
  await upload.setInputFiles({name:'meeting.vtt',mimeType:'text/vtt',buffer:Buffer.from('WEBVTT\n\n00:00:01.000 --> 00:00:03.000\n<v Bob>Okay 📝.</v>\n<v Maya>I’ll send the report tomorrow.</v>')});
  const preview=page.getByLabel('Transcript import preview');await preview.waitFor();
  assert.equal(await preview.inputValue(),'Bob: Okay 📝.\nMaya: I’ll send the report tomorrow.');
  assert.equal((await (await fetch(base+'/api/runs')).json()).length,0);
  await preview.fill('Bob: Okay 📝.\nMaya: I will send the invoice tomorrow.');await scan(page,'import-preview-light');
  await page.getByRole('button',{name:'Use this transcript'}).click();assert.equal(await (await meetingField(page,'Meeting date')).inputValue(),'');assert.equal(await page.evaluate(()=>document.activeElement.id),'meeting-date');
  await (await meetingField(page,'Meeting date')).fill('2026-10-12');
  await page.getByRole('button',{name:'Analyze transcript',exact:true}).click();await page.getByRole('heading',{name:/Review action proposals/}).waitFor();
  await page.reload();await page.getByRole('heading',{name:/Review action proposals/}).waitFor();assert.equal(await page.getByRole('button',{name:'Try an example',exact:true}).count(),0);
  const saved=await (await fetch(base+'/api/runs')).json();const run=await (await fetch(base+`/api/runs/${saved[0].id}`)).json();
  assert.equal(run.transcript,'Bob: Okay 📝.\nMaya: I will send the invoice tomorrow.');assert.equal(run.proposals[0].owner,'Maya');assert.equal(run.proposals[0].deadline,'2026-10-13');
  for(const e of run.proposals[0].evidence)assert.equal(Array.from(run.transcript).slice(e.start,e.end).join(''),e.text);
  await meetingField(page,'Meeting transcript');
  await page.locator('summary').filter({hasText:'Import a transcript file'}).click();
  await upload.setInputFiles({name:'meeting.srt',mimeType:'text/plain',buffer:Buffer.from('1\n00:00:01,000 --> 00:00:03,000\nJon will send the report.')});assert.equal(await preview.inputValue(),'Jon will send the report.');await page.getByRole('button',{name:'Discard preview'}).click();
  await upload.setInputFiles({name:'meeting.txt',mimeType:'text/plain',buffer:Buffer.from('Maya will send the notes tomorrow.\r\nJon: Thanks.')});assert.equal(await preview.inputValue(),'Maya will send the notes tomorrow.\nJon: Thanks.');await page.getByRole('button',{name:'Discard preview'}).click();
  await upload.setInputFiles({name:'bad.vtt',mimeType:'text/vtt',buffer:Buffer.from('broken')});await page.getByRole('alert').filter({hasText:'WEBVTT header'}).waitFor();
  assert.equal((await (await fetch(base+'/api/runs')).json()).length,1);
  // Keyboard navigation places focus on the new page heading, including unchanged pages.
  const history=page.getByRole('button',{name:'Meeting history',exact:true});await history.focus();await page.keyboard.press('Enter');await page.waitForFunction(()=>document.activeElement?.tagName==='H1');
  assert.equal(await page.evaluate(()=>document.activeElement.textContent),'Your meeting history.');
  const pages=['Extract & review','Meeting history','Evaluation lab','Annotation reviewer','Data & account'];
  for(const width of [1440,320]){
    await page.setViewportSize({width,height:width===320?800:1000});
    for(const theme of ['light','dark']){
      await page.getByLabel('Color theme').selectOption(theme);
      for(const name of pages){
        await navigate(page,name);
        if(name==='Data & account')await page.getByRole('heading',{name:/Saved transcripts/}).waitFor();
        if(name==='Evaluation lab')await page.locator('.experiment').first().waitFor();
        if(name==='Annotation reviewer')await page.getByRole('button',{name:'Import bundled cases',exact:true}).waitFor();
        await scan(page,`${width}-${theme}-${name}`);
        assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${name} overflows at ${width}px`);
      }
      await page.getByRole('button',{name:/Delete extraction/,exact:false}).first().click();
      const dialog=page.getByRole('dialog');assert.ok(await dialog.getByRole('button',{name:'Cancel',exact:true}).evaluate(el=>el===document.activeElement));
      await page.keyboard.press('Shift+Tab');assert.ok(await dialog.evaluate(el=>el.contains(document.activeElement)));
      await scan(page,`${width}-${theme}-erasure-dialog`);await page.keyboard.press('Escape');
      await page.screenshot({path:path.join(shots,`accessibility-${width}-${theme}.png`),fullPage:true});
    }
  }
  // Hosted meter states are UI fixtures; backend byte counts and isolation are tested separately.
  await page.route('**/api/account',async route=>{const response=await route.fetch();await route.fulfill({response,json:{...await response.json(),storage:{history:{used_bytes:20_000_000,limit_bytes:25_000_000},drafts:{used_bytes:4_500_000,limit_bytes:5_000_000}}}});});
  await page.getByRole('button',{name:'Meeting history',exact:true}).click();await page.getByRole('button',{name:'Data & account',exact:true}).click();
  await page.getByRole('meter',{name:'Saved history usage'}).waitFor();
  assert.equal(await page.getByRole('meter',{name:'Saved history usage'}).getAttribute('value'),'20000000');
  assert.equal(await page.getByRole('meter',{name:'Annotation drafts usage'}).getAttribute('max'),'5000000');
  assert.equal(await page.getByText('Storage is getting full.',{exact:false}).count(),2);
  for(const theme of ['light','dark']){await page.getByLabel('Color theme').selectOption(theme);await scan(page,`storage-warning-${theme}`);}
  await page.unroute('**/api/account');await page.getByRole('button',{name:'Refresh usage',exact:true}).click();await page.getByText('No account quota is enforced in local mode.',{exact:true}).first().waitFor();assert.equal(await page.getByRole('meter').count(),0);
  const annotation=await (await fetch(base+'/api/annotations',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({transcript:'Maya will send the report tomorrow.',reference_date:'2026-10-12',source:'synthetic',permission:true,anonymized:true,group:'Accessibility fixture'})})).json();
  await navigate(page,'Annotation reviewer');
  const permission=page.getByLabel('I have permission to use this material for evaluation'),privacy=page.getByLabel('I checked the preview for identifying or sensitive information');await permission.check();await privacy.check();
  await page.locator('summary').filter({hasText:'Import a transcript file'}).click();await page.getByLabel('Transcript file',{exact:true}).setInputFiles({name:'annotation.txt',mimeType:'text/plain',buffer:Buffer.from('Jon will send the notes tomorrow.')});await page.getByLabel('Transcript import preview').waitFor();await page.getByRole('button',{name:'Use this transcript'}).click();
  assert.equal(await page.getByLabel('Transcript to import',{exact:true}).inputValue(),'Jon will send the notes tomorrow.');assert.equal(await page.getByLabel('Annotation meeting date').inputValue(),'');assert.equal(await permission.isChecked(),false);assert.equal(await privacy.isChecked(),false);assert.equal((await (await fetch(base+'/api/annotations')).json()).length,1);
  await page.getByRole('button',{name:`Label case ${annotation.id.slice(0,6)}`,exact:true}).click();
  await page.getByLabel('Reviewer identity').fill('Accessibility fixture');await page.getByRole('button',{name:'Start or resume review',exact:true}).click();await page.getByText('Independent review',{exact:false}).first().waitFor();
  for(const theme of ['light','dark']){await page.getByLabel('Color theme').selectOption(theme);await scan(page,`active-annotation-${theme}`);}
  await page.emulateMedia({reducedMotion:'reduce'});assert.equal(await page.evaluate(()=>matchMedia('(prefers-reduced-motion: reduce)').matches),true);
  const login=await context.newPage();await login.setViewportSize({width:320,height:800});await login.goto(authBase);await login.getByRole('button',{name:'Continue with GitHub'}).waitFor();
  for(const theme of ['light','dark']){await login.getByLabel('Color theme').selectOption(theme);await scan(login,`sign-in-${theme}`);assert.ok(await login.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));}
  const privacyPage=await context.newPage(),privacyPageRequests=[];privacyPage.on('request',r=>{if(new URL(r.url()).pathname.startsWith('/api/'))privacyPageRequests.push(r.url());});
  await privacyPage.goto(authBase+'/privacy');await privacyPage.getByRole('heading',{name:'Privacy & your data',exact:true}).waitFor();assert.equal(await privacyPage.getByRole('button',{name:'Continue with GitHub'}).count(),0);assert.deepEqual(privacyPageRequests,[]);
  for(const width of [1440,320]){await privacyPage.setViewportSize({width,height:800});for(const theme of ['light','dark']){await privacyPage.getByLabel('Color theme').selectOption(theme);await scan(privacyPage,`privacyPage-${width}-${theme}`);assert.ok(await privacyPage.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await privacyPage.screenshot({path:path.join(shots,`privacyPage-${width}-${theme}.png`),fullPage:true});}}
  await privacyPage.getByRole('link',{name:'Open Data & account',exact:true}).click();await privacyPage.getByRole('button',{name:'Continue with GitHub'}).waitFor();
  assert.deepEqual(errors,[]);console.log('Onboarding, storage, privacy, imports, and accessibility passed: empty first-use input/date, explicit unsaved example, paste/import focus, restored review, account meter warnings/refresh, public privacy without auth requests, preview approval, TXT/VTT/SRT, caption voices, edited evidence offsets, required meeting date, rejected malformed file, keyboard skip/navigation/modal, 320px reflow and automated WCAG checks in both themes.');
}finally{
  await writeFile(path.join(shots,'accessibility-results.json'),JSON.stringify(checks,null,2));
  await browser?.close();for(const s of [server,authServer]){s.closeAllConnections();await new Promise(resolve=>s.close(resolve));}await rm(folder,{recursive:true,force:true});
}
