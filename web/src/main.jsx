import '@fontsource-variable/inter/wght.css';
import React from 'react';
import {createRoot} from 'react-dom/client';
import AuthShell from './AuthShell.jsx';
import {deferSection} from './DeferredSection.jsx';
import './styles.css';

const WorkspaceApp=deferSection(()=>import('./WorkspaceApp.jsx'),'your workspace');
const PrivacyPage=deferSection(()=>import('./PrivacyPage.jsx'),'privacy information');
createRoot(document.getElementById('root')).render(location.pathname.replace(/\/$/,'')==='/privacy'?<PrivacyPage/>:<AuthShell>{props=><WorkspaceApp {...props}/>}</AuthShell>);
