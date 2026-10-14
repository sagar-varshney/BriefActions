(() => {
  const media=matchMedia('(prefers-color-scheme: dark)');
  let preference='system';
  try{preference=localStorage.getItem('flow.theme') || 'system';}catch{}
  window.applyFlowTheme=value=>{
    preference=['light','dark'].includes(value)?value:'system';
    const theme=preference==='system'?(media.matches?'dark':'light'):preference;
    document.documentElement.dataset.theme=theme;
    document.documentElement.style.colorScheme=theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content',theme==='dark'?'#101c1a':'#f5f8f6');
  };
  media.addEventListener('change',()=>window.applyFlowTheme(preference));
  window.applyFlowTheme(preference);
})();
