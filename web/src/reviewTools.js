export const missing=value=>!value?.trim() || value.trim().toLowerCase()==='unknown';
export function validDeadline(value){const text=value?.trim();return text==='Unknown' || /^\d{4}-\d{2}-\d{2}$/.test(text || '') && text.slice(0,4)!=='0000' && Number.isFinite(Date.parse(text)) && new Date(text).toISOString().slice(0,10)===text;}
const taskWords=value=>(value?.toLowerCase().match(/[a-z0-9]+/g) || []).filter(word=>!['a','an','the'].includes(word)).join(' ');
export function issues(item,items=[]){
 const result=[
  !item.task?.trim()&&{field:'task',label:'Task is empty',description:'Write the action you want to keep, using the supporting passage to check it.'},
  missing(item.owner)&&{field:'owner',label:'Owner unknown',description:'This proposal has no named owner. Check the supporting passage; keep Unknown if you cannot establish who is responsible.'},
  missing(item.deadline)&&{field:'deadline',label:'Deadline missing',description:'This proposal has no exact deadline. Check the supporting passage; vague timing such as “soon” can stay Unknown.'},
  !missing(item.deadline)&&!validDeadline(item.deadline)&&{field:'deadline',label:'Deadline is invalid',description:'Use a real calendar date in YYYY-MM-DD format, or Unknown. This value must be corrected before confirmation.'}
 ].filter(Boolean);
 if(!missing(item.deadline)&&validDeadline(item.deadline)&&taskWords(item.task)){
  const alternatives=[...new Set(items.filter(other=>other.proposal_id!==item.proposal_id && taskWords(other.task)===taskWords(item.task) && (other.owner===item.owner || missing(other.owner) || missing(item.owner)) && !missing(other.deadline)&&validDeadline(other.deadline)&&other.deadline!==item.deadline).map(other=>other.deadline))].sort();
  if(alternatives.length)result.push({field:'deadline',label:'Different deadlines',description:`Another proposal with the same task wording uses ${alternatives.join(', ')}. Compare the supporting passages before deciding which tasks and dates to keep.`});
 }
 return result;
}
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
