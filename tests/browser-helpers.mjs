export async function navigate(page,name){
 const button=page.getByRole('button',{name,exact:true});
 if(['Evaluation lab','Annotation reviewer'].includes(name) && !await button.isVisible())await page.getByRole('button',{name:'Research tools',exact:true}).click();
 await button.click();
}
