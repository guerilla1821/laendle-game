'use strict';
const snd = n => { if (window.Snd) Snd.play(n); };
/* Kampf um Liechtenstein: Gebietsstrategie nach dem Prinzip von OpenFront, vereinfacht.
   Raster 25 m (aus der Pipeline): Gemeinde, Boden, Höhe. Bevölkerung und Arbeitsplätze aus dem Hektarraster.
   11 Gemeinden, eine davon spielst du, die anderen sind Bots. Wer 70 % des Landes hält, gewinnt. */
// Farben nach der Palette der Retro-Konsole PICO-8
const WAR_COLORS = ['#000', '#ff004d', '#29adff', '#ffec27', '#00e436', '#ff77a8', '#ffa300', '#83769c', '#ffccaa', '#ab5236', '#c2c3c7', '#fff1e8'];
const WAR_BUILD = {
  siedlung: { name: 'Siedlung', cost: 220, eff: '+1500 Truppen-Max.', info: 'Erhöht dein Truppen-Maximum um 1500. Mehr Maximum heisst auch schnelleres Wachstum.' },
  burg: { name: 'Burg', cost: 180, eff: 'Abwehr ×2, 300 m', info: 'Gegner brauchen im Umkreis von 300 m doppelt so viele Truppen pro Feld. Bau sie an die Grenze zu starken Nachbarn.' },
  markt: { name: 'Markt', cost: 260, eff: '+6 Gold/s', info: 'Bringt 6 Gold pro Sekunde zusätzlich.' },
  soeldner: { name: 'Söldner', cost: 400, eff: '+20 % Truppen', info: 'Sofort Truppen in Höhe von 20 % deines Maximums. Du kannst 4 Mal pro Partie anwerben, jede Anwerbung kostet doppelt so viel, danach 60 s Pause.' },
};
// Schwierigkeit: Wachstum der Computergegner, ab welcher Truppenstärke sie angreifen, Schonfrist für dich, wie viele dich gleichzeitig angreifen, Punkte
const WAR_LEVELS = {
  leicht: { name: 'LEICHT', grow: .8, attackAt: .55, grace: 180, maxOnMe: 1, score: .6 },
  normal: { name: 'NORMAL', grow: 1, attackAt: .45, grace: 90, maxOnMe: 2, score: 1 },
  schwer: { name: 'SCHWER', grow: 1.12, attackAt: .38, grace: 30, maxOnMe: 4, score: 1.5 },
};
const COLLAPSE_AFTER = 360, COLLAPSE_MIN = 0.003, PREY_AFTER = 360, PREY_SHARE = 0.02, MERC_MAX = 4, MERC_PAUSE = 60, BOT_MERC_MAX = 2, COLLAPSE_SHARE = 0.01, WIN_SHARE = 0.7, PACT_TIME = 300, TRAITOR_TIME = 30;

