export async function navigationButton(page,name){
 const button=page.getByRole('button',{name,exact:true});
 if(await button.isVisible())return button;
 await page.locator('.workspace-header').waitFor();
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
