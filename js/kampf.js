'use strict';
/* Kampf um Liechtenstein: eigenständige Seite. Hilfsfunktionen, Chiptune-Ton, Intro, Menü, Highscore. */
const $ = s => document.querySelector(s);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const store = { get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { } } };
function toast(msg) { const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg; $('#toasts').appendChild(t); setTimeout(() => t.remove(), 3800); while ($('#toasts').children.length > 3) $('#toasts').firstChild.remove(); }
function rng(seed) { let s = (seed >>> 0) || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }
const DATA = null; // die Kacheldekodierung wird hier nicht gebraucht

/* ======================= Ton: 4 Stimmen wie ein Heimcomputer der 80er ======================= */
const Snd = {
  ctx: null, on: store.get('kampf-ton') !== false, playing: false,
  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    const c = this.ctx = new AC();
    this.master = c.createGain(); this.master.gain.value = this.on ? .5 : 0; this.master.connect(c.destination);
    // Pulswellen mit 12,5 %, 25 % und 50 % Tastverhältnis, wie bei den Soundchips der Zeit
    const pulse = d => { const n = 32, re = new Float32Array(n), im = new Float32Array(n); for (let k = 1; k < n; k++) im[k] = 2 / (k * Math.PI) * Math.sin(k * Math.PI * d); return c.createPeriodicWave(re, im); };
    this.w12 = pulse(.125); this.w25 = pulse(.25); this.w50 = pulse(.5);
    const len = c.sampleRate, b = c.createBuffer(1, len, c.sampleRate), d = b.getChannelData(0); let v = 0;
    for (let i = 0; i < len; i++) { if (i % 3 === 0) v = Math.random() * 2 - 1; d[i] = v; }   // grobes Rauschen
    this.noise = b;
  },
  setOn(v) { this.on = v; store.set('kampf-ton', v); if (this.master) this.master.gain.setTargetAtTime(v ? .5 : 0, this.ctx.currentTime, .05); },
  f(n) { // Notenname -> Frequenz
    const m = /^([A-G])(#?)(\d)$/.exec(n); if (!m) return 0;
    const semi = { C: -9, D: -7, E: -5, F: -4, G: -2, A: 0, B: 2 }[m[1]] + (m[2] ? 1 : 0) + (m[3] - 4) * 12;
    return 440 * Math.pow(2, semi / 12);
  },
  tone(t, freq, dur, wave, vol, slide, out) {
    const c = this.ctx, o = c.createOscillator(), g = c.createGain();
    if (wave === 'tri') o.type = 'triangle'; else o.setPeriodicWave(wave || this.w50);
    o.frequency.setValueAtTime(freq, t); if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, slide), t + dur);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + .004); g.gain.setValueAtTime(vol * .8, t + dur * .6); g.gain.linearRampToValueAtTime(0, t + dur);
    o.connect(g); g.connect(out || this.master); o.start(t); o.stop(t + dur + .02);
  },
  hiss(t, dur, vol, hp) {
    const c = this.ctx, s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    s.buffer = this.noise; f.type = 'highpass'; f.frequency.value = hp || 1500;
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(.001, t + dur);
    s.connect(f); f.connect(g); g.connect(this.master); s.start(t, Math.random() * .5); s.stop(t + dur + .02);
  },
  /* ---------- Marsch (eigene Komposition): Melodie, Arpeggio, Bass, Trommel ---------- */
  song() {
    if (this._song) return this._song;
    const mel = 'G4:2 G4:1 G4:1 C5:4 E5:4 G5:4|E5:3 C5:1 E5:4 G5:8|A5:2 G5:2 F5:2 E5:2 D5:4 G4:4|C5:8 r:4 G4:2 G4:2|C5:4 B4:2 A4:2 G4:4 E4:4|F4:2 A4:2 C5:4 A4:4 F4:4|G4:2 B4:2 D5:4 F5:4 D5:2 B4:2|C5:6 G4:2 C5:8|' +
      'A4:4 C5:2 E5:2 A5:4 E5:4|F5:4 E5:2 D5:2 C5:4 A4:4|B4:2 C5:2 D5:4 G5:4 F5:2 D5:2|E5:8 E5:2 D5:2 C5:2 B4:2|A4:4 E5:4 A5:4 G5:2 F5:2|E5:2 F5:2 G5:4 C5:4 E5:4|D5:2 E5:2 F5:4 B4:4 D5:4|C5:12 r:4';
    const chords = ['C', 'C', 'FG', 'C', 'C', 'F', 'G', 'C', 'Am', 'F', 'G', 'E', 'Am', 'C', 'G', 'C'];
    const CH = { C: ['C', 'E', 'G'], F: ['F', 'A', 'C'], G: ['G', 'B', 'D'], Am: ['A', 'C', 'E'], E: ['E', 'G#', 'B'] };
    const notes = []; let step = 0;
    for (const tok of mel.replace(/\|/g, ' ').trim().split(/\s+/)) { const [n, l] = tok.split(':'); if (n !== 'r') notes.push([step, n, +l]); step += +l; }
    this._song = { notes, chords, CH, steps: step };
    return this._song;
  },
  startMusic() {
    this.init(); if (!this.ctx || this.playing) return;
    this.playing = true; const S = this.song(), bpm = 128, st = 60 / bpm / 4;
    this.mus = this.ctx.createGain(); this.mus.gain.value = 1; this.mus.connect(this.master);
    let t0 = this.ctx.currentTime + .1, next = 0;
    const sched = () => {
      if (!this.playing) return;
      const c = this.ctx, horizon = c.currentTime + .25;
      while (t0 + next * st < horizon) {
        const s = next % S.steps, t = t0 + next * st, bar = Math.floor(s / 16), pos = s % 16;
        for (const [at, n, l] of S.notes) if (at === s) this.tone(t, this.f(n), l * st * .92, this.w25, .16, 0, this.mus);
        let ch = S.chords[bar]; if (ch.length === 2 && ch !== 'Am') ch = pos < 8 ? ch[0] : ch[1];
        const tones = S.CH[ch], root = tones[0];
        // Arpeggio in Sechzehnteln, leise
        this.tone(t, this.f(tones[[0, 1, 2, 1][pos % 4]] + '4'), st * .8, this.w12, .045, 0, this.mus);
        // Bass: Grundton und Quinte im Marschtakt
        if (pos % 4 === 0) this.tone(t, this.f((pos % 8 === 0 ? root : tones[2]) + '2'), st * 3, 'tri', .28, 0, this.mus);
        // Trommel: Pauke auf 1 und 3, kleine Trommel auf 2 und 4, Wirbel am Ende jeder vierten Zeile
        if (pos === 0 || pos === 8) this.tone(t, 150, .12, 'tri', .5, 40, this.mus);
        if (pos === 4 || pos === 12) this.hiss(t, .12, .22, 1200);
        if (bar % 4 === 3 && pos >= 13) this.hiss(t, .06, .15, 1800);
        if (pos % 2 === 1) this.hiss(t, .02, .04, 6000);
        next++;
      }
      this.timer = setTimeout(sched, 50);
    };
    sched();
  },
  stopMusic() {
    if (!this.playing) return; this.playing = false; clearTimeout(this.timer);
    if (this.mus) { const g = this.mus; g.gain.setTargetAtTime(0, this.ctx.currentTime, .08); setTimeout(() => g.disconnect(), 600); }
  },
  /* ---------- Effekte ---------- */
  play(n) {
    if (!this.ctx || !this.on) return; const t = this.ctx.currentTime + .01, F = x => this.f(x);
    const now = performance.now(); this._last = this._last || {}; if (now - (this._last[n] || 0) < 60) return; this._last[n] = now;
    switch (n) {
      case 'tap': this.tone(t, 880, .05, this.w25, .12); break;
      case 'tick': this.tone(t, 1200 + Math.random() * 300, .025, this.w12, .05); break;
      case 'charge': this.tone(t, F('C5'), .06, this.w25, .14); this.tone(t + .07, F('G5'), .1, this.w25, .14); break;
      case 'build': this.tone(t, F('E5'), .08, this.w50, .14); this.tone(t + .09, F('C6'), .14, this.w50, .14); this.hiss(t, .05, .1, 3000); break;
      case 'hit': this.tone(t, 220, .12, this.w50, .12, 90); break;
      case 'alarm': for (let k = 0; k < 3; k++) { this.tone(t + k * .16, 660, .07, this.w50, .13); this.tone(t + k * .16 + .08, 440, .07, this.w50, .13); } break;
      case 'pact': ['C5', 'E5', 'G5', 'C6'].forEach((x, k) => this.tone(t + k * .07, F(x), .2, this.w25, .12)); break;
      case 'start': ['G4', 'C5', 'E5', 'G5'].forEach((x, k) => this.tone(t + k * .09, F(x), .12, this.w25, .14)); this.tone(t + .36, F('C6'), .35, this.w25, .14); break;
      case 'fanfare': ['C5', 'C5', 'C5', 'G5'].forEach((x, k) => this.tone(t + k * .1, F(x), k === 3 ? .4 : .08, this.w25, .15)); break;
      case 'boom': this.hiss(t, .5, .4, 200); this.tone(t, 90, .3, 'tri', .5, 30); break;
      case 'type': this.tone(t, 1500, .015, this.w12, .04); break;
      case 'win': { const m = ['C5:2', 'C5:1', 'C5:1', 'G5:4', 'E5:2', 'G5:2', 'C6:8']; let k = 0; for (const x of m) { const [nn, l] = x.split(':'); this.tone(t + k * .1, F(nn), l * .1, this.w25, .16); this.tone(t + k * .1, F(nn) / 2, l * .1, 'tri', .25); k += +l; } break; }
      case 'lose': ['G4', 'F4', 'E4', 'D4', 'C4'].forEach((x, k) => this.tone(t + k * .22, F(x), .22, this.w50, .14)); this.tone(t + 1.1, F('C3'), .8, 'tri', .3); break;
    }
  },
};

