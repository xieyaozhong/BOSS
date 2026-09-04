(() => {
  const sections=[...document.querySelectorAll('[data-tool-section]')];
  const expand=document.getElementById('expandAll');
  const collapse=document.getElementById('collapseAll');
  expand?.addEventListener('click',()=>sections.forEach(d=>d.open=true));
  collapse?.addEventListener('click',()=>sections.forEach(d=>d.open=false));

  // Mobile starts compact: the score stays visible and tools open only when requested.
  if(matchMedia('(max-width: 860px)').matches){
    sections.forEach(d=>d.open=false);
  }

  // Keep the currently opened tool easy to find without forcing scroll jumps.
  sections.forEach(d=>d.addEventListener('toggle',()=>{
    if(d.open) d.setAttribute('data-expanded','true');
    else d.removeAttribute('data-expanded');
  }));

  const rack=document.getElementById('trackRack');
  const compactTrackEditors=()=>rack?.querySelectorAll('.track-editor[open]').forEach(d=>d.open=false);
  compactTrackEditors();
  if(rack){new MutationObserver(compactTrackEditors).observe(rack,{childList:true});}

  const standalone=(window.matchMedia?.('(display-mode: standalone)').matches)||navigator.standalone===true;
  if(standalone && /iPad|iPhone|iPod/.test(navigator.userAgent)){
    const state=document.getElementById('audioState');
    if(state){
      state.textContent='iPhone 主畫面 Web App 的 Web Audio 可能受系統限制；若重建後仍無聲，請改用 Safari 分頁開啟。';
      state.dataset.tone='warn';
    }
  }
})();