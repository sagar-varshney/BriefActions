import Icon from './Icon.jsx';
import React,{useEffect,useRef,useState} from 'react';
export default function ResearchNavigation({page,disabled,onNavigate,onOpen}){
 const [open,setOpen]=useState(false),root=useRef(null);
 useEffect(()=>{if(disabled)setOpen(false);},[disabled]);
 useEffect(()=>{const outside=event=>{if(!root.current?.contains(event.target))setOpen(false);};document.addEventListener('pointerdown',outside);return()=>document.removeEventListener('pointerdown',outside);},[]);
 return <div className="research-navigation" ref={root} onBlur={e=>{if(!e.currentTarget.contains(e.relatedTarget))setOpen(false);}} onKeyDown={e=>{if(e.key==='Escape'&&open){e.preventDefault();e.stopPropagation();setOpen(false);root.current.querySelector('button').focus();}}}><button type="button" disabled={disabled} className={`nav-item ${['benchmark','annotations'].includes(page)?'active':''}`} aria-expanded={open&&!disabled} aria-controls="research-links" onClick={()=>{if(!open)onOpen?.();setOpen(!open);}}><Icon name="chart" size={20}/><span>Research tools</span><Icon name="chevron" size={12} className="research-chevron"/></button><div id="research-links" className="research-links" hidden={!open||disabled}>{[{id:'benchmark',label:'Compare extraction methods'},{id:'annotations',label:'Label & review examples'}].map(p=><button type="button" key={p.id} className="nav-item" aria-current={page===p.id?'page':undefined} onClick={()=>{setOpen(false);onNavigate(p.id);}}>{p.label}</button>)}</div></div>;
}