/* ======================= Intro-Szene in 320 x 180 Pixeln ======================= */
const Intro = {
  W: 320, H: 180, t: 0, run: false, shots: [], booms: [],
  init() {
    const c = this.cv = $('#ic'); this.g = c.getContext('2d'); c.width = this.W; c.height = this.H; this.g.imageSmoothingEnabled = false;
    const r = rng(1719);
    const ridge = (y0, amp, rough, seed) => { const rr = rng(seed), pts = []; let y = y0; for (let x = 0; x <= this.W; x += 4) { y += (rr() - .5) * rough; y = clamp(y, y0 - amp, y0 + amp * .3); pts.push(y); } return pts; };
    this.far = ridge(92, 34, 10, 7); this.near = ridge(118, 24, 7, 11);
    this.stars = Array.from({ length: 70 }, () => [Math.floor(r() * this.W), Math.floor(r() * 90), r()]);
    this.soldiers = Array.from({ length: 14 }, (_, k) => k * 26);
    this.resize(); addEventListener('resize', () => this.resize());
  },
  resize() {
    const c = this.cv, box = $('#intro'), w = box.clientWidth || innerWidth, h = box.clientHeight || innerHeight, s = Math.max(w / this.W, Math.min(h / this.H, w / 170));
    // Soldaten (unterste Bildzeilen) sollen über dem Menü bleiben: Szene notfalls nach oben schieben
    const m = $('#menu'), menuTop = m && !m.hidden ? m.getBoundingClientRect().top - box.getBoundingClientRect().top : h;
    let top = Math.min(0, (h - this.H * s) / 2); if (h <= w) top = Math.max(h - this.H * s, Math.min(top, h - 4 - 174 * s)); const feet = top + 174 * s; if (h > w && feet > menuTop - 6) top -= feet - (menuTop - 6);
    c.style.width = this.W * s + 'px'; c.style.height = this.H * s + 'px'; c.style.left = clamp(w / 2 - 190 * s, w - this.W * s, 0) + 'px'; c.style.top = top + 'px';
    const bottom = top + this.H * s; box.style.background = bottom < h ? 'linear-gradient(#000 0,#000 ' + bottom + 'px,#1a2414 ' + bottom + 'px)' : '#000';
  },
  start() { if (this.run) return; this.run = true; let last = performance.now(); const loop = t => { if (!this.run) return; this.t += Math.min(.05, (t - last) / 1000); last = t; this.draw(); requestAnimationFrame(loop); }; requestAnimationFrame(loop); },
  stop() { this.run = false; },
  px(x, y, w, h, c) { this.g.fillStyle = c; this.g.fillRect(Math.round(x), Math.round(y), w, h); },
  draw() {
    const g = this.g, W = this.W, H = this.H, t = this.t;
    // Himmel in Bändern mit Rasterübergang (Dithering)
    const bands = ['#0a0c22', '#13153a', '#24204e', '#3e2a5c', '#6a3658', '#a24a4a', '#d9734a'];
    const bh = 14;
    for (let i = 0; i < bands.length; i++) { this.px(0, i * bh, W, bh, bands[i]); if (i < bands.length - 1) { g.fillStyle = bands[i + 1]; for (let x = (i % 2); x < W; x += 2) g.fillRect(x, i * bh + bh - 2, 1, 1); for (let x = 0; x < W; x += 2) g.fillRect(x + 1, i * bh + bh - 1, 1, 1); } }
    this.px(0, bands.length * bh, W, H, '#d9734a');
    for (const [x, y, p] of this.stars) if (y < 70 && Math.sin(t * 3 + p * 20) > -.6) this.px(x, y, 1, 1, p > .8 ? '#fff' : '#9aa0d0');
    // Mond
    this.px(262, 18, 10, 10, '#f2e6b0'); this.px(260, 20, 14, 6, '#f2e6b0'); this.px(266, 18, 6, 4, '#13153a');
    // Berge
    const ridge = (pts, col, snow) => { for (let i = 0; i < pts.length - 1; i++) { const x = i * 4, y = Math.round(pts[i]); this.px(x, y, 4, H - y, col); if (snow && y < 70) this.px(x, y, 4, 3, '#dfe4f0'); } };
    ridge(this.far, '#3b3550', true); ridge(this.near, '#232a2a', false);
    // Talboden mit Rhein
    this.px(0, 140, W, 40, '#1a2414'); this.px(0, 146, W, 2, '#2c4a6a'); for (let x = (Math.floor(t * 20) % 6); x < W; x += 6) this.px(x, 146, 2, 1, '#5a86b0');
    // Burg auf dem Hügel rechts
    const bx = 214, by = 96; const stone = '#4a4650', dark = '#2c2a32';
    for (let k = 0; k < 18; k++) this.px(bx - 30 + k * 6, by + 30 - Math.round(Math.sin(k / 17 * Math.PI) * 14), 6, 30, '#1c2618');
    this.px(bx, by, 52, 26, stone); this.px(bx + 4, by - 18, 14, 18, stone); this.px(bx + 36, by - 10, 12, 10, stone);
    for (let k = 0; k < 7; k++) this.px(bx + k * 8, by - 3, 4, 3, stone);
    for (let k = 0; k < 3; k++) this.px(bx + 4 + k * 5, by - 21, 3, 3, stone);
    this.px(bx + 22, by + 14, 8, 12, dark); this.px(bx + 8, by - 10, 3, 4, '#f2c84a'); this.px(bx + 40, by - 4, 3, 3, '#f2c84a'); this.px(bx + 34, by + 8, 3, 4, '#f2c84a');
    // Fahne blau/rot, weht
    this.px(bx + 10, by - 34, 1, 14, '#bbb'); const wv = Math.floor(t * 4) % 2;
    this.px(bx + 11, by - 34, 10, 3, '#2a4aa8'); this.px(bx + 11, by - 31, 10, 3, '#c41f3a'); if (wv) { this.px(bx + 21, by - 33, 2, 3, '#2a4aa8'); this.px(bx + 21, by - 30, 2, 2, '#c41f3a'); }
    // Suchscheinwerfer
    const a = Math.sin(t * .8) * .7 - Math.PI / 2; g.fillStyle = 'rgba(255,240,180,.08)'; g.beginPath(); g.moveTo(bx + 11, by - 18); g.lineTo(bx + 11 + Math.cos(a - .08) * 200, by - 18 + Math.sin(a - .08) * 200); g.lineTo(bx + 11 + Math.cos(a + .08) * 200, by - 18 + Math.sin(a + .08) * 200); g.fill();
    // Kanone links feuert auf die Burg
    const cx = 44, cy = 128; this.px(cx - 8, cy + 4, 18, 5, '#3a2a1a'); this.px(cx - 4, cy + 8, 5, 5, '#1a1208'); this.px(cx + 5, cy + 8, 5, 5, '#1a1208'); this.px(cx, cy, 16, 4, '#555');
    if (!this.nextShot || t > this.nextShot) { this.nextShot = t + 2.6 + Math.random() * 1.5; this.shots.push({ x: cx + 16, y: cy + 1, vx: 70 + Math.random() * 15, vy: -62, t0: t }); this.flash = t; if (this.sound) Snd.play('boom'); }
    if (this.flash && t - this.flash < .12) { this.px(cx + 16, cy - 2, 6, 6, '#ffe070'); this.px(cx + 19, cy - 4, 4, 10, '#ff9a3a'); }
    for (const s of this.shots) { const dt = t - s.t0, x = s.x + s.vx * dt, y = s.y + s.vy * dt + 30 * dt * dt; if (x > bx - 4 || y > 140) { s.dead = true; this.booms.push({ x, y, t0: t }); continue; } this.px(x, y, 2, 2, '#111'); }
    this.shots = this.shots.filter(s => !s.dead);
    for (const b of this.booms) { const dt = t - b.t0; if (dt > .6) { b.dead = true; continue; } const r = Math.round(dt * 18); for (let k = 0; k < 10; k++) { const an = k / 10 * Math.PI * 2; this.px(b.x + Math.cos(an) * r, b.y + Math.sin(an) * r, 2, 2, dt < .2 ? '#ffe070' : dt < .4 ? '#ff7a2a' : '#555'); } }
    this.booms = this.booms.filter(b => !b.dead);
    // marschierende Soldaten
    const step = Math.floor(t * 6) % 2;
    for (let k = 0; k < this.soldiers.length; k++) {
      const x = ((this.soldiers[k] + t * 14) % (W + 30)) - 20, y = 160;
      this.px(x + 1, y, 3, 2, '#3a4a22'); this.px(x + 1, y + 2, 3, 2, '#e0b890'); this.px(x, y + 4, 5, 5, '#4a5a2a'); this.px(x + 4, y + 1, 1, 7, '#222');
      this.px(x + (step ? 0 : 1), y + 9, 2, 3, '#2a2a1a'); this.px(x + (step ? 3 : 2), y + 9, 2, 3, '#2a2a1a');
    }
    // Vignette oben und unten
    this.px(0, 0, W, 2, '#000'); this.px(0, H - 2, W, 2, '#000');
  },
};

