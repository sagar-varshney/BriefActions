import React,{useEffect,useRef,useState} from 'react';
import Icon from './Icon.jsx';
import ProductBrand from './ProductBrand.jsx';
import ThemeControl from './ThemeControl.jsx';
import ResearchNavigation from './ResearchNavigation.jsx';
import accountStorage from './accountStorage.js';
import useWorkspaceInset from './useWorkspaceInset.js';
import './workspace-shell.css';

const quickPages=['extract','today','tasks','calendar'];
const shortNames={extract:'Review',today:'My day',tasks:'Tasks',calendar:'Calendar'};

export default function WorkspaceShell({children,pages,page,navigationKey,account,isDisabled,onNavigate,onHelp,onSignOut}){
 const [collapsed,setCollapsed]=useState(()=>{try{return accountStorage.getItem('flow.sidebarCollapsed')==='true';}catch{return false;}});
 const [mobile,setMobile]=useState(()=>matchMedia('(max-width:960px)').matches),[open,setOpen]=useState(false);
 const header=useRef(null),dialog=useRef(null),more=useRef(null),openedPage=useRef(null),returnFocus=useRef(false);
 useWorkspaceInset(header);
 useEffect(()=>{
  const media=matchMedia('(max-width:960px)'),change=()=>{setMobile(media.matches);setOpen(false);};
  media.addEventListener('change',change);return()=>media.removeEventListener('change',change);
 },[]);
 useEffect(()=>{
  const element=dialog.current;
  if(open&&mobile&&element&&!element.open){openedPage.current=page;returnFocus.current=true;element.showModal();}
  else if(!open){if(element?.open)element.close();if(returnFocus.current){returnFocus.current=false;if(mobile&&page===openedPage.current)more.current?.focus({preventScroll:true});}}
 },[open,mobile,page]);
 useEffect(()=>{dialog.current?.close();setOpen(false);},[navigationKey]);
 useEffect(()=>{
  if(!open||!mobile)return;
  const root=document.documentElement,previous=root.style.overflow;root.style.overflow='hidden';
  return()=>{root.style.overflow=previous;};
 },[open,mobile]);
 function close(){dialog.current?.close();setOpen(false);}
 function containFocus(event){
  if(event.key!=='Tab')return;
  const controls=[...event.currentTarget.querySelectorAll('a[href],button:not(:disabled),[tabindex="0"]')].filter(element=>element.getClientRects().length);
  const first=controls[0],last=controls.at(-1);
  if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}
  else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
 }
 function navigate(id){close();onNavigate(id);}
 function toggleSidebar(){setCollapsed(value=>{try{accountStorage.setItem('flow.sidebarCollapsed',String(!value));}catch{}return !value;});}
 const current=pages.find(item=>item.id===page),otherPage=!quickPages.includes(page);
 const button=item=><button type="button" key={item.id} className={`nav-item ${page===item.id?'active':''}`} aria-current={page===item.id?'page':undefined} title={collapsed&&!mobile?item.name:undefined} disabled={isDisabled(item.id)} onClick={()=>navigate(item.id)}><Icon name={item.id==='data'?'settings':item.icon} size={20}/><span className="nav-label">{item.name}</span></button>;
 const navigation=<>
  <div className="sidebar-heading"><ProductBrand href="/today" onClick={event=>{event.preventDefault();if(!isDisabled('today'))navigate('today');}}/>{mobile?<button type="button" className="shell-icon-button" aria-label="Close navigation" title="Close navigation" onClick={close}><Icon name="cancelled" size={21}/></button>:<button type="button" className="shell-icon-button sidebar-toggle" aria-label={collapsed?'Expand navigation':'Collapse navigation'} title={collapsed?'Expand navigation':'Collapse navigation'} aria-expanded={!collapsed} aria-controls="workspace-sidebar-navigation" onClick={toggleSidebar}><Icon name={collapsed?'sidebarOpen':'sidebarClose'} size={20}/></button>}</div>
  <nav id="workspace-sidebar-navigation" className="sidebar-navigation" aria-label="Main navigation">
   <p className="sidebar-group-label">Workspace</p>
   {pages.filter(item=>['extract','today','tasks','owners','calendar'].includes(item.id)).map(button)}
   <p className="sidebar-group-label sidebar-library-label">Library</p>
   {button(pages.find(item=>item.id==='history'))}
   <ResearchNavigation page={page} disabled={isDisabled('benchmark')} onNavigate={navigate} onOpen={()=>{if(collapsed&&!mobile)toggleSidebar();}}/>
  </nav>
  <div className="sidebar-footer"><nav aria-label="Workspace settings">{button(pages.find(item=>item.id==='data'))}</nav>
   <div className="sidebar-account"><span className="sidebar-account-icon" aria-hidden="true"><Icon name="owner" size={19}/></span><div className="sidebar-account-copy"><strong>{account?'Your workspace':'Local workspace'}</strong><span className="account-name" title={account?.email}>{account?.email || (account?'Signed in':'Saved on this device')}</span></div>{account&&<button type="button" className="shell-icon-button signout-button" aria-label="Sign out" title="Sign out" onClick={onSignOut}><Icon name="signout" size={19}/></button>}</div>
  </div>
 </>;
 return <div className={`app-shell workspace-app-layout${collapsed?' sidebar-collapsed':''}${open?' navigation-open':''}`}>
  <a className="skip-link" href="#workspace-main">Skip to workspace</a>
  {!mobile?<aside className="workspace-sidebar" aria-label="Workspace sidebar">{navigation}</aside>:<dialog ref={dialog} className="workspace-navigation-dialog" aria-label="Workspace navigation" onKeyDown={containFocus} onCancel={event=>{event.preventDefault();close();}} onClose={()=>setOpen(false)} onClick={event=>{const box=event.currentTarget.getBoundingClientRect();if(event.target===event.currentTarget&&(event.clientX<box.left||event.clientX>box.right||event.clientY<box.top||event.clientY>box.bottom))close();}}>{navigation}</dialog>}
  <div className="workspace-body"><header ref={header} className="workspace-header workspace-toolbar">
   <div className="workspace-location"><div className="workspace-mobile-brand"><ProductBrand href="/today" onClick={event=>{event.preventDefault();if(!isDisabled('today'))navigate('today');}}/></div><div><span className="workspace-location-label">Workspace</span><span className="workspace-location-page">{current.name}</span></div></div>
   <div className="workspace-toolbar-actions"><span className="workspace-scope"><span aria-hidden="true"/>{account?'Private workspace':'Local preview'}</span><ThemeControl/><button type="button" className="shell-icon-button workspace-help" aria-label="Help" title="Help & walkthroughs" onClick={onHelp}><Icon name="help" size={21}/></button></div>
  </header>
  {mobile&&<nav className="workspace-mobile-navigation" aria-label="Quick navigation" hidden={open}>
   {quickPages.map(id=>{const item=pages.find(value=>value.id===id);return <button type="button" key={id} aria-label={item.name} aria-current={page===id?'page':undefined} disabled={isDisabled(id)} className={page===id?'active':''} onClick={()=>navigate(id)}><Icon name={item.icon} size={21}/><span>{shortNames[id]}</span></button>;})}
   <button ref={more} type="button" className={otherPage?'active':''} aria-label="More navigation" aria-haspopup="dialog" aria-expanded={open} onClick={()=>setOpen(true)}><Icon name="menu" size={21}/><span>More</span></button>
  </nav>}

  {children}</div>
 </div>;
}
