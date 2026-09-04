(() => {
  'use strict';
  if (window.__bossV6TranscriptionLoaded) return;
  window.__bossV6TranscriptionLoaded = true;

  const $ = (id) => document.getElementById(id);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const fmt = (s) => {
    s = Number.isFinite(s) ? Math.max(0, s) : 0;
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60).toString().padStart(2, '0');
    const ms = Math.floor((s % 1) * 10);
    return `${m}:${sec}.${ms}`;
  };

  const state = {
    file: null,
    buffer: null,
    mono: null,
    duration: 0,
    loopA: 0,
    loopB: 0,
    loopOn: false,
    markers: [],
    zoom: 1,
    center: 0,
    pitch: [],
    pitchReady: false,
    dragging: false,
    dragStart: 0,
    raf: 0,
    timing: null,
    timingVisual: null,
    activeEls: [],
    lastSyncSec: -1,
    tapTimes: [],
    bpm: null,
    spectroBusy: false,
    spectroToken: 0,
  };

  function addStyleLink() {
    if (document.querySelector('link[data-boss-v6-transcription]')) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = './assets/composer-v6-transcription.css';
    link.dataset.bossV6Transcription = '1';
    document.head.appendChild(link);
  }

  function buildUI() {
    if ($('transcriptionLab')) return;
    const wrap = document.querySelector('.wrap') || document.body;
    const lab = document.createElement('section');
    lab.id = 'transcriptionLab';
    lab.className = 'panel transcription-lab';
    lab.innerHTML = `
      <div class="tl-head">
        <div>
          <span class="eyebrow">TRANSCRIPTION LAB · SONIC VISUALISER × TONY × AUDACITY × MUSESCORE</span>
          <h2>專業扒譜模式</h2>
          <p>把音檔、波形、頻譜、音高軌跡、A/B Loop、標記與五線譜放在同一條時間軸上。上傳音檔後即可使用。</p>
        </div>
        <div class="tl-badges"><span>WAVEFORM</span><span>SPECTROGRAM</span><span>PITCH</span><span>A/B LOOP</span><span>SCORE FOLLOW</span></div>
      </div>

      <div class="tl-transport">
        <div class="tl-transport-main">
          <button class="btn primary" id="tlPlay" type="button">▶ 播放參考音檔</button>
          <button class="mini" id="tlBack5" type="button" title="倒退 5 秒">−5s</button>
          <button class="mini" id="tlForward5" type="button" title="前進 5 秒">+5s</button>
          <span class="tl-clock" id="tlClock">0:00.0 / 0:00.0</span>
        </div>
        <div class="tl-transport-controls">
          <label>速度 <output id="tlSpeedLabel">1.00×</output><input id="tlSpeed" type="range" min="0.25" max="2" step="0.05" value="1"></label>
          <label class="checkline"><input id="tlPreservePitch" type="checkbox" checked> 變速維持音高</label>
          <label>縮放 <output id="tlZoomLabel">1×</output><input id="tlZoom" type="range" min="1" max="16" step="1" value="1"></label>
        </div>
      </div>

      <div class="tl-syncbar">
        <div class="tl-syncstat"><b id="tlSyncState">WAITING AUDIO</b><span id="tlBarBeat">BAR 1 · BEAT 1</span></div>
        <label class="checkline"><input id="tlFollowScore" type="checkbox" checked> 播放時跟譜</label>
        <label class="checkline"><input id="tlHighlightNotes" type="checkbox" checked> 高亮目前音符</label>
        <button class="mini" id="tlRebuildSync" type="button">↻ 重建同步</button>
      </div>

      <div class="tl-view" id="tlTimeline">
        <div class="tl-view-head"><strong>Waveform</strong><span id="tlViewRange">0:00.0 — 0:00.0</span></div>
        <div class="tl-canvas-wrap" id="tlWaveWrap"><canvas id="tlWave"></canvas><div class="tl-selection" id="tlSelection"></div><div class="tl-playhead" id="tlWaveHead"></div><div class="tl-markers" id="tlMarkerLayer"></div></div>
        <div class="tl-view-head"><strong>Spectrogram + Pitch Track</strong><span id="tlFreqReadout">50 Hz — 5 kHz</span></div>
        <div class="tl-canvas-wrap spectro" id="tlSpectroWrap"><canvas id="tlSpectro"></canvas><canvas id="tlPitchOverlay"></canvas><div class="tl-playhead" id="tlSpectroHead"></div></div>
      </div>

      <div class="tl-grid">
        <section class="tl-card">
          <div class="tl-card-head"><strong>A/B 區段循環</strong><span>Sonic Visualiser / MuseScore</span></div>
          <div class="ab-times"><div><small>A</small><b id="tlA">0:00.0</b></div><div><small>B</small><b id="tlB">0:00.0</b></div></div>
          <div class="actions"><button class="mini" id="tlSetA" type="button">A = 現在</button><button class="mini" id="tlSetB" type="button">B = 現在</button><button class="btn acid" id="tlLoop" type="button">LOOP OFF</button><button class="mini" id="tlClearLoop" type="button">清除</button></div>
          <p>也可以直接在 Waveform 上拖曳一段時間建立 A/B 選區；點一下波形即可跳播。</p>
        </section>

        <section class="tl-card">
          <div class="tl-card-head"><strong>時間標記 / 樂句註記</strong><span>Sonic Visualiser</span></div>
          <div class="marker-entry"><input id="tlMarkerText" type="text" placeholder="例如：副歌、吉他 Solo、轉調" maxlength="60"><button class="btn blue" id="tlAddMarker" type="button">＋ 在現在時間標記</button></div>
          <div class="marker-list" id="tlMarkerList"><div class="tl-empty">尚無標記</div></div>
        </section>

        <section class="tl-card">
          <div class="tl-card-head"><strong>音高軌跡 / 單音分析</strong><span>Tony / pYIN workflow</span></div>
          <div class="actions"><button class="btn peach" id="tlAnalyzePitch" type="button">分析音高軌跡</button><button class="mini" id="tlOctDown" type="button">轉譜軌 −8度</button><button class="mini" id="tlOctUp" type="button">轉譜軌 +8度</button></div>
          <div class="tl-analysis" id="tlPitchStatus">尚未分析。適合人聲、長笛、小提琴、Bass 等單音來源。</div>
        </section>

        <section class="tl-card">
          <div class="tl-card-head"><strong>Tap Tempo</strong><span>ANNOTATION BY TAPPING</span></div>
          <div class="tap-row"><button class="tap-button" id="tlTap" type="button">TAP</button><div><small>估計 BPM</small><b id="tlTapBpm">—</b></div></div>
          <div class="actions"><button class="mini" id="tlApplyBpm" type="button" disabled>套用到編曲 BPM</button><button class="mini" id="tlResetTap" type="button">重設</button></div>
        </section>
      </div>

      <div class="tl-footer-note" id="tlStatus">先到「音檔自動轉譜」選擇 MP3 / WAV / M4A；這裡會自動載入同一份音檔。YouTube / Apple Music 因平台限制仍只作參考播放。</div>
    `;
    const main = document.querySelector('.app-shell');
    if (main && main.parentNode === wrap) main.insertAdjacentElement('afterend', lab);
    else wrap.appendChild(lab);

    const paper = $('paper');
    if (paper && !paper.querySelector('.tl-score-cursor')) {
      paper.style.position = paper.style.position || 'relative';
      const cursor = document.createElement('div');
      cursor.className = 'tl-score-cursor hidden';
      paper.appendChild(cursor);
    }
  }

  function sourceAudio() { return $('sourceAudio'); }

  async function decodeFile(file) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) throw new Error('瀏覽器不支援 Web Audio');
    const ctx = new Ctx();
    try {
      const ab = await file.arrayBuffer();
      return await ctx.decodeAudioData(ab.slice(0));
    } finally {
      try { await ctx.close(); } catch {}
    }
  }

  function downmix(buffer) {
    const out = new Float32Array(buffer.length);
    for (let c = 0; c < buffer.numberOfChannels; c++) {
      const ch = buffer.getChannelData(c);
      for (let i = 0; i < out.length; i++) out[i] += ch[i] / buffer.numberOfChannels;
    }
    return out;
  }

  function getView() {
    if (!state.duration) return { start: 0, end: 1, duration: 1 };
    const span = state.duration / state.zoom;
    const center = clamp(state.center || sourceAudio()?.currentTime || span / 2, span / 2, state.duration - span / 2);
    const start = clamp(center - span / 2, 0, Math.max(0, state.duration - span));
    return { start, end: start + span, duration: span };
  }

  function resizeCanvas(canvas, cssHeight) {
    const wrap = canvas.parentElement;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(320, Math.floor(wrap.clientWidth || 800));
    const h = cssHeight;
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, w, h, dpr };
  }

  function drawWaveform() {
    const canvas = $('tlWave');
    if (!canvas) return;
    const { ctx, w, h } = resizeCanvas(canvas, 150);
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#171a18';
    ctx.fillRect(0, 0, w, h);
    if (!state.mono || !state.buffer) {
      ctx.fillStyle = '#8b8f89';
      ctx.font = '12px system-ui';
      ctx.fillText('選擇音檔後顯示 waveform', 16, 30);
      return;
    }
    const { start, end } = getView();
    const sr = state.buffer.sampleRate;
    const startSample = Math.floor(start * sr);
    const endSample = Math.min(state.mono.length, Math.ceil(end * sr));
    const spp = Math.max(1, (endSample - startSample) / w);
    ctx.strokeStyle = '#d8ef4b';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x < w; x++) {
      const a = Math.floor(startSample + x * spp);
      const b = Math.min(endSample, Math.floor(a + spp));
      let min = 1, max = -1;
      const step = Math.max(1, Math.floor((b - a) / 28));
      for (let i = a; i < b; i += step) {
        const v = state.mono[i] || 0;
        if (v < min) min = v;
        if (v > max) max = v;
      }
      const y1 = h * (0.5 - max * 0.44);
      const y2 = h * (0.5 - min * 0.44);
      ctx.moveTo(x + 0.5, y1);
      ctx.lineTo(x + 0.5, y2);
    }
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,.15)';
    ctx.beginPath(); ctx.moveTo(0, h / 2); ctx.lineTo(w, h / 2); ctx.stroke();
    $('tlViewRange').textContent = `${fmt(start)} — ${fmt(end)}`;
    drawSelection();
    drawMarkers();
    updateHeads();
  }

  function fftMag(samples) {
    const n = samples.length;
    const re = new Float64Array(n);
    const im = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const win = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (n - 1));
      re[i] = samples[i] * win;
    }
    for (let i = 1, j = 0; i < n; i++) {
      let bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) { const tr = re[i]; re[i] = re[j]; re[j] = tr; const ti = im[i]; im[i] = im[j]; im[j] = ti; }
    }
    for (let len = 2; len <= n; len <<= 1) {
      const ang = -2 * Math.PI / len;
      for (let i = 0; i < n; i += len) {
        for (let j = 0; j < len / 2; j++) {
          const cos = Math.cos(ang * j), sin = Math.sin(ang * j);
          const uRe = re[i + j], uIm = im[i + j];
          const vRe = re[i + j + len / 2] * cos - im[i + j + len / 2] * sin;
          const vIm = re[i + j + len / 2] * sin + im[i + j + len / 2] * cos;
          re[i + j] = uRe + vRe; im[i + j] = uIm + vIm;
          re[i + j + len / 2] = uRe - vRe; im[i + j + len / 2] = uIm - vIm;
        }
      }
    }
    const mag = new Float32Array(n / 2);
    for (let i = 0; i < mag.length; i++) mag[i] = Math.sqrt(re[i] * re[i] + im[i] * im[i]);
    return mag;
  }

  async function drawSpectrogram() {
    const canvas = $('tlSpectro');
    if (!canvas) return;
    const token = ++state.spectroToken;
    const { ctx, w, h } = resizeCanvas(canvas, 190);
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#111311'; ctx.fillRect(0, 0, w, h);
    if (!state.mono || !state.buffer) {
      ctx.fillStyle = '#8b8f89'; ctx.font = '12px system-ui'; ctx.fillText('選擇音檔後顯示 spectrogram', 16, 30); return;
    }
    state.spectroBusy = true;
    const image = ctx.createImageData(w, h);
    const { start, end } = getView();
    const sr = state.buffer.sampleRate;
    const N = 512;
    const fMin = 50, fMax = Math.min(5000, sr / 2);
    const temp = new Float32Array(N);
    const columnsPerChunk = 24;
    for (let x0 = 0; x0 < w; x0 += columnsPerChunk) {
      if (token !== state.spectroToken) return;
      const xEnd = Math.min(w, x0 + columnsPerChunk);
      for (let x = x0; x < xEnd; x++) {
        const t = start + (x / Math.max(1, w - 1)) * (end - start);
        const center = Math.floor(t * sr);
        const a = center - N / 2;
        for (let i = 0; i < N; i++) temp[i] = state.mono[clamp(a + i, 0, state.mono.length - 1)] || 0;
        const mag = fftMag(temp);
        for (let y = 0; y < h; y++) {
          const frac = 1 - y / Math.max(1, h - 1);
          const freq = fMin * Math.pow(fMax / fMin, frac);
          const bin = clamp(Math.round(freq * N / sr), 1, mag.length - 1);
          const db = 20 * Math.log10(mag[bin] + 1e-7);
          const q = clamp((db + 58) / 58, 0, 1);
          const idx = (y * w + x) * 4;
          image.data[idx] = Math.round(20 + 225 * Math.pow(q, 1.8));
          image.data[idx + 1] = Math.round(24 + 185 * Math.pow(q, 1.25));
          image.data[idx + 2] = Math.round(28 + 75 * q);
          image.data[idx + 3] = 255;
        }
      }
      ctx.putImageData(image, 0, 0);
      $('tlFreqReadout').textContent = `Spectrogram ${Math.round(100 * xEnd / w)}%`;
      await new Promise(requestAnimationFrame);
    }
    state.spectroBusy = false;
    $('tlFreqReadout').textContent = `${fMin} Hz — ${Math.round(fMax / 100) / 10} kHz · log scale`;
    drawPitchOverlay();
    updateHeads();
  }

  function drawPitchOverlay() {
    const canvas = $('tlPitchOverlay');
    if (!canvas) return;
    const { ctx, w, h } = resizeCanvas(canvas, 190);
    ctx.clearRect(0, 0, w, h);
    if (!state.pitchReady || !state.pitch.length) return;
    const { start, end } = getView();
    const fMin = 50, fMax = 5000;
    ctx.strokeStyle = '#8fb6ff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    let moved = false;
    for (const p of state.pitch) {
      if (p.t < start || p.t > end || !p.hz) continue;
      const x = (p.t - start) / (end - start) * w;
      const frac = Math.log(p.hz / fMin) / Math.log(fMax / fMin);
      const y = h * (1 - clamp(frac, 0, 1));
      if (!moved) { ctx.moveTo(x, y); moved = true; } else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  function timeFromPointer(ev, wrap) {
    const rect = wrap.getBoundingClientRect();
    const x = clamp(ev.clientX - rect.left, 0, rect.width);
    const v = getView();
    return v.start + (x / Math.max(1, rect.width)) * v.duration;
  }

  function drawSelection() {
    const el = $('tlSelection');
    if (!el) return;
    if (!(state.loopB > state.loopA) || !state.duration) { el.style.display = 'none'; return; }
    const v = getView();
    const a = clamp((state.loopA - v.start) / v.duration, 0, 1);
    const b = clamp((state.loopB - v.start) / v.duration, 0, 1);
    if (state.loopB < v.start || state.loopA > v.end) { el.style.display = 'none'; return; }
    el.style.display = 'block';
    el.style.left = `${a * 100}%`;
    el.style.width = `${Math.max(0.3, (b - a) * 100)}%`;
  }

  function drawMarkers() {
    const layer = $('tlMarkerLayer');
    if (!layer) return;
    layer.replaceChildren();
    if (!state.duration) return;
    const v = getView();
    for (const m of state.markers) {
      if (m.t < v.start || m.t > v.end) continue;
      const x = (m.t - v.start) / v.duration * 100;
      const el = document.createElement('button');
      el.type = 'button'; el.className = 'tl-marker-line'; el.style.left = `${x}%`; el.title = `${fmt(m.t)} · ${m.label}`;
      el.innerHTML = `<span>${escapeHtml(m.label)}</span>`;
      el.addEventListener('click', (e) => { e.stopPropagation(); seek(m.t); });
      layer.appendChild(el);
    }
  }

  function escapeHtml(s) { return String(s).replace(/[&<>"']/g, (m) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot',"'":'&#39;'}[m])); }

  function renderMarkerList() {
    const list = $('tlMarkerList'); if (!list) return;
    list.replaceChildren();
    if (!state.markers.length) { list.innerHTML = '<div class="tl-empty">尚無標記</div>'; return; }
    state.markers.sort((a,b)=>a.t-b.t).forEach((m, i) => {
      const row = document.createElement('div'); row.className = 'tl-marker-row';
      row.innerHTML = `<button type="button" class="tl-marker-jump"><b>${fmt(m.t)}</b><span>${escapeHtml(m.label)}</span></button><button type="button" class="mini danger">×</button>`;
      row.querySelector('.tl-marker-jump').addEventListener('click', () => seek(m.t));
      row.querySelector('.danger').addEventListener('click', () => { state.markers.splice(i, 1); renderMarkerList(); drawMarkers(); });
      list.appendChild(row);
    });
  }

  function seek(t) {
    const audio = sourceAudio(); if (!audio || !state.duration) return;
    audio.currentTime = clamp(t, 0, state.duration);
    state.center = audio.currentTime;
    updateHeads(); syncScoreToTime(true);
  }

  function updateHeads() {
    const audio = sourceAudio();
    const time = audio?.currentTime || 0;
    const v = getView();
    const frac = clamp((time - v.start) / v.duration, 0, 1);
    for (const id of ['tlWaveHead','tlSpectroHead']) {
      const el = $(id); if (el) { el.style.left = `${frac * 100}%`; el.style.display = (time >= v.start && time <= v.end) ? 'block' : 'none'; }
    }
    $('tlClock').textContent = `${fmt(time)} / ${fmt(state.duration)}`;
    updateBarBeat(time);
  }

  function setLoopUI() {
    $('tlA').textContent = fmt(state.loopA);
    $('tlB').textContent = fmt(state.loopB);
    const btn = $('tlLoop');
    btn.textContent = state.loopOn ? 'LOOP ON' : 'LOOP OFF';
    btn.classList.toggle('active-loop', state.loopOn);
    drawSelection();
  }

  function updateBarBeat(time) {
    const bpm = Number($('tempo')?.value || 96);
    const meter = String($('meter')?.value || '4/4').split('/');
    const top = Number(meter[0] || 4);
    const beatSec = 60 / Math.max(1, bpm);
    const beat = Math.floor(time / beatSec);
    const bar = Math.floor(beat / top) + 1;
    const inBar = beat % top + 1;
    $('tlBarBeat').textContent = `BAR ${bar} · BEAT ${inBar}`;
  }

  function clearActiveScore() {
    state.activeEls.forEach(el => el?.classList?.remove('boss-v6-active-note'));
    state.activeEls = [];
    $('paper')?.querySelector('.tl-score-cursor')?.classList.add('hidden');
  }

  function flattenElements(input, out = []) {
    if (!input) return out;
    if (Array.isArray(input)) { input.forEach(x => flattenElements(x, out)); return out; }
    if (input.nodeType === 1) { out.push(input); return out; }
    if (input.elemset) flattenElements(input.elemset, out);
    if (input.abselem?.elemset) flattenElements(input.abselem.elemset, out);
    return out;
  }

  function cursorToElements(elements) {
    const paper = $('paper'); const cursor = paper?.querySelector('.tl-score-cursor');
    if (!paper || !cursor || !elements.length) return;
    const rects = elements.map(el => el.getBoundingClientRect?.()).filter(r => r && r.width >= 0);
    if (!rects.length) return;
    const r = rects[0]; const p = paper.getBoundingClientRect();
    cursor.classList.remove('hidden');
    cursor.style.left = `${r.left - p.left + paper.scrollLeft - 3}px`;
    cursor.style.top = `${r.top - p.top + paper.scrollTop - 5}px`;
    cursor.style.height = `${Math.max(28, r.height + 10)}px`;
  }

  function scoreEvent(ev) {
    if (!ev) { clearActiveScore(); return; }
    clearActiveScore();
    const els = flattenElements(ev.elements).filter(el => el?.classList);
    if ($('tlHighlightNotes')?.checked) {
      state.activeEls = els;
      els.forEach(el => el.classList.add('boss-v6-active-note'));
    }
    cursorToElements(els);
    if ($('tlFollowScore')?.checked && els[0]) {
      const r = els[0].getBoundingClientRect();
      if (r.top < 80 || r.bottom > window.innerHeight - 80) els[0].scrollIntoView({behavior:'smooth', block:'center'});
    }
  }

  function rebuildScoreSync() {
    if (!window.ABCJS?.TimingCallbacks || !$('abc')?.value.trim()) return;
    try {
      const visual = ABCJS.renderAbc('paper', $('abc').value, { responsive: 'resize', add_classes: true, staffwidth: 900 })?.[0];
      if (!visual) throw new Error('樂譜無法解析');
      state.timing?.stop?.();
      state.timingVisual = visual;
      state.timing = new ABCJS.TimingCallbacks(visual, {
        beatSubdivisions: 4,
        eventCallback: scoreEvent,
        lineEndAnticipation: 160,
      });
      state.lastSyncSec = -1;
      $('tlSyncState').textContent = 'SCORE SYNC READY';
      $('tlStatus').textContent = '總譜同步已建立：參考音檔播放時，正在演奏的譜面事件會同步高亮。';
    } catch (err) {
      $('tlSyncState').textContent = 'SYNC ERROR';
      $('tlStatus').textContent = '同步建立失敗：' + err.message;
    }
  }

  function syncScoreToTime(force = false) {
    if (!state.timing) return;
    const audio = sourceAudio(); if (!audio) return;
    const t = audio.currentTime || 0;
    if (!force && Math.abs(t - state.lastSyncSec) < 0.055) return;
    state.lastSyncSec = t;
    try { state.timing.setProgress(t, 'seconds'); } catch {}
  }

  function animationLoop() {
    cancelAnimationFrame(state.raf);
    const tick = () => {
      const audio = sourceAudio();
      if (audio && !audio.paused) {
        if (state.loopOn && state.loopB > state.loopA && audio.currentTime >= state.loopB - 0.025) {
          audio.currentTime = state.loopA;
        }
        if (state.zoom > 1) {
          const v = getView();
          if (audio.currentTime > v.start + v.duration * 0.82 || audio.currentTime < v.start) {
            state.center = audio.currentTime;
            drawWaveform();
            drawSpectrogram();
          }
        }
        updateHeads();
        syncScoreToTime();
      }
      state.raf = requestAnimationFrame(tick);
    };
    state.raf = requestAnimationFrame(tick);
  }

  function pitchAt(data, start, size, sr, fmin = 55, fmax = 1500) {
    let rms = 0, count = 0;
    for (let i = 0; i < size; i += 4) { const v = data[start + i] || 0; rms += v * v; count++; }
    rms = Math.sqrt(rms / Math.max(1, count));
    if (rms < 0.012) return null;
    const minLag = Math.max(2, Math.floor(sr / fmax));
    const maxLag = Math.min(size - 8, Math.ceil(sr / fmin));
    let bestLag = 0, best = 0;
    for (let lag = minLag; lag <= maxLag; lag++) {
      let sum = 0, a2 = 0, b2 = 0;
      for (let i = 0; i < size - lag; i += 4) {
        const a = data[start + i] || 0, b = data[start + i + lag] || 0;
        sum += a * b; a2 += a * a; b2 += b * b;
      }
      const corr = sum / Math.sqrt(a2 * b2 + 1e-12);
      if (corr > best) { best = corr; bestLag = lag; }
    }
    return best > 0.58 && bestLag ? sr / bestLag : null;
  }

  async function analyzePitch() {
    if (!state.buffer || !state.mono) { $('tlPitchStatus').textContent = '請先選擇音訊檔。'; return; }
    const btn = $('tlAnalyzePitch'); btn.disabled = true;
    $('tlPitchStatus').textContent = '正在分析單音音高軌跡…';
    try {
      const targetSr = 4000;
      const ratio = state.buffer.sampleRate / targetSr;
      const seconds = Math.min(90, state.duration);
      const len = Math.floor(seconds * targetSr);
      const data = new Float32Array(len);
      for (let i = 0; i < len; i++) data[i] = state.mono[Math.min(state.mono.length - 1, Math.floor(i * ratio))] || 0;
      const size = 512, hop = 320, out = [];
      const total = Math.max(1, Math.floor((data.length - size) / hop));
      for (let n = 0, s = 0; s + size < data.length; s += hop, n++) {
        const hz = pitchAt(data, s, size, targetSr);
        out.push({ t: s / targetSr, hz });
        if (n % 18 === 0) {
          $('tlPitchStatus').textContent = `正在分析音高… ${Math.round(n / total * 100)}%`;
          await new Promise(requestAnimationFrame);
        }
      }
      state.pitch = out; state.pitchReady = true; drawPitchOverlay();
      const valid = out.filter(x => x.hz);
      const midis = valid.map(x => 69 + 12 * Math.log2(x.hz / 440)).sort((a,b)=>a-b);
      const median = midis.length ? midis[Math.floor(midis.length / 2)] : null;
      $('tlPitchStatus').textContent = valid.length ? `完成：${valid.length} 個音高取樣點；中心音域約 MIDI ${Math.round(median)}。藍線可與頻譜一起比對。` : '沒有偵測到穩定單音音高，可改用較乾淨的單一樂器音訊。';
    } catch (err) { $('tlPitchStatus').textContent = '音高分析失敗：' + err.message; }
    finally { btn.disabled = false; }
  }

  function midiToABC(midi) {
    const pcs = ['C','^C','D','^D','E','F','^F','G','^G','A','^A','B'];
    midi = Math.round(midi); const pc = ((midi % 12) + 12) % 12; const octave = Math.floor(midi / 12) - 1;
    let s = pcs[pc];
    if (octave >= 5) { s = s.replace(/[A-G]/, m => m.toLowerCase()); if (octave > 5) s += "'".repeat(octave - 5); }
    else if (octave < 4) s += ','.repeat(4 - octave);
    return s;
  }

  function abcTokenToMidi(token) {
    const m = token.match(/^([\^_=]*)([A-Ga-g])([,']*)/); if (!m) return null;
    const pcs = {C:0,D:2,E:4,F:5,G:7,A:9,B:11}; const lower = m[2] === m[2].toLowerCase();
    let midi = (lower ? 72 : 60) + pcs[m[2].toUpperCase()];
    for (const c of m[3]) midi += c === "'" ? 12 : -12;
    midi += (m[1].match(/\^/g)||[]).length - (m[1].match(/_/g)||[]).length;
    return midi;
  }

  function octaveShiftTarget(delta) {
    const target = $('targetTrack')?.value;
    if (!target) { $('tlPitchStatus').textContent = '請先在「音檔自動轉譜」選擇目標軌。'; return; }
    const cards = [...document.querySelectorAll('.track')];
    const idx = [...($('targetTrack')?.options || [])].findIndex(o => o.value === target);
    const card = cards[idx]; const ta = card?.querySelector('.track-editor textarea');
    if (!ta) { $('tlPitchStatus').textContent = '找不到目標軌的手動譜面。'; return; }
    ta.value = ta.value.replace(/([\^_=]*[A-Ga-g][,']*)(?=\d|\/|\s|\]|\||$)/g, (tok) => {
      const midi = abcTokenToMidi(tok); return Number.isFinite(midi) ? midiToABC(midi + delta) : tok;
    });
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    card.querySelector('[data-act="apply"]')?.click();
    $('tlPitchStatus').textContent = `目標轉譜軌已${delta > 0 ? '升' : '降'}一個八度，可繼續手動修正。`;
    setTimeout(rebuildScoreSync, 120);
  }

  function tapTempo() {
    const now = performance.now();
    if (state.tapTimes.length && now - state.tapTimes.at(-1) > 2200) state.tapTimes = [];
    state.tapTimes.push(now); if (state.tapTimes.length > 9) state.tapTimes.shift();
    if (state.tapTimes.length >= 2) {
      const gaps = []; for (let i = 1; i < state.tapTimes.length; i++) gaps.push(state.tapTimes[i] - state.tapTimes[i-1]);
      const avg = gaps.reduce((a,b)=>a+b,0) / gaps.length;
      state.bpm = clamp(Math.round(60000 / avg), 30, 260);
      $('tlTapBpm').textContent = String(state.bpm); $('tlApplyBpm').disabled = false;
    } else $('tlTapBpm').textContent = '…';
  }

  function applyTapBpm() {
    if (!state.bpm || !$('tempo')) return;
    $('tempo').value = clamp(state.bpm, Number($('tempo').min || 45), Number($('tempo').max || 190));
    $('tempo').dispatchEvent(new Event('input', { bubbles: true }));
    $('tempo').dispatchEvent(new Event('change', { bubbles: true }));
    $('tlStatus').textContent = `Tap Tempo ${state.bpm} BPM 已套用到編曲。`;
    rebuildScoreSync();
  }

  async function loadSelectedFile(file) {
    if (!file) return;
    state.file = file; state.pitch = []; state.pitchReady = false; state.markers = []; state.loopA = 0; state.loopB = 0; state.loopOn = false;
    $('tlStatus').textContent = '正在建立 waveform / spectrogram…';
    try {
      const buffer = await decodeFile(file);
      state.buffer = buffer; state.mono = downmix(buffer); state.duration = buffer.duration; state.center = buffer.duration / 2; state.zoom = 1;
      $('tlZoom').value = '1'; $('tlZoomLabel').textContent = '1×';
      setLoopUI(); renderMarkerList(); drawWaveform(); await drawSpectrogram(); rebuildScoreSync();
      $('tlSyncState').textContent = 'AUDIO READY';
      $('tlStatus').textContent = `${file.name} · ${fmt(buffer.duration)} · ${buffer.sampleRate} Hz。拖曳波形可建立 A/B Loop，點波形可跳播。`;
    } catch (err) { $('tlStatus').textContent = '音訊視覺化失敗：' + err.message; }
  }

  function bind() {
    const audio = sourceAudio(); const fileInput = $('audioFile');
    fileInput?.addEventListener('change', () => loadSelectedFile(fileInput.files?.[0] || null));
    if (fileInput?.files?.[0]) loadSelectedFile(fileInput.files[0]);

    $('tlPlay').addEventListener('click', async () => {
      if (!audio || !audio.src) { $('tlStatus').textContent = '請先在「音檔自動轉譜」選擇音訊檔。'; return; }
      if (audio.paused) { try { await audio.play(); } catch (err) { $('tlStatus').textContent = '播放被瀏覽器阻擋：' + err.message; } }
      else audio.pause();
    });
    audio?.addEventListener('play', () => { $('tlPlay').textContent = 'Ⅱ 暫停參考音檔'; $('tlSyncState').textContent = 'PLAY + SCORE FOLLOW'; syncScoreToTime(true); });
    audio?.addEventListener('pause', () => { $('tlPlay').textContent = '▶ 播放參考音檔'; $('tlSyncState').textContent = 'PAUSED'; syncScoreToTime(true); });
    audio?.addEventListener('ended', () => { $('tlPlay').textContent = '▶ 播放參考音檔'; $('tlSyncState').textContent = 'ENDED'; clearActiveScore(); });
    audio?.addEventListener('seeked', () => { state.center = audio.currentTime; updateHeads(); syncScoreToTime(true); });
    audio?.addEventListener('timeupdate', updateHeads);

    $('tlBack5').addEventListener('click', () => seek((audio?.currentTime || 0) - 5));
    $('tlForward5').addEventListener('click', () => seek((audio?.currentTime || 0) + 5));
    $('tlSpeed').addEventListener('input', (e) => { const v = Number(e.target.value); $('tlSpeedLabel').textContent = `${v.toFixed(2)}×`; if (audio) audio.playbackRate = v; });
    $('tlPreservePitch').addEventListener('change', (e) => { if (!audio) return; audio.preservesPitch = e.target.checked; if ('webkitPreservesPitch' in audio) audio.webkitPreservesPitch = e.target.checked; });
    $('tlZoom').addEventListener('input', (e) => { state.zoom = Number(e.target.value); $('tlZoomLabel').textContent = `${state.zoom}×`; state.center = audio?.currentTime || state.duration / 2; drawWaveform(); clearTimeout(window.__bossV6SpectroDebounce); window.__bossV6SpectroDebounce = setTimeout(drawSpectrogram, 160); });

    $('tlSetA').addEventListener('click', () => { state.loopA = audio?.currentTime || 0; if (state.loopB <= state.loopA) state.loopB = Math.min(state.duration, state.loopA + 4); setLoopUI(); });
    $('tlSetB').addEventListener('click', () => { state.loopB = audio?.currentTime || 0; if (state.loopB <= state.loopA) state.loopA = Math.max(0, state.loopB - 4); setLoopUI(); });
    $('tlLoop').addEventListener('click', () => { if (!(state.loopB > state.loopA)) { const t = audio?.currentTime || 0; state.loopA = Math.max(0, t - 2); state.loopB = Math.min(state.duration, t + 2); } state.loopOn = !state.loopOn; setLoopUI(); });
    $('tlClearLoop').addEventListener('click', () => { state.loopA = 0; state.loopB = 0; state.loopOn = false; setLoopUI(); });

    const waveWrap = $('tlWaveWrap');
    waveWrap.addEventListener('pointerdown', (e) => { if (!state.duration) return; state.dragging = true; state.dragStart = timeFromPointer(e, waveWrap); waveWrap.setPointerCapture?.(e.pointerId); });
    waveWrap.addEventListener('pointerup', (e) => { if (!state.dragging) return; state.dragging = false; const end = timeFromPointer(e, waveWrap); if (Math.abs(end - state.dragStart) < Math.max(.08, getView().duration * .004)) seek(end); else { state.loopA = Math.min(state.dragStart, end); state.loopB = Math.max(state.dragStart, end); state.loopOn = true; setLoopUI(); seek(state.loopA); } });

    $('tlAddMarker').addEventListener('click', () => { if (!state.duration) return; const label = $('tlMarkerText').value.trim() || `Marker ${state.markers.length + 1}`; state.markers.push({ t: audio?.currentTime || 0, label }); $('tlMarkerText').value = ''; renderMarkerList(); drawMarkers(); });
    $('tlMarkerText').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $('tlAddMarker').click(); } });

    $('tlAnalyzePitch').addEventListener('click', analyzePitch); $('tlOctDown').addEventListener('click', () => octaveShiftTarget(-12)); $('tlOctUp').addEventListener('click', () => octaveShiftTarget(12));
    $('tlTap').addEventListener('click', tapTempo); $('tlApplyBpm').addEventListener('click', applyTapBpm); $('tlResetTap').addEventListener('click', () => { state.tapTimes = []; state.bpm = null; $('tlTapBpm').textContent = '—'; $('tlApplyBpm').disabled = true; });
    $('tlRebuildSync').addEventListener('click', rebuildScoreSync);
    $('refreshPlayback')?.addEventListener('click', () => setTimeout(rebuildScoreSync, 160));
    $('renderRawABC')?.addEventListener('click', () => setTimeout(rebuildScoreSync, 160));
    $('restoreStructured')?.addEventListener('click', () => setTimeout(rebuildScoreSync, 160));

    const spectro = $('tlSpectroWrap');
    spectro.addEventListener('pointermove', (e) => {
      if (!state.duration) return;
      const rect = spectro.getBoundingClientRect(); const y = clamp(e.clientY - rect.top, 0, rect.height); const x = clamp(e.clientX - rect.left, 0, rect.width);
      const frac = 1 - y / Math.max(1, rect.height); const hz = 50 * Math.pow(5000 / 50, frac); const v = getView(); const t = v.start + x / Math.max(1, rect.width) * v.duration;
      $('tlFreqReadout').textContent = `${fmt(t)} · ${hz >= 1000 ? (hz/1000).toFixed(2)+' kHz' : Math.round(hz)+' Hz'}`;
    });
    spectro.addEventListener('pointerleave', () => { if (!state.spectroBusy) $('tlFreqReadout').textContent = '50 Hz — 5 kHz · log scale'; });
    spectro.addEventListener('click', (e) => seek(timeFromPointer(e, spectro)));

    window.addEventListener('resize', () => { clearTimeout(window.__bossV6Resize); window.__bossV6Resize = setTimeout(() => { drawWaveform(); drawSpectrogram(); }, 180); });
    animationLoop();
  }

  addStyleLink();
  buildUI();
  bind();
})();
