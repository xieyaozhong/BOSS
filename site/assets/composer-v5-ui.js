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

  const isiOSLike=/iPad|iPhone|iPod/.test(navigator.userAgent)||
    (navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
  let structuredDirty=false;
  let syncTimer=0;

  const stateEl=()=>document.getElementById('audioState');
  const mobilePlayer=()=>document.getElementById('bossMobileMedia');

  function setSyncState(message,tone='warn'){
    const state=stateEl();
    if(!state) return;
    state.textContent=message;
    state.dataset.tone=tone;
  }

  function invalidateMobileMedia(message='譜面已更新；下一次播放會重新合成最新音軌。'){
    if(!isiOSLike) return;
    const player=mobilePlayer();
    if(player){
      const hadSource=Boolean(player.getAttribute('src')||player.currentSrc);
      if(!player.paused) player.pause();
      if(hadSource){
        player.removeAttribute('src');
        try{player.load();}catch{}
      }
    }
    const boot=document.getElementById('audioBoot');
    if(boot) boot.textContent='▶ 播放最新總譜';
    setSyncState(message,'warn');
  }

  function clickRefresh(){
    const refresh=document.getElementById('refreshPlayback');
    if(refresh) refresh.click();
  }

  function syncStructuredNow(){
    if(syncTimer){clearTimeout(syncTimer);syncTimer=0;}
    if(!structuredDirty) return;
    clickRefresh();
    structuredDirty=false;
  }

  function scheduleStructuredSync(delay=120){
    structuredDirty=true;
    if(syncTimer) clearTimeout(syncTimer);
    syncTimer=setTimeout(()=>{
      syncTimer=0;
      clickRefresh();
      structuredDirty=false;
    },delay);
  }

  function currentTrackStates(){
    return [...document.querySelectorAll('#trackRack .track')].map(row=>({
      mute:Boolean(row.querySelector('[data-act="mute"]')?.classList.contains('active')),
      solo:Boolean(row.querySelector('[data-act="solo"]')?.classList.contains('active'))
    }));
  }

  // The iPhone WAV fallback is generated from #abc. Before mobile playback,
  // build the latest structured ABC and then filter it with the current M/S state.
  function filterAbcForAudibleTracks(abc){
    const source=String(abc||'');
    const lines=source.split(/\r?\n/);
    const voiceIds=[];
    for(const line of lines){
      const m=line.match(/^V:([^\s]+)/);
      if(m&&!voiceIds.includes(m[1])) voiceIds.push(m[1]);
    }
    const states=currentTrackStates();
    if(!voiceIds.length||!states.length) return source;

    const hasSolo=states.some(s=>s.solo&&!s.mute);
    const audible=new Set();
    voiceIds.forEach((id,index)=>{
      const s=states[index]||{mute:false,solo:false};
      if(hasSolo ? (s.solo&&!s.mute) : !s.mute) audible.add(id);
    });
    if(audible.size===voiceIds.length) return source;

    const out=[];
    let bodyVoice=null;
    for(const line of lines){
      const score=line.match(/^%%score\s+(.+)$/);
      if(score){
        out.push('%%score '+voiceIds.filter(id=>audible.has(id)).join(' '));
        continue;
      }
      const def=line.match(/^V:([^\s]+)/);
      if(def){
        bodyVoice=null;
        if(audible.has(def[1])) out.push(line);
        continue;
      }
      const body=line.match(/^\[V:([^\]]+)\]/);
      if(body){
        bodyVoice=body[1];
        if(audible.has(bodyVoice)) out.push(line);
        continue;
      }
      if(bodyVoice){
        if(audible.has(bodyVoice)) out.push(line);
        continue;
      }
      out.push(line);
    }
    return out.join('\n');
  }

  // Run before the v5 mobile-audio target handler. Track textarea input already updates
  // the v3 track object, so one synchronous refresh here rebuilds #abc from the newest data.
  document.addEventListener('click',e=>{
    if(!isiOSLike||!e.target.closest?.('#audioBoot')) return;
    syncStructuredNow();

    const abc=document.getElementById('abc');
    if(!abc) return;
    const full=abc.value;
    const audible=filterAbcForAudibleTracks(full);
    if(audible!==full){
      abc.value=audible;
      queueMicrotask(()=>{
        if(abc.value===audible) abc.value=full;
      });
    }
  },true);

  // Live score synchronization for track/body edits. We debounce typing so the score
  // doesn't re-render on every single keystroke, but the next play is always current.
  document.addEventListener('input',e=>{
    const target=e.target;
    if(target.closest?.('#trackRack')){
      scheduleStructuredSync(target.matches?.('textarea[data-field="body"]')?220:80);
      invalidateMobileMedia();
    }else if(target.closest?.('.settings-grid')){
      scheduleStructuredSync(80);
      invalidateMobileMedia();
    }
  });

  document.addEventListener('change',e=>{
    const target=e.target;
    if(target.closest?.('#trackRack, .settings-grid')){
      structuredDirty=true;
      setTimeout(syncStructuredNow,0);
      invalidateMobileMedia();
    }
  });

  // Buttons that rebuild or alter structured tracks. This listener runs in bubble phase,
  // after the v3/v4 click handlers have changed the track data.
  document.addEventListener('click',e=>{
    const hit=e.target.closest?.(
      '[data-example],[data-preset],#generate,#variation,#addTrack,'+
      '[data-act="apply"],[data-act="remove"],[data-act="mute"],[data-act="solo"],'+
      '#newTrackForImport,#restoreStructured'
    );
    if(!hit) return;
    structuredDirty=true;
    invalidateMobileMedia();
    setTimeout(syncStructuredNow,0);
  });

  if(rack){
    const observer=new MutationObserver(()=>{
      compactTrackEditors();
      structuredDirty=true;
      invalidateMobileMedia('音軌結構已更新；手機播放會重新合成最新總譜。');
      scheduleStructuredSync(60);
    });
    observer.observe(rack,{childList:true});
  }

  const standalone=(window.matchMedia?.('(display-mode: standalone)').matches)||navigator.standalone===true;
  if(standalone && /iPad|iPhone|iPod/.test(navigator.userAgent)){
    const state=document.getElementById('audioState');
    if(state){
      state.textContent='iPhone 主畫面 Web App 的音訊可能受系統限制；手機版會優先使用原生媒體 WAV 播放。';
      state.dataset.tone='warn';
    }
  }
})();