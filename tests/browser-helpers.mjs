export async function navigate(page,name){
 const button=page.getByRole('button',{name,exact:true});
 if(['Compare extraction methods','Label & review examples'].includes(name) && !await button.isVisible())await page.getByRole('button',{name:'Research tools',exact:true}).click();
 await button.click();
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
