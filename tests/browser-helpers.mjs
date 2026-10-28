// Legacy card-layout suites choose their original layouts explicitly. The focused
// review suite uses a fresh account/browser with the new product default.
export async function legacyReviewDefaults(target,accounts=[]){
 await target.addInitScript(accounts=>{
  try{if(sessionStorage.getItem('flow.test.legacyReviewInitialized'))return;const layout=matchMedia('(max-width:760px)').matches?'focus':'detailed';for(const key of ['flow.reviewLayout',...accounts.map(id=>`flow.account.${id}.flow.reviewLayout`)])if(localStorage.getItem(key)===null)localStorage.setItem(key,layout);sessionStorage.setItem('flow.test.legacyReviewInitialized','true');}catch{}
 },accounts);
}
export async function navigationButton(page,name){
 const button=page.getByRole('button',{name,exact:true});
 await page.locator('.workspace-header').waitFor();
 await page.waitForFunction(()=>matchMedia('(max-width:960px)').matches?!!document.querySelector('.workspace-mobile-navigation'):!!document.querySelector('.workspace-sidebar'));
 if(await button.isVisible())return button;
 const more=page.getByRole('button',{name:'More navigation',exact:true});
 if(await more.isVisible())await more.click();
 if(['Compare extraction methods','Label & review examples'].includes(name)&&!await button.isVisible())await page.getByRole('button',{name:'Research tools',exact:true}).click();
 return button;
}
export async function navigate(page,name){
 await (await navigationButton(page,name)).click();
}
export async function scrollWorkspace(page,position=0){
 await page.evaluate(position=>{
  const main=document.getElementById('workspace-main'),framed=main&&getComputedStyle(main).overflowY==='auto';
  const top=position==='end'?(framed?main.scrollHeight:document.documentElement.scrollHeight):position;
  if(framed)main.scrollTo({top,left:0,behavior:'instant'});else window.scrollTo({top,left:0,behavior:'instant'});
 },position);
}
export async function meetingField(page,name){
 const field=page.getByLabel(name,{exact:true});
 if(await field.count() && !await field.isVisible()){
  const edit=page.getByRole('button',{name:'Edit meeting input',exact:true});
  if(await edit.isVisible())await edit.click();
 }
 return field;
}
export async function openLayoutOptions(page){
 if(!await page.getByLabel('Transcript panel width',{exact:true}).isVisible())await page.locator('.layout-options>summary').click();
}
