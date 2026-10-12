import {useState} from 'react';
export default function ThemeControl(){
  const [theme,setTheme]=useState(()=>{try{return localStorage.getItem('flow.theme') || 'system';}catch{return 'system';}});
  return <label className="theme-control">Theme<select aria-label="Color theme" value={theme} onChange={e=>{setTheme(e.target.value);try{localStorage.setItem('flow.theme',e.target.value);}catch{}window.applyFlowTheme(e.target.value);}}><option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option></select></label>;
}
