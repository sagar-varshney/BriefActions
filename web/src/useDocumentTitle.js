import {useEffect} from 'react';

export default function useDocumentTitle(label){
 useEffect(()=>{
  // The workspace owns its title while the authenticated app is mounted.
  if(label!==null)document.title=label?`${label} · BriefActions`:'BriefActions';
 },[label]);
}
