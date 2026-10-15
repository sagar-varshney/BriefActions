import React from 'react';
export default function ProductBrand({onClick,href='/'}){
  return <a href={href} className="brand" onClick={onClick} aria-label="BriefActions home"><span className="brand-mark" aria-hidden="true"><img src="/flow.svg?v=3" width="52" height="52" alt=""/></span><span className="brand-wordmark"><span className="brand-name">BriefActions</span></span></a>;
}
