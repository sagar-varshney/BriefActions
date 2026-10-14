const paths={extract:'/meetings',history:'/history',benchmark:'/research/evaluation',annotations:'/research/annotations',data:'/account'};
export function readRoute(url=new URL(location.href)){
 const path=url.pathname.replace(/\/$/,'') || '/';
 if(path==='/' && url.hash==='#data')return {page:'data',runId:null};
 const match=path.match(/^\/meetings\/([a-f0-9]{32})$/);
 if(match)return {page:'extract',runId:match[1]};
 if(path==='/')return {page:'extract',runId:null,restore:true};
 const page=Object.keys(paths).find(key=>paths[key]===path);
 return {page:page || 'extract',runId:null,invalid:!page};
}
export function routePath({page,runId}){return page==='extract' && runId?`/meetings/${runId}`:paths[page] || paths.extract;}