/* ======================= Highscore ======================= */
const HS = {
  key: 'kampf-highscore',
  // Supabase (öffentliche Tabelle kampf_highscore); ohne Schlüssel oder offline: nur auf diesem Gerät
  get remote() { return !!(CFG.supabaseUrl && CFG.supabaseKey); },
  headers(extra) { const k = CFG.supabaseKey, h = { apikey: k, 'Content-Type': 'application/json' }; if (k.startsWith('eyJ')) h.Authorization = 'Bearer ' + k; return Object.assign(h, extra || {}); },
  local() { return store.get(this.key) || []; },
  async list() {
    if (this.remote) {
      try {
        const r = await fetch(`${CFG.supabaseUrl}/rest/v1/kampf_highscore?select=id,name,gemeinde,score,win,minutes,platz,created_at&order=score.desc,created_at.asc&limit=10`, { headers: this.headers() });
        if (!r.ok) throw new Error(r.status);
        this.online = true;
        return (await r.json()).map(e => ({ id: e.id, n: e.name, g: e.gemeinde, s: e.score, w: e.win, m: e.minutes, p: e.platz }));
      } catch (e) { console.warn('Highscore offline', e); this.online = false; }
    }
    return this.local();
  },
  async add(e) {
    const loc = this.local(); loc.push(e); loc.sort((a, b) => b.s - a.s); store.set(this.key, loc.slice(0, 10));
    if (this.remote) {
      try {
        const r = await fetch(`${CFG.supabaseUrl}/rest/v1/kampf_highscore`, { method: 'POST', headers: this.headers({ Prefer: 'return=representation' }),
          body: JSON.stringify({ name: e.n, gemeinde: e.g, score: e.s, win: !!e.w, minutes: Math.min(600, e.m || 0), land: Math.min(100, e.land || 0), ...(e.p ? { platz: e.p } : {}) }) });
        if (!r.ok) throw new Error(r.status + ' ' + await r.text());
        const row = (await r.json())[0]; e.id = row && row.id; return true;
      } catch (err) { console.warn('Highscore nicht gespeichert', err); toast('Online-Highscore nicht erreichbar, lokal gespeichert.'); }
    }
    return false;
  },
  qualifies(list, s) { return s > 0 && (list.length < 10 || s > list[list.length - 1].s); },
  color(g) { const i = ['Balzers', 'Eschen', 'Gamprin', 'Mauren', 'Planken', 'Ruggell', 'Schaan', 'Schellenberg', 'Triesen', 'Triesenberg', 'Vaduz'].indexOf(g); return WAR_COLORS[i + 1] || '#fff'; },
  table(list, hi) {
    const where = this.remote && this.online ? 'WELTWEIT' : 'NUR AUF DIESEM GERÄT';
    if (!list.length) return `<p>NOCH KEINE EINTRÄGE. SEI DER ERSTE!</p><div class="hsinfo">${where}</div>`;
    return `<table class="hs"><tr><th>#</th><th>NAME</th><th>GEMEINDE</th><th title="Schlussplatz in der Partie">PL.</th><th style="text-align:right">PUNKTE</th></tr>${list.map((e, k) => `<tr class="${hi && e === hi ? 'new' : ''}"><td>${k + 1}.</td><td class="n">${esc(e.n)}</td><td><i style="background:${this.color(e.g)}"></i><span>${esc(e.g.toUpperCase())}</span></td><td class="pl" title="${e.p ? e.p + '. Platz' : ''}">${e.w || e.p === 1 ? Spr.img('pokal', 1, 'Sieg') : e.p ? e.p + '.' : ''}</td><td class="s">${e.s.toLocaleString('de-CH')}</td></tr>`).join('')}</table><div class="hsinfo">${where}</div>`;
  },
};

