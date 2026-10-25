'use strict';
const snd = n => { if (window.Snd) Snd.play(n); };
/* Kampf um Liechtenstein: Gebietsstrategie nach dem Prinzip von OpenFront, vereinfacht.
   Raster 25 m (aus der Pipeline): Gemeinde, Boden, Höhe. Bevölkerung und Arbeitsplätze aus dem Hektarraster.
   11 Gemeinden, eine davon spielst du, die anderen sind Bots. Wer 70 % des Landes hält, gewinnt. */
const WAR_COLORS = ['#000', '#d1495b', '#2e86ab', '#edae49', '#66a182', '#8e5cc4', '#e07a3f', '#3d5a80', '#c2477f', '#3fa7a3', '#9c6b30', '#5b8c2a'];
const WAR_BUILD = {
  siedlung: { name: 'Siedlung', icon: '🏘️', cost: 220, eff: '+1500 Truppen-Max.', info: 'Erhöht dein Truppen-Maximum um 1500. Mehr Maximum heisst auch schnelleres Wachstum.' },
  burg: { name: 'Burg', icon: '🏰', cost: 180, eff: 'Abwehr ×2, 300 m', info: 'Gegner brauchen im Umkreis von 300 m doppelt so viele Truppen pro Feld. Bau sie an die Grenze zu starken Nachbarn.' },
  markt: { name: 'Markt', icon: '💰', cost: 260, eff: '+6 Gold/s', info: 'Bringt 6 Gold pro Sekunde zusätzlich. Gold brauchst du nur für Gebäude.' },
};
const WIN_SHARE = 0.7, PACT_TIME = 300, TRAITOR_TIME = 30;

