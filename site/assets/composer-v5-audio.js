(() => {
  if (!window.ABCJS?.synth?.SynthController) return;

  const isiOSLike = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const NativeSynthController = ABCJS.synth.SynthController;
  let mediaPlayer = null;
  let mediaUrl = null;
  let renderedFingerprint = '';
  let renderBusy = false;

  const stateEl = () => document.getElementById('audioState');
  function setState(message, tone = 'idle') {
    const el = stateEl();
    if (!el) return;
    el.textContent = message;
    el.dataset.tone = tone;
  }

  function hashText(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return String(h >>> 0);
  }

  function keySignature(key) {
    const k = String(key || 'C').trim();
    const map = {
      C: {}, Am: {},
      G: { F: 1 }, Em: { F: 1 },
      D: { F: 1, C: 1 },
      F: { B: -1 }, Dm: { B: -1 }
    };
    return map[k] || {};
  }

  function abcNoteToMidi(token, keySig = {}) {
    const m = String(token).match(/^([\^_=]*)([A-Ga-g])([,']*)/);
    if (!m) return null;
    const [, accidental, letterRaw, octaves] = m;
    const letter = letterRaw.toUpperCase();
    const pcs = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
    let midi = (letterRaw === letterRaw.toLowerCase() ? 72 : 60) + pcs[letter];
    for (const c of octaves) midi += c === "'" ? 12 : -12;
    if (accidental) {
      if (!accidental.includes('=')) {
        midi += (accidental.match(/\^/g) || []).length;
        midi -= (accidental.match(/_/g) || []).length;
      }
    } else if (keySig[letter]) {
      midi += keySig[letter];
    }
    return midi;
  }

  function durationUnits(suffix) {
    if (!suffix) return 1;
    const s = suffix.replace(/-/g, '');
    if (/^\d+$/.test(s)) return Math.max(0.125, Number(s));
    if (s === '/') return 0.5;
    const half = s.match(/^\/(\d+)$/);
    if (half) return 1 / Number(half[1]);
    const frac = s.match(/^(\d+)\/(\d+)$/);
    if (frac) return Number(frac[1]) / Number(frac[2]);
    return 1;
  }

  function tokenizeBody(body) {
    return String(body || '')
      .replace(/%.*$/gm, '')
      .replace(/\s+/g, ' ')
      .trim()
      .match(/\[[^\]]+\](?:\d+(?:\/\d+)?|\/\d+|\/)?|[\^_=]*[A-Ga-gzZ][,']*(?:\d+(?:\/\d+)?|\/\d+|\/)?|\|+|\S+/g) || [];
  }

  function parseABC(abc) {
    const bpm = Number((abc.match(/^Q:.*?=(\d+(?:\.\d+)?)/m) || [])[1] || 96);
    const key = ((abc.match(/^K:([^\s]+)/m) || [])[1] || 'C').trim();
    const sig = keySignature(key);
    const unitSec = 30 / bpm;
    const lines = String(abc || '').split(/\r?\n/);
    const defs = new Map();
    for (const line of lines) {
      const md = line.match(/^V:([^\s]+).*?clef=([^\s]+)/);
      if (md) defs.set(md[1], { id: md[1], clef: md[2], program: 0, volume: 100, body: [] });
    }

    const voices = [];
    let current = null;
    for (const raw of lines) {
      const line = raw.trim();
      const vm = line.match(/^\[V:([^\]]+)\]/);
      if (vm) {
        const base = defs.get(vm[1]) || { id: vm[1], clef: 'treble', program: 0, volume: 100, body: [] };
        current = { ...base, body: [] };
        voices.push(current);
        continue;
      }
      if (!current) continue;
      const pm = line.match(/^%%MIDI\s+program\s+(\d+)/i);
      if (pm) { current.program = Number(pm[1]); continue; }
      const cv = line.match(/^%%MIDI\s+control\s+7\s+(\d+)/i);
      if (cv) { current.volume = Number(cv[1]); continue; }
      if (!line || /^[A-Z]:/.test(line) || /^%%/.test(line)) continue;
      current.body.push(line);
    }

    if (!voices.length) {
      const afterKey = abc.split(/^K:.*$/m)[1] || '';
      voices.push({ id: 'V1', clef: 'treble', program: 0, volume: 100, body: [afterKey] });
    }

    const events = [];
    let total = 0;
    for (const voice of voices) {
      let cursor = 0;
      for (const token of tokenizeBody(voice.body.join(' '))) {
        if (/^\|+$/.test(token) || /^\[V:/.test(token)) continue;
        if (/^[zZ]/.test(token)) {
          const dm = token.match(/^[zZ](.*)$/);
          cursor += durationUnits(dm?.[1] || '') * unitSec;
          continue;
        }
        if (token.startsWith('[')) {
          const cm = token.match(/^\[([^\]]+)\](.*)$/);
          if (!cm) continue;
          const noteTokens = cm[1].match(/[\^_=]*[A-Ga-g][,']*/g) || [];
          const notes = noteTokens.map(n => abcNoteToMidi(n, sig)).filter(Number.isFinite);
          const dur = durationUnits(cm[2] || '') * unitSec;
          if (notes.length) events.push({ start: cursor, dur, notes, program: voice.program, volume: voice.volume });
          cursor += dur;
          total = Math.max(total, cursor);
          continue;
        }
        const nm = token.match(/^([\^_=]*[A-Ga-g][,']*)(.*)$/);
        if (nm) {
          const midi = abcNoteToMidi(nm[1], sig);
          const dur = durationUnits(nm[2] || '') * unitSec;
          if (Number.isFinite(midi)) events.push({ start: cursor, dur, notes: [midi], program: voice.program, volume: voice.volume });
          cursor += dur;
          total = Math.max(total, cursor);
        }
      }
    }
    return { events, total: Math.min(total, 90), bpm, voices: voices.length };
  }

  function timbre(program, phase) {
    const p = Number(program) || 0;
    if (p >= 32 && p <= 39) return Math.sin(phase) + 0.18 * Math.sin(phase * 2);
    if (p >= 40 && p <= 55) return 0.72 * Math.sin(phase) + 0.22 * Math.sin(phase * 2) + 0.08 * Math.sin(phase * 3);
    if (p >= 56 && p <= 71) return 0.62 * Math.sin(phase) + 0.28 * Math.sin(phase * 2) + 0.12 * Math.sin(phase * 3);
    if (p >= 72 && p <= 79) return 0.88 * Math.sin(phase) + 0.10 * Math.sin(phase * 2);
    if (p >= 88 && p <= 103) return 0.82 * Math.sin(phase) + 0.15 * Math.sin(phase * 2);
    if (p >= 24 && p <= 31) return 0.78 * Math.sin(phase) + 0.20 * Math.sin(phase * 2);
    return 0.82 * Math.sin(phase) + 0.15 * Math.sin(phase * 2) + 0.05 * Math.sin(phase * 3);
  }

  function renderWav(abc, testTone = false) {
    const sampleRate = 22050;
    const parsed = testTone
      ? { events: [{ start: 0, dur: 0.55, notes: [76], program: 0, volume: 127 }], total: 0.7, bpm: 96, voices: 1 }
      : parseABC(abc);
    if (!parsed.events.length) throw new Error('目前總譜沒有可播放音符');
    const duration = Math.max(0.8, Math.min(parsed.total + 0.25, 90));
    const totalSamples = Math.ceil(duration * sampleRate);
    const mix = new Float32Array(totalSamples);
    const voiceScale = 0.24 / Math.sqrt(Math.max(1, parsed.voices));

    for (const ev of parsed.events) {
      if (ev.start >= duration) continue;
      const start = Math.max(0, Math.floor(ev.start * sampleRate));
      const len = Math.min(totalSamples - start, Math.max(1, Math.floor(ev.dur * sampleRate)));
      const chordScale = 1 / Math.sqrt(Math.max(1, ev.notes.length));
      const baseAmp = voiceScale * chordScale * Math.max(0, Math.min(1, ev.volume / 127));
      const attack = Math.max(1, Math.floor(Math.min(0.012, ev.dur * 0.15) * sampleRate));
      const release = Math.max(1, Math.floor(Math.min(0.08, ev.dur * 0.32) * sampleRate));
      const decayLike = ev.program <= 31 || (ev.program >= 8 && ev.program <= 15);
      for (const midi of ev.notes) {
        const freq = 440 * Math.pow(2, (midi - 69) / 12);
        const inc = 2 * Math.PI * freq / sampleRate;
        let phase = 0;
        for (let i = 0; i < len; i++) {
          let env = 1;
          if (i < attack) env *= i / attack;
          if (i > len - release) env *= Math.max(0, (len - i) / release);
          if (decayLike) env *= Math.exp(-2.2 * i / Math.max(1, len));
          mix[start + i] += timbre(ev.program, phase) * baseAmp * env;
          phase += inc;
        }
      }
    }

    let peak = 0;
    for (let i = 0; i < mix.length; i++) peak = Math.max(peak, Math.abs(mix[i]));
    const norm = peak > 0.92 ? 0.92 / peak : 1;
    const buffer = new ArrayBuffer(44 + mix.length * 2);
    const view = new DataView(buffer);
    const write = (offset, str) => { for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i)); };
    write(0, 'RIFF'); view.setUint32(4, 36 + mix.length * 2, true); write(8, 'WAVE');
    write(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
    write(36, 'data'); view.setUint32(40, mix.length * 2, true);
    let o = 44;
    for (let i = 0; i < mix.length; i++, o += 2) {
      const s = Math.max(-1, Math.min(1, mix[i] * norm));
      view.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    }
    return { blob: new Blob([buffer], { type: 'audio/wav' }), duration, parsed };
  }

  function ensureMediaPlayer() {
    if (mediaPlayer) return mediaPlayer;
    const gate = document.getElementById('audioGate');
    if (!gate) return null;
    const wrap = document.createElement('div');
    wrap.id = 'bossMobileMediaWrap';
    wrap.style.cssText = 'grid-column:1/-1;width:100%;display:grid;gap:8px;margin-top:4px';
    mediaPlayer = document.createElement('audio');
    mediaPlayer.id = 'bossMobileMedia';
    mediaPlayer.controls = true;
    mediaPlayer.preload = 'auto';
    mediaPlayer.setAttribute('playsinline', '');
    mediaPlayer.style.cssText = 'width:100%;height:44px';
    wrap.appendChild(mediaPlayer);
    gate.appendChild(wrap);
    mediaPlayer.addEventListener('play', () => setState('正在用 iPhone 原生媒體播放器播放總譜。', 'ok'));
    mediaPlayer.addEventListener('pause', () => { if (!mediaPlayer.ended) setState('已暫停手機相容播放。', 'idle'); });
    mediaPlayer.addEventListener('ended', () => setState('播放完成。', 'ok'));
    mediaPlayer.addEventListener('error', () => setState('iPhone 媒體播放器無法讀取合成音訊，請重新產生一次。', 'error'));
    return mediaPlayer;
  }

  function currentABC() {
    return document.getElementById('abc')?.value || '';
  }

  function setMediaBlob(blob, fingerprint) {
    const player = ensureMediaPlayer();
    if (!player) throw new Error('找不到手機播放器');
    if (mediaUrl) URL.revokeObjectURL(mediaUrl);
    mediaUrl = URL.createObjectURL(blob);
    player.src = mediaUrl;
    player.load();
    renderedFingerprint = fingerprint;
    return player;
  }

  function playIOSScore(forceRender = false) {
    const abc = currentABC();
    if (!abc.trim()) { setState('總譜尚未建立，請稍後再按一次。', 'warn'); return; }
    const fp = hashText(abc);
    const player = ensureMediaPlayer();
    if (!player) return;
    try {
      if (forceRender || fp !== renderedFingerprint || !player.src) {
        if (renderBusy) return;
        renderBusy = true;
        setState('正在把總譜轉成 iPhone 可直接播放的 WAV…', 'warn');
        const out = renderWav(abc);
        setMediaBlob(out.blob, fp);
        renderBusy = false;
      }
      player.play().then(() => {
        const boot = document.getElementById('audioBoot');
        if (boot) boot.textContent = 'Ⅱ 暫停手機播放';
      }).catch(err => {
        setState('Safari 阻擋播放：' + err.message + '。請再點一次「手機相容播放」。', 'error');
      });
    } catch (err) {
      renderBusy = false;
      setState('手機合成播放失敗：' + err.message, 'error');
    }
  }

  function toggleIOSScore() {
    const player = ensureMediaPlayer();
    if (player && !player.paused && !player.ended) {
      player.pause();
      const boot = document.getElementById('audioBoot');
      if (boot) boot.textContent = '▶ 手機相容播放';
      return;
    }
    playIOSScore(false);
  }

  function playTestTone() {
    try {
      const out = renderWav('', true);
      const test = new Audio();
      test.setAttribute('playsinline', '');
      const url = URL.createObjectURL(out.blob);
      test.src = url;
      test.volume = 1;
      test.play().then(() => setState('測試音已送到 iPhone 原生媒體輸出；如果聽到短音，手機聲音本身正常。', 'ok'))
        .catch(err => setState('測試音被 Safari 阻擋：' + err.message, 'error'));
      test.addEventListener('ended', () => URL.revokeObjectURL(url), { once: true });
    } catch (err) {
      setState('測試音建立失敗：' + err.message, 'error');
    }
  }

  if (!isiOSLike) {
    ABCJS.synth.SynthController = NativeSynthController;
    return;
  }

  document.documentElement.classList.add('boss-ios-media-fallback');
  try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch {}
  const nativeDock = document.getElementById('audio');
  if (nativeDock) nativeDock.style.display = 'none';
  const boot = document.getElementById('audioBoot');
  if (boot) boot.textContent = '▶ 手機相容播放';
  ensureMediaPlayer();

  const gate = document.getElementById('audioGate');
  if (gate && !document.getElementById('audioTestTone')) {
    const testBtn = document.createElement('button');
    testBtn.id = 'audioTestTone';
    testBtn.type = 'button';
    testBtn.className = 'btn';
    testBtn.textContent = '🔊 測試手機喇叭';
    testBtn.style.cssText = 'grid-column:1/-1;justify-self:start';
    gate.appendChild(testBtn);
    testBtn.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); playTestTone(); });
  }

  boot?.addEventListener('click', e => {
    e.preventDefault();
    e.stopImmediatePropagation();
    toggleIOSScore();
  }, { capture: true });

  document.getElementById('audio')?.addEventListener('click', e => {
    const play = e.target.closest?.('.abcjs-midi-start');
    if (!play) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    toggleIOSScore();
  }, { capture: true });

  const invalidate = () => { renderedFingerprint = ''; };
  document.addEventListener('input', e => {
    if (e.target.closest?.('#abc, #trackRack, .settings-grid')) invalidate();
  }, true);
  document.addEventListener('change', e => {
    if (e.target.closest?.('#abc, #trackRack, .settings-grid')) invalidate();
  }, true);
  document.addEventListener('click', e => {
    if (e.target.closest?.('[data-example], [data-preset], #generate, #variation, #refreshPlayback, [data-act="apply"]')) {
      invalidate();
      mediaPlayer?.pause();
    }
  }, true);

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) mediaPlayer?.pause();
  });

  setState('iPhone 已切換為原生媒體相容模式；即使 Web Audio 被靜音，總譜仍會改用 WAV 播放。', 'ok');
})();