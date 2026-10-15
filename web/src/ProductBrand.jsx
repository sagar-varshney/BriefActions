import React from 'react';
export default function ProductBrand({onClick,href='/'}){
  return <a href={href} className="brand" onClick={onClick} aria-label="Productivity Flow Engine home"><span className="brand-mark" aria-hidden="true"><img src="/flow.svg?v=3" width="52" height="52" alt=""/></span><span className="brand-wordmark"><span className="brand-sub">PRODUCTIVITY</span><span className="brand-name">Flow Engine</span></span></a>;
}
