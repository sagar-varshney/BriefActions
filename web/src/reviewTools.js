export const missing=value=>!value?.trim() || value.trim().toLowerCase()==='unknown';
export function validDeadline(value){const text=value?.trim();return text==='Unknown' || /^\d{4}-\d{2}-\d{2}$/.test(text || '') && text.slice(0,4)!=='0000' && Number.isFinite(Date.parse(text)) && new Date(text).toISOString().slice(0,10)===text;}
export function issues(item){return [!item.task?.trim()&&{field:'task',label:'Task is empty'},missing(item.owner)&&{field:'owner',label:'Owner unknown'},missing(item.deadline)&&{field:'deadline',label:'Deadline missing'},!missing(item.deadline)&&!validDeadline(item.deadline)&&{field:'deadline',label:'Deadline is invalid'}].filter(Boolean);}
export function reviewError(items){for(let index=0;index<items.length;index++){const item=items[index];if(!item.task?.trim())return {index,field:'task',message:`Task ${index+1} needs a description.`};if(!item.owner?.trim())return {index,field:'owner',message:`Owner ${index+1} cannot be empty; use Unknown if it was not stated.`};if(!validDeadline(item.deadline))return {index,field:'deadline',message:`Deadline ${index+1} must be a valid YYYY-MM-DD date or Unknown.`};}return null;}
export const progressLabels={todo:'To do',in_progress:'In progress',done:'Done'};
export function localToday(now=new Date()){return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;}
export function dueMatches(task,status,filter,today=localToday()){
 if(filter==='all')return true;
 if(filter==='unknown')return missing(task.deadline);
 if(!validDeadline(task.deadline) || missing(task.deadline) || status==='done')return false;
 if(filter==='overdue')return task.deadline<today;
 if(filter==='today')return task.deadline===today;
 const end=new Date(`${today}T12:00:00Z`);end.setUTCDate(end.getUTCDate()+7);
 return filter==='upcoming' && task.deadline>today && task.deadline<=end.toISOString().slice(0,10);
}
