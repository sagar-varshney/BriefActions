const paths={today:'/today',extract:'/meetings',tasks:'/tasks',owners:'/owners',calendar:'/calendar',history:'/history',benchmark:'/research/evaluation',annotations:'/research/annotations',data:'/account'};
const validTask=value=>typeof value==='string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value);
export function readRoute(url=new URL(location.href)){
 const path=url.pathname.replace(/\/$/,'') || '/';
 if(path==='/' && url.hash==='#data')return {page:'data',runId:null};
 const match=path.match(/^\/meetings\/([a-f0-9]{32})$/);
 if(match){const taskId=url.searchParams.get('task');return {page:'extract',runId:match[1],...(validTask(taskId)?{taskId}:{})};}
 if(path==='/')return {page:'extract',runId:null,restore:true};
 const page=Object.keys(paths).find(key=>paths[key]===path);
 return {page:page || 'extract',runId:null,invalid:!page};
}
export function routePath({page,runId,taskId}){return page==='extract' && runId?`/meetings/${runId}${validTask(taskId)?'?task='+encodeURIComponent(taskId):''}`:paths[page] || paths.extract;}
