import React from 'react';
import Icon from './Icon.jsx';

export default function Evidence({passages=[],onInspect,label}){
 return <div className="evidence"><div className="eyebrow"><Icon name="quote" size={15}/> Supporting transcript</div>{passages.map((e,i)=><div key={i}><blockquote>{e.text}</blockquote><div className="evidence-footer"><span className="span-note">Characters {e.start}–{e.end} in the saved input</span>{onInspect&&<button type="button" className="text-button evidence-jump" aria-label={`Locate passage ${i+1} for ${label}`} onClick={event=>onInspect(e,event.currentTarget)}>Locate passage <Icon name="arrow" size={14}/></button>}</div></div>)}</div>;
}
