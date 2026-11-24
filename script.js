/* Nimra Birthday Experience — plain HTML / CSS / JS
   - Canvas engine: stars + fireworks (trails, smoke, twinkles)
   - 6 scenes (0..5)
   - Soundtrack: ./moonlight.mp3 (starts on the first tap, loops forever)
     If the file is missing, a soft piano score plays so the sky is never silent.
   - Scene 3 candle: mic blow detection + tap fallback → fireworks
   - Scene 5: real movie credits roll (bottom → past the top edge)
     → three quiet lines → only sky, fireworks and music → tiny Replay
*/
(() => {
  'use strict';

  // guard: never boot twice (module + file:// fallback can both load this file)
  if (window.__nimraBooted) return;
  window.__nimraBooted = true;

  // --------------------------
  // Helpers
  // --------------------------
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const now = () => performance.now();

  const timers = [];
  function later(fn, ms) {
    const id = setTimeout(fn, ms);
    timers.push(id);
    return id;
  }
  function clearLater() {
    while (timers.length) clearTimeout(timers.pop());
  }

  const reducedMotion =
    window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // --------------------------
  // Scene navigation
  // --------------------------
  const scenes = $$('.scene');
  let sceneIndex = 0;

  function setScene(i) {
    sceneIndex = clamp(i, 0, scenes.length - 1);
    scenes.forEach((s) => s.classList.remove('active'));
    const active = scenes.find((s) => Number(s.dataset.scene) === sceneIndex);
    if (active) active.classList.add('active');

    // Fireworks intensity per scene
    if (sceneIndex === 0) fx.setIntensity(0.05);
    if (sceneIndex === 1) fx.setIntensity(0.9);
    if (sceneIndex === 2) fx.setIntensity(0.4);
    if (sceneIndex === 3) fx.setIntensity(0.35);
    if (sceneIndex === 4) fx.setIntensity(0.3);
    if (sceneIndex === 5) fx.setIntensity(0.55);

    // Scene hooks
    if (sceneIndex === 1) startMemoriesSequence();
    if (sceneIndex === 2) startSaturnSequence();
    if (sceneIndex === 3) enterCandleScene();
    if (sceneIndex === 5) restartCreditsRoll();
  }

  function go(i) {
    clearLater();
    setScene(i);
  }

  // --------------------------
  // Sound — ./moonlight.mp3, with a piano fallback
  // --------------------------
  const bgm = $('#bgm');
  const soundBtn = $('#soundBtn');
  const soundName = $('#soundName');
  const TRACK_LABEL = 'Salvatore'; // shown on the switch (the file stays moonlight.mp3)

  let audioStarted = false;
  let muted = false;
  let score = null; // generative piano

  function trackReady() {
    return new Promise((resolve) => {
      if (!bgm) return resolve(false);
      if (bgm.readyState >= 2) return resolve(true);
      if (bgm.error) return resolve(false);
      let done = false;
      const finish = (v) => {
        if (done) return;
        done = true;
        bgm.removeEventListener('loadeddata', onOk);
        bgm.removeEventListener('canplay', onOk);
        bgm.removeEventListener('error', onErr);
        resolve(v);
      };
      const onOk = () => finish(true);
      const onErr = () => finish(false);
      bgm.addEventListener('loadeddata', onOk);
      bgm.addEventListener('canplay', onOk);
      bgm.addEventListener('error', onErr);
      setTimeout(() => finish(bgm.readyState >= 2), 1500);
    });
  }

  async function startMusic() {
    if (audioStarted) return;
    audioStarted = true;
    soundName.textContent = muted ? 'Muted' : TRACK_LABEL;

    const ok = await trackReady();
    if (ok) {
      try {
        bgm.loop = true;
        bgm.volume = muted ? 0 : 0.32;
        await bgm.play();
        return;
      } catch {
        /* fall through to the piano */
      }
    }
    score = createPianoScore();
    if (score) score.start(muted);
  }

  soundBtn.addEventListener('click', () => {
    muted = !muted;
    soundBtn.classList.toggle('muted', muted);
    soundBtn.setAttribute('aria-pressed', String(muted));
    soundBtn.setAttribute('aria-label', muted ? 'Unmute the soundtrack' : 'Mute the soundtrack');
    soundName.textContent = muted ? 'Muted' : TRACK_LABEL;
    if (bgm) {
      bgm.volume = muted ? 0 : 0.32;
      bgm.muted = muted;
    }
    if (score) score.setMuted(muted);
  });

  /* A small generative piano (Am7 · Fmaj7 · Cmaj7 · G6) used only when
     moonlight.mp3 is not next to the page. */
  function createPianoScore() {
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return null;

    const PROGRESSION = [
      { pad: 45, notes: [69, 72, 76, 79, 76, 72] },
      { pad: 41, notes: [65, 69, 72, 76, 72, 69] },
      { pad: 48, notes: [72, 76, 79, 83, 79, 76] },
      { pad: 43, notes: [67, 71, 74, 76, 74, 71] },
    ];
    const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);

    let ctx = null;
    let master = null;
    let dest = null;
    let step = 0;
    let nextTime = 0;
    let timer = null;

    function bell(n, t, vel) {
      const f = midi(n);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vel * 0.5), t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 2.6);
      const o1 = ctx.createOscillator();
      o1.type = 'sine';
      o1.frequency.value = f;
      const o2 = ctx.createOscillator();
      o2.type = 'triangle';
      o2.frequency.value = f * 2.002;
      const g2 = ctx.createGain();
      g2.gain.value = 0.16;
      o1.connect(g);
      o2.connect(g2);
      g2.connect(g);
      g.connect(dest);
      o1.start(t);
      o2.start(t);
      o1.stop(t + 2.8);
      o2.stop(t + 2.8);
    }

    function pad(n, t, dur) {
      const f = midi(n);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.14, t + 1.4);
      g.gain.linearRampToValueAtTime(0.0001, t + dur + 0.6);
      const o1 = ctx.createOscillator();
      o1.type = 'sine';
      o1.frequency.value = f;
      const o2 = ctx.createOscillator();
      o2.type = 'sine';
      o2.frequency.value = f * 1.005;
      o1.connect(g);
      o2.connect(g);
      g.connect(dest);
      o1.start(t);
      o2.start(t);
      o1.stop(t + dur + 0.8);
      o2.stop(t + dur + 0.8);
    }

    function schedule() {
      if (!ctx) return;
      const SPB = 0.72;
      while (nextTime < ctx.currentTime + 0.6) {
        const chord = PROGRESSION[Math.floor(step / 6) % PROGRESSION.length];
        const idx = step % 6;
        if (idx === 0) pad(chord.pad, nextTime, SPB * 6);
        const note = chord.notes[idx];
        const vel = idx === 0 ? 0.5 : 0.3 + Math.random() * 0.12;
        bell(note, nextTime, vel);
        if (Math.random() < 0.28) bell(note + 12, nextTime + SPB * 0.5, vel * 0.42);
        nextTime += SPB;
        step += 1;
      }
      timer = setTimeout(schedule, 220);
    }

    return {
      start(isMuted) {
        if (ctx) return;
        ctx = new Ctor();
        if (ctx.resume) ctx.resume().catch(() => {});
        master = ctx.createGain();
        master.gain.value = isMuted ? 0.0001 : 0.22;
        const tone = ctx.createBiquadFilter();
        tone.type = 'lowpass';
        tone.frequency.value = 2400;
        tone.Q.value = 0.4;
        const wet = ctx.createGain();
        wet.gain.value = 0.34;
        const d1 = ctx.createDelay(1.2);
        d1.delayTime.value = 0.36;
        const d2 = ctx.createDelay(1.2);
        d2.delayTime.value = 0.54;
        const fb = ctx.createGain();
        fb.gain.value = 0.34;
        tone.connect(master);
        tone.connect(wet);
        wet.connect(d1);
        wet.connect(d2);
        d1.connect(fb);
        d2.connect(fb);
        fb.connect(d1);
        d1.connect(master);
        d2.connect(master);
        master.connect(ctx.destination);
        dest = tone;
        step = 0;
        nextTime = ctx.currentTime + 0.15;
        schedule();
      },
      setMuted(m) {
        if (!ctx || !master) return;
        const t = ctx.currentTime;
        master.gain.cancelScheduledValues(t);
        master.gain.setTargetAtTime(m ? 0.0001 : 0.22, t, 0.25);
      },
      stop() {
        if (timer) clearTimeout(timer);
        timer = null;
        if (ctx) ctx.close().catch(() => {});
        ctx = null;
      },
    };
  }

  // --------------------------
  // Scene 1 — memories stagger
  // --------------------------
  function startMemoriesSequence() {
    const items = $$('.memory');
    items.forEach((m) => m.classList.remove('show'));
    const baseDelay = 280;
    items.forEach((el, idx) => {
      later(() => el.classList.add('show'), baseDelay + idx * 850);
    });
  }

  // --------------------------
  // Scene 2 — saturn quotes stagger
  // --------------------------
  function startSaturnSequence() {
    const cards = $$('.quote-card');
    cards.forEach((c) => c.classList.remove('show'));
    const baseDelay = 300;
    cards.forEach((el, idx) => {
      later(() => el.classList.add('show'), baseDelay + idx * 800);
    });
  }

  // --------------------------
  // Scene 3 — candle blow-out logic
  // --------------------------
  const continueBtn = $('#continueBtn');
  const flameEl = $('#flame');
  const candleEl = $('#candle');
  let candleOut = false;

  function setCandleOut(out) {
    candleOut = out;
    if (candleOut) {
      flameEl.classList.add('off');
      continueBtn.disabled = false;
    } else {
      flameEl.classList.remove('off');
      continueBtn.disabled = true;
    }
  }

  // Mic detection
  let micRequested = false;
  let audioCtx = null;
  let analyser = null;
  let micStream = null;
  let micSource = null;
  let micBuf = null;
  let blowScore = 0;
  let lastMicFrame = 0;

  async function requestMicOnce() {
    if (micRequested || candleOut) return;
    micRequested = true;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return;
    try {
      micStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      const Ctor = window.AudioContext || window.webkitAudioContext;
      if (!Ctor) return;
      audioCtx = new Ctor();
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.8;
      micSource = audioCtx.createMediaStreamSource(micStream);
      micSource.connect(analyser);
      micBuf = new Uint8Array(analyser.fftSize);
      lastMicFrame = now();
      blowScore = 0;
    } catch {
      analyser = null;
      audioCtx = null;
      micStream = null;
      micSource = null;
    }
  }

  function stopMic() {
    try {
      if (micStream) micStream.getTracks().forEach((t) => t.stop());
    } catch {}
    micStream = null;
    try { micSource && micSource.disconnect(); } catch {}
    micSource = null;
    try { analyser && analyser.disconnect(); } catch {}
    analyser = null;
    try { audioCtx && audioCtx.close(); } catch {}
    audioCtx = null;
    micBuf = null;
  }

  function sampleMicAndDetectBlow(t) {
    if (!analyser || candleOut) return;
    const dt = Math.min((t - lastMicFrame) / 1000, 0.1);
    lastMicFrame = t;
    if (!micBuf || micBuf.length !== analyser.fftSize) micBuf = new Uint8Array(analyser.fftSize);
    analyser.getByteTimeDomainData(micBuf);
    let sum = 0;
    for (let i = 0; i < micBuf.length; i++) {
      const v = (micBuf[i] - 128) / 128;
      sum += v * v;
    }
    const rms = Math.sqrt(sum / micBuf.length);
    const threshold = 0.06;
    const strong = 0.12;
    const x = clamp((rms - threshold) / (strong - threshold), 0, 1);
    const rise = 3.0;
    const decay = 1.8;
    blowScore += (x > 0 ? rise * x : -decay) * dt;
    blowScore = clamp(blowScore, 0, 1.2);
    if (blowScore >= 1.0) extinguishCandle('mic');
  }

  function extinguishCandle() {
    if (candleOut) return;
    setCandleOut(true);
    stopMic();
    fx.puffAtCenter();
    fx.celebrationBurst();
    fx.setIntensity(0.95);
    later(() => {
      if (sceneIndex === 3) fx.setIntensity(0.35);
    }, 3200);
  }

  function enterCandleScene() {
    setCandleOut(candleOut);
    requestMicOnce();
  }

  candleEl.addEventListener('click', () => extinguishCandle(), { passive: true });
  candleEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      extinguishCandle();
    }
  });

  // --------------------------
  // Scene 4 — envelope
  // --------------------------
  const envelopeBtn = $('#envelope');
  envelopeBtn.addEventListener('click', (e) => {
    if (envelopeBtn.classList.contains('open')) {
      const insideLetter = e.target && e.target.closest && e.target.closest('.letter');
      if (insideLetter) return;
    }
    envelopeBtn.classList.add('open');
  });

  // --------------------------
  // Scene 5 — credits roll + eternal sky finale
  // --------------------------
  const creditsRoll = $('#creditsRoll');
  const creditsWrapper = $('#creditsWrapper');
  const finaleLines = $$('#skyFinale .finale-line');
  const grandFinale = $('#grandFinale');
  const lyricsStage = $('#lyricsStage');
  const lyricPrev = $('#lyricPrev');
  const lyricNow = $('#lyricNow');
  const lyricNext = $('#lyricNext');
  const lyricsBar = $('#lyricsBar');
  const lyricsTrack = $('#lyricsTrack');
  const lyricsToggle = $('#lyricsToggle');
  const skyControls = $('#skyControls');
  const replayBtn = $('#replayBtn');

  /* Roll speed in pixels per second.
     Cinema credits sit around 80–100; this is deliberately a touch slower
     so every line can be read without rushing. Raise it to go faster. */
  const CREDIT_SPEED = 66;

  let finaleStarted = false;
  let rollSeconds = 100;

  function restartCreditsRoll() {
    finaleStarted = false;
    creditsWrapper.classList.remove('done');
    finaleLines.forEach((l) => l.classList.remove('show'));
    closeSky();

    creditsRoll.classList.remove('roll');
    void creditsRoll.offsetHeight; // restart the animation from the very beginning

    if (reducedMotion) {
      openLyricsStage();
      return;
    }

    const distance = creditsRoll.scrollHeight; // padding-top 100vh + every card
    rollSeconds = clamp(distance / CREDIT_SPEED, 80, 150);
    creditsRoll.style.setProperty('--roll-dur', rollSeconds.toFixed(1) + 's');
    creditsRoll.classList.add('roll');

    // safety net: the sky always comes back, even if the event is missed
    later(startFinale, rollSeconds * 1000 + 1200);
  }

  function startFinale() {
    if (finaleStarted) return;
    finaleStarted = true;
    creditsWrapper.classList.add('done');

    // 1 — three quiet lines
    let t = 1600;
    finaleLines.forEach((line) => {
      later(() => line.classList.add('show'), t);
      t += 5000;
      later(() => line.classList.remove('show'), t);
      t += 2000;
    });

    // 2 — the last card: Happy Birthday, Nimra
    t += 600;
    later(showGrandFinale, t);
    t += 8600;
    later(() => grandFinale.classList.remove('show'), t);

    // 3 — then nothing but sky, fireworks, the song and its words
    t += 2600;
    later(openLyricsStage, t);
  }

  function showGrandFinale() {
    grandFinale.classList.add('show');
    grandFinale.setAttribute('aria-hidden', 'false');
    fx.puffAtCenter();
    fx.celebrationBurst();
    fx.setIntensity(0.95);
    later(() => fx.setIntensity(0.5), 4600);
  }

  creditsRoll.addEventListener('animationend', (e) => {
    if (e.animationName !== 'scrollCredits') return;
    startFinale();
  });

  // --------------------------
  // The eternal sky : subtitles that live with the song
  // --------------------------
  /* Every line is { t: seconds, text: '...' }.
     Edit, add or remove freely — they follow the song on their own.
     LYRICS_SPAN is the length the timings were written against; if your
     moonlight.mp3 is a different edit, the timings stretch to fit. */
  const LYRICS_SPAN = 277;
  const LYRICS = [
    { t: 0, text: '♪' },
    { t: 13, text: 'ah — ah — ah — ah' },
    { t: 27, text: 'all the lights begin to gleam' },
    { t: 34, text: 'ruby, blue and green, neon too' },
    { t: 42, text: 'everything looks better from above' },
    { t: 50, text: 'like aquamarine, oceans blue' },
    { t: 58, text: '♪' },
    { t: 64, text: 'cacciatore' },
    { t: 71, text: 'la — da — da — da — da' },
    { t: 79, text: 'limousines' },
    { t: 86, text: 'ciao, amore' },
    { t: 94, text: '♪' },
    { t: 100, text: 'Salvatore, wait for me' },
    { t: 108, text: 'catch me if you can' },
    { t: 116, text: '♪' },
    { t: 122, text: 'soft ice cream' },
    { t: 129, text: 'I adore you' },
    { t: 137, text: '♪' },
    { t: 143, text: 'by the sea' },
    { t: 150, text: 'sun and fun' },
    { t: 158, text: '♪' },
    { t: 164, text: "Salvatore, can't you see" },
    { t: 172, text: "I'm on my way" },
    { t: 180, text: '♪' },
    { t: 188, text: 'ah — ah — ah — ah' },
    { t: 202, text: '♪' },
    { t: 214, text: 'bring back the sun' },
    { t: 226, text: '♪' },
    { t: 240, text: 'ah — ah — ah — ah' },
    { t: 256, text: '♪' },
  ];

  let lyricsOn = true;
  let lyricIndex = -1;
  let lyricRAF = 0;
  let lyricClock = 0;

  function lyricTime() {
    if (bgm && !bgm.paused && bgm.currentTime > 0 && bgm.duration > 0 && isFinite(bgm.duration)) {
      const scale = bgm.duration / LYRICS_SPAN;
      return bgm.currentTime / (scale > 0.4 && scale < 2.5 ? scale : 1);
    }
    return ((now() - lyricClock) / 1000) % LYRICS_SPAN;
  }

  function lyricAt(t) {
    let i = 0;
    for (let k = 0; k < LYRICS.length; k++) {
      if (LYRICS[k].t <= t) i = k;
      else break;
    }
    return i;
  }

  function paintLyric(i) {
    const prev = LYRICS[i - 1];
    const next = LYRICS[(i + 1) % LYRICS.length];
    lyricNow.textContent = LYRICS[i].text;
    lyricPrev.textContent = prev ? prev.text : '';
    lyricNext.textContent = next ? next.text : '';
    lyricNow.classList.remove('in');
    void lyricNow.offsetWidth;
    lyricNow.classList.add('in');
  }

  function lyricTick() {
    const t = lyricTime();
    const i = lyricAt(t);
    if (i !== lyricIndex) {
      lyricIndex = i;
      paintLyric(i);
    }
    lyricsBar.style.transform = `scaleX(${clamp(t / LYRICS_SPAN, 0, 1).toFixed(4)})`;
    lyricRAF = requestAnimationFrame(lyricTick);
  }

  function startLyricLoop() {
    if (lyricRAF) return;
    lyricClock = now();
    lyricIndex = -1;
    lyricRAF = requestAnimationFrame(lyricTick);
  }

  function stopLyricLoop() {
    if (lyricRAF) cancelAnimationFrame(lyricRAF);
    lyricRAF = 0;
  }

  function setLyrics(on) {
    lyricsOn = on;
    lyricsStage.classList.toggle('show', on);
    lyricsStage.setAttribute('aria-hidden', String(!on));
    lyricsToggle.textContent = on ? 'Hide lyrics' : 'Show lyrics';
    if (on) startLyricLoop();
    else stopLyricLoop();
  }

  function openLyricsStage() {
    skyControls.classList.add('show');
    fx.setIntensity(0.35);
    setLyrics(true);
  }

  function closeSky() {
    stopLyricLoop();
    lyricIndex = -1;
    lyricsOn = true;
    lyricsToggle.textContent = 'Hide lyrics';
    lyricsStage.classList.remove('show');
    lyricsStage.setAttribute('aria-hidden', 'true');
    grandFinale.classList.remove('show');
    grandFinale.setAttribute('aria-hidden', 'true');
    skyControls.classList.remove('show');
  }

  lyricsToggle.addEventListener('click', () => setLyrics(!lyricsOn));
  lyricsTrack.textContent = `${TRACK_LABEL} · Lana Del Rey`;

  // --------------------------
  // Buttons
  // --------------------------
  $('#startBtn').addEventListener('click', () => {
    startMusic();
    go(1);
  });
  $('#memoriesNextBtn').addEventListener('click', () => {
    startMusic();
    go(2);
  });
  $('#saturnNextBtn').addEventListener('click', () => go(3));
  continueBtn.addEventListener('click', () => {
    if (!candleOut) return;
    go(4);
  });
  $('#creditsBtn').addEventListener('click', () => go(5));
  replayBtn.addEventListener('click', () => {
    clearLater();
    stopMic();
    micRequested = false;
    setCandleOut(false);
    envelopeBtn.classList.remove('open');
    creditsWrapper.classList.remove('done');
    finaleLines.forEach((l) => l.classList.remove('show'));
    closeSky();
    finaleStarted = false;
    go(0);
  });

  // --------------------------
  // Gift layer — floating gifts
  // --------------------------
  const giftLayer = $('#giftLayer');

  function makeGiftEl() {
    const el = document.createElement('div');
    el.className = 'gift';
    const size = Math.random() * 26 + 18;
    el.style.width = `${size}px`;
    el.style.height = `${size}px`;
    el.style.left = `${Math.random() * 100}%`;
    el.style.top = `${100 + Math.random() * 30}%`;
    el.style.opacity = `${0.18 + Math.random() * 0.2}`;
    const dur = 9 + Math.random() * 10;
    const drift = (Math.random() * 2 - 1) * 18;
    el.style.setProperty('--dur', `${dur}s`);
    el.style.setProperty('--drift', `${drift}px`);
    el.style.animationDelay = `${-Math.random() * dur}s`;
    return el;
  }

  function initGifts() {
    for (let i = 0; i < 14; i++) giftLayer.appendChild(makeGiftEl());
    giftLayer.addEventListener('animationiteration', (e) => {
      const el = e.target;
      if (!(el instanceof HTMLElement)) return;
      if (!el.classList.contains('gift')) return;
      el.style.left = `${Math.random() * 100}%`;
      el.style.opacity = `${0.16 + Math.random() * 0.22}`;
      el.style.setProperty('--drift', `${(Math.random() * 2 - 1) * 18}px`);
    });
  }
  initGifts();

  // --------------------------
  // Fireworks + Stars engine
  // --------------------------
  const canvas = $('#fxCanvas');
  const ctx = canvas.getContext('2d', { alpha: true });

  const fx = (() => {
    let w = 0, h = 0, dpr = 1;
    let last = now();
    const stars = [];
    const STAR_COUNT_BASE = 140;
    const rockets = [];
    const particles = [];
    const smokes = [];
    let intensity = 0.05;
    let spawnAcc = 0;
    const pending = [];

    const palette = [
      { r: 170, g: 110, b: 255 },
      { r: 110, g: 160, b: 255 },
      { r: 255, g: 110, b: 220 },
      { r: 235, g: 235, b: 255 },
    ];

    function resize() {
      dpr = Math.max(1, Math.min(2.25, window.devicePixelRatio || 1));
      w = Math.floor(window.innerWidth * dpr);
      h = Math.floor(window.innerHeight * dpr);
      canvas.width = w;
      canvas.height = h;
      stars.length = 0;
      const count = Math.floor((STAR_COUNT_BASE * (w * h)) / (900 * 700));
      for (let i = 0; i < count; i++) {
        stars.push({
          x: Math.random() * w,
          y: Math.random() * h,
          z: Math.random() * 1,
          r: (Math.random() * 1.2 + 0.25) * dpr,
          tw: Math.random() * Math.PI * 2,
          tws: 0.7 + Math.random() * 1.8,
          a: 0.15 + Math.random() * 0.55,
        });
      }
      ctx.fillStyle = 'rgba(5, 3, 12, 1)';
      ctx.fillRect(0, 0, w, h);
    }

    function setIntensity(v) {
      intensity = clamp(v, 0, 1);
    }

    function launchRocket() {
      const x = (Math.random() * 0.9 + 0.05) * w;
      const y = h + 10 * dpr;
      const z = 0.35 + Math.random() * 0.65;
      const speed = (6.2 + Math.random() * 2.6) * dpr * (0.85 + 0.35 * (1 - z));
      const vx = (Math.random() * 2 - 1) * 0.6 * dpr;
      const vy = -speed;
      const targetY = (Math.random() * 0.45 + 0.12) * h;
      const color = palette[(Math.random() * palette.length) | 0];
      rockets.push({ x, y, z, vx, vy, targetY, life: 0, color, trail: [] });
    }

    function burst(x, y, z, baseColor) {
      const count = Math.floor(70 + Math.random() * 60);
      const spread = 2.2 + Math.random() * 1.8;
      for (let i = 0; i < count; i++) {
        const ang = Math.random() * Math.PI * 2;
        const mag = Math.random() ** 0.45 * spread * dpr * (0.55 + 0.75 * z);
        const col = Math.random() < 0.7 ? baseColor : palette[(Math.random() * palette.length) | 0];
        particles.push({
          x, y, z,
          vx: Math.cos(ang) * mag,
          vy: Math.sin(ang) * mag,
          drag: 0.985 - Math.random() * 0.01,
          g: (0.045 + Math.random() * 0.035) * dpr,
          life: 0,
          maxLife: (42 + Math.random() * 28) * (0.9 + 0.6 * z),
          r: (1.1 + Math.random() * 1.8) * dpr * (0.75 + 0.85 * z),
          col,
          sparkle: Math.random() < 0.16,
          trail: [],
        });
      }
      smokes.push({
        x, y, z,
        r: (22 + Math.random() * 18) * dpr * (0.7 + 0.8 * z),
        a: 0.14,
        life: 0,
        maxLife: 56 + Math.random() * 30,
      });
    }

    function celebrationBurst() {
      for (let i = 0; i < 6; i++) {
        const id = setTimeout(() => {
          const x = (0.15 + Math.random() * 0.7) * w;
          const y = (0.12 + Math.random() * 0.45) * h;
          const z = 0.55 + Math.random() * 0.45;
          burst(x, y, z, palette[(Math.random() * palette.length) | 0]);
        }, i * 170);
        pending.push(id);
      }
    }

    function puffAtCenter() {
      const x = w * 0.5 + (Math.random() * 2 - 1) * 18 * dpr;
      const y = h * 0.5 + 60 * dpr;
      smokes.push({ x, y, z: 0.65, r: 26 * dpr, a: 0.18, life: 0, maxLife: 70 });
    }

    function drawStars(t) {
      ctx.save();
      ctx.globalCompositeOperation = 'source-over';
      for (const s of stars) {
        const tw = 0.55 + 0.45 * Math.sin(s.tw + t * 0.001 * s.tws);
        const alpha = s.a * tw;
        ctx.beginPath();
        ctx.fillStyle = `rgba(220,230,255,${alpha})`;
        ctx.arc(s.x, s.y, s.r * (0.85 + 0.35 * s.z), 0, Math.PI * 2);
        ctx.fill();
        if (tw > 0.92 && s.z > 0.7) {
          ctx.globalAlpha = alpha * 0.55;
          ctx.strokeStyle = 'rgba(255,255,255,0.6)';
          ctx.lineWidth = 0.8 * dpr;
          ctx.beginPath();
          ctx.moveTo(s.x - 3.2 * dpr, s.y);
          ctx.lineTo(s.x + 3.2 * dpr, s.y);
          ctx.moveTo(s.x, s.y - 3.2 * dpr);
          ctx.lineTo(s.x, s.y + 3.2 * dpr);
          ctx.stroke();
          ctx.globalAlpha = 1;
        }
      }
      ctx.restore();
    }

    function tick(t) {
      const dt = clamp((t - last) / 16.6667, 0.2, 2.2);
      last = t;

      ctx.save();
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = `rgba(5, 3, 12, 0.18)`;
      ctx.fillRect(0, 0, w, h);
      ctx.restore();

      drawStars(t);

      spawnAcc += dt * (0.015 + 0.055 * intensity);
      while (spawnAcc > 1) {
        spawnAcc -= 1;
        if (intensity > 0.08) launchRocket();
      }

      // Rockets
      for (let i = rockets.length - 1; i >= 0; i--) {
        const r = rockets[i];
        r.life += dt;
        r.trail.push({ x: r.x, y: r.y });
        if (r.trail.length > 14) r.trail.shift();
        r.x += r.vx * dt;
        r.y += r.vy * dt;
        r.vx *= 0.995;
        r.vy *= 0.998;
        r.vx += Math.sin(t * 0.001 + r.life) * 0.01 * dpr;
        const reached = r.y <= r.targetY;
        const timed = r.life > 70;
        if (reached || timed) {
          burst(r.x, r.y, r.z, r.color);
          rockets.splice(i, 1);
        }
      }

      // Particles
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.life += dt;
        p.trail.push({ x: p.x, y: p.y });
        if (p.trail.length > 10) p.trail.shift();
        p.vx *= p.drag;
        p.vy *= p.drag;
        p.vy += p.g * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        if (p.life > p.maxLife) particles.splice(i, 1);
      }

      // Smokes
      for (let i = smokes.length - 1; i >= 0; i--) {
        const s = smokes[i];
        s.life += dt;
        if (s.life > s.maxLife) smokes.splice(i, 1);
      }

      // Draw (additive)
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';

      for (const r of rockets) {
        for (let i = 0; i < r.trail.length - 1; i++) {
          const a = i / r.trail.length;
          ctx.strokeStyle = `rgba(${r.color.r},${r.color.g},${r.color.b},${0.08 + a * 0.14})`;
          ctx.lineWidth = (1.2 + a * 1.8) * dpr * (0.7 + 0.8 * r.z);
          ctx.beginPath();
          ctx.moveTo(r.trail[i].x, r.trail[i].y);
          ctx.lineTo(r.trail[i + 1].x, r.trail[i + 1].y);
          ctx.stroke();
        }
        const glow = 10 * dpr * (0.7 + 0.9 * r.z);
        const g = ctx.createRadialGradient(r.x, r.y, 0, r.x, r.y, glow);
        g.addColorStop(0, `rgba(${r.color.r},${r.color.g},${r.color.b},0.60)`);
        g.addColorStop(1, `rgba(${r.color.r},${r.color.g},${r.color.b},0.00)`);
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(r.x, r.y, glow, 0, Math.PI * 2);
        ctx.fill();
      }

      for (const p of particles) {
        const life01 = clamp(p.life / p.maxLife, 0, 1);
        const fade = 1 - life01;
        for (let i = 0; i < p.trail.length - 1; i++) {
          const a = i / p.trail.length;
          const alpha = (0.06 + a * 0.1) * fade;
          ctx.strokeStyle = `rgba(${p.col.r},${p.col.g},${p.col.b},${alpha})`;
          ctx.lineWidth = (0.8 + a * 1.2) * dpr * (0.65 + 0.9 * p.z);
          ctx.beginPath();
          ctx.moveTo(p.trail[i].x, p.trail[i].y);
          ctx.lineTo(p.trail[i + 1].x, p.trail[i + 1].y);
          ctx.stroke();
        }
        const flick = p.sparkle ? 0.65 + 0.35 * Math.sin(t * 0.02 + p.life) : 1.0;
        const alpha = (0.22 + 0.45 * fade) * flick;
        ctx.fillStyle = `rgba(${p.col.r},${p.col.g},${p.col.b},${alpha})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r * (0.7 + 0.6 * fade), 0, Math.PI * 2);
        ctx.fill();
        const glowR = p.r * (3.2 + 3.2 * fade);
        const gg = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, glowR);
        gg.addColorStop(0, `rgba(${p.col.r},${p.col.g},${p.col.b},${0.16 * fade})`);
        gg.addColorStop(1, `rgba(${p.col.r},${p.col.g},${p.col.b},0)`);
        ctx.fillStyle = gg;
        ctx.beginPath();
        ctx.arc(p.x, p.y, glowR, 0, Math.PI * 2);
        ctx.fill();
      }

      for (const s of smokes) {
        const life01 = clamp(s.life / s.maxLife, 0, 1);
        const fade = 1 - life01;
        const radius = s.r * (0.7 + 1.25 * life01);
        const g = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, radius);
        g.addColorStop(0, `rgba(220,220,255,${s.a * fade})`);
        g.addColorStop(1, `rgba(220,220,255,0)`);
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(s.x, s.y, radius, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.restore();

      // Mic sampling in the candle scene
      if (sceneIndex === 3 && !candleOut) sampleMicAndDetectBlow(t);

      requestAnimationFrame(tick);
    }

    return { resize, tick, setIntensity, puffAtCenter, celebrationBurst, pending };
  })();

  // --------------------------
  // Boot
  // --------------------------
  function boot() {
    fx.resize();
    ctx.fillStyle = 'rgba(5, 3, 12, 1)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    requestAnimationFrame(fx.tick);
  }

  window.addEventListener('resize', () => fx.resize(), { passive: true });
  window.addEventListener('orientationchange', () => fx.resize(), { passive: true });

  setScene(0);
  boot();
})();