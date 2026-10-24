import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {chromium} from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import {createApp} from '../server/index.mjs';
import {loadConfig} from '../server/config.mjs';
import {navigate,navigationButton,scrollWorkspace} from './browser-helpers.mjs';

const folder=await mkdtemp(path.join(tmpdir(),'briefactions-shell-')),shots=process.env.FLOW_SCREENSHOTS||path.join(folder,'screenshots');await mkdir(shots,{recursive:true});
const server=createApp({config:loadConfig({}),historyPath:path.join(folder,'history.sqlite3')});
const checks=[],errors=[];let browser,page;
async function scan(label){
 const result=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa']).analyze();checks.push({label,violations:result.violations});assert.deepEqual(result.violations,[],label);
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),label+' overflow');
 if(page.viewportSize().width<=960)assert.ok(await page.evaluate(()=>document.documentElement.scrollHeight<=innerHeight),label+' has no empty outer page below the mobile scroll frame');
}
async function shot(name){await page.evaluate(()=>document.fonts.ready);await page.screenshot({path:path.join(shots,name+'.png'),animations:'disabled'});}
try{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`;
 browser=await chromium.launch({headless:true,...(process.env.FLOW_CHROMIUM_PATH?{executablePath:process.env.FLOW_CHROMIUM_PATH}:{})});
 const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'});page=await context.newPage();page.setDefaultTimeout(15000);page.on('pageerror',error=>errors.push(error.message));
 await page.goto(base+'/meetings');await page.getByRole('button',{name:'Try an example',exact:true}).waitFor();
 const main=page.locator('#workspace-main'),header=page.locator('.workspace-header');
 assert.ok((await header.boundingBox()).height<=72,'Desktop toolbar stays slim');assert.equal((await main.boundingBox()).x,236);
 await page.keyboard.press('Tab');await page.keyboard.press('Enter');assert.equal(await page.evaluate(()=>document.activeElement.id),'workspace-main','Skip link bypasses the sidebar and toolbar');
 await page.getByRole('button',{name:'Collapse navigation',exact:true}).click();assert.equal((await main.boundingBox()).x,80);assert.equal(await page.getByRole('button',{name:'Calendar',exact:true}).getAttribute('title'),'Calendar');
 await page.reload();await page.getByRole('button',{name:'Expand navigation',exact:true}).waitFor();assert.equal((await main.boundingBox()).x,80,'Sidebar preference survives reload');
 await page.getByRole('button',{name:'Research tools',exact:true}).click();await page.getByRole('button',{name:'Collapse navigation',exact:true}).waitFor();assert.ok(await page.getByRole('button',{name:'Compare extraction methods',exact:true}).isVisible(),'Opening research expands a collapsed rail to readable labels');await page.keyboard.press('Escape');
 await page.getByRole('button',{name:'Try an example',exact:true}).click();await page.getByRole('button',{name:'Analyze transcript',exact:true}).click();await page.getByRole('heading',{name:/Review action proposals/}).waitFor();
 await page.getByLabel('Owner 1',{exact:true}).fill('Maya Patel');await page.getByLabel('Keep task 1',{exact:true}).check();await page.locator('.save-feedback').getByText('Saved',{exact:true}).waitFor();
 const id=new URL(page.url()).pathname.split('/').at(-1);
 for(const [width,height] of [[1600,1000],[1440,1000],[1024,1000],[961,1000],[960,900],[768,900],[390,844],[320,740],[844,390]]){
  await page.setViewportSize({width,height});
  for(const theme of ['light','dark']){
   await page.getByLabel('Color theme').selectOption(theme);await scan(`shell-${width}-${height}-${theme}`);
   assert.ok((await header.boundingBox()).height<=72,`Toolbar remains compact at ${width}`);
   if(width<=960){
    await page.getByRole('button',{name:'Help',exact:true}).focus();await page.keyboard.press('Tab');assert.ok(await page.getByRole('navigation',{name:'Quick navigation',exact:true}).getByRole('button',{name:'Extract & review',exact:true}).evaluate(el=>el===document.activeElement),'Mobile navigation is reached before the long review form');
    assert.equal((await main.boundingBox()).x,0);assert.equal(await page.getByRole('navigation',{name:'Quick navigation',exact:true}).getByRole('button').count(),5);
    const more=page.getByRole('button',{name:'More navigation',exact:true});await more.click();const menu=page.getByRole('dialog',{name:'Workspace navigation',exact:true});await menu.waitFor();
    assert.ok(await menu.evaluate(el=>el.contains(document.activeElement)),'Opening More focuses its modal');assert.equal(await page.evaluate(()=>document.documentElement.style.overflow),'hidden','More locks background scrolling');
    await scan(`menu-${width}-${height}-${theme}`);
    const firstLink=menu.getByRole('link',{name:'BriefActions home',exact:true}),lastButton=menu.getByRole('button',{name:'Data & account',exact:true});await firstLink.focus();await page.keyboard.press('Shift+Tab');assert.ok(await lastButton.evaluate(el=>el===document.activeElement),'Shift+Tab wraps to the final navigation control');await page.keyboard.press('Tab');assert.ok(await firstLink.evaluate(el=>el===document.activeElement),'Tab wraps back to the first navigation control');
    for(let n=0;n<14;n++){await page.keyboard.press('Tab');assert.ok(await menu.evaluate(el=>el.contains(document.activeElement)),'Tab stays in navigation');}
    await menu.getByRole('button',{name:'Research tools',exact:true}).click();await page.keyboard.press('Escape');assert.ok(await menu.isVisible(),'First Escape closes the research disclosure');assert.equal(await menu.getByRole('button',{name:'Research tools',exact:true}).getAttribute('aria-expanded'),'false');
    await page.keyboard.press('Escape');await menu.waitFor({state:'hidden'});assert.ok(await more.evaluate(el=>el===document.activeElement),'Closing More returns keyboard focus');
    if(width===390&&theme==='light'){await scrollWorkspace(page);await shot('stage-one-mobile-light');await more.click();await shot('stage-one-mobile-menu');await page.getByRole('button',{name:'Close navigation',exact:true}).click();}
   }
   if(width===1440){await scrollWorkspace(page);await shot('stage-one-desktop-'+theme);}
  }
 }
 await page.setViewportSize({width:320,height:740});
 await navigate(page,'My day');await navigate(page,'Calendar');await page.getByRole('button',{name:'More navigation',exact:true}).click();await page.goBack();await page.getByRole('dialog',{name:'Workspace navigation',exact:true}).waitFor({state:'hidden'});assert.equal(await page.evaluate(()=>document.documentElement.style.overflow),'','Browser history closes More and restores page scrolling');
 await navigate(page,'Calendar');await page.getByRole('heading',{name:'Calendar',exact:true}).waitFor();await navigate(page,'Meeting history');await page.getByRole('heading',{name:'Your meeting history.',exact:true}).waitFor();assert.equal(await page.getByRole('dialog',{name:'Workspace navigation',exact:true}).isVisible(),false,'Choosing a destination closes More');
 await page.waitForFunction(()=>document.activeElement?.tagName==='H1');await page.getByRole('button',{name:'Open meeting',exact:true}).click();await page.getByRole('heading',{name:/Review action proposals/}).waitFor();assert.equal(await page.getByLabel('Owner 1',{exact:true}).inputValue(),'Maya Patel');assert.ok(await page.getByLabel('Keep task 1',{exact:true}).isChecked());assert.equal(new URL(page.url()).pathname,'/meetings/'+id);
 await navigate(page,'Label & review examples');await page.getByRole('heading',{name:'Label & review examples.',exact:true}).waitFor();await page.getByRole('navigation',{name:'Quick navigation',exact:true}).getByRole('button',{name:'More navigation',exact:true}).click();await page.getByRole('button',{name:'Close navigation',exact:true}).click();
 await page.getByRole('button',{name:'Help',exact:true}).click();await page.getByRole('button',{name:'Close guide',exact:true}).click();assert.ok(await page.getByRole('button',{name:'Help',exact:true}).evaluate(el=>el===document.activeElement));
 await page.setViewportSize({width:1440,height:1000});await page.getByRole('button',{name:'Collapse navigation',exact:true}).click();await page.emulateMedia({forcedColors:'active',reducedMotion:'reduce'});await navigate(page,'Calendar');assert.equal(await page.getByRole('button',{name:'Calendar',exact:true}).getAttribute('aria-current'),'page');assert.notEqual(await page.getByRole('button',{name:'Calendar',exact:true}).evaluate(el=>getComputedStyle(el).outlineStyle),'none');
 const saved=await(await fetch(base+'/api/runs/'+id)).json();assert.equal(saved.status,'review');assert.equal(saved.final_tasks,null);assert.equal(saved.draft.decisions[0].owner,'Maya Patel');assert.deepEqual(errors,[]);
 console.log('Workspace shell passed: compact sidebar/toolbar, persisted collapse, readable research, mobile More and safe areas, keyboard containment/Escape/focus return, route focus, preserved edits, theme/forced-colour states, and 320–1600px responsive accessibility.');
}catch(error){if(page){await shot('workspace-shell-failure').catch(()=>{});await writeFile(path.join(shots,'workspace-shell-failure.txt'),await page.locator('body').innerText().catch(()=>''));}throw error;}
finally{await writeFile(path.join(shots,'workspace-shell-accessibility.json'),JSON.stringify(checks,null,2));await browser?.close();server.closeAllConnections();await server.shutdown();await rm(folder,{recursive:true,force:true});}