const War = {
  level: store.get('kampf-level') || 'normal', inited: false, map: null, phase: 'off', speed: 1, halt: new Set(), score: 0, ratio: .3, build: null, cam: { x: 0, y: 0, s: 1, tilt: 0, yaw: 0 },

  /* ---------- Einstieg ---------- */
  async open() {
    this.init();
    $('#warScreen').hidden = false; this.resize();
    if (!this.map) {
      $('#wMsg').textContent = 'Lade die Landeskarte...'; $('#wMsg').hidden = false;
      try { await this.loadMap(); } catch (e) { console.warn(e); $('#wMsg').innerHTML = `Die Kampfkarte ist noch nicht verfügbar. Sie entsteht beim nächsten Lauf der Geodaten-Pipeline.<br><button class="btn" id="wBack2">Zurück</button>`; $('#wBack2').onclick = () => this.exit(); return; }
    }
    this.choose();
  },
  exit() {
    if (this.phase === 'play' && !this.over) this.upload('abgebrochen');
    this.phase = 'off'; this.halt.clear(); $('#warScreen').hidden = true; $('#wTut').hidden = true; if (this.onExit) this.onExit();
  },
  init() {
    if (this.inited) return; this.inited = true;
    const c = this.cv = $('#wc'); this.ctx = c.getContext('2d');
    addEventListener('resize', () => this.resize());
    const pts = new Map(); let down = null, pinch = null, rdrag = null;
    c.addEventListener('contextmenu', e => e.preventDefault());
    c.addEventListener('pointerdown', e => {
      $('#wTip').hidden = true; c.setPointerCapture(e.pointerId);
      if (e.button === 2) { rdrag = { x: e.clientX, y: e.clientY, t: this.cam.tilt, w: this.cam.yaw }; return; }   // rechte Maustaste: kippen und drehen
      pts.set(e.pointerId, [e.clientX, e.clientY]);
      if (pts.size === 1) down = { x: e.clientX, y: e.clientY, cx: this.cam.x, cy: this.cam.y, moved: false };
      if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), s: this.cam.s, my: (a[1] + b[1]) / 2, an: Math.atan2(b[1] - a[1], b[0] - a[0]), t: this.cam.tilt, w: this.cam.yaw }; down = null; }
    });
    c.addEventListener('pointermove', e => {
      if (rdrag) { this.cam.tilt = clamp(rdrag.t + (rdrag.y - e.clientY) * .006, 0, 1.15); this.cam.yaw = rdrag.w + (e.clientX - rdrag.x) * .006; this.update3D(); return; }
      if (!pts.has(e.pointerId)) { this.hover(e.clientX, e.clientY); return; }
      pts.set(e.pointerId, [e.clientX, e.clientY]);
      if (pinch && pts.size === 2) {
        // zwei Finger: auseinander = zoomen, gemeinsam hoch/runter = kippen, drehen = drehen
        const [a, b] = [...pts.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]), my = (a[1] + b[1]) / 2, an = Math.atan2(b[1] - a[1], b[0] - a[0]);
        this.cam.s = clamp(pinch.s * d / pinch.d, this.minS || .3, 40);
        const dy = pinch.my - my, dz = Math.sign(dy) * Math.max(0, Math.abs(dy) - 24); this.cam.tilt = clamp(pinch.t + dz * .008, 0, 1.15);
        let da = an - pinch.an; if (da > Math.PI) da -= 2 * Math.PI; if (da < -Math.PI) da += 2 * Math.PI;
        this.cam.yaw = pinch.w - (Math.abs(da) > .3 || this.cam.tilt > .05 ? da : 0);
        this.update3D(); return;
      }
      if (down) {
        const dx = e.clientX - down.x, dy = e.clientY - down.y; if (Math.hypot(dx, dy) > 8) down.moved = true;
        if (down.moved) { const cy = Math.cos(this.cam.yaw), sy = Math.sin(this.cam.yaw), s = this.cam.s; this.cam.x = down.cx - (cy * dx + sy * dy) / s; this.cam.y = down.cy - (-sy * dx + cy * dy) / s; this.clampCam(); }
      }
    });
    const up = e => {
      if (rdrag) { rdrag = null; return; }
      if (!pts.has(e.pointerId)) return; pts.delete(e.pointerId); if (pts.size < 2) pinch = null;
      if (down && !down.moved && pts.size === 0) this.tap(e.clientX, e.clientY); if (pts.size === 0) down = null;
    };
    c.addEventListener('pointerup', up); c.addEventListener('pointercancel', up);
    $('#w3d').onclick = () => { snd('tap'); if (this.is3D()) { this.cam.tilt = 0; this.cam.yaw = 0; } else { this.cam.tilt = .85; } this.update3D(); };
    c.addEventListener('wheel', e => { e.preventDefault(); this.zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * .0015)); }, { passive: false });
    $('#wExit').onclick = () => this.exit(); $('#wHelp').onclick = () => { snd('tap'); this.tutorial(0); };
    document.addEventListener('visibilitychange', () => { if (document.hidden && this.phase === 'play') this.upload(this.over ? null : 'laufend'); if (document.hidden) this.halt.add('hidden'); else this.halt.delete('hidden'); });
    $('#wRatio').oninput = e => { this.ratio = e.target.value / 100; $('#wRatioV').textContent = e.target.value + ' %'; };
    document.querySelectorAll('#wBuild button').forEach(b => b.onclick = () => {
      const t = b.dataset.b;
      if (t === 'soeldner') { this.hire(this.me); return; }
      if (this.build === t) { this.build = null; this.updateBuildBtns(); return; }
      if (!this.me || this.me.gold < this.costOf(this.me, t)) { toast(`Zu wenig Gold für ${WAR_BUILD[t].name}: ${fmtK(this.costOf(this.me, t))} nötig.`); return; }
      this.build = t; this.updateBuildBtns(); toast(`${WAR_BUILD[t].name}: Tippe auf dein Gebiet. Nochmal auf den Knopf tippen bricht ab.`);
    });
    let last = performance.now(), acc = 0;
    const loop = t => {
      const dt = Math.min(.25, (t - last) / 1000); last = t;
      if (this.phase === 'play' && !this.halt.size) { acc += dt; let n = 0; while (acc >= .1 && n < 8) { acc -= .1; this.tick(); n++; } if (n >= 8) acc = 0; }
      if (this.phase !== 'off') this.render();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  },
  resize() { if (!this.cv) return; const r = this.cv.getBoundingClientRect(); this.dpr = Math.min(devicePixelRatio || 1, 2); this.W = r.width; this.H = r.height; this.cv.width = r.width * this.dpr; this.cv.height = r.height * this.dpr; if (window.War3D && War3D.ok) War3D.resize(); this.layout(); },
  // Abstände für Rangliste, Meldungen und Anleitung aus der echten Höhe von Kopf- und Fussleiste
  layout() {
    const r = document.documentElement.style, h = $('#wHud'), b = $('#wBottom');
    if (h && !h.hidden) r.setProperty('--th', Math.round(h.getBoundingClientRect().bottom) + 'px');
    if (b && !b.hidden) r.setProperty('--bh', Math.round(innerHeight - b.getBoundingClientRect().top) + 'px');
  },
  is3D() { return this.cam.tilt > .02 || Math.abs(this.cam.yaw) > .02; },
  update3D() {
    if (this.is3D() && !War3D.ok && !War3D.init(this)) { this.cam.tilt = 0; this.cam.yaw = 0; toast('3D wird von diesem Gerät nicht unterstützt.'); }
    const on = this.is3D() && War3D.ok; $('#wc3').hidden = !on; $('#w3d').textContent = on ? '2D' : '3D';
  },
  proj(gx, gy, lift) { return this.is3D() && War3D.ok ? War3D.project(gx, gy, lift) : this.g2s(gx, gy); },

  /* ---------- Karte laden ---------- */
  async loadMap() {
    const meta = Tiles.ok && Tiles.index.files && Tiles.index.files.kampf;
    if (!meta) throw new Error('kein Kampfraster im Index');
    const r = await fetch(CFG.dataBase + meta.path); if (!r.ok) throw new Error(r.status);
    const gunzip = async b => { const hd = new Uint8Array(b, 0, 2); return hd[0] === 0x1f && hd[1] === 0x8b ? await new Response(new Blob([b]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer() : b; };
    const buf = await gunzip(await r.arrayBuffer());
    const { w, h, cell } = meta, N = w * h;
    const M = this.map = { w, h, N, cell, x0: meta.x0, y1: meta.y1, names: meta.gemeinden, gem: new Uint8Array(buf, 0, N), boden: new Uint8Array(buf, N, N), hoehe: new Uint16Array(buf.slice(2 * N, 4 * N)) };
    // Kosten pro Zelle (Gelände), Bevölkerung und Arbeitsplätze pro Zelle
    M.cost = new Float32Array(N); M.pers = new Float32Array(N); M.jobs = new Float32Array(N); M.land = 0;
    const share = (cell * cell) / 10000;
    for (let i = 0; i < N; i++) {
      if (!M.gem[i]) continue; const cls = M.boden[i] & 15;
      if (cls === 4) { M.cost[i] = Infinity; continue; }
      M.land++;
      const hm = M.hoehe[i] || 500;
      let c = hm < 600 ? 1 : hm < 900 ? 1.5 : hm < 1300 ? 2.2 : hm < 1800 ? 3 : 4;
      if (cls === 3) c *= 1.35; else if (cls === 5) c *= 1.2; else if (cls === 1) c *= 1.1;
      if (M.boden[i] & 16) c *= .6;
      M.cost[i] = c;
      if (Density.cells) {
        const X = M.x0 + (i % w + .5) * cell, Y = M.y1 - (Math.floor(i / w) + .5) * cell, d = Density.map.get(Math.floor(X / 100) + ',' + Math.floor(Y / 100));
        if (d) { M.pers[i] = (+d.p || 0) * share; M.jobs[i] = (+d.j || 0) * share; }
      }
    }
    // Umland (Schweiz, Österreich): nur Höhen, als Kulisse ausserhalb des Spielfelds
    if (meta.umland) try {
      const u = meta.umland, ru = await fetch(CFG.dataBase + u.path);
      if (ru.ok) { const ub = await gunzip(await ru.arrayBuffer()); M.um = { w: u.w, h: u.h, cell: u.cell, k: u.cell / cell, gx0: (u.x0 - M.x0) / cell, gy0: (M.y1 - u.y1) / cell, hoehe: new Uint16Array(ub) }; }
    } catch (e) { console.warn('Umland', e); }
    this.buildBase(); this.buildUmland();
    this.relief = window.KAMPF_RELIEF;
    $('#wMsg').hidden = true;
  },
  // Höhe des Umlands an einer Rasterposition (Felder), 0 wenn unbekannt
  umHeight(gx, gy) {
    const U = this.map.um; if (!U) return 0;
    const x = clamp((gx - U.gx0) / U.k - .5, 0, U.w - 1.001), y = clamp((gy - U.gy0) / U.k - .5, 0, U.h - 1.001), i = Math.floor(x), j = Math.floor(y), a = x - i, b = y - j, k = j * U.w + i, H = U.hoehe;
    return (H[k] * (1 - a) + H[k + 1] * a) * (1 - b) + (H[k + U.w] * (1 - a) + H[k + U.w + 1] * a) * b;
  },
  buildUmland() {
    const U = this.map.um; this.umCanvas = null; if (!U) return;
    const cv = document.createElement('canvas'); cv.width = U.w; cv.height = U.h; const g = cv.getContext('2d'), img = g.createImageData(U.w, U.h), d = img.data, H = U.hoehe, w = U.w;
    const hex = h => [1, 3, 5].map(k => parseInt(h.slice(k, k + 2), 16));
    // gedämpfte Töne: das Umland ist nur angedeutet
    const P = [[0, ['#141c16', '#1b261d', '#233025']], [750, ['#0f1712', '#151f18', '#1c281f']], [1650, ['#22221b', '#2b2b23', '#35352c']], [2150, ['#292727', '#343232', '#423f3f']], [2450, ['#3c3c48', '#4e4e5c', '#62627a']]].map(([h, c]) => [h, c.map(hex)]);
    const bayer = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
    for (let i = 0; i < U.w * U.h; i++) {
      const hm = H[i]; if (!hm) continue; const x = i % w, y = (i / w) | 0;
      let pal = P[0][1]; for (const [lim, c] of P) if (hm >= lim) pal = c;
      const hn = H[i - w] || hm, hw = H[i - 1] || hm, hs = H[i + w] || hm, he = H[i + 1] || hm;
      const sh = clamp(((hn - hs) + (hw - he)) / 160, -1, 1), th = (bayer[(y & 3) * 4 + (x & 3)] + .5) / 16;
      let lvl = 1; if (sh > 0) lvl = sh > th ? 2 : 1; else if (sh < 0) lvl = -sh > th ? 0 : 1;
      const c = pal[lvl], f = y & 1 ? .8 : 1;   // jede zweite Zeile dunkler: Schraffur für "ausserhalb"
      d[i * 4] = c[0] * f; d[i * 4 + 1] = c[1] * f; d[i * 4 + 2] = c[2] * f; d[i * 4 + 3] = 255;
    }
    g.putImageData(img, 0, 0); this.umCanvas = cv;
  },
  buildBase() {
    const M = this.map, cv = document.createElement('canvas'); cv.width = M.w; cv.height = M.h;
    const g = cv.getContext('2d'), img = g.createImageData(M.w, M.h), d = img.data, w = M.w;
    const hex = h => [1, 3, 5].map(k => parseInt(h.slice(k, k + 2), 16));
    // je Bodenart drei Töne: Schatten, normal, Licht
    const P = {
      wiese: ['#0f3a22', '#1d5e2e', '#2f7a34'], alp: ['#3b3a1e', '#55522a', '#6f6a38'], wald: ['#06200f', '#0e3418', '#184a22'],
      fels: ['#3a3532', '#5f574f', '#7a7068'], schnee: ['#83769c', '#c2c3c7', '#fff1e8'], ort: ['#2a221e', '#3d322b', '#52443a'],
      haus: ['#7e2553', '#ab5236', '#c8643c'], strasse: ['#5f574f', '#8a7a6a', '#a8988a'], wasser: ['#111d3d', '#1d2b53', '#29adff'],
    };
    for (const k in P) P[k] = P[k].map(hex);
    const bayer = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
    for (let i = 0; i < M.N; i++) {
      if (!M.gem[i]) continue; const cls = M.boden[i] & 15, hm = M.hoehe[i] || 500;
      const pal = cls === 4 ? P.wasser : M.boden[i] & 32 ? P.haus : M.boden[i] & 16 ? P.strasse : cls === 1 ? P.ort : cls === 3 ? P.wald : cls === 5 ? (hm > 2100 ? P.schnee : P.fels) : hm > 1500 ? P.alp : P.wiese;
      // Licht von Nordwesten: Höhenunterschied zu den Nachbarn, gerastert wie auf alten Grafikchips
      const x = i % w, y = (i / w) | 0, hn = M.hoehe[i - w] || hm, hw = M.hoehe[i - 1] || hm, hs = M.hoehe[i + w] || hm, he = M.hoehe[i + 1] || hm;
      const sh = clamp(((hn - hs) + (hw - he)) / 40, -1, 1), th = (bayer[(y & 3) * 4 + (x & 3)] + .5) / 16;
      let lvl = 1; if (sh > 0) lvl = sh > th ? 2 : 1; else if (sh < 0) lvl = -sh > th ? 0 : 1;
      if (cls === 4) lvl = ((x + y * 3) % 7 === 0) ? 2 : 1;
      const c = pal[lvl]; d[i * 4] = c[0]; d[i * 4 + 1] = c[1]; d[i * 4 + 2] = c[2]; d[i * 4 + 3] = 255;
    }
    g.putImageData(img, 0, 0); this.base = cv;
    this.ov = document.createElement('canvas'); this.ov.width = M.w; this.ov.height = M.h; this.ovCtx = this.ov.getContext('2d'); this.ovImg = this.ovCtx.createImageData(M.w, M.h);
  },

  /* ---------- Spielstart ---------- */
  choose() {
    const M = this.map; this.phase = 'choose'; this.owner = new Uint8Array(M.N); this.buildings = []; this.attacks = []; this.feed = [];
    this.players = M.names.map((n, k) => ({ id: k + 1, name: n, color: WAR_COLORS[k + 1], troops: 0, gold: 120, cells: 0, pers: 0, jobs: 0, alive: true, bot: true, nextAi: 0, lx: 0, ly: 0 }));
    this.players.forEach((p, k) => { const b = this.startPoints()[k]; p.start = b; p.lx = b % M.w; p.ly = Math.floor(b / M.w); });
    this.cam.tilt = 0; this.cam.yaw = 0; this.update3D(); this.fit(); this.fullRepaint();
    $('#wHud').hidden = true; $('#wBottom').hidden = true; $('#wBoard').hidden = true; $('#wFeed').innerHTML = ''; $('#wChoose').hidden = false;
    $('#wChoose').innerHTML = `<b>Wähle deine Gemeinde</b><span>Tippe auf die Karte oder hier. Wer wer ist, steht im Menü unter DIE GEMEINDEN.</span><div class="wlvl">${Object.entries(WAR_LEVELS).map(([k, l]) => `<button data-l="${k}" aria-pressed="${(this.level || 'normal') === k}">${l.name}</button>`).join('')}</div><div class="wgems">${this.players.map(p => `<button data-g="${p.id}" style="--c:${p.color}">${window.GEM_INFO && GEM_INFO[p.name] ? Spr.portraitImg(GEM_INFO[p.name].avatar, 1, '') : ''}${esc(p.name)}</button>`).join('')}</div>`;
    $('#wChoose').querySelectorAll('button[data-g]').forEach(b => b.onclick = () => this.startGame(+b.dataset.g));
    $('#wChoose').querySelectorAll('button[data-l]').forEach(b => b.onclick = () => { this.level = b.dataset.l; store.set('kampf-level', this.level); $('#wChoose').querySelectorAll('button[data-l]').forEach(x => x.setAttribute('aria-pressed', x === b)); snd('tap'); });
  },
  // Startpunkt je Gemeinde: dichtester bewohnter Ort (Index je Gemeinde 1..11, Rückgabe nach Gemeinde-Reihenfolge)
  startPoints() {
    const M = this.map; if (this._sp) return this._sp; const n = M.names.length;
    const best = Array.from({ length: n }, () => ({ v: -1, i: -1 })), sum = Array.from({ length: n }, () => [0, 0, 0]);
    for (let i = 0; i < M.N; i++) { const g = M.gem[i]; if (!g || M.cost[i] === Infinity) continue; const v = M.pers[i] * 3 + M.jobs[i] + (M.boden[i] & 32 ? .2 : 0); const s = sum[g - 1]; s[0] += i % M.w; s[1] += Math.floor(i / M.w); s[2]++; if (v > best[g - 1].v) best[g - 1] = { v, i }; }
    return (this._sp = best.map((b, k) => b.i >= 0 ? b.i : Math.round(sum[k][1] / sum[k][2]) * M.w + Math.round(sum[k][0] / sum[k][2])));
  },
  // Kennzahlen je Gemeinde aus den echten Daten (für das Menü DIE GEMEINDEN und den Punktefaktor)
  gemStats() {
    if (this._gs) return this._gs; const M = this.map, n = M.names.length, R = 14, sp = this.startPoints();
    const st = M.names.map((name, k) => ({ id: k + 1, name, cells: 0, pers: 0, jobs: 0, cost: 0, alp: 0, wald: 0, start: { cells: 0, pers: 0, jobs: 0 } }));
    for (let i = 0; i < M.N; i++) { const g = M.gem[i]; if (!g || M.cost[i] === Infinity) continue; const q = st[g - 1]; q.cells++; q.pers += M.pers[i]; q.jobs += M.jobs[i]; q.cost += M.cost[i]; if (M.hoehe[i] > 1200) q.alp++; if ((M.boden[i] & 15) === 3) q.wald++; }
    st.forEach((q, k) => {
      const sx = sp[k] % M.w, sy = Math.floor(sp[k] / M.w);
      for (let y = sy - R; y <= sy + R; y++) for (let x = sx - R; x <= sx + R; x++) { if (x < 0 || y < 0 || x >= M.w || y >= M.h || (x - sx) ** 2 + (y - sy) ** 2 > R * R) continue; const i = y * M.w + x; if (M.gem[i] === q.id && M.cost[i] !== Infinity) { q.start.cells++; q.start.pers += M.pers[i]; q.start.jobs += M.jobs[i]; } }
      q.cost /= Math.max(1, q.cells); q.startMax = Math.round(800 + q.start.cells * 1.5 + q.start.pers * 6 + q.start.jobs * 2);
    });
    const avgT = st.reduce((s, q) => s + q.cost, 0) / n, avgM = st.reduce((s, q) => s + q.startMax, 0) / n;
    st.forEach(q => { q.factor = Math.round(clamp(Math.sqrt(avgM / q.startMax) * (q.cost / avgT), 1, 3) * 10) / 10; });
    return (this._gs = st);
  },
  startGame(gid) {
    const M = this.map; this.me = this.players[gid - 1]; this.me.bot = false;
    this.lvl = WAR_LEVELS[this.level || 'normal']; const gs = this.gemStats(); this.startFloor = this.troopFloor = Math.round(gs.reduce((s, q) => s + q.startMax, 0) / gs.length); this.startCells = 0; this.warnedShrink = 0;
    this.owner.fill(0); this.buildings = []; this.attacks = []; this.feed = []; this.t = 0; this.build = null; this.over = false; this.score = 0; this.firstHit = false; this.pacts = new Map(); this.lastHit = {}; this.refused = {}; this.maxWarned = -999; this.nextOffer = 60;
    const R = 14;
    for (const p of this.players) {
      p.cells = p.pers = p.jobs = 0; p.alive = true; p.gold = 120; p.traitorUntil = 0; p.merc = 0; p.mercT = -1e9; p.peak = 0; p.growth = 0; p.goldRate = 0; p.nextAi = 20 + Math.random() * 20;
      const sx = p.start % M.w, sy = Math.floor(p.start / M.w);
      for (let y = sy - R; y <= sy + R; y++) for (let x = sx - R; x <= sx + R; x++) {
        if (x < 0 || y < 0 || x >= M.w || y >= M.h || (x - sx) ** 2 + (y - sy) ** 2 > R * R) continue;
        const i = y * M.w + x; if (M.gem[i] === p.id && M.cost[i] !== Infinity && !this.owner[i]) this.setOwner(i, p.id, true);
      }
      p.troops = Math.round(this.maxTroops(p) * .35);
    }
    this.startCells = this.me.cells;
    this.phase = 'play'; this.fullRepaint(); this.adjacency(); this.halt.clear();
    $('#wChoose').hidden = true; $('#wHud').hidden = false; $('#wBottom').hidden = false; $('#wBoard').hidden = false; this.updateBuildBtns();
    this.cam.x = this.me.lx; this.cam.y = this.me.ly; this.cam.s = Math.max(this.cam.s, Math.min(this.W, this.H) / 140); this.clampCam();
    this.log(`Du führst ${this.me.name}. Tippe auf neutrales Land, um dich auszubreiten.`);
    // Faktor: schwache Startgemeinden (wenig Truppen, steiles Gelände) geben mehr Punkte
    this.factor = this.gemStats()[gid - 1].factor;
    this.trace = { v: 1, session: (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2) + Date.now()), gemeinde: this.me.name, level: this.level || 'normal',
      geraet: `${innerWidth}x${innerHeight}${matchMedia('(pointer:coarse)').matches ? ' touch' : ''}`, start: new Date().toISOString(),
      spalten: 't, felder, truppen, max, gold, wachstum, angriffe_auf_mich, eigene_angriffe, gebaeude, top5 [id, felder, truppen]', snaps: [], ev: [] };
    this.labels(); this.updateHud(); this.layout(); snd('start');
    if (!store.get('laendle-kampf-tut')) this.tutorial(0);
  },

  // Kurzname des Oberhaupts für Meldungen
  boss(p) { const g = window.GEM_INFO && GEM_INFO[p.name]; return g ? `${g.short} (${p.name})` : p.name; },
  /* ---------- Regeln ---------- */
  maxTroops(p) { return Math.round(Math.max(this.troopFloor || 0, 800 + p.cells * 1.5 + p.pers * 6 + p.jobs * 2) + 1500 * Math.pow(this.count(p, 'siedlung'), .7)); },
  count(p, type) { let n = 0; for (const b of this.buildings) if (b.owner === p.id && b.type === type) n++; return n; },
  costOf(p, type) { if (type === 'soeldner') return Math.round(WAR_BUILD.soeldner.cost * Math.pow(2, p.merc || 0)); let n = 0; for (const b of this.buildings) if (b.by === p.id && b.type === type) n++; return Math.round(WAR_BUILD[type].cost * Math.pow(1.5, n)); },
  setOwner(i, pid, silent) {
    const M = this.map, old = this.owner[i];
    if (old) { const q = this.players[old - 1]; q.cells--; q.pers -= M.pers[i]; q.jobs -= M.jobs[i]; }
    this.owner[i] = pid;
    if (pid) { const p = this.players[pid - 1]; p.cells++; p.pers += M.pers[i]; p.jobs += M.jobs[i]; }
    if (!silent && this.me) { if (pid === this.me.id) { this.score += old ? 3 : 1; this.conq = (this.conq || 0) + 1; } else if (old === this.me.id) this.lost = (this.lost || 0) + 1; }
    for (const b of this.buildings) if (b.i === i && b.owner !== pid) { b.owner = pid; if (!silent && pid === this.me.id) this.log(`${WAR_BUILD[b.type].name} erobert!`); }
    if (!silent) { this.paint(i); const w = M.w; this.paint(i - 1); this.paint(i + 1); this.paint(i - w); this.paint(i + w); }
  },
  defense(i, pid) {
    let f = 1;
    for (const b of this.buildings) if (b.type === 'burg' && b.owner === pid) { const M = this.map, dx = b.i % M.w - i % M.w, dy = Math.floor(b.i / M.w) - Math.floor(i / M.w); if (dx * dx + dy * dy < 144) { f = 2; break; } }
    return f;
  },
  neighbors(i) { const M = this.map, x = i % M.w, out = []; if (x > 0) out.push(i - 1); if (x < M.w - 1) out.push(i + 1); if (i >= M.w) out.push(i - M.w); if (i < M.N - M.w) out.push(i + M.w); return out; },
  passable(i) { return this.map.gem[i] && this.map.cost[i] !== Infinity; },
  // Angriff: von pid auf Besitzer target (0 = neutrales Land), Zielpunkt für die Stossrichtung
  attack(pid, target, troops, tx, ty) {
    const p = this.players[pid - 1]; troops = Math.min(Math.floor(troops), p.troops); if (troops < 10 || target === pid) return false;
    if (target && this.allied(pid, target)) return false;
    if (target) this.lastHit[pid + '-' + target] = this.t;
    let a = this.attacks.find(a => a.att === pid && a.def === target);
    if (!a) {
      const M = this.map, cand = [], inSet = new Uint8Array(M.N);
      for (let i = 0; i < M.N; i++) {
        if (this.owner[i] !== target || !this.passable(i)) continue;
        for (const n of this.neighbors(i)) if (this.owner[n] === pid) { cand.push(i); inSet[i] = 1; break; }
      }
      if (!cand.length) return false;
      a = { att: pid, def: target, troops: 0, cand, inSet, tx, ty };
      this.attacks.push(a);
      if (target && this.players[target - 1] === this.me) { this.log(`${this.boss(p)} greift dich an!`, 'bad'); snd('alarm'); if (!this.firstHit) { this.firstHit = true; this.banner('ANGRIFF!', '#ff004d'); } }
    }
    a.tx = tx; a.ty = ty; a.troops += troops; p.troops -= troops;
    return true;
  },
  stepAttack(a) {
    const M = this.map, att = this.players[a.att - 1], def = a.def ? this.players[a.def - 1] : null;
    if (!att.alive) return false;
    let budget = 2 + Math.sqrt(a.troops) / 7;
    while (budget > 0 && a.troops > 0 && a.cand.length) {
      // aus einer Stichprobe den besten Kandidaten nehmen: viele eigene Nachbarn, nahe am Zielpunkt
      let bestK = -1, bestS = -1e9, bestI = -1;
      for (let s = 0; s < 10; s++) {
        const k = Math.floor(Math.random() * a.cand.length), i = a.cand[k];
        if (this.owner[i] !== a.def) { a.cand[k] = a.cand[a.cand.length - 1]; a.cand.pop(); a.inSet[i] = 0; if (!a.cand.length) break; continue; }
        let own = 0; for (const n of this.neighbors(i)) if (this.owner[n] === a.att) own++;
        if (!own) continue;
        const dx = i % M.w - a.tx, dy = Math.floor(i / M.w) - a.ty, sc = own * 3 - Math.sqrt(dx * dx + dy * dy) / 12 + Math.random() * 2;
        if (sc > bestS) { bestS = sc; bestK = k; bestI = i; }
      }
      if (bestK < 0 || bestK >= a.cand.length || a.cand[bestK] !== bestI) { budget -= .5; if (!a.cand.length) break; continue; }
      const i = a.cand[bestK];
      // Heimat zuerst: freies Land der eigenen Gemeinde ist billig, fremdes teurer
      let c = M.cost[i] * 1.6 * (M.gem[i] === a.att ? .5 : 1.6), dens = 0;
      if (def) { dens = Math.min(10, def.troops / Math.max(1, def.cells)); c = M.cost[i] * (2.5 + dens * 1.1) * this.defense(i, def.id) * (def.traitorUntil > this.t ? .6 : 1) * (M.gem[i] === def.id ? 1.6 : 1); }
      if (a.troops < c) { a.troops = 0; break; }
      a.troops -= c; budget -= M.cost[i];
      // Verteidiger verliert die Truppen, die auf dem Feld standen (höchstens wie bisher): dünn besetztes Land blutet nicht aus
      if (def) def.troops = Math.max(0, def.troops - Math.min(c * .55, dens * 1.1));
      a.cand[bestK] = a.cand[a.cand.length - 1]; a.cand.pop(); a.inSet[i] = 0;
      this.setOwner(i, a.att);
      for (const n of this.neighbors(i)) if (this.owner[n] === a.def && !a.inSet[n] && this.passable(n)) { a.cand.push(n); a.inSet[n] = 1; }
      if (def && def.cells <= 0) { this.eliminate(def, att); break; }
    }
    if (a.troops <= 0 || !a.cand.length) { att.troops += Math.max(0, a.troops); return false; }
    return true;
  },
  // Zusammenbruch: das Restland geht an den stärksten Angreifer, sonst an den grössten Nachbarn
  collapse(p) {
    const A = this.adj, M = this.map, al = this.players.filter(q => q.alive && q !== p); if (!al.length) return;
    let by = null, best = -1;
    for (const a of this.attacks) if (a.def === p.id && a.troops > best) { best = a.troops; by = this.players[a.att - 1]; }
    if (!by || !by.alive) { best = -1; for (const q of al) { const n = A && A[p.id] ? A[p.id][q.id] : 0; const sc = n ? q.cells + 1e9 : q.cells; if (sc > best) { best = sc; by = q; } } }
    this.log(`${p.name} bricht zusammen.`, p === this.me ? 'bad' : '');
    if (p === this.me) this.banner('ZUSAMMENBRUCH', '#ff004d');
    for (let i = 0; i < M.N; i++) if (this.owner[i] === p.id) this.setOwner(i, by.id, true);
    this.fullRepaint();
    this.attacks = this.attacks.filter(a => a.def !== p.id);
    this.eliminate(p, by);
  },
  eliminate(p, by) {
    p.alive = false; p.troops = 0; this.attacks = this.attacks.filter(a => a.att !== p.id);
    for (const b of this.buildings) if (b.owner === p.id) b.owner = by.id;
    by.gold += Math.round(p.gold); p.gold = 0; if (by === this.me) { this.score += 5000; snd('fanfare'); }
    this.log(`${p.name} wurde von ${by.name} erobert.`, p === this.me ? 'bad' : by === this.me ? 'good' : '');
    if (p === this.me && !this.over) this.end(false);
  },
  tick() {
    this.t += .1; const M = this.map;
    for (const p of this.players) {
      if (!p.alive) continue;
      const max = this.maxTroops(p), T = p.troops;
      p.growth = (max * .006 + T * .06) * Math.max(0, 1 - T / max) * (p.bot ? this.lvl.grow : 1);
      p.troops = T > max ? T - (T - max) * .02 : Math.min(max, T + p.growth * .1);
      p.goldRate = 4 + p.jobs * .012 + p.cells * .0015 + this.count(p, 'markt') * 6;
      p.gold += p.goldRate * .1;
    }
    this.attacks = this.attacks.filter(a => this.stepAttack(a));
    if (Math.floor(this.t * 10) % 4 === 0) { if (this.conq) snd('tick'); if (this.lost > 3) snd('hit'); this.conq = 0; this.lost = 0; }
    if (Math.floor(this.t * 10) % 20 === 0) {
      this.adjacency();
      // Aufholhilfe: Niemand fällt unter die Hälfte der durchschnittlichen Truppenstärke (Grundwert ohne Siedlungen)
      const al = this.players.filter(p => p.alive), raw = p => 800 + p.cells * 1.5 + p.pers * 6 + p.jobs * 2;
      this.troopFloor = Math.max(this.startFloor || 0, Math.round(.5 * al.reduce((s, p) => s + raw(p), 0) / Math.max(1, al.length)));
      // Kleinstreste nicht künstlich weiterspielen: ab Minute 6 bricht zusammen, wer unter 1 % fällt; jederzeit, wer nach dem Start unter 0,3 % schrumpft
      for (const p of al) { const sh = p.cells / M.land; p.peak = Math.max(p.peak || 0, sh); if (!this.over && ((this.t > COLLAPSE_AFTER && sh < COLLAPSE_SHARE) || (p.peak >= .01 && sh < COLLAPSE_MIN))) this.collapse(p); }
    }
    for (const p of this.players) if (p.bot && p.alive && this.t >= p.nextAi) { this.botThink(p); p.nextAi = this.t + 1.2 + Math.random() * 2.2; }
    if (Math.floor(this.t * 10) % 10 === 0) { this.labels(); this.updateHud(); this.pactTick(); }
    if (this.trace && Math.floor(this.t * 10) % 150 === 0) { const me = this.me;
      this.trace.snaps.push([Math.round(this.t), me.cells, Math.round(me.troops), this.maxTroops(me), Math.round(me.gold), Math.round(me.growth || 0), this.attacks.filter(a => a.def === me.id).length, this.attacks.filter(a => a.att === me.id).length, this.buildings.filter(b => b.owner === me.id).length,
        this.players.filter(p => p.alive).sort((a, b) => b.cells - a.cells).slice(0, 5).map(p => [p.id, p.cells, Math.round(p.troops)])]);
      if (this.trace.snaps.length % 8 === 0) this.upload('laufend'); }
    if (!this.over && this.me.cells / M.land >= WIN_SHARE) this.end(true);
    if (!this.over) for (const p of this.players) if (p.bot && p.alive && p.cells / M.land >= WIN_SHARE) { this.end(false, p); break; }
    if (!this.over && this.me.alive && this.t > 30) {
      const left = this.me.cells / Math.max(1, this.startCells);
      if (this.me.cells < Math.max(25, this.startCells * .08)) { this.banner('ERLEDIGT', '#ff004d'); this.end(false); }
      else if (left < .35 && this.warnedShrink < 2) { this.warnedShrink = 2; this.banner('LETZTE BASTION!', '#ff004d'); }
      else if (left < .7 && this.warnedShrink < 1) { this.warnedShrink = 1; this.banner('DEIN LAND SCHRUMPFT', '#ffa300'); }
    }
  },
  // gemeinsame Grenzen zählen (wer grenzt an wen, wie lang)
  adjacency() {
    const M = this.map, n = this.players.length + 1, A = this.adj = Array.from({ length: n }, () => new Int32Array(n)), o = this.owner;
    for (let i = 0; i < M.N; i++) {
      if (!this.passable(i)) continue; const a = o[i];
      if (i % M.w < M.w - 1 && this.passable(i + 1) && o[i + 1] !== a) { A[a][o[i + 1]]++; A[o[i + 1]][a]++; }
      if (i < M.N - M.w && this.passable(i + M.w) && o[i + M.w] !== a) { A[a][o[i + M.w]]++; A[o[i + M.w]][a]++; }
    }
  },
  labels() {
    const M = this.map, s = this.players.map(() => [0, 0, 0]);
    for (let i = 0; i < M.N; i += 3) { const o = this.owner[i]; if (o) { const q = s[o - 1]; q[0] += i % M.w; q[1] += Math.floor(i / M.w); q[2]++; } }
    this.players.forEach((p, k) => { if (s[k][2]) { const x = Math.round(s[k][0] / s[k][2]), y = Math.round(s[k][1] / s[k][2]); if (this.owner[y * M.w + x] === p.id || !this.owner[p.ly * M.w + p.lx] || this.owner[p.ly * M.w + p.lx] !== p.id) { p.lx = x; p.ly = y; } } });
  },
  botThink(p) {
    const A = this.adj; if (!A) return;
    const max = this.maxTroops(p);
    // in der Not Söldner anwerben
    if (p.troops < max * .15 && (p.merc || 0) < BOT_MERC_MAX && p.gold >= this.costOf(p, 'soeldner') * 1.2) this.hire(p);
    // bauen
    const types = ['siedlung', 'markt', 'burg'], type = Math.random() < .5 ? 'siedlung' : Math.random() < .6 ? 'markt' : 'burg', cost = this.costOf(p, type);
    if (p.gold >= cost * 1.5 && this.buildings.filter(b => b.by === p.id).length < 1 + p.cells / 4000) { const i = this.randomOwnCell(p, type === 'burg'); if (i >= 0) this.place(p, type, i); }
    if (this.attacks.filter(a => a.att === p.id).length >= 2) return;
    // Kleine Nachbarn (weniger als ein Viertel der eigenen Fläche, unter 2 %) werden ab Minute 6 bevorzugt und früher angegriffen
    let prey = null;
    if (this.t > PREY_AFTER) for (const q of this.players) {
      if (!q.alive || q === p || !A[p.id][q.id] || this.allied(p.id, q.id) || q.cells > p.cells * .25 || q.cells / this.map.land > PREY_SHARE) continue;
      if (q === this.me && this.shielded(p)) continue;
      if (!prey || q.cells < prey.cells) prey = q;
    }
    if (prey && p.troops >= max * this.lvl.attackAt * .6 && p.troops > prey.troops * 1.2) { this.attack(p.id, prey.id, p.troops * .5, prey.lx, prey.ly); return; }
    if (p.troops < max * this.lvl.attackAt) return;
    const neutral = A[p.id][0];
    let target = -1;
    if (neutral > 0 && (Math.random() < .8 || this.t < 60)) target = 0;
    else {
      let best = 1e9;
      for (const q of this.players) {
        if (!q.alive || q === p || !A[p.id][q.id] || this.allied(p.id, q.id)) continue;
        if (q === this.me && (this.t < this.lvl.grace || this.shielded(p))) continue;
        const dens = q.troops / Math.max(1, q.cells), mine = p.troops / Math.max(1, p.cells), score = dens / mine;
        if (score < best) { best = score; target = q.id; }
      }
      if (target < 0 && neutral > 0) target = 0;
      if (target > 0 && best > 1.4 && neutral > 0) target = 0;
      if (target > 0 && best > 2.2) return;
    }
    if (target < 0) return;
    const tq = target ? this.players[target - 1] : null;
    const tx = tq ? tq.lx : p.lx + (Math.random() - .5) * 200, ty = tq ? tq.ly : p.ly + (Math.random() - .5) * 200;
    this.attack(p.id, target, p.troops * (target ? .35 : .25), tx, ty);
  },
  // Schutz des Spielers vor zu vielen gleichzeitigen Angreifern. Zählt nur ernsthafte Angriffe (mind. 3 % des Truppen-Maximums
  // des Angreifers), und wer das meiste Land hat, ist nie geschützt: der Führende soll gejagt werden.
  shielded(p) {
    const me = this.me; if (!me || !me.alive) return false;
    if (this.players.every(q => !q.alive || q === me || q.cells <= me.cells)) return false;
    const n = this.attacks.filter(a => a.def === me.id && a.att !== p.id && a.troops >= this.maxTroops(this.players[a.att - 1]) * .03).length;
    return n >= this.lvl.maxOnMe;
  },
  randomOwnCell(p, border) {
    const M = this.map;
    for (let t = 0; t < 4000; t++) {
      const i = Math.floor(Math.random() * M.N); if (this.owner[i] !== p.id) continue;
      if (this.buildings.some(b => Math.abs(b.i % M.w - i % M.w) + Math.abs(Math.floor(b.i / M.w) - Math.floor(i / M.w)) < 10)) continue;
      if (border && !this.neighbors(i).some(n => this.owner[n] !== p.id && this.passable(n))) { if (t < 3500) continue; }
      return i;
    }
    return -1;
  },
  // Söldner: Gold sofort in Truppen umwandeln (bis zum Maximum)
  hire(p) {
    if (!p || !p.alive || this.over) return false;
    const cost = this.costOf(p, 'soeldner'), max = this.maxTroops(p), add = Math.min(Math.round(max * .2), Math.round(max - p.troops));
    if ((p.merc || 0) >= MERC_MAX) { if (p === this.me) toast(`Du hast alle ${MERC_MAX} Anwerbungen dieser Partie genutzt.`); return false; }
    if (this.t - (p.mercT || -1e9) < MERC_PAUSE) { if (p === this.me) toast(`Söldner erst in ${Math.ceil(MERC_PAUSE - (this.t - p.mercT))} s wieder.`); return false; }
    if (p.gold < cost) { if (p === this.me) toast(`Zu wenig Gold für Söldner: ${fmtK(cost)} nötig.`); return false; }
    if (add < max * .05) { if (p === this.me) toast('Deine Truppen sind fast voll. Söldner lohnen sich erst, wenn Truppen fehlen.'); return false; }
    p.gold -= cost; p.troops += add; p.merc = (p.merc || 0) + 1; p.mercT = this.t;
    if (p === this.me) { this.log(`Söldner angeworben: +${fmtK(add)} Truppen.`, 'good'); snd('build'); this.updateHud(); }
    return true;
  },
  place(p, type, i) {
    const cost = this.costOf(p, type); if (p.gold < cost || this.owner[i] !== p.id) return false;
    const M = this.map;
    if (this.buildings.some(b => Math.abs(b.i % M.w - i % M.w) + Math.abs(Math.floor(b.i / M.w) - Math.floor(i / M.w)) < 6)) { if (p === this.me) toast('Zu nah an einem anderen Gebäude.'); return false; }
    p.gold -= cost; this.buildings.push({ type, owner: p.id, by: p.id, i });
    if (p === this.me) { this.log(`${WAR_BUILD[type].name} gebaut.`); this.score += 50; snd('build'); }
    return true;
  },
  end(win, winner) {
    this.over = true; this.halt.add('end');
    const land = Math.round(this.me.cells / this.map.land * 100), min = Math.max(1, Math.round(this.t / 60));
    const bonus = win ? 50000 + Math.max(0, Math.round((1500 - this.t) * 40)) : 0, total = Math.round((this.score + bonus) * this.factor * this.lvl.score);
    snd(win ? 'win' : 'lose'); this.upload(win ? 'sieg' : winner ? 'niederlage:' + winner.name : 'erobert', total);
    if (this.onEnd) this.onEnd({ win, winner, land, min, base: this.score, bonus, factor: this.factor, level: this.lvl, total, gem: this.me.name, color: this.me.color });
  },
  continueAfterWin() { this.halt.delete('end'); },
  // Spielverlauf anonym an Supabase senden (Tabelle kampf_protokoll), damit sich die Balance auswerten lässt
  upload(result, total) {
    try {
      const T = this.trace; if (!T || typeof HS === 'undefined' || !HS.remote) return;
      if (result) T.result = result; if (total != null) T.punkte = total; T.minuten = Math.round(this.t / 60); T.land = Math.round(this.me.cells / this.map.land * 1000) / 10;
      fetch(`${CFG.supabaseUrl}/rest/v1/kampf_protokoll`, { method: 'POST', keepalive: true, headers: HS.headers({ Prefer: 'return=minimal' }),
        body: JSON.stringify({ session: T.session, gemeinde: T.gemeinde, level: T.level, result: T.result || 'laufend', minutes: Math.min(600, T.minuten), data: T }) }).catch(() => { });
    } catch (e) { }
  },
  banner(text, col) {
    const el = $('#wBanner'); if (!el) return; el.textContent = text; el.style.color = col || '#ffec27'; el.hidden = false; el.classList.remove('go'); void el.offsetWidth; el.classList.add('go');
    clearTimeout(this._bt); this._bt = setTimeout(() => { el.hidden = true; }, 2600);
  },
  log(msg, cls) {
    if (this.trace && this.trace.ev.length < 1500) this.trace.ev.push([Math.round(this.t), msg]);
    const el = $('#wFeed'); if (!el) return; const d = document.createElement('div'); d.textContent = msg; if (cls) d.className = cls; el.prepend(d);
    while (el.children.length > 4) el.lastChild.remove(); setTimeout(() => d.classList.add('old'), 6000);
  },

  /* ---------- Eingabe ---------- */
  s2g(sx, sy) { return [(sx - this.W / 2) / this.cam.s + this.cam.x, (sy - this.H / 2) / this.cam.s + this.cam.y]; },
  g2s(gx, gy) { return [(gx - this.cam.x) * this.cam.s + this.W / 2, (gy - this.cam.y) * this.cam.s + this.H / 2]; },
  cellAt(sx, sy) { if (this.is3D() && War3D.ok) { const r = this.cv.getBoundingClientRect(); return War3D.pick(sx - r.left, sy - r.top); } const r = this.cv.getBoundingClientRect(), [gx, gy] = this.s2g(sx - r.left, sy - r.top), x = Math.floor(gx), y = Math.floor(gy), M = this.map; if (x < 0 || y < 0 || x >= M.w || y >= M.h) return -1; return y * M.w + x; },
  tap(sx, sy) {
    const i = this.cellAt(sx, sy), M = this.map; if (i < 0 || !M.gem[i]) return;
    if (this.phase === 'choose') { this.startGame(M.gem[i]); return; }
    if (this.phase !== 'play' || this.halt.has('end')) return;
    if (!this.passable(i)) { toast('Wasser kann man nicht erobern.'); return; }
    const o = this.owner[i], me = this.me;
    if (this.build) {
      const t = this.build; this.build = null; this.updateBuildBtns();
      if (o !== me.id) { toast('Bauen geht nur auf deinem Gebiet. Bauen abgebrochen.'); return; }
      if (me.gold < this.costOf(me, t)) { toast('Zu wenig Gold. Bauen abgebrochen.'); return; }
      this.place(me, t, i); return;
    }
    if (o === me.id) { toast('Das ist dein Gebiet. Tippe auf neutrales Land oder einen Nachbarn.'); return; }
    if (o && this.allied(me.id, o)) { toast(`${this.players[o - 1].name} ist mit dir verbündet. Bündnis zuerst in der Rangliste brechen.`); return; }
    const ok = this.attack(me.id, o, me.troops * this.ratio, i % M.w, Math.floor(i / M.w)); if (ok) snd(o ? 'charge' : 'tap');
    if (!ok) toast(me.troops * this.ratio < 10 ? 'Zu wenig Truppen.' : 'Keine gemeinsame Grenze.');
    else if (o) this.log(`Angriff auf ${this.players[o - 1].name} mit ${fmtK(Math.floor(me.troops / (1 - this.ratio) * this.ratio))} Truppen.`);
    this.updateHud();
  },
  hover(sx, sy) {
    if (!this.map) return; const i = this.cellAt(sx, sy), tip = $('#wTip');
    if (i < 0 || !this.map.gem[i] || this.phase === 'off') { tip.hidden = true; return; }
    const M = this.map, o = this.owner[i], q = o ? this.players[o - 1] : null, c = M.cost[i];
    const terr = c === Infinity ? 'WASSER' : c < 1.3 ? 'LEICHT' : c < 2 ? 'MITTEL' : c < 3 ? 'SCHWER' : 'SEHR SCHWER';
    const lines = [q ? `<b style="color:${q.color}">${esc(q.name.toUpperCase())}</b>${q === this.me ? ' (DU)' : this.me && this.allied(q.id, this.me.id) ? ' (VERBÜNDET)' : ''}` : '<b>FREIES LAND</b>'];
    if (q && q !== this.me) lines.push(`TRUPPEN ${fmtK(q.troops)}`);
    if (c !== Infinity) lines.push(`EROBERN: ${terr}${q && q !== this.me && M.gem[i] === q.id ? ', HEIMVORTEIL' : ''}${q && this.defense(i, q.id) > 1 ? ', BURG' : ''}`); else lines.push('NICHT EROBERBAR');
    tip.hidden = false; tip.style.left = sx + 14 + 'px'; tip.style.top = sy + 14 + 'px'; tip.innerHTML = lines.join('<br>');
  },
  zoomAt(sx, sy, f) {
    if (this.is3D()) { this.cam.s = clamp(this.cam.s * f, this.minS || .3, 40); return; }
    const r = this.cv.getBoundingClientRect(), [gx, gy] = this.s2g(sx - r.left, sy - r.top);
    this.cam.s = clamp(this.cam.s * f, this.minS || .3, 40); this.cam.x = gx - (sx - r.left - this.W / 2) / this.cam.s; this.cam.y = gy - (sy - r.top - this.H / 2) / this.cam.s; this.clampCam();
  },
  fit() { const M = this.map, top = 64, bot = this.W < 700 ? 150 : 100; this.minS = Math.min(this.W / M.w, (this.H - top - bot) / M.h) * .95; this.cam.s = this.minS; this.cam.x = M.w / 2; this.cam.y = M.h / 2 + (bot - top) / 2 / this.cam.s; },
  clampCam() { const M = this.map; this.cam.x = clamp(this.cam.x, 0, M.w); this.cam.y = clamp(this.cam.y, 0, M.h); },
  updateBuildBtns() {
    document.querySelectorAll('#wBuild button').forEach(b => { const t = b.dataset.b, c = this.me ? this.costOf(this.me, t) : WAR_BUILD[t].cost; b.querySelector('small').textContent = fmtK(c) + ' Gold'; b.querySelector('em').textContent = WAR_BUILD[t].eff; b.setAttribute('aria-pressed', this.build === t); b.classList.toggle('poor', !this.me || this.me.gold < c);
      if (t === 'soeldner') { const left = Math.max(0, MERC_MAX - (this.me ? this.me.merc || 0 : 0)); b.dataset.left = left + '×'; b.title = `Söldner: sofort +20 % Truppen für Gold. Noch ${left} von ${MERC_MAX} Anwerbungen.`; if (!left) { b.querySelector('small').textContent = 'GENUTZT'; b.classList.add('poor'); } } });
    if (this.build && this.me && this.me.gold < this.costOf(this.me, this.build)) { this.build = null; document.querySelectorAll('#wBuild button').forEach(b => b.setAttribute('aria-pressed', false)); }
  },
  updateHud() {
    if (!this.me) return; const me = this.me, M = this.map, max = this.maxTroops(me), full = me.troops >= max * .97;
    $('#wName').textContent = me.name; $('#wName').style.color = me.color;
    $("#wTroops").textContent = `${fmtK(me.troops)}/${fmtK(max)}`;
    const gr = (max * .006 + me.troops * .06) * Math.max(0, 1 - me.troops / max); const drained = me.troops < max * .05 && this.attacks.some(a => a.def === me.id); $('#wGrow').textContent = drained ? 'ABWEHR!' : full ? 'Maximum' : `+${fmtK(gr)}/s`; $('#wGrow').classList.toggle('full', full || drained);
    if (full && me.alive && this.t - this.maxWarned > 90) { this.maxWarned = this.t; this.log('Truppen am Maximum: Es wachsen keine neuen nach. Greif an, erobere Land oder baue Siedlungen.', 'warn'); }
    $('#wGold').textContent = fmtK(me.gold); $('#wGoldR').textContent = `+${(me.goldRate || 0).toFixed(1)}/s`;
    $('#wLand').textContent = (me.cells / M.land * 100).toFixed(1) + ' %'; $('#wScore').textContent = Math.round(this.score * (this.factor || 1) * (this.lvl ? this.lvl.score : 1)).toLocaleString('de-CH');
    const att = this.attacks.filter(a => a.att === me.id).reduce((s, a) => s + a.troops, 0); $('#wAtt').textContent = att ? `${fmtK(att)} im Angriff` : '';
    this.renderBoard(); this.updateBuildBtns();
  },
  renderBoard() {
    const me = this.me, M = this.map, all = this.players.slice().sort((a, b) => (b.alive - a.alive) || b.cells - a.cells);
    const rank = all.indexOf(me), open = this.boardOpen;
    let rows = open ? all : all.filter(p => p.alive).slice(0, 3); if (!open && !rows.includes(me)) rows = rows.concat([me]);
    const row = p => {
      const k = all.indexOf(p), pact = this.pacts.get(this.pk(me.id, p.id)), left = pact ? Math.max(0, Math.round(pact.until - this.t)) : 0;
      const act = !open ? '' : p === me || !p.alive ? `<button class="ph" tabindex="-1" aria-hidden="true">${Spr.img('pakt', 1)}</button>` : pact ? `<button data-a="break" data-p="${p.id}" title="Bündnis brechen (du giltst ${TRAITOR_TIME} s als Verräter)">${Spr.img('bruch', 1)}</button>` : this.refused[p.id] > this.t ? `<button disabled title="Abgelehnt, bald wieder möglich">${Spr.img('pakt', 1)}</button>` : `<button data-a="offer" data-p="${p.id}" title="Bündnis anbieten">${Spr.img('pakt', 1)}</button>`;
      return `<div class="${p === me ? 'me' : ''}${p.alive ? '' : ' dead'}" data-f="${p.id}"><i style="background:${p.color}"></i><em>${k + 1}.</em> ${esc(p.name)}${pact ? ` <small class="pact" title="Bündnis, noch ${left} s">${Spr.img('pakt', 1)}${Math.ceil(left / 60)}M</small>` : ''}${p.traitorUntil > this.t ? ` ${Spr.img('warn', 1, 'Verräter')}` : ''}<span>${p.alive ? (p.cells / M.land * 100).toFixed(1) + ' %' : 'erobert'}</span>${open ? `<span class="tr">${p.alive ? fmtK(p.troops) : ''}</span>` : ''}${act}</div>`;
    };
    const html = rows.map(row).join('') + `<button class="more" data-a="toggle">${open ? 'WENIGER' : `ALLE ${all.length} GEMEINDEN`}</button><div class="goal">ZIEL: ${WIN_SHARE * 100} %</div>`;
    const el = $('#wBoard'); el.classList.toggle('open', !!open); if (el._html === html) return; el._html = html; el.innerHTML = html;
    el.querySelectorAll('[data-a]').forEach(b => b.onclick = e => { e.stopPropagation(); const a = b.dataset.a, q = this.players[(+b.dataset.p || 1) - 1];
      if (a === 'toggle') this.boardOpen = !this.boardOpen; else if (a === 'offer') this.offer(me, q); else if (a === 'break') this.breakPact(me, q, true);
      el._html = null; this.renderBoard(); });
    el.querySelectorAll('[data-f]').forEach(d => d.onclick = () => { const q = this.players[+d.dataset.f - 1]; if (q.alive) { this.cam.x = q.lx; this.cam.y = q.ly; this.clampCam(); } });
  },

  /* ---------- Bündnisse ---------- */
  pk(a, b) { return a < b ? a + '-' + b : b + '-' + a; },
  allied(a, b) { const p = this.pacts && this.pacts.get(this.pk(a, b)); return !!p && p.until > this.t; },
  leader() { return this.players.filter(p => p.alive).sort((a, b) => b.cells - a.cells)[0]; },
  // Bereitschaft eines Bots, mit q ein Bündnis zu schliessen (0..1)
  willing(bot, q) {
    if (!bot.alive || !q.alive || q.traitorUntil > this.t) return 0;
    const hit = Math.max(this.lastHit[q.id + '-' + bot.id] || -999, this.lastHit[bot.id + '-' + q.id] || -999);
    if (this.t - hit < 45) return 0;
    const L = this.leader(), land = this.map.land; let w = .3;
    if (L && L !== bot && L !== q && L.cells > land * .2) w += .4;          // gemeinsamer starker Gegner
    if (L === q && q.cells > land * .25) w -= .35;                           // dem Führenden hilft man nicht
    if (q.cells > bot.cells * 1.3) w += .15;                                 // Schutz durch Stärkere
    if (bot.cells > q.cells * 2.5) w -= .3;                                  // braucht keine Hilfe
    if (this.adj && !this.adj[bot.id][q.id]) w -= .15;                       // keine gemeinsame Grenze
    const own = [...this.pacts.entries()].filter(([k, v]) => v.until > this.t && k.split('-').includes(String(bot.id))).length; w -= own * .15;
    return clamp(w, 0, .95);
  },
  makePact(a, b) {
    this.pacts.set(this.pk(a.id, b.id), { since: this.t, until: this.t + PACT_TIME, warned: false });
    this.attacks = this.attacks.filter(x => !((x.att === a.id && x.def === b.id) || (x.att === b.id && x.def === a.id)) || (this.players[x.att - 1].troops += x.troops, false));
    this.log(`Bündnis: ${a.name} und ${b.name} (${PACT_TIME / 60} Minuten).`, a === this.me || b === this.me ? 'good' : '');
  },
  offer(from, to) {
    const w = this.willing(to, from);
    if (Math.random() < w) { this.makePact(from, to); snd('pact'); }
    else { this.refused[to.id] = this.t + 40; this.log(`${this.boss(to)} lehnt dein Bündnis ab.`); }
  },
  breakPact(a, b, betray) {
    this.pacts.delete(this.pk(a.id, b.id));
    if (betray) { a.traitorUntil = this.t + TRAITOR_TIME; this.log(`${a.name} bricht das Bündnis mit ${b.name}! ${TRAITOR_TIME} s lang verteidigt ${a.name} schlechter.`, b === this.me ? 'bad' : a === this.me ? 'warn' : ''); }
  },
  pactTick() {
    const me = this.me;
    for (const [k, v] of [...this.pacts.entries()]) {
      const [a, b] = k.split('-').map(n => this.players[n - 1]);
      if (!a.alive || !b.alive || v.until <= this.t) { this.pacts.delete(k); if (a.alive && b.alive) this.log(`Das Bündnis ${a.name} und ${b.name} ist abgelaufen.`, a === me || b === me ? 'warn' : ''); continue; }
      const other = a === me ? b : b === me ? a : null;
      if (other && !v.warned && v.until - this.t < 25) { v.warned = true; this.ask(`Bündnis mit ${other.name} endet bald. Verlängern?`, 'Verlängern', () => { if (Math.random() < this.willing(other, me) + .25) { v.until = this.t + PACT_TIME; v.warned = false; this.log(`Bündnis mit ${other.name} verlängert.`, 'good'); } else this.log(`${other.name} will nicht verlängern.`); }); }
      // Bots brechen selten ein Bündnis mit einem schwachen Partner, wenn kein freies Land mehr da ist
      for (const [x, y] of [[a, b], [b, a]]) if (x.bot && this.t - v.since > 120 && this.adj && !this.adj[x.id][0] && y.troops / Math.max(1, y.cells) < .35 * x.troops / Math.max(1, x.cells) && Math.random() < .02) { this.breakPact(x, y, true); break; }
    }
    if (this.t < this.nextOffer) return;
    this.nextOffer = this.t + 25 + Math.random() * 30;
    // ein Bot bietet dir oder einem anderen Bot ein Bündnis an
    const bots = this.players.filter(p => p.bot && p.alive);
    const cand = [];
    for (const x of bots) for (const y of this.players) if (y !== x && y.alive && !this.allied(x.id, y.id) && this.adj && this.adj[x.id][y.id]) cand.push([x, y, this.willing(x, y) * (y.bot ? this.willing(y, x) : 1)]);
    cand.sort((u, v) => v[2] - u[2]);
    const pick = cand.find(c => c[2] > .35 && Math.random() < .7); if (!pick) return;
    const [x, y] = pick;
    if (y === me) this.ask(`${this.boss(x)} bietet dir ein Bündnis an (${PACT_TIME / 60} Minuten).`, 'Annehmen', () => { if (x.alive && !this.allied(x.id, me.id)) this.makePact(x, me); });
    else this.makePact(x, y);
  },
  ask(msg, label, fn) {
    const el = $('#wFeed'); const d = document.createElement('div'); d.className = 'ask';
    d.innerHTML = `${esc(msg)} <button>${esc(label)}</button><button class="no">X</button>`; el.prepend(d);
    const close = () => d.remove(); d.querySelector('button').onclick = () => { fn(); close(); }; d.querySelector('.no').onclick = close; setTimeout(close, 20000);
  },

  /* ---------- Anleitung ---------- */
  tutSteps() {
    return [
      { t: 'Kampf um Liechtenstein', b: `Du führst eine Gemeinde. Wer ${WIN_SHARE * 100} % des Landes hält, gewinnt. Die anderen zehn Gemeinden spielt der Computer.` },
      { sel: '#wTroopsBox', t: 'Truppen', b: 'Deine Truppen, dahinter das Maximum und das Wachstum pro Sekunde. Am schnellsten wachsen sie bei etwa der Hälfte des Maximums. AM MAXIMUM WÄCHST NICHTS MEHR: dann angreifen oder Land dazugewinnen.' },
      { sel: '#wGoldBox', t: 'Gold', b: 'Gold kommt vor allem von den Arbeitsplätzen in deinem Gebiet. Du brauchst es für Gebäude und Söldner.' },
      { sel: '#wScoreBox', t: 'Punkte', b: 'Neutrales Feld 1 Punkt, feindliches Feld 3, Gebäude 50, ausgelöschte Gemeinde 5000, Sieg 50000 plus Zeitbonus. Schwache Startgemeinden zählen mehr (Faktor bis ×3).' },
      { sel: '#w3d', t: 'Ansicht und Hilfe', b: 'Ziehen verschiebt die Karte, Mausrad oder zwei Finger zoomen. Zwei Finger gemeinsam hoch oder runter kippen die Karte in 3D, Drehen dreht sie. Am Computer mit der rechten Maustaste. Der Knopf 3D/2D schaltet um. Während die Anleitung offen ist, ruht das Spiel. Mit ? kommt sie wieder.' },
      { sel: '#wBoard', t: 'Rangliste und Bündnisse', b: 'Die drei Führenden. Aufklappen zeigt alle Gemeinden. Mit ' + Spr.img('pakt', 1) + ' bietest du ein Bündnis an (5 Minuten). Verbündete greifen sich nicht an. Wer ein Bündnis bricht, gilt 30 s als Verräter.' },
      { sel: '#wc', t: 'Ausbreiten', b: 'Tippe auf ungefärbtes Land neben deinem Gebiet. Talboden ist billig, Hang, Wald und Berge kosten viel mehr Truppen pro Feld. Hauptstrassen sind billig, Wasser geht nicht. Freies Land deiner eigenen Gemeinde kostet nur die Hälfte, fremdes mehr. Und daheim verteidigst du dich besser (Heimvorteil).' },
      { sel: '.wr', t: 'Angriffsstärke', b: 'So viel Prozent deiner Truppen schickt ein Tippen los. Nicht verbrauchte Truppen kehren zurück. Nachbarn kosten mehr, je dichter sie besetzt sind.' },
      { sel: '#wBuild', t: 'Gebäude und Söldner', b: 'SIEDLUNG: +1500 Truppen-Maximum, also schnelleres Wachstum.<br>BURG: Gegner brauchen im Umkreis von 300 m doppelt so viele Truppen.<br>MARKT: +6 Gold pro Sekunde.<br>SÖLDNER: sofort +20 % Truppen für Gold. Du kannst 4 Mal pro Partie anwerben, die Zahl am Knopf zeigt, wie oft noch.<br>Jedes weitere Gebäude derselben Art und jede Anwerbung wird teurer.' },
    ];
  },
  tutorial(k) {
    const el = $('#wTut'); this.layout();
    // Reihenfolge nach Bildschirmposition: oben von links nach rechts, dann Rangliste, dann Karte, dann unten
    if (k === 0 || !this._tutSteps) {
      const zone = st => { if (!st.sel) return [-1, 0]; if (st.sel === '#wBoard') return [1, 0]; if (st.sel === '#wc') return [2, 0]; const e = $(st.sel), r = e && e.getBoundingClientRect(); if (!r || !r.width) return [4, 0]; return [r.top + r.height / 2 < innerHeight * .4 ? 0 : 3, r.left]; };
      this._tutSteps = this.tutSteps().map(st => ({ st, z: zone(st) })).sort((a, b) => a.z[0] - b.z[0] || a.z[1] - b.z[1]).map(x => x.st);
    }
    const steps = this._tutSteps;
    document.querySelectorAll('.tutHi').forEach(e => e.classList.remove('tutHi'));
    if (k >= steps.length) { el.hidden = true; store.set('laendle-kampf-tut', 1); this.halt.delete('tut'); return; }
    this.halt.add('tut');
    const st = steps[k], t = st.sel && st.sel !== '#wc' ? $(st.sel) : null; if (t) t.classList.add('tutHi');
    el.hidden = false;
    el.innerHTML = `<button class="px-x" id="tutX" aria-label="Anleitung schliessen">X</button><div class="tn">${k + 1}/${steps.length}</div><h3>${esc(st.t)}</h3><p>${st.b}</p><div class="trow"><button class="px-btn" id="tutNext">${k === steps.length - 1 ? 'LOS!' : 'WEITER >'}</button></div>`;
    // der Karte ausweichen: liegt das markierte Element unten, kommt die Karte nach oben und umgekehrt
    el.classList.remove('top', 'bottom');
    const r = t && t.getBoundingClientRect(); el.classList.add(r && r.top + r.height / 2 > innerHeight * .5 ? 'top' : 'bottom');
    // darf das markierte Element nicht verdecken: notfalls Höhe begrenzen (Inhalt scrollt)
    el.style.maxHeight = '';
    if (r && innerHeight > 520) { const e = el.getBoundingClientRect(); if (e.top < r.bottom && r.top < e.bottom) el.style.maxHeight = Math.max(110, el.classList.contains('top') ? r.top - e.top - 16 : e.bottom - r.bottom - 16) + 'px'; }
    el.scrollTop = 0;
    $('#tutNext').onclick = () => { snd('tap'); this.tutorial(k + 1); };
    $('#tutX').onclick = () => { snd('tap'); this.tutorial(steps.length); };
  },


  /* ---------- Darstellung ---------- */
  rgb(hex) { this._rgb = this._rgb || {}; if (!this._rgb[hex]) this._rgb[hex] = [1, 3, 5].map(k => parseInt(hex.slice(k, k + 2), 16)); return this._rgb[hex]; },
  paint(i) {
    const M = this.map; if (i < 0 || i >= M.N) return; const d = this.ovImg.data, o = this.owner[i];
    if (!o) { d[i * 4 + 3] = 0; this.ovDirty = true; return; }
    const c = this.rgb(this.players[o - 1].color);
    let border = false; for (const n of this.neighbors(i)) if (this.owner[n] !== o) { border = true; break; }
    const x = i % M.w, y = (i / M.w) | 0, on = border || ((x + y) & 1) === 0;
    d[i * 4] = c[0]; d[i * 4 + 1] = c[1]; d[i * 4 + 2] = c[2]; d[i * 4 + 3] = border ? 255 : on ? 150 : 60;
    this.ovDirty = true;
  },
  fullRepaint() {
    const M = this.map, d = this.ovImg.data;
    if (this.phase === 'choose') {
      // Gemeindegrenzen als Vorschau
      for (let i = 0; i < M.N; i++) { const g = M.gem[i]; if (!g) { d[i * 4 + 3] = 0; continue; } const c = this.rgb(WAR_COLORS[g]); let b = false; for (const n of this.neighbors(i)) if (M.gem[n] !== g) b = true; d[i * 4] = c[0]; d[i * 4 + 1] = c[1]; d[i * 4 + 2] = c[2]; d[i * 4 + 3] = b ? 255 : (((i % M.w) + ((i / M.w) | 0)) & 1) ? 0 : 90; }
    } else for (let i = 0; i < M.N; i++) this.paint(i);
    this.ovDirty = true;
  },
  render() {
    const g = this.ctx, M = this.map; if (!M) return;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0); g.fillStyle = '#000'; g.fillRect(0, 0, this.W, this.H);
    if (this.ovDirty) { this.ovCtx.putImageData(this.ovImg, 0, 0); this.ovDirty = false; if (window.War3D) War3D.dirty = true; }
    const [ox, oy] = this.g2s(0, 0), s = this.cam.s, td = this.is3D() && War3D.ok, P = (x, y, l) => this.proj(x, y, l);
    if (td) { g.clearRect(0, 0, this.W, this.H); War3D.render(); }
    const R = this.relief;
    const U = M.um;
    if (!td && this.umCanvas) { g.imageSmoothingEnabled = false; g.drawImage(this.umCanvas, ox + U.gx0 * s, oy + U.gy0 * s, U.w * U.k * s, U.h * U.k * s); }
    else if (!td && R && R.complete && R.naturalWidth) {
      // Schweiz und Österreich nur als dunkles Relief
      const lx = (-622.276 - (M.x0 - O0[0])) / M.cell, ly = ((M.y1 - O0[1]) - 26477.241) / M.cell, k = 20.01346 / M.cell;
      g.globalAlpha = .28; g.imageSmoothingEnabled = false;
      g.drawImage(R, ox + lx * s, oy + ly * s, R.naturalWidth * k * s, R.naturalHeight * k * s);
      g.globalAlpha = 1;
    }
    g.imageSmoothingEnabled = false; if (!td) { g.drawImage(this.base, ox, oy, M.w * s, M.h * s); g.drawImage(this.ov, ox, oy, M.w * s, M.h * s); }
    g.textAlign = 'center'; g.textBaseline = 'middle';
    const font = this.labelFont || 'monospace';
    if (this.phase === 'play') {
      g.setLineDash([2, 4]); g.lineWidth = 2;
      for (const b of this.buildings) if (b.type === 'burg' && b.owner === this.me.id) { const bx = b.i % M.w + .5, by = Math.floor(b.i / M.w) + .5; g.strokeStyle = '#fff1e8'; g.beginPath(); for (let k = 0; k <= 24; k++) { const a = k / 24 * Math.PI * 2, [x, y] = P(bx + Math.cos(a) * 12, by + Math.sin(a) * 12); k ? g.lineTo(x, y) : g.moveTo(x, y); } g.stroke(); }
      g.setLineDash([]);
      const sc = s >= 3 ? 3 : s >= 1.5 ? 2 : 1;
      for (const b of this.buildings) {
        const [x, y] = P(b.i % M.w + .5, Math.floor(b.i / M.w) + .5, 1); if (x < -30 || y < -30 || x > this.W + 30 || y > this.H + 30) continue;
        const sz = 8 * sc, X = Math.round(x - sz / 2), Y = Math.round(y - sz / 2);
        g.fillStyle = '#000'; g.fillRect(X - 2, Y - 2, sz + 4, sz + 4); g.fillStyle = this.players[b.owner - 1].color; g.fillRect(X - 1, Y - 1, sz + 2, sz + 2);
        g.fillStyle = '#000'; g.fillRect(X, Y, sz, sz); g.drawImage(Spr.canvas(b.type, sc), X, Y);
      }
      for (const a of this.attacks) if (a.att === this.me.id || a.def === this.me.id) {
        const [x, y] = P(a.tx + .5, a.ty + .5), r = 8 + (Math.floor(performance.now() / 150) % 3) * 3;
        g.strokeStyle = a.att === this.me.id ? '#fff1e8' : '#ff004d'; g.lineWidth = 2; g.strokeRect(Math.round(x - r), Math.round(y - r), r * 2, r * 2);
      }
    }
    const txt = (t, x, y, col) => { g.fillStyle = '#000'; for (const [dx, dy] of [[-2, 0], [2, 0], [0, -2], [0, 2], [2, 2]]) g.fillText(t, x + dx, y + dy); g.fillStyle = col; g.fillText(t, x, y); };
    if (M.um) { g.font = `8px ${font}`; for (const [n, X, Y] of [['SCHWEIZ', 2751600, 1221500], ['SCHWEIZ', 2763500, 1212500], ['ÖSTERREICH', 2768000, 1231500]]) { const [x, y] = P((X - M.x0) / M.cell, (M.y1 - Y) / M.cell, 4); if (x > -50 && y > -20 && x < this.W + 50 && y < this.H + 20) txt(n, Math.round(x), Math.round(y), '#83769c'); } }
    for (const p of this.players) {
      if (this.phase === 'play' && !p.alive) continue;
      const [x0, y0] = P(p.lx + .5, p.ly + .5, 3), x = Math.round(x0), y = Math.round(y0);
      const area = p.cells * s * s, size = this.phase === 'play' ? (area > 60000 ? 16 : area > 6000 ? 10 : 8) : (s > 2.5 ? 10 : 8);
      if (x < -100 || y < -50 || x > this.W + 100 || y > this.H + 50) continue;
      g.font = `${size}px ${font}`;
      const name = p.name.toUpperCase(), ally = this.phase === 'play' && p !== this.me && this.allied(p.id, this.me.id);
      txt(name, x, y, this.phase === 'play' && p === this.me ? '#ffec27' : '#fff1e8');
      if (ally) { const w = g.measureText(name).width; g.drawImage(Spr.canvas('pakt', 2), Math.round(x - w / 2 - 22), y - 8); }
      if (this.phase === 'play') { g.font = `8px ${font}`; txt(fmtK(p.troops), x, y + size + 6, p.color); }
    }
  },
};
function fmtK(v) { v = Math.max(0, v); return v >= 1e6 ? (v / 1e6).toFixed(2) + ' Mio.' : v >= 1e4 ? Math.round(v / 1000) + 'k' : v >= 1000 ? (v / 1000).toFixed(1) + 'k' : String(Math.round(v)); }
