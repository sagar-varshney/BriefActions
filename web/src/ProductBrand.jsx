import React from 'react';
export default function ProductBrand({onClick,href='/'}){
  return <a href={href} className="brand" onClick={onClick} aria-label="Productivity Flow Engine home"><span className="brand-mark"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m14 2-8 11h6l-2 9 8-11h-6z"/></svg></span><span>Productivity<span className="brand-sub">FLOW ENGINE</span></span></a>;
}
