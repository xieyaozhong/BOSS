(() => {
  if(!window.ABCJS?.synth?.SynthController) return;
  const NativeSynthController=ABCJS.synth.SynthController;
  const controllers=new Set();
  let needsFreshContext=true;
  let audioUnlocked=false;
  const isiOSLike=/iPad|iPhone|iPod/.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);

  const stateEl=()=>document.getElementById('audioState');
  function setState(message,tone='idle'){
    const el=stateEl();
    if(!el) return;
    el.textContent=message;
    el.dataset.tone=tone;
  }
  function badContext(ctx){
    return !ctx || ['closed','suspended','interrupted'].includes(ctx.state);
  }
  function registerFreshContextNow(){
    // This function MUST stay synchronous until `new AudioContext()` and registerAudioContext().
    // It is called from the user's actual play/click gesture on iOS.
    const old=window.abcjsAudioContext;
    const AC=window.AudioContext||window.webkitAudioContext;
    if(!AC) throw new Error('此瀏覽器不支援 Web Audio');
    const fresh=new AC();
    if(ABCJS.synth.registerAudioContext) ABCJS.synth.registerAudioContext(fresh);
    else window.abcjsAudioContext=fresh;
    try{fresh.resume();}catch{}
    if(old && old!==fresh && old.state!=='closed') old.close?.().catch?.(()=>{});
    needsFreshContext=false;
    audioUnlocked=true;
    setState('新的手機音訊已啟用，正在載入目前總譜…','ok');
    return fresh;
  }
  function patchController(controller){
    controllers.add(controller);
    const nativePlay=controller.play;
    const nativeSetTune=controller.setTune;

    controller.setTune=function(visualObj,userAction,audioParams){
      const shouldPrime=Boolean(userAction || (audioUnlocked && !needsFreshContext && !badContext(window.abcjsAudioContext)));
      // abcjs setTune(false) intentionally defers audio creation. Once mobile audio is unlocked,
      // rebuild immediately so edits, instrument changes and new examples don't keep an old buffer.
      if(controller.midiBuffer && controller.visualObj && controller.visualObj!==visualObj){
        try{controller.destroy();}catch{}
        controller.isLoaded=false;
        controller.isLoading=false;
        controller.isStarted=false;
      }
      return nativeSetTune.call(controller,visualObj,shouldPrime,audioParams);
    };

    controller.play=function(){
      try{
        if(needsFreshContext || badContext(window.abcjsAudioContext)){
          const visual=controller.visualObj;
          const options=controller.options||{};
          try{controller.destroy();}catch{}
          controller.isLoaded=false;
          controller.isLoading=false;
          controller.isStarted=false;
          // Create and register the context synchronously before any promise/await.
          registerFreshContextNow();
          if(visual){
            return nativeSetTune.call(controller,visual,true,options)
              .then(()=>nativePlay.call(controller))
              .then(result=>{setState('播放中。若 iPhone 切到其他 App 再回來，請重新按播放或「啟用聲音」。','ok');return result;})
              .catch(err=>{needsFreshContext=true;audioUnlocked=false;setState('播放初始化失敗：'+err.message,'error');throw err;});
          }
        }
        audioUnlocked=true;
        return Promise.resolve(nativePlay.call(controller)).then(result=>{setState('播放器已啟用。','ok');return result;});
      }catch(err){
        needsFreshContext=true;audioUnlocked=false;setState('手機聲音建立失敗：'+err.message,'error');
        return Promise.reject(err);
      }
    };
    return controller;
  }

  ABCJS.synth.SynthController=function(){return patchController(new NativeSynthController());};
  ABCJS.synth.SynthController.prototype=NativeSynthController.prototype;

  const boot=document.getElementById('audioBoot');
  boot?.addEventListener('pointerdown',()=>{
    if(needsFreshContext || badContext(window.abcjsAudioContext)){
      try{registerFreshContextNow();}catch(err){setState('無法啟用聲音：'+err.message,'error');}
    }
  },{capture:true});
  boot?.addEventListener('click',()=>{
    const play=document.querySelector('#audio .abcjs-midi-start');
    if(play){play.click();}
    else setState('播放器仍在建立中；請稍後再按一次。','warn');
  });

  // Also prepare the context before the native abcjs PLAY click reaches its handler.
  document.getElementById('audio')?.addEventListener('pointerdown',e=>{
    if(!e.target.closest('.abcjs-midi-start')) return;
    if(needsFreshContext || badContext(window.abcjsAudioContext)){
      try{registerFreshContextNow();}catch(err){setState('無法啟用聲音：'+err.message,'error');}
    }
  },{capture:true});

  document.addEventListener('visibilitychange',()=>{
    if(!isiOSLike) return;
    if(document.hidden){
      controllers.forEach(c=>{try{c.pause?.();}catch{}});
      needsFreshContext=true;
      audioUnlocked=false;
    }else{
      setState('iPhone 已回到前景。Safari 可能保留一個「看似 running 但無聲」的舊 Context；下一次播放會自動重建。','warn');
    }
  });
  window.addEventListener('pageshow',e=>{
    if(isiOSLike && e.persisted){needsFreshContext=true;audioUnlocked=false;setState('頁面已從快取恢復；下一次播放會重建手機聲音。','warn');}
  });
  window.addEventListener('pagehide',()=>controllers.forEach(c=>{try{c.pause?.();}catch{}}));
})();