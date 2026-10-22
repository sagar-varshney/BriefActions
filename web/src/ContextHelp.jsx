import React from 'react';
import Icon from './Icon.jsx';

export default function ContextHelp({title,children,className=''}){
 return <details className={`context-help ${className}`.trim()}><summary><Icon name="help" size={17}/><span>{title}</span><Icon name="chevron" size={14} className="context-help-chevron"/></summary><div className="context-help-content">{children}</div></details>;
}