const War = {
  inited: false, map: null, phase: 'off', speed: 1, halt: new Set(), score: 0, ratio: .3, build: null, cam: { x: 0, y: 0, s: 1 },

  /* ---------- Einstieg ---------- */
  async open() {
    this.init();
    $('#warScreen').hidden = false; this.resize();
    if (!this.map) {
      $('#wMsg').textContent = 'Lade die Landeskarte …'; $('#wMsg').hidden = false;
      try { await this.loadMap(); } catch (e) { console.warn(e); $('#wMsg').innerHTML = `Die Kampfkarte ist noch nicht verfügbar. Sie entsteht beim nächsten Lauf der Geodaten-Pipeline.<br><button class="btn" id="wBack2">Zurück</button>`; $('#wBack2').onclick = () => this.exit(); return; }
    }
    this.choose();
  },
  exit() {
    this.phase = 'off'; this.halt.clear(); $('#warScreen').hidden = true; $('#wTut').hidden = true; if (this.onExit) this.onExit();
  },
  init() {
    if (this.inited) return; this.inited = true;
    const c = this.cv = $('#wc'); this.ctx = c.getContext('2d');
    addEventListener('resize', () => this.resize());
    const pts = new Map(); let down = null, pinch = null;
    c.addEventListener('pointerdown', e => { $('#wTip').hidden = true; c.setPointerCapture(e.pointerId); pts.set(e.pointerId, [e.clientX, e.clientY]); if (pts.size === 1) down = { x: e.clientX, y: e.clientY, cx: this.cam.x, cy: this.cam.y, moved: false };
      if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), s: this.cam.s, mx: (a[0] + b[0]) / 2, my: (a[1] + b[1]) / 2 }; down = null; } });
    c.addEventListener('pointermove', e => {
      if (!pts.has(e.pointerId)) { this.hover(e.clientX, e.clientY); return; }
      pts.set(e.pointerId, [e.clientX, e.clientY]);
      if (pinch && pts.size === 2) { const [a, b] = [...pts.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]); this.zoomAt(pinch.mx, pinch.my, pinch.s * d / pinch.d / this.cam.s); return; }
      if (down) { const dx = e.clientX - down.x, dy = e.clientY - down.y; if (Math.hypot(dx, dy) > 8) down.moved = true; if (down.moved) { this.cam.x = down.cx - dx / this.cam.s; this.cam.y = down.cy - dy / this.cam.s; this.clampCam(); } }
    });
    const up = e => { if (!pts.has(e.pointerId)) return; pts.delete(e.pointerId); if (pts.size < 2) pinch = null; if (down && !down.moved && pts.size === 0) this.tap(e.clientX, e.clientY); if (pts.size === 0) down = null; };
    c.addEventListener('pointerup', up); c.addEventListener('pointercancel', up);
    c.addEventListener('wheel', e => { e.preventDefault(); this.zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * .0015)); }, { passive: false });
    $('#wExit').onclick = () => this.exit(); $('#wHelp').onclick = () => { snd('tap'); this.tutorial(0); };
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.halt.add('hidden'); else this.halt.delete('hidden'); });
    $('#wRatio').oninput = e => { this.ratio = e.target.value / 100; $('#wRatioV').textContent = e.target.value + ' %'; };
    document.querySelectorAll('#wBuild button').forEach(b => b.onclick = () => { this.build = this.build === b.dataset.b ? null : b.dataset.b; this.updateBuildBtns(); if (this.build) toast(`${WAR_BUILD[this.build].name}: Tippe auf dein Gebiet.`); });
    let last = performance.now(), acc = 0;
    const loop = t => {
      const dt = Math.min(.25, (t - last) / 1000); last = t;
      if (this.phase === 'play' && !this.halt.size) { acc += dt; let n = 0; while (acc >= .1 && n < 8) { acc -= .1; this.tick(); n++; } if (n >= 8) acc = 0; }
      if (this.phase !== 'off') this.render();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  },
  resize() { if (!this.cv) return; const r = this.cv.getBoundingClientRect(); this.dpr = Math.min(devicePixelRatio || 1, 2); this.W = r.width; this.H = r.height; this.cv.width = r.width * this.dpr; this.cv.height = r.height * this.dpr; },

  /* ---------- Karte laden ---------- */
  async loadMap() {
    const meta = Tiles.ok && Tiles.index.files && Tiles.index.files.kampf;
    if (!meta) throw new Error('kein Kampfraster im Index');
    const r = await fetch(CFG.dataBase + meta.path); if (!r.ok) throw new Error(r.status);
    let buf = await r.arrayBuffer(); const head = new Uint8Array(buf, 0, 2);
    if (head[0] === 0x1f && head[1] === 0x8b) buf = await new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
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
    this.buildBase();
    this.relief = window.KAMPF_RELIEF;
    $('#wMsg').hidden = true;
  },
  buildBase() {
    const M = this.map, cv = document.createElement('canvas'); cv.width = M.w; cv.height = M.h;
    const g = cv.getContext('2d'), img = g.createImageData(M.w, M.h), d = img.data;
    for (let i = 0; i < M.N; i++) {
      if (!M.gem[i]) continue; const cls = M.boden[i] & 15, hm = M.hoehe[i] || 500; let c;
      if (cls === 4) c = [111, 166, 214];
      else if (M.boden[i] & 32) c = [140, 132, 122];
      else if (cls === 1) c = [196, 189, 178];
      else if (cls === 3) c = hm > 1400 ? [88, 120, 80] : [93, 138, 74];
      else if (cls === 5) c = hm > 2000 ? [236, 236, 236] : [201, 194, 181];
      else c = hm > 1500 ? [170, 186, 140] : [184, 208, 138];
      if (M.boden[i] & 16 && !(M.boden[i] & 32)) c = [222, 214, 196];
      d[i * 4] = c[0]; d[i * 4 + 1] = c[1]; d[i * 4 + 2] = c[2]; d[i * 4 + 3] = 255;
    }
    g.putImageData(img, 0, 0); this.base = cv;
    this.ov = document.createElement('canvas'); this.ov.width = M.w; this.ov.height = M.h; this.ovCtx = this.ov.getContext('2d'); this.ovImg = this.ovCtx.createImageData(M.w, M.h);
  },

  /* ---------- Spielstart ---------- */
  choose() {
    const M = this.map; this.phase = 'choose'; this.owner = new Uint8Array(M.N); this.buildings = []; this.attacks = []; this.feed = [];
    this.players = M.names.map((n, k) => ({ id: k + 1, name: n, color: WAR_COLORS[k + 1], troops: 0, gold: 120, cells: 0, pers: 0, jobs: 0, alive: true, bot: true, nextAi: 0, lx: 0, ly: 0 }));
    // Startpunkt je Gemeinde: dichtester bewohnter Ort
    const best = this.players.map(() => ({ v: -1, i: -1 })), sum = this.players.map(() => [0, 0, 0]);
    for (let i = 0; i < M.N; i++) { const g = M.gem[i]; if (!g || M.cost[i] === Infinity) continue; const v = M.pers[i] * 3 + M.jobs[i] + (M.boden[i] & 32 ? .2 : 0); const s = sum[g - 1]; s[0] += i % M.w; s[1] += Math.floor(i / M.w); s[2]++; if (v > best[g - 1].v) best[g - 1] = { v, i }; }
    this.players.forEach((p, k) => { const b = best[k].i >= 0 ? best[k].i : Math.round(sum[k][1] / sum[k][2]) * M.w + Math.round(sum[k][0] / sum[k][2]); p.start = b; p.lx = b % M.w; p.ly = Math.floor(b / M.w); });
    this.fit(); this.fullRepaint();
    $('#wHud').hidden = true; $('#wBottom').hidden = true; $('#wBoard').hidden = true; $('#wFeed').innerHTML = ''; $('#wChoose').hidden = false;
    $('#wChoose').innerHTML = `<b>Wähle deine Gemeinde</b><span>Tippe auf die Karte oder hier:</span><div class="wgems">${this.players.map(p => `<button data-g="${p.id}" style="--c:${p.color}">${esc(p.name)}</button>`).join('')}</div>`;
    $('#wChoose').querySelectorAll('button').forEach(b => b.onclick = () => this.startGame(+b.dataset.g));
  },
  startGame(gid) {
    const M = this.map; this.me = this.players[gid - 1]; this.me.bot = false;
    this.owner.fill(0); this.buildings = []; this.attacks = []; this.feed = []; this.t = 0; this.build = null; this.over = false; this.score = 0; this.pacts = new Map(); this.lastHit = {}; this.refused = {}; this.maxWarned = -999; this.nextOffer = 60;
    const R = 14;
    for (const p of this.players) {
      p.cells = p.pers = p.jobs = 0; p.alive = true; p.gold = 120; p.traitorUntil = 0; p.growth = 0; p.goldRate = 0; p.nextAi = 20 + Math.random() * 20;
      const sx = p.start % M.w, sy = Math.floor(p.start / M.w);
      for (let y = sy - R; y <= sy + R; y++) for (let x = sx - R; x <= sx + R; x++) {
        if (x < 0 || y < 0 || x >= M.w || y >= M.h || (x - sx) ** 2 + (y - sy) ** 2 > R * R) continue;
        const i = y * M.w + x; if (M.gem[i] === p.id && M.cost[i] !== Infinity && !this.owner[i]) this.setOwner(i, p.id, true);
      }
      p.troops = Math.round(this.maxTroops(p) * .35);
    }
    this.phase = 'play'; this.fullRepaint(); this.adjacency(); this.halt.clear();
    $('#wChoose').hidden = true; $('#wHud').hidden = false; $('#wBottom').hidden = false; $('#wBoard').hidden = false; this.updateBuildBtns();
    this.cam.x = this.me.lx; this.cam.y = this.me.ly; this.cam.s = Math.max(this.cam.s, Math.min(this.W, this.H) / 140); this.clampCam();
    this.log(`Du führst ${this.me.name}. Tippe auf neutrales Land, um dich auszubreiten.`);
    // Faktor: schwache Startgemeinden (wenig Truppen, steiles Gelände) geben mehr Punkte
    const M2 = this.map, cs = new Float64Array(this.players.length + 1), cn = new Float64Array(this.players.length + 1);
    for (let i = 0; i < M2.N; i++) { const g = M2.gem[i]; if (g && M2.cost[i] !== Infinity) { cs[g] += M2.cost[i]; cn[g]++; } }
    const terr = p => cs[p.id] / Math.max(1, cn[p.id]), avgT = this.players.reduce((s, p) => s + terr(p), 0) / this.players.length;
    const avg = this.players.reduce((s, p) => s + this.maxTroops(p), 0) / this.players.length;
    this.factor = Math.round(clamp(Math.sqrt(avg / this.maxTroops(this.me)) * (terr(this.me) / avgT), 1, 3) * 10) / 10;
    this.labels(); this.updateHud(); snd('start');
    if (!store.get('laendle-kampf-tut')) this.tutorial(0);
  },

  /* ---------- Regeln ---------- */
  maxTroops(p) { return Math.round(800 + p.cells * 1.5 + p.pers * 6 + p.jobs * 2 + this.count(p, 'siedlung') * 1500); },
  count(p, type) { let n = 0; for (const b of this.buildings) if (b.owner === p.id && b.type === type) n++; return n; },
  costOf(p, type) { return Math.round(WAR_BUILD[type].cost * Math.pow(1.6, this.count(p, type))); },
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
      if (target && this.players[target - 1] === this.me) { this.log(`${p.name} greift dich an!`, 'bad'); snd('alarm'); }
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
      let c = M.cost[i] * 1.6;
      if (def) { const dens = def.troops / Math.max(1, def.cells); c = M.cost[i] * (2.5 + dens * 1.1) * this.defense(i, def.id) * (def.traitorUntil > this.t ? .6 : 1); }
      if (a.troops < c) { a.troops = 0; break; }
      a.troops -= c; budget -= M.cost[i];
      if (def) def.troops = Math.max(0, def.troops - c * .45);
      a.cand[bestK] = a.cand[a.cand.length - 1]; a.cand.pop(); a.inSet[i] = 0;
      this.setOwner(i, a.att);
      for (const n of this.neighbors(i)) if (this.owner[n] === a.def && !a.inSet[n] && this.passable(n)) { a.cand.push(n); a.inSet[n] = 1; }
      if (def && def.cells <= 0) { this.eliminate(def, att); break; }
    }
    if (a.troops <= 0 || !a.cand.length) { att.troops += Math.max(0, a.troops); return false; }
    return true;
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
      p.growth = (max * .006 + T * .06) * Math.max(0, 1 - T / max);
      p.troops = T > max ? T - (T - max) * .02 : Math.min(max, T + p.growth * .1);
      p.goldRate = 1.5 + p.jobs * .012 + p.cells * .0015 + this.count(p, 'markt') * 6;
      p.gold += p.goldRate * .1;
    }
    this.attacks = this.attacks.filter(a => this.stepAttack(a));
    if (Math.floor(this.t * 10) % 4 === 0) { if (this.conq) snd('tick'); if (this.lost > 3) snd('hit'); this.conq = 0; this.lost = 0; }
    if (Math.floor(this.t * 10) % 20 === 0) this.adjacency();
    for (const p of this.players) if (p.bot && p.alive && this.t >= p.nextAi) { this.botThink(p); p.nextAi = this.t + 1.2 + Math.random() * 2.2; }
    if (Math.floor(this.t * 10) % 10 === 0) { this.labels(); this.updateHud(); this.pactTick(); }
    if (!this.over && this.me.cells / M.land >= WIN_SHARE) this.end(true);
    if (!this.over) for (const p of this.players) if (p.bot && p.alive && p.cells / M.land >= WIN_SHARE) { this.end(false, p); break; }
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
    // bauen
    const types = ['siedlung', 'markt', 'burg'], type = Math.random() < .5 ? 'siedlung' : Math.random() < .6 ? 'markt' : 'burg', cost = this.costOf(p, type);
    if (p.gold >= cost * 1.5 && this.buildings.filter(b => b.owner === p.id).length < 2 + p.cells / 2500) { const i = this.randomOwnCell(p, type === 'burg'); if (i >= 0) this.place(p, type, i); }
    if (this.attacks.filter(a => a.att === p.id).length >= 2) return;
    if (p.troops < max * .42) return;
    const neutral = A[p.id][0];
    let target = -1;
    if (neutral > 0 && (Math.random() < .8 || this.t < 60)) target = 0;
    else {
      let best = 1e9;
      for (const q of this.players) {
        if (!q.alive || q === p || !A[p.id][q.id] || this.allied(p.id, q.id)) continue;
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
  place(p, type, i) {
    const cost = this.costOf(p, type); if (p.gold < cost || this.owner[i] !== p.id) return false;
    const M = this.map;
    if (this.buildings.some(b => Math.abs(b.i % M.w - i % M.w) + Math.abs(Math.floor(b.i / M.w) - Math.floor(i / M.w)) < 6)) { if (p === this.me) toast('Zu nah an einem anderen Gebäude.'); return false; }
    p.gold -= cost; this.buildings.push({ type, owner: p.id, i });
    if (p === this.me) { this.log(`${WAR_BUILD[type].name} gebaut.`); this.score += 50; snd('build'); }
    return true;
  },
  end(win, winner) {
    this.over = true; this.halt.add('end');
    const land = Math.round(this.me.cells / this.map.land * 100), min = Math.max(1, Math.round(this.t / 60));
    const bonus = win ? 50000 + Math.max(0, Math.round((1500 - this.t) * 40)) : 0, total = Math.round((this.score + bonus) * this.factor);
    snd(win ? 'win' : 'lose');
    if (this.onEnd) this.onEnd({ win, winner, land, min, base: this.score, bonus, factor: this.factor, total, gem: this.me.name, color: this.me.color });
  },
  continueAfterWin() { this.halt.delete('end'); },
  log(msg, cls) {
    const el = $('#wFeed'); if (!el) return; const d = document.createElement('div'); d.textContent = msg; if (cls) d.className = cls; el.prepend(d);
    while (el.children.length > 4) el.lastChild.remove(); setTimeout(() => d.classList.add('old'), 6000);
  },

  /* ---------- Eingabe ---------- */
  s2g(sx, sy) { return [(sx - this.W / 2) / this.cam.s + this.cam.x, (sy - this.H / 2) / this.cam.s + this.cam.y]; },
  g2s(gx, gy) { return [(gx - this.cam.x) * this.cam.s + this.W / 2, (gy - this.cam.y) * this.cam.s + this.H / 2]; },
  cellAt(sx, sy) { const r = this.cv.getBoundingClientRect(), [gx, gy] = this.s2g(sx - r.left, sy - r.top), x = Math.floor(gx), y = Math.floor(gy), M = this.map; if (x < 0 || y < 0 || x >= M.w || y >= M.h) return -1; return y * M.w + x; },
  tap(sx, sy) {
    const i = this.cellAt(sx, sy), M = this.map; if (i < 0 || !M.gem[i]) return;
    if (this.phase === 'choose') { this.startGame(M.gem[i]); return; }
    if (this.phase !== 'play' || this.halt.has('end')) return;
    if (!this.passable(i)) { toast('Wasser kann man nicht erobern.'); return; }
    const o = this.owner[i], me = this.me;
    if (this.build) { if (o !== me.id) { toast('Bauen geht nur auf deinem Gebiet.'); return; } if (this.place(me, this.build, i)) { this.build = null; this.updateBuildBtns(); } else if (me.gold < this.costOf(me, this.build)) toast('Zu wenig Gold.'); return; }
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
    const M = this.map, o = this.owner[i], hm = M.hoehe[i], cls = ['', 'Siedlung', 'Wiese', 'Wald', 'Wasser', 'Fels'][M.boden[i] & 15] || '';
    tip.hidden = false; tip.style.left = sx + 14 + 'px'; tip.style.top = sy + 14 + 'px';
    tip.innerHTML = `<b>${o ? esc(this.players[o - 1].name) : 'Neutral'}</b><br>${esc(M.names[M.gem[i] - 1])} · ${cls}${hm ? ` · ${hm} m` : ''}${M.boden[i] & 16 ? ' · Strasse' : ''}<br>Gelände: ${M.cost[i] === Infinity ? 'unpassierbar' : '×' + M.cost[i].toFixed(1)}`;
  },
  zoomAt(sx, sy, f) {
    const r = this.cv.getBoundingClientRect(), [gx, gy] = this.s2g(sx - r.left, sy - r.top);
    this.cam.s = clamp(this.cam.s * f, this.minS || .3, 40); this.cam.x = gx - (sx - r.left - this.W / 2) / this.cam.s; this.cam.y = gy - (sy - r.top - this.H / 2) / this.cam.s; this.clampCam();
  },
  fit() { const M = this.map, top = 64, bot = this.W < 700 ? 150 : 100; this.minS = Math.min(this.W / M.w, (this.H - top - bot) / M.h) * .95; this.cam.s = this.minS; this.cam.x = M.w / 2; this.cam.y = M.h / 2 + (bot - top) / 2 / this.cam.s; },
  clampCam() { const M = this.map; this.cam.x = clamp(this.cam.x, 0, M.w); this.cam.y = clamp(this.cam.y, 0, M.h); },
  updateBuildBtns() {
    document.querySelectorAll('#wBuild button').forEach(b => { const t = b.dataset.b, c = this.me ? this.costOf(this.me, t) : WAR_BUILD[t].cost; b.querySelector('small').textContent = c + ' Gold'; b.querySelector('em').textContent = WAR_BUILD[t].eff; b.setAttribute('aria-pressed', this.build === t); b.disabled = !this.me || this.me.gold < c; });
  },
  updateHud() {
    if (!this.me) return; const me = this.me, M = this.map, max = this.maxTroops(me), full = me.troops >= max * .97;
    $('#wName').textContent = me.name; $('#wName').style.color = me.color;
    $("#wTroops").textContent = `${fmtK(me.troops)}/${fmtK(max)}`;
    const gr = (max * .006 + me.troops * .06) * Math.max(0, 1 - me.troops / max); $('#wGrow').textContent = full ? 'Maximum' : `+${fmtK(gr)}/s`; $('#wGrow').classList.toggle('full', full);
    if (full && me.alive && this.t - this.maxWarned > 90) { this.maxWarned = this.t; this.log('Truppen am Maximum: Es wachsen keine neuen nach. Greif an, erobere Land oder baue Siedlungen.', 'warn'); }
    $('#wGold').textContent = fmtK(me.gold); $('#wGoldR').textContent = `+${(me.goldRate || 0).toFixed(1)}/s`;
    $('#wLand').textContent = (me.cells / M.land * 100).toFixed(1) + ' %'; $('#wScore').textContent = Math.round(this.score * (this.factor || 1)).toLocaleString('de-CH');
    const att = this.attacks.filter(a => a.att === me.id).reduce((s, a) => s + a.troops, 0); $('#wAtt').textContent = att ? `${fmtK(att)} im Angriff` : '';
    this.renderBoard(); this.updateBuildBtns();
  },
  renderBoard() {
    const me = this.me, M = this.map, all = this.players.slice().sort((a, b) => (b.alive - a.alive) || b.cells - a.cells);
    const rank = all.indexOf(me), open = this.boardOpen;
    let rows = open ? all : all.filter(p => p.alive).slice(0, 3); if (!open && !rows.includes(me)) rows = rows.concat([me]);
    const row = p => {
      const k = all.indexOf(p), pact = this.pacts.get(this.pk(me.id, p.id)), left = pact ? Math.max(0, Math.round(pact.until - this.t)) : 0;
      const act = !open || p === me || !p.alive ? '' : pact ? `<button data-a="break" data-p="${p.id}" title="Bündnis brechen (du giltst ${TRAITOR_TIME} s als Verräter)">✖</button>` : this.refused[p.id] > this.t ? `<button disabled title="Abgelehnt, bald wieder möglich">🤝</button>` : `<button data-a="offer" data-p="${p.id}" title="Bündnis anbieten">🤝</button>`;
      return `<div class="${p === me ? 'me' : ''}${p.alive ? '' : ' dead'}" data-f="${p.id}"><i style="background:${p.color}"></i><em>${k + 1}.</em> ${esc(p.name)}${pact ? ` <small class="pact" title="Bündnis, noch ${left} s">🤝${Math.ceil(left / 60)}′</small>` : ''}${p.traitorUntil > this.t ? ' <small class="trait" title="Verräter">⚠</small>' : ''}<span>${p.alive ? (p.cells / M.land * 100).toFixed(1) + ' %' : 'erobert'}</span>${open ? `<span class="tr">${p.alive ? fmtK(p.troops) : ''}</span>` : ''}${act}</div>`;
    };
    const html = rows.map(row).join('') + `<button class="more" data-a="toggle">${open ? 'Weniger ▴' : `Alle ${all.length} Gemeinden ▾`}</button><div class="goal">Ziel: ${WIN_SHARE * 100} %</div>`;
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
    else { this.refused[to.id] = this.t + 40; this.log(`${to.name} lehnt dein Bündnis ab.`); }
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
    if (y === me) this.ask(`${x.name} bietet dir ein Bündnis an (${PACT_TIME / 60} Minuten).`, 'Annehmen', () => { if (x.alive && !this.allied(x.id, me.id)) this.makePact(x, me); });
    else this.makePact(x, y);
  },
  ask(msg, label, fn) {
    const el = $('#wFeed'); const d = document.createElement('div'); d.className = 'ask';
    d.innerHTML = `${esc(msg)} <button>${esc(label)}</button><button class="no">✕</button>`; el.prepend(d);
    const close = () => d.remove(); d.querySelector('button').onclick = () => { fn(); close(); }; d.querySelector('.no').onclick = close; setTimeout(close, 20000);
  },

  /* ---------- Anleitung ---------- */
  tutSteps() {
    return [
      { t: 'Kampf um Liechtenstein', b: `Du führst eine Gemeinde. Wer ${WIN_SHARE * 100} % des Landes hält, gewinnt. Die anderen zehn Gemeinden spielt der Computer.` },
      { sel: '#wTroopsBox', t: 'Truppen', b: 'Deine Truppen, dahinter das Maximum und das Wachstum pro Sekunde. Am schnellsten wachsen sie bei etwa der Hälfte des Maximums. AM MAXIMUM WÄCHST NICHTS MEHR: dann angreifen oder Land dazugewinnen.' },
      { sel: '#wc', t: 'Ausbreiten', b: 'Tippe auf ungefärbtes Land neben deinem Gebiet. Talboden ist billig, Hang, Wald und Berge kosten viel mehr Truppen pro Feld. Hauptstrassen sind billig, Wasser geht nicht.' },
      { sel: '.wr', t: 'Angriffsstärke', b: 'So viel Prozent deiner Truppen schickt ein Tippen los. Nicht verbrauchte Truppen kehren zurück. Nachbarn kosten mehr, je dichter sie besetzt sind.' },
      { sel: '#wGoldBox', t: 'Gold', b: 'Gold kommt vor allem von den Arbeitsplätzen in deinem Gebiet. Du brauchst es nur für Gebäude.' },
      { sel: '#wBuild', t: 'Gebäude', b: 'SIEDLUNG: +1500 Truppen-Maximum, also schnelleres Wachstum.<br>BURG: Gegner brauchen im Umkreis von 300 m doppelt so viele Truppen.<br>MARKT: +6 Gold pro Sekunde.<br>Jedes weitere Gebäude derselben Art wird teurer.' },
      { sel: '#wBoard', t: 'Rangliste und Bündnisse', b: 'Die drei Führenden. Aufklappen zeigt alle Gemeinden. Mit 🤝 bietest du ein Bündnis an (5 Minuten). Verbündete greifen sich nicht an. Wer ein Bündnis bricht, gilt 30 s als Verräter.' },
      { sel: '#wScoreBox', t: 'Punkte', b: 'Neutrales Feld 1 Punkt, feindliches Feld 3, Gebäude 50, ausgelöschte Gemeinde 5000, Sieg 50000 plus Zeitbonus. Schwache Startgemeinden zählen mehr (Faktor bis ×3).' },
      { sel: '#wHelp', t: 'Hilfe', b: 'Ziehen verschiebt die Karte, Mausrad oder zwei Finger zoomen. Während die Anleitung offen ist, ruht das Spiel. Mit ? kommt sie wieder.' },
    ];
  },
  tutorial(k) {
    const steps = this.tutSteps(), el = $('#wTut');
    document.querySelectorAll('.tutHi').forEach(e => e.classList.remove('tutHi'));
    if (k >= steps.length) { el.hidden = true; store.set('laendle-kampf-tut', 1); this.halt.delete('tut'); return; }
    this.halt.add('tut');
    const st = steps[k], t = st.sel && st.sel !== '#wc' ? $(st.sel) : null; if (t) t.classList.add('tutHi');
    el.hidden = false;
    el.innerHTML = `<button class="px-x" id="tutX" aria-label="Anleitung schliessen">✕</button><div class="tn">${k + 1}/${steps.length}</div><h3>${esc(st.t)}</h3><p>${st.b}</p><div class="trow"><button class="px-btn" id="tutNext">${k === steps.length - 1 ? 'LOS!' : 'WEITER ▶'}</button></div>`;
    // der Karte ausweichen: liegt das markierte Element unten, kommt die Karte nach oben und umgekehrt
    el.classList.remove('top', 'bottom');
    const r = t && t.getBoundingClientRect(); el.classList.add(r && r.top + r.height / 2 > innerHeight * .5 ? 'top' : 'bottom');
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
    d[i * 4] = border ? c[0] * .55 : c[0]; d[i * 4 + 1] = border ? c[1] * .55 : c[1]; d[i * 4 + 2] = border ? c[2] * .55 : c[2]; d[i * 4 + 3] = border ? 245 : 155;
    this.ovDirty = true;
  },
  fullRepaint() {
    const M = this.map, d = this.ovImg.data;
    if (this.phase === 'choose') {
      // Gemeindegrenzen als Vorschau
      for (let i = 0; i < M.N; i++) { const g = M.gem[i]; if (!g) { d[i * 4 + 3] = 0; continue; } const c = this.rgb(WAR_COLORS[g]); let b = false; for (const n of this.neighbors(i)) if (M.gem[n] !== g) b = true; d[i * 4] = c[0]; d[i * 4 + 1] = c[1]; d[i * 4 + 2] = c[2]; d[i * 4 + 3] = b ? 230 : 70; }
    } else for (let i = 0; i < M.N; i++) this.paint(i);
    this.ovDirty = true;
  },
  render() {
    const g = this.ctx, M = this.map; if (!M) return;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0); g.fillStyle = '#dfe6ea'; g.fillRect(0, 0, this.W, this.H);
    if (this.ovDirty) { this.ovCtx.putImageData(this.ovImg, 0, 0); this.ovDirty = false; }
    const [ox, oy] = this.g2s(0, 0), s = this.cam.s;
    g.imageSmoothingEnabled = s < 2; g.drawImage(this.base, ox, oy, M.w * s, M.h * s);
    const R = this.relief;
    if (R && R.complete && R.naturalWidth) {
      const lx = (-622.276 - (M.x0 - O0[0])) / M.cell, ly = ((M.y1 - O0[1]) - 26477.241) / M.cell, k = 20.01346 / M.cell;
      g.globalCompositeOperation = 'multiply'; g.globalAlpha = .6; g.imageSmoothingEnabled = true;
      g.drawImage(R, ox + lx * s, oy + ly * s, R.naturalWidth * k * s, R.naturalHeight * k * s);
      g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
    }
    g.imageSmoothingEnabled = false; g.drawImage(this.ov, ox, oy, M.w * s, M.h * s);
    // Gebäude
    g.textAlign = 'center'; g.textBaseline = 'middle';
    if (this.phase === 'play') {
      const fs = clamp(s * 5, 12, 26); g.font = `${fs}px system-ui`;
      const big = s >= 2.2;
      g.setLineDash([4, 4]); g.lineWidth = 1.5;
      for (const b of this.buildings) if (b.type === 'burg' && b.owner === this.me.id) { const [x, y] = this.g2s(b.i % M.w + .5, Math.floor(b.i / M.w) + .5); g.strokeStyle = 'rgba(255,255,255,.8)'; g.beginPath(); g.arc(x, y, 12 * s, 0, 7); g.stroke(); }
      g.setLineDash([]);
      for (const b of this.buildings) { const [x, y] = this.g2s(b.i % M.w + .5, Math.floor(b.i / M.w) + .5); if (x < -30 || y < -30 || x > this.W + 30 || y > this.H + 30) continue; g.fillStyle = this.players[b.owner - 1].color; g.strokeStyle = '#fff'; g.lineWidth = 1.5; g.beginPath(); g.arc(x, y, big ? fs * .62 : 3.5, 0, 7); g.fill(); g.stroke(); if (big) g.fillText(WAR_BUILD[b.type].icon, x, y + 1); }
      // Angriffspfeile des Spielers
      for (const a of this.attacks) if (a.att === this.me.id || a.def === this.me.id) { const [x, y] = this.g2s(a.tx + .5, a.ty + .5); g.strokeStyle = a.att === this.me.id ? 'rgba(255,255,255,.9)' : 'rgba(207,66,55,.9)'; g.lineWidth = 2; g.beginPath(); g.arc(x, y, 9 + Math.sin(performance.now() / 200) * 2, 0, 7); g.stroke(); }
    }
    // Namen und Truppen
    for (const p of this.players) {
      if (this.phase === 'play' && !p.alive) continue;
      const [x, y] = this.g2s(p.lx + .5, p.ly + .5), size = this.phase === 'play' ? clamp(Math.sqrt(p.cells) * s * .22, 10, 30) : clamp(s * 9, 11, 22);
      if (x < -100 || y < -50 || x > this.W + 100 || y > this.H + 50) continue;
      g.font = `${size}px ${this.labelFont || 'system-ui'}`; g.lineWidth = 3; g.strokeStyle = 'rgba(255,255,255,.85)'; g.fillStyle = '#18223a';
      const nm = (this.phase === 'play' && p !== this.me && this.allied(p.id, this.me.id) ? '🤝 ' : '') + p.name; g.strokeText(nm, x, y); g.fillText(nm, x, y);
      if (this.phase === 'play') { g.font = `${size * .8}px ${this.labelFont || 'system-ui'}`; g.strokeText(fmtK(p.troops), x, y + size); g.fillText(fmtK(p.troops), x, y + size); }
    }
  },
};
function fmtK(v) { v = Math.max(0, v); return v >= 1e6 ? (v / 1e6).toFixed(2) + ' Mio.' : v >= 1e4 ? Math.round(v / 1000) + 'k' : v >= 1000 ? (v / 1000).toFixed(1) + 'k' : String(Math.round(v)); }
