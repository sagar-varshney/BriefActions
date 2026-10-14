import React,{useEffect,useRef,useState} from 'react';
export default function ResearchNavigation({page,disabled,onNavigate}){
 const [open,setOpen]=useState(false),root=useRef(null);
 useEffect(()=>{const outside=event=>{if(!root.current?.contains(event.target))setOpen(false);};document.addEventListener('pointerdown',outside);return()=>document.removeEventListener('pointerdown',outside);},[]);
 return <div className="research-navigation" ref={root} onKeyDown={e=>{if(e.key==='Escape'){setOpen(false);root.current.querySelector('button').focus();}}}><button type="button" disabled={disabled} className={`nav-item ${['benchmark','annotations'].includes(page)?'active':''}`} aria-expanded={open} aria-controls="research-links" onClick={()=>setOpen(!open)}>Research tools <span aria-hidden="true">⌄</span></button><div id="research-links" className="research-links" hidden={!open}>{[{id:'benchmark',label:'Evaluation lab'},{id:'annotations',label:'Annotation reviewer'}].map(p=><button type="button" key={p.id} className="nav-item" aria-current={page===p.id?'page':undefined} onClick={()=>{setOpen(false);onNavigate(p.id);}}>{p.label}</button>)}</div></div>;
}
