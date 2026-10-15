import React from 'react';
export default function ProductBrand({onClick,href='/'}){
  return <a href={href} className="brand" onClick={onClick} aria-label="Productivity Flow Engine home"><span className="brand-mark" aria-hidden="true"><img src="/flow.svg?v=2" width="44" height="44" alt=""/></span><span className="brand-wordmark"><span className="brand-name">Productivity</span><span className="brand-sub">FLOW ENGINE</span></span></a>;
}
