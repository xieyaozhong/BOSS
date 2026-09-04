(() => {
  const $ = id => document.getElementById(id);
  const EXAMPLES={
    citypop:{preset:'band',key:'C',meter:'4/4',tempo:118,bodies:['| E2 G2 A2 c2 | B2 A2 G2 E2 | G2 A2 c2 B2 | A2 G2 E4 |','| [CEG]2 [DFA]2 [EGB]2 [FAC]2 | [ACE]2 [GBd]2 [FAC]2 [GBd]2 | [CEG]4 [ACE]4 | [FAC]4 [GBd]4 |','| C,2 C,2 G,2 A,2 | F,2 F,2 G,2 G,2 | A,2 E,2 F,2 C2 | D2 G,2 C4 |','| [CEG]8 | [ACE]8 | [FAC]8 | [GBd]8 |']},
    kost:{preset:'strings',key:'G',meter:'4/4',tempo:74,bodies:['| B2 d2 e2 d2 | A2 B2 d4 | e2 d2 B2 A2 | G4 A4 |','| G4 B4 | A4 d4 | B4 e4 | A4 d4 |','| D4 G4 | E4 A4 | G4 B4 | F4 A4 |','| G,8 | C8 | E8 | D8 |']},
    lofi:{preset:'band',key:'Am',meter:'4/4',tempo:76,bodies:['| z2 e2 a2 g2 | e2 d2 c4 | z2 c2 e2 g2 | a4 e4 |','| [ACE]4 [FAC]4 | [CEG]4 [GBd]4 | [ACE]4 [EGB]4 | [FAC]4 [EGB]4 |','| A,4 E,4 | F,4 C4 | C4 G,4 | E,4 A,4 |','| [Ace]8 | [Fac]8 | [CEG]8 | [EGB]8 |']},
    hero:{preset:'cinematic',key:'D',meter:'4/4',tempo:108,bodies:['| D2 A2 d2 A2 | F2 A2 d4 | e2 d2 A2 F2 | D4 A4 |','| D4 F4 | A4 d4 | B4 A4 | G4 F4 |','| [DFA]8 | [GBd]8 | [Ace]8 | [DFA]8 |','| D,4 A,4 | G,4 D4 | A,4 E4 | D,8 |','| D,,8 | G,,8 | A,,8 | D,,8 |','| [DFA]8 | [GBd]8 | [Ace]8 | [DFA]8 |']},
    mystic:{preset:'cinematic',key:'Dm',meter:'6/8',tempo:64,bodies:['| D2 F2 A2 | c2 A2 F2 | E2 G2 B2 | A2 G2 E2 |','| A2 d2 f2 | e2 c2 A2 | B2 e2 g2 | f2 e2 c2 |','| [DFA]6 | [BDF]6 | [CEG]6 | [Ace]6 |','| D,6 | B,6 | C6 | A,6 |','| D,,6 | B,,6 | C,6 | A,,6 |','| [DFA]6 | [BDF]6 | [CEG]6 | [Ace]6 |']},
    woodland:{preset:'woodwind',key:'F',meter:'6/8',tempo:104,bodies:['| F2 A2 c2 | d2 c2 A2 | G2 B2 d2 | c2 A2 F2 |','| A2 c2 f2 | e2 c2 A2 | B2 d2 g2 | f2 d2 B2 |','| C2 E2 G2 | A2 G2 E2 | D2 F2 A2 | G2 E2 C2 |','| F,6 | C6 | D6 | C6 |']},
    waltz:{preset:'trio',key:'Dm',meter:'3/4',tempo:108,bodies:['| D2 F2 A2 | c2 A2 F2 | E2 G2 B2 | A2 G2 E2 |','| [DFA]2 A2 F2 | [BDF]2 F2 D2 | [CEG]2 G2 E2 | [Ace]2 e2 c2 |','| D,2 A,2 D2 | B,2 F2 B2 | C2 G2 C2 | A,2 E2 A2 |']},
    ballad:{preset:'trio',key:'G',meter:'4/4',tempo:72,bodies:['| G2 A2 B4 | d2 B2 A4 | e2 d2 B2 A2 | G4 G4 |','| [GBd]4 [EGB]4 | [CEG]4 [DFA]4 | [EGB]4 [CEG]4 | [DFA]8 |','| G,4 D4 | E,4 B,4 | C4 G,4 | D4 G,4 |']},
    jazz:{preset:'band',key:'F',meter:'4/4',tempo:96,bodies:['| A2 c2 d2 c2 | F2 A2 c2 A2 | B2 d2 f2 d2 | c4 A4 |','| [FAc]2 [GBd]2 [Ace]2 [GBd]2 | [DFA]2 [EGB]2 [FAc]4 | [Bdf]2 [Ace]2 [GBd]4 | [FAc]8 |','| F,2 A,2 C2 E2 | D2 F2 G2 A2 | B,2 D2 E2 G2 | F2 C2 F,4 |','| [FAc]4 [Ace]4 | [DFA]4 [GBd]4 | [Bdf]4 [GBd]4 | [FAc]8 |']},
    minimal:{preset:'trio',key:'C',meter:'4/4',tempo:64,bodies:['| C2 G2 E2 G2 | C2 G2 E2 G2 | D2 A2 F2 A2 | C2 G2 E4 |','| [CEG]8 | [CEG]8 | [DFA]8 | [CEG]8 |','| C,8 | C,8 | D,8 | C,8 |']},
    gametown:{preset:'woodwind',key:'C',meter:'6/8',tempo:112,bodies:['| C2 E2 G2 | c2 G2 E2 | D2 F2 A2 | G2 E2 C2 |','| E2 G2 c2 | B2 G2 E2 | F2 A2 d2 | c2 A2 F2 |','| G2 B2 d2 | c2 B2 G2 | A2 c2 e2 | d2 c2 A2 |','| C,2 G,2 C2 | F,2 C2 F2 | G,2 D2 G2 | C,6 |']},
    finale:{preset:'cinematic',key:'Em',meter:'4/4',tempo:132,bodies:['| E E B B e e B B | G G B B e4 | F F A A d d A A | E2 B2 e4 |','| E2 G2 B2 e2 | d2 B2 G2 E2 | F2 A2 d2 f2 | e2 d2 B4 |','| [EGB]4 [CEG]4 | [DFA]4 [EGB]4 | [CEG]4 [DFA]4 | [EGB]8 |','| E,2 E,2 B,2 B,2 | C2 C2 G,2 G,2 | D2 D2 A,2 A,2 | E,8 |','| E,,8 | C,8 | D,8 | E,,8 |','| [EGB]8 | [CEG]8 | [DFA]8 | [EGB]8 |']}
  };
  function applyExample(name){
    const ex=EXAMPLES[name]; if(!ex) return;
    document.querySelector(`[data-preset="${ex.preset}"]`)?.click();
    $('key').value=ex.key; $('meter').value=ex.meter; $('bars').value='4'; $('tempo').value=ex.tempo; $('tempoLabel').textContent=ex.tempo+' BPM';
    [...document.querySelectorAll('.track-editor textarea')].forEach((ta,i)=>{ta.value=ex.bodies[i]||'| z8 |';ta.dispatchEvent(new Event('input',{bubbles:true}));});
    $('refreshPlayback')?.click();
    const label=document.querySelector(`[data-example="${name}"] strong`)?.textContent||name;
    $('exampleStatus').textContent=`已載入「${label}」：${ex.key} · ${ex.meter} · ${ex.tempo} BPM。所有聲部都可繼續手動修改。`;
  }
  function youtubeId(url){
    const host=url.hostname.replace(/^www\./,'').toLowerCase(); let id='';
    if(host==='youtu.be') id=url.pathname.split('/').filter(Boolean)[0]||'';
    else if(host==='youtube.com'||host==='music.youtube.com'||host==='m.youtube.com'){
      if(url.pathname==='/watch') id=url.searchParams.get('v')||'';
      else {const parts=url.pathname.split('/').filter(Boolean); if(['shorts','embed','live'].includes(parts[0])) id=parts[1]||'';}
    }
    return /^[A-Za-z0-9_-]{11}$/.test(id)?id:null;
  }
  function placeholder(){return '<div class="stream-placeholder">貼入 YouTube 或 Apple Music 的公開分享連結，就能在編曲器旁直接播放比對。<br>這個播放器只作參考，不會下載或抽取平台串流。</div>';}
  function loadReferenceStream(){
    const raw=$('streamUrl').value.trim(), box=$('streamPlayer'), status=$('streamStatus'), open=$('openStream'), clear=$('clearStream');
    if(!raw){status.textContent='請先貼上 YouTube 或 Apple Music 分享連結。';return;}
    let url; try{url=new URL(raw);}catch{status.textContent='連結格式不正確。';return;}
    box.replaceChildren(); const iframe=document.createElement('iframe'); let kind=''; const yid=youtubeId(url);
    if(yid){kind='YouTube';iframe.src=`https://www.youtube.com/embed/${yid}?enablejsapi=1&playsinline=1&rel=0&origin=${encodeURIComponent(location.origin)}`;iframe.height='315';iframe.allow='accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture; web-share';iframe.allowFullscreen=true;iframe.referrerPolicy='strict-origin-when-cross-origin';}
    else if(/(^|\.)music\.apple\.com$/i.test(url.hostname)){kind='Apple Music';iframe.src=`https://embed.music.apple.com${url.pathname}${url.search}`;iframe.height='175';iframe.allow='autoplay *; encrypted-media *; fullscreen *';iframe.sandbox='allow-forms allow-popups allow-same-origin allow-scripts allow-storage-access-by-user-activation allow-top-navigation-by-user-activation';}
    else {status.textContent='目前只接受 YouTube / YouTube Music / Apple Music 的公開分享連結。';box.innerHTML='<div class="stream-placeholder">無法辨識這個音樂平台連結。</div>';return;}
    iframe.title=`${kind} 參考音源播放器`;box.append(iframe);open.href=url.href;open.classList.remove('hidden');clear.classList.remove('hidden');status.textContent=`已載入 ${kind} 參考播放器。若原作者禁止嵌入，請使用「在原平台開啟」。平台串流不會被本站擷取或送去自動轉譜。`;
  }
  function clearReferenceStream(){$('streamUrl').value='';$('streamPlayer').innerHTML=placeholder();$('openStream').classList.add('hidden');$('clearStream').classList.add('hidden');$('streamStatus').textContent='支援常見 youtube.com / youtu.be / music.youtube.com / music.apple.com 分享連結。';}
  document.querySelectorAll('[data-example]').forEach(b=>b.addEventListener('click',()=>applyExample(b.dataset.example)));
  $('loadStream')?.addEventListener('click',loadReferenceStream); $('clearStream')?.addEventListener('click',clearReferenceStream); $('streamUrl')?.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();loadReferenceStream();}});
})();

(() => {
  if (window.__bossV6Loader) return;
  window.__bossV6Loader = true;
  const script = document.createElement('script');
  script.src = './assets/composer-v6-transcription.js';
  script.defer = true;
  document.body.appendChild(script);
})();