/* ======================= Menü und Ablauf ======================= */
const Kampf = {
  menuIdx: 0,
  boot() {
    Intro.init();
    const relief = new Image(); relief.src = 'data/relief.png'; window.KAMPF_RELIEF = relief;
    War.labelFont = 'PressStart'; Spr.fill();
    if (document.fonts && document.fonts.load) document.fonts.load('10px PressStart');
    this.ready = Tiles.init().then(ok => ok ? Density.load() : null);
    $('#press').onclick = () => this.intro();
    addEventListener('keydown', e => {
      if (!$('#press').hidden && (e.key === 'Enter' || e.key === ' ')) { this.intro(); return; }
      if ($('#menu').hidden || !$('#panel').hidden) { if (e.key === 'Escape' && !$('#panel').hidden) this.closePanel(); return; }
      const items = [...document.querySelectorAll('#menu .mi')];
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); this.menuIdx = (this.menuIdx + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length; this.markMenu(); Snd.play('tap'); }
      if (e.key === 'Enter') items[this.menuIdx].click();
    });
    document.querySelectorAll('#menu .mi').forEach((b, k) => { b.onclick = () => { Snd.play('tap'); this.menuIdx = k; this.markMenu(); this.action(b.dataset.m); }; b.onmouseenter = () => { this.menuIdx = k; this.markMenu(); }; });
    this.markMenu(); this.updSnd();
    War.onExit = () => this.toMenu();
    War.onEnd = r => this.endScreen(r);
  },
  intro() {
    $('#press').hidden = true; Snd.init(); Intro.sound = Snd.on; Intro.start(); Snd.startMusic();
    const skip = () => { if (this.skipped) return; this.skipped = true; clearTimeout(this.tm); this.showMenu(); };
    $('#intro').addEventListener('pointerdown', e => { if (!$('#menu').hidden) return; skip(); }, { once: false });
    this.tm = setTimeout(() => { $('#titleTxt').hidden = false; $('#titleTxt').classList.add('drop'); setTimeout(() => Snd.play('boom'), 900); }, 600);
    const lines = ['1 LAND. 11 GEMEINDEN.', 'NUR EINE WIRD GEWINNEN.', 'KRÖNE DICH ZUM HERRSCHER.'];
    let li = 0, ci = 0, txt = '';
    const type = () => {
      if (this.skipped) return;
      if (li >= lines.length) { this.tm = setTimeout(skip, 1400); return; }
      txt += lines[li][ci] || ''; ci++; $('#story').innerHTML = esc(txt).replace(/\n/g, '<br>') + '<span style="animation:blink .5s steps(1) infinite">_</span>';
      if (lines[li][ci - 1] !== ' ') Snd.play('type');
      if (ci >= lines[li].length) { li++; ci = 0; txt += '\n'; this.tm = setTimeout(type, 650); } else this.tm = setTimeout(type, 70);
    };
    setTimeout(() => { if (!this.skipped) type(); }, 2200);
  },
  showMenu() {
    $('#titleTxt').hidden = false; $('#titleTxt').classList.remove('drop'); $('#story').innerHTML = ''; $('#menu').hidden = false; this.markMenu(); Intro.resize();
  },
  markMenu() { document.querySelectorAll('#menu .mi').forEach((b, k) => b.classList.toggle('on', k === this.menuIdx)); },
  updSnd() { $('#menu [data-m="snd"]').textContent = 'TON: ' + (Snd.on ? 'AN' : 'AUS'); },
  action(m) {
    if (m === 'new') this.newGame();
    else if (m === 'gem') this.gemList();
    else if (m === 'snd') { Snd.setOn(!Snd.on); Intro.sound = Snd.on; if (Snd.on) Snd.startMusic(); this.updSnd(); }
    else if (m === 'home') location.href = 'index.html';
    else if (m === 'hs') { this.panel(`<h2>HIGHSCORE</h2><div id="hsBox"><p>LADE...</p></div><div class="trow" style="margin-top:16px"><button class="px-btn" id="pClose">ZURÜCK</button></div>`); HS.list().then(l => { const b = $('#hsBox'); if (b) b.innerHTML = HS.table(l); }); }
    else if (m === 'credits') this.panel(`<h2>CREDITS</h2><div class="cr">
      <h3>SPIEL</h3>
      <p><b>SPIELPRINZIP</b><br>inspiriert von <a href="https://openfront.io" target="_blank" rel="noopener">OpenFront</a></p>
      <p><b>MUSIK</b><br>Marsch um Liechtenstein, eigene Komposition</p>
      <p><b>SCHRIFT</b><br>Press Start 2P von CodeMan38, SIL Open Font License 1.1</p>
      <p><b>3D-DARSTELLUNG</b><br><a href="https://threejs.org" target="_blank" rel="noopener">three.js</a>, MIT-Lizenz</p>
      <h3>DATEN</h3>
      <p><b>GEMEINDEGRENZEN, BODENBEDECKUNG, GEBÄUDE</b><br>Amtliche Vermessung, Amt für Tiefbau und Geoinformation, Liechtenstein</p>
      <p><b>HÖHEN LIECHTENSTEIN</b><br>swissALTI3D © swisstopo</p>
      <p><b>HÖHEN SCHWEIZ UND ÖSTERREICH</b><br>Copernicus DEM GLO-30 © DLR e.V. 2010-2014 und © Airbus Defence and Space GmbH 2014-2018, bereitgestellt durch das Copernicus-Programm der EU und ESA</p>
      <p><b>HAUPTSTRASSEN</b><br>© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap-Mitwirkende</a>, ODbL</p>
      <p><b>EINWOHNER UND ARBEITSPLÄTZE</b><br>Bevölkerungs- und Arbeitsplatzdichte (Hektarraster), Amt für Statistik Liechtenstein</p>
      <p><b>HIGHSCORE</b><br>gespeichert bei Supabase</p>
      <h3>DATENSCHUTZ</h3><p>Damit das Spiel fairer wird, speichert es den Verlauf jeder Partie anonym: Land, Truppen, Gold und Spielmeldungen, dazu die Bildschirmgrösse. Keine Namen, keine Konten. Der Highscore speichert nur die drei Buchstaben, die du selbst eingibst.</p></div>
      <div class="trow" style="margin-top:16px"><button class="px-btn" id="pClose">ZURÜCK</button></div>`);
    else if (m === 'tut') this.panel(`<h2>ANLEITUNG</h2>${War.tutSteps().map(s => `<h3>${esc(s.t.toUpperCase())}</h3><p>${s.b}</p>`).join('')}<div class="trow" style="margin-top:16px"><button class="px-btn" id="pClose">ZURÜCK</button></div>`);
  },
  /* ---------- DIE GEMEINDEN: Oberhäupter, Stärken, Schwächen ---------- */
  async gemData() {
    await this.ready; if (!War.map) { try { await War.loadMap(); } catch (e) { return null; } }
    return War.gemStats();
  },
  async gemList() {
    this.panel('<h2>DIE GEMEINDEN</h2><p>LADE...</p><div class="trow"><button class="px-btn" id="pClose">ZURÜCK</button></div>');
    const st = await this.gemData(); if ($('#panel').hidden) return;
    const names = st ? st.map(q => q.name) : Object.keys(GEM_INFO).sort();
    this.panel(`<h2>DIE GEMEINDEN</h2><p class="gsub">Wen willst du anführen? Tippe auf ein Oberhaupt.</p><div class="ggrid">${names.map((n, k) => { const g = GEM_INFO[n]; return `<button class="gcard" data-k="${k}" style="--c:${WAR_COLORS[k + 1]}">${Spr.portraitImg(g.avatar, 2, g.leader)}<span class="gn">${esc(n.toUpperCase())}</span><span class="gl">${esc(g.short)}</span></button>`; }).join('')}</div><div class="trow" style="margin-top:14px"><button class="px-btn" id="pClose">ZURÜCK</button></div>`);
    $('#panel').querySelectorAll('.gcard').forEach(b => b.onclick = () => { Snd.play('tap'); this.gemDetail(+b.dataset.k, st, names); });
  },
  gemDetail(k, st, names) {
    const n = names[k], g = GEM_INFO[n], q = st && st[k], col = WAR_COLORS[k + 1];
    const max = f => Math.max(...st.map(f)), bar = (v, m) => { const b = Math.max(1, Math.round(v / m * 5)); return `<span class="bar">${'<i class="on"></i>'.repeat(b)}${'<i></i>'.repeat(5 - b)}</span>`; };
    const stats = q ? `<h3>DAS SAGEN DIE ZAHLEN</h3><div class="gst">
      <span>TRUPPEN AM START</span>${bar(q.startMax, max(x => x.startMax))}<b>${fmtK(q.startMax)}</b>
      <span>WIRTSCHAFT (GOLD)</span>${bar(q.jobs, max(x => x.jobs))}<b>${fmtK(q.jobs)} JOBS</b>
      <span>EINWOHNER</span>${bar(q.pers, max(x => x.pers))}<b>${fmtK(q.pers)}</b>
      <span>FLÄCHE</span>${bar(q.cells, max(x => x.cells))}<b>${(q.cells * War.map.cell * War.map.cell / 1e6).toFixed(1)} KM²</b>
      <span>GELÄNDE (STEILHEIT)</span>${bar(q.cost, max(x => x.cost))}<b>X${q.cost.toFixed(1)}</b>
      <span>ÜBER 1200 M</span>${bar(q.alp / q.cells, max(x => x.alp / x.cells))}<b>${Math.round(q.alp / q.cells * 100)} %</b>
      <span>PUNKTEFAKTOR</span>${bar(q.factor, 3)}<b>X${q.factor}</b></div>` : '';
    const li = a => `<ul>${a.map(x => `<li>${esc(x)}</li>`).join('')}</ul>`;
    this.panel(`<div class="ghead">${Spr.portraitImg(g.avatar, 5, g.leader)}<div><div class="gn" style="color:${col}">${esc(n.toUpperCase())}</div><h2>${esc(g.leader)}</h2><div class="gt">${esc(g.title)}</div><p class="gq">«${esc(g.quote)}»</p></div></div>
      <h3>CHARAKTER</h3><p>${esc(g.character)}</p>
      <h3>STÄRKEN</h3>${li(g.strengths)}<h3>SCHWÄCHEN</h3>${li(g.weaknesses)}<h3>GEHEIMWAFFE</h3><p>${esc(g.secret)}</p>
      ${stats}<p class="gname">NAMENSPATIN/-PATE: ${esc(g.flur)}</p>
      <div class="trow" style="margin-top:14px"><button class="px-btn red gplay" id="gPlay">MIT ${esc(n.toUpperCase())} SPIELEN</button></div>
      <div class="trow gnav"><button class="px-btn" id="gPrev">&lt;</button><button class="px-btn" id="pClose">LISTE</button><button class="px-btn" id="gNext">&gt;</button></div>`);
    $('#panel').scrollTop = 0;
    $('#pClose').onclick = () => { Snd.play('tap'); this.gemList(); };
    $('#gPrev').onclick = () => { Snd.play('tap'); this.gemDetail((k + names.length - 1) % names.length, st, names); };
    $('#gNext').onclick = () => { Snd.play('tap'); this.gemDetail((k + 1) % names.length, st, names); };
    $('#gPlay').onclick = () => { Snd.play('start'); this.closePanel(); this.newGame(k + 1); };
  },
  panel(html) { const p = $('#panel'); p.innerHTML = html; p.hidden = false; $('#menu').hidden = true; $('#pClose').onclick = () => { Snd.play('tap'); this.closePanel(); }; },
  closePanel() { $('#panel').hidden = true; $('#menu').hidden = false; },
  async newGame(gid) {
    $('#menu').hidden = true; $('#story').textContent = 'LADE LANDESKARTE...';
    await this.ready;
    Snd.stopMusic(); Intro.stop(); $('#intro').hidden = true; $('#story').textContent = '';
    await War.open(); if (gid && War.phase === 'choose') War.startGame(gid);
  },
  toMenu() { $('#modal').hidden = true; $('#intro').hidden = false; Intro.start(); Snd.startMusic(); this.showMenu(); },
  async endScreen(r) {
    const m = $('#modal'); m.hidden = false;
    const head = r.win ? `<h2 class="win">SIEG!<br>${esc(r.gem.toUpperCase())} HERRSCHT</h2>` : r.winner ? `<h2 class="lose">NIEDERLAGE<br>${esc(r.winner.name.toUpperCase())} HERRSCHT</h2>` : `<h2 class="lose">${esc(r.gem.toUpperCase())}<br>IST GEFALLEN</h2>`;
    const body = `<div class="sc"><span>PLATZ</span><b>${r.platz}. VON 11</b><span>LAND</span><b>${r.land} %</b><span>ZEIT</span><b>${r.min} MIN</b><span>EROBERUNGEN</span><b>${r.base.toLocaleString('de-CH')}</b>${r.bonus ? `<span>SIEGBONUS</span><b>${r.bonus.toLocaleString('de-CH')}</b>` : ''}<span>GEMEINDE-FAKTOR</span><b>X${r.factor}</b>${r.level ? `<span>SCHWIERIGKEIT ${r.level.name}</span><b>X${r.level.score}</b>` : ''}<span class="tot">PUNKTE</span><b class="tot">${r.total.toLocaleString('de-CH')}</b></div>`;
    const buttons = `<div class="trow"><button class="px-btn red" id="eAgain">NOCHMAL</button><button class="px-btn" id="eMenu">MENÜ</button>${r.win ? '<button class="px-btn" id="eCont">WEITER</button>' : ''}</div>`;
    m.innerHTML = `<div class="mcard px">${head}${body}<div id="eHs"><p>LADE HIGHSCORE...</p></div>${buttons}</div>`;
    $('#eAgain').onclick = () => { Snd.play('tap'); m.hidden = true; War.choose(); };
    $('#eMenu').onclick = () => { Snd.play('tap'); m.hidden = true; War.exit(); };
    if (r.win) $('#eCont').onclick = () => { Snd.play('tap'); m.hidden = true; War.continueAfterWin(); };
    const list = await HS.list(), box = $('#eHs'); if (!box) return;
    if (!HS.qualifies(list, r.total)) { box.innerHTML = HS.table(list); return; }
    box.innerHTML = `<div class="ini">NEUER HIGHSCORE! NAME <input id="eName" maxlength="3" autocomplete="off" value="${esc(store.get('kampf-name') || '')}"><button class="px-btn" id="eSave">OK</button></div>`;
    const inp = $('#eName'); setTimeout(() => inp.focus(), 50);
    const save = async () => {
      const n = (inp.value || 'AAA').toUpperCase().replace(/[^A-ZÄÖÜ0-9]/g, '').slice(0, 3) || 'AAA'; store.set('kampf-name', n);
      $('#eSave').disabled = true;
      const e = { n, g: r.gem, s: r.total, w: r.win, m: r.min, land: r.land, p: r.platz };
      await HS.add(e); Snd.play('pact');
      const fresh = await HS.list(), mine = fresh.find(x => (e.id && x.id === e.id) || (!e.id && x === e) || (!e.id && x.n === e.n && x.s === e.s)) || null;
      box.innerHTML = HS.table(fresh, mine);
    };
    $('#eSave').onclick = save; inp.onkeydown = ev => { if (ev.key === 'Enter') save(); };
  },
};
addEventListener('DOMContentLoaded', () => Kampf.boot());
