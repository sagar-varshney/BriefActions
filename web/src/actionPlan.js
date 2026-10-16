const inline=value=>String(value).replace(/\r\n?/g,'\n').split('\n').join(' ');
// Escape user text so a downloaded plan cannot introduce links, images or HTML.
const markdown=value=>inline(value).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/[\\`*_{}[\]()#+.!|~-]/g,'\\$&');
const unknown=value=>!value?.trim() || value.trim().toLowerCase()==='unknown';

export function actionPlan(run,{groupBy='owner',format='text'}={}){
 if(run?.status!=='confirmed' || !Array.isArray(run.final_tasks))throw new Error('Confirm your plan before exporting it.');
 if(!['owner','deadline','none'].includes(groupBy) || !['text','markdown'].includes(format))throw new Error('Invalid action plan format.');
 const md=format==='markdown',escape=md?markdown:inline,groups=new Map();
 for(const task of run.final_tasks){const key=groupBy==='none'?'Tasks':unknown(task[groupBy])?'Unknown':task[groupBy];if(!groups.has(key))groups.set(key,[]);groups.get(key).push(task);}
 const keys=[...groups.keys()].sort((a,b)=>a==='Unknown'?1:b==='Unknown'?-1:a<b?-1:a>b?1:0);
 const lines=[`${md?'# ':''}${escape(run.title || `Meeting ${run.reference_date}`)}`,'',`Meeting date: ${run.reference_date}`,`Confirmed action plan · ${run.final_tasks.length} task${run.final_tasks.length===1?'':'s'}`,''];
 if(!run.final_tasks.length)lines.push('No tasks were confirmed.','');
 for(const key of keys){
  lines.push(`${md?'## ':''}${groupBy==='owner'?'Owner: ':groupBy==='deadline'?'Deadline: ':''}${escape(key)}`,'');
  for(const [index,task] of groups.get(key).entries()){
   lines.push(md?`- **${escape(task.task)}**  `:`${index+1}. ${escape(task.task)}`,
    `  Owner: ${escape(task.owner)}${md?'  ':''}`,`  Deadline: ${escape(task.deadline)}${md?'  ':''}`);
   if(task.evidence?.length){lines.push('  Supporting transcript:');for(const passage of task.evidence){for(const line of passage.text.replace(/\r\n?/g,'\n').split('\n'))lines.push(md?`  > ${markdown(line)}`:`    ${line}`);lines.push('');}}
   else lines.push('  No supporting passage is attached.','');
  }
 }
 return lines.join('\n').trimEnd()+'\n';
}
