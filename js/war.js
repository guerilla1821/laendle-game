'use strict';
const snd = n => { if (typeof Snd !== 'undefined') Snd.play(n); };   // Snd ist eine Konstante, kein window-Eigenschaft
/* Kampf um Liechtenstein: Gebietsstrategie nach dem Prinzip von OpenFront, vereinfacht.
   Raster 25 m (aus der Pipeline): Gemeinde, Boden, Höhe. Bevölkerung und Arbeitsplätze aus dem Hektarraster.
   11 Gemeinden, eine davon spielst du, die anderen sind Bots. Wer 50 % des Landes hält, gewinnt. */
// Farben nach der Palette der Retro-Konsole PICO-8
const WAR_COLORS = ['#000', '#ff004d', '#29adff', '#ffec27', '#00e436', '#ff77a8', '#ffa300', '#83769c', '#ffccaa', '#ab5236', '#c2c3c7', '#fff1e8'];
const WAR_BUILD = {
  siedlung: { name: 'Siedlung', cost: 220, eff: '+1500 Truppen-Max.', info: 'Erhöht dein Truppen-Maximum um 1500. Mehr Maximum heisst auch schnelleres Wachstum.' },
  burg: { name: 'Burg', cost: 1200, eff: 'Abwehr ×3, 500 m', info: 'Gegner brauchen im Umkreis von 500 m dreimal so viele Truppen pro Feld. Bau sie an die Grenze zu starken Nachbarn.' },
  markt: { name: 'Markt', cost: 260, eff: '+6 Gold/s', info: 'Bringt 6 Gold pro Sekunde zusätzlich.' },
  soeldner: { name: 'Söldner', cost: 400, eff: '+20 % Truppen', info: 'Sofort Truppen in Höhe von 20 % deines Maximums. Du kannst 4 Mal pro Partie anwerben, jede Anwerbung kostet doppelt so viel, danach 60 s Pause.' },
};
// Schwierigkeit: Wachstum der Computergegner, ab welcher Truppenstärke sie angreifen, Schonfrist für dich, wie viele dich gleichzeitig angreifen, Punkte
const WAR_LEVELS = {
  leicht: { name: 'LEICHT', grow: .8, attackAt: .55, grace: 180, maxOnMe: 1, score: .6 },
  normal: { name: 'NORMAL', grow: 1, attackAt: .45, grace: 150, maxOnMe: 2, score: 1 },
  schwer: { name: 'SCHWER', grow: 1.12, attackAt: .38, grace: 30, maxOnMe: 4, score: 1.5 },
};
// Wirtschaftsmodell, umschaltbar mit ?modell=einwohner in der Adresse (zum Vergleichen und Zurückwechseln)
const WAR_MODELS = {
  // wie im Original (OpenFront): Truppen nur aus der Fläche (leicht abnehmender Ertrag, OpenFront nutzt Exponent 0.6), Einwohner und Arbeitsplätze bringen Gold
  flaeche: { raw: (c, pe, jo) => FL_B + FL_A * Math.pow(c, FL_E), gold: (c, pe, jo) => 4 + jo * .012 + pe * .01 + c * .001 },
  // bis 8.11.2026: Einwohner und Arbeitsplätze zählen direkt als Truppen
  einwohner: { raw: (c, pe, jo) => 800 + c * 1.5 + pe * 6 + jo * 2, gold: (c, pe, jo) => 4 + jo * .012 + c * .0015 },
};
// Flächenmodell: Exponent (unter 1 = abnehmender Ertrag); geeicht auf 8000 Truppen bei 600 Feldern (Start) und 45000 bei 12000 Feldern
const FL_E = (() => { try { const e = +new URLSearchParams(location.search).get('exp'); return e > .3 && e <= 1 ? e : .9; } catch (x) { return .9; } })();
const FL_A = 37000 / (Math.pow(12000, FL_E) - Math.pow(600, FL_E)), FL_B = 8000 - FL_A * Math.pow(600, FL_E);
const WAR_MODEL = (() => { try { const m = new URLSearchParams(location.search).get('modell'); return WAR_MODELS[m] ? m : 'flaeche'; } catch (e) { return 'flaeche'; } })();
// Eigenschaften der Oberhäupter: eine Stärke, eine Schwäche, eine Geheimwaffe (einmal pro Partie). Gelten für dich und die Computergegner.
// def: Faktor für Angreifer überall, defAt(höhe, bodenart)/defHome: nur dort, atk(höhe): eigene Angriffskosten, speed: Vorrücken, grow/gold/max: Faktoren
const WAR_TRAITS = {
  Balzers: { plus: 'Angreifer zahlen überall 25 % mehr.', minus: 'Deine Angriffe rücken 25 % langsamer vor.', def: 1.25, speed: .75, w: { id: 'rush', name: 'Hafalääb-Rennen', text: '30 s lang rücken deine Angriffe dreimal so schnell vor.', dur: 30, off: true } },
  Eschen: { plus: 'Truppen wachsen 10 % schneller.', minus: 'Andere nehmen deine Bündnisse seltener an.', grow: 1.1, pact: -.15, w: { id: 'volley', name: 'Kolpa-Katapult', text: 'Alle Nachbarn, die nicht mit dir verbündet sind, verlieren sofort 15 % ihrer Truppen.', dur: 0, off: true } },
  Gamprin: { plus: 'Deine Angriffe rücken 20 % schneller vor.', minus: 'Truppen-Maximum 7 % kleiner.', speed: 1.2, max: .93, w: { id: 'wet', name: 'Gampriner Seele', text: '30 s lang kosten Angriffe auf dich das Doppelte.', dur: 30 } },
  Mauren: { plus: 'In deinem Wald zahlen Angreifer 50 % mehr.', minus: 'Eigene Angriffe über 600 m kosten 10 % mehr.', defAt: (h, cls) => cls === 3 ? 1.5 : 1, atk: h => h >= 600 ? 1.1 : 1, w: { id: 'refill', name: 'Brunnenmarsch', text: 'Sofort Truppen in Höhe von 40 % deines Maximums.', dur: 0 } },
  Planken: { plus: 'Im Gebiet der Gemeinde Planken zahlen Angreifer 50 % mehr.', minus: '15 % weniger Gold.', defHome: 1.5, gold: .85, w: { id: 'fortress', name: 'Drei Schwestern', text: '60 s lang kostet dein Heimatgebiet Angreifer das Fünffache.', dur: 60 } },
  Ruggell: { plus: 'Eigene Angriffe unter 600 m kosten 20 % weniger.', minus: 'Über 900 m kosten sie 30 % mehr.', atk: h => h < 600 ? .8 : h >= 900 ? 1.3 : 1, w: { id: 'pause', name: 'Sibirische Schwertlilie', text: 'Alle Angriffe auf dich enden sofort, und 25 s lang greift dich niemand an.', dur: 25 } },
  Schaan: { plus: 'Truppen-Maximum 5 % grösser.', minus: 'Angreifer zahlen überall 20 % weniger.', max: 1.05, def: .8, w: { id: 'esel', name: 'Palmesel', text: '30 s lang ignorieren deine Angriffe Burgen und Heimvorteil.', dur: 30, off: true } },
  Schellenberg: { plus: 'Burgen kosten die Hälfte.', minus: 'Siedlungen kosten 50 % mehr.', cost: { burg: .5, siedlung: 1.5 }, w: { id: 'shell', name: 'Burgen-Hütchenspiel', text: 'Alle Angriffe auf dich verlieren sofort die Hälfte ihrer Truppen.', dur: 0 } },
  Triesen: { plus: 'Eigene Angriffe über 900 m kosten 30 % weniger.', minus: 'Unter 600 m kosten sie 15 % mehr.', atk: h => h >= 900 ? .7 : h < 600 ? 1.15 : 1, w: { id: 'candle', name: 'Kerzeten', text: '45 s lang wachsen deine Truppen doppelt so schnell.', dur: 45, off: true } },
  Triesenberg: { plus: 'Über 900 m zahlen Angreifer 40 % mehr.', minus: 'Eigene Angriffe unter 600 m kosten 25 % mehr.', defAt: h => h >= 900 ? 1.4 : 1, atk: h => h < 600 ? 1.25 : 1, w: { id: 'dialect', name: 'Walserdialekt', text: '30 s lang zählt bei deinen Angriffen die Truppendichte der Gegner nicht.', dur: 30, off: true } },
  Vaduz: { plus: '25 % mehr Gold.', minus: 'Deine Angriffe rücken 10 % langsamer vor.', gold: 1.25, speed: .9, w: { id: 'firework', name: 'Staatsfeiertags-Feuerwerk', text: '30 s lang kosten deine Angriffe die Hälfte.', dur: 30, off: true } },
};
// Ereignisse im Ländle: alle 2,5 bis 3,5 Minuten eines, für alle gleich
const WAR_EVENTS = [
  { id: 'foehn', name: 'FÖHNSTURM', dur: 30, text: 'Unter 600 m verteidigen alle schlechter: Angriffe kosten dort 40 % weniger.' },
  { id: 'hochwasser', name: 'RHEINHOCHWASSER', dur: 30, text: 'Der Talboden am Rhein steht unter Wasser: Dort kostet jedes Feld das Doppelte.' },
  { id: 'feiertag', name: 'STAATSFEIERTAG', dur: 30, text: 'Alle bekommen doppeltes Gold.' },
  { id: 'fasnacht', name: 'FASNACHT', dur: 25, text: 'feiert Fasnacht: Dort wachsen so lange keine Truppen nach.' },
  { id: 'winter', name: 'WINTEREINBRUCH', dur: 30, text: 'Schnee in den Bergen: Über 1200 m kostet jedes Feld das Doppelte.' },
];
const EASE_AFTER = 720, EASE_SPAN = 600, EASE_MIN = .3;   // ab Minute 12 sinken die Kosten für Angriffe auf Gegner in 10 Minuten auf 30 %
const BURG_R = 20, BURG_F = 3;   // Burg: Radius in Feldern (25 m), Faktor für Angreifer
const LEADER_HUNT = false;   // Jagd auf den Führenden ausgeschaltet (9.11.2026, zum Ausprobieren)
const LEADER_HUNT_AFTER = 360, LEADER_HUNT_SHARE = 0.1, COLLAPSE_AFTER = 360, PREY_AFTER = 360, PREY_SHARE = 0.02, MERC_MAX = 4, MERC_PAUSE = 60, BOT_MERC_MAX = 2, COLLAPSE_SHARE = 0.01, WIN_SHARE = 0.5, PACT_TIME = 300, TRAITOR_TIME = 30;

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
    this.phase = 'off'; this.halt.clear(); this.closeMenu(); $('#warScreen').hidden = true; $('#wTut').hidden = true; if (this.onExit) this.onExit();
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
      if (pts.size === 1) {
        const d = down = { x: e.clientX, y: e.clientY, cx: this.cam.x, cy: this.cam.y, moved: false };
        // langer Druck (Finger oder Maus): Feld-Info statt Angriff
        clearTimeout(this._lp); this._lp = setTimeout(() => { if (down === d && !d.moved && pts.size === 1) { d.moved = true; this.hover(d.x, d.y, true); } }, 480);
      }
      if (pts.size === 2) { clearTimeout(this._lp); const [a, b] = [...pts.values()]; pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), s: this.cam.s, my: (a[1] + b[1]) / 2, an: Math.atan2(b[1] - a[1], b[0] - a[0]), t: this.cam.tilt, w: this.cam.yaw }; down = null; }
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
        const dx = e.clientX - down.x, dy = e.clientY - down.y; if (Math.hypot(dx, dy) > 8) { if (!down.moved || !$('#wTip').hidden) $('#wTip').hidden = true; down.moved = true; clearTimeout(this._lp); }
        if (down.moved) { const cy = Math.cos(this.cam.yaw), sy = Math.sin(this.cam.yaw), s = this.cam.s; this.cam.x = down.cx - (cy * dx + sy * dy) / s; this.cam.y = down.cy - (-sy * dx + cy * dy) / s; this.clampCam(); }
      }
    });
    const up = e => {
      if (rdrag) { rdrag = null; return; }
      clearTimeout(this._lp); if (!pts.has(e.pointerId)) return; pts.delete(e.pointerId); if (pts.size < 2) pinch = null;
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
    $('#wWeapon').onclick = () => { const me = this.me; if (!me || this.phase !== 'play' || this.over) return; if (me.wUsed) { toast('Deine Geheimwaffe ist für diese Partie verbraucht.'); return; } this.useWeapon(me); };
    let last = performance.now(), acc = 0;
    const loop = t => {
      const dt = Math.min(.25, (t - last) / 1000); last = t;
      if (this.phase === 'play' && !this.halt.size) { acc += dt; let n = 0; while (acc >= .1 && n < 8) { acc -= .1; this.tick(); n++; } if (n >= 8) acc = 0; }
      if (this.phase !== 'off') this.render();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  },
  resize() { if (!this.cv) return; const r = this.cv.getBoundingClientRect(); this.dpr = Math.min(devicePixelRatio || 1, 2); this.W = r.width; this.H = r.height; this.cv.width = r.width * this.dpr; this.cv.height = r.height * this.dpr; if (typeof War3D !== 'undefined' && War3D.ok) War3D.resize(); this.layout(); },
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
    M.cost = new Float32Array(N); M.pers = new Float32Array(N); M.jobs = new Float32Array(N); M.pass = new Uint8Array(N); M.land = 0;
    const share = (cell * cell) / 10000;
    for (let i = 0; i < N; i++) {
      if (!M.gem[i]) continue; const cls = M.boden[i] & 15;
      if (cls === 4) { M.cost[i] = Infinity; continue; }
      M.land++; M.pass[i] = 1;
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
    const M = this.map; this.phase = 'choose'; if (this.onPhase) this.onPhase('choose'); this.owner = new Uint8Array(M.N); this.buildings = []; this.bAt = new Map(); this.attacks = []; this.feed = [];
    this.players = M.names.map((n, k) => ({ id: k + 1, name: n, tr: WAR_TRAITS[n] || {}, color: WAR_COLORS[k + 1], troops: 0, gold: 120, cells: 0, pers: 0, jobs: 0, alive: true, bot: true, nextAi: 0, lx: 0, ly: 0 }));
    this.players.forEach((p, k) => { const b = this.startPoints()[k]; p.start = b; p.lx = b % M.w; p.ly = Math.floor(b / M.w); });
    this.cam.tilt = 0; this.cam.yaw = 0; this.update3D(); this.fit(); this.fullRepaint();
    $('#wHud').hidden = true; $('#wBottom').hidden = true; $('#wBoard').hidden = true; $('#wFeed').innerHTML = ''; $('#wEvent').hidden = true; this.closeMenu(); $('#wChoose').hidden = false;
    $('#wChoose').innerHTML = `<b>Wähle deine Gemeinde</b><span>Tippe auf die Karte oder hier. Wer wer ist, steht im Menü unter DIE GEMEINDEN.</span><div class="wlvl">${Object.entries(WAR_LEVELS).map(([k, l]) => `<button data-l="${k}" aria-pressed="${(this.level || 'normal') === k}">${l.name}</button>`).join('')}</div><div class="wgems">${this.players.map(p => `<button data-g="${p.id}" style="--c:${p.color}">${typeof GEM_INFO !== 'undefined' && GEM_INFO[p.name] ? Spr.portraitImg(GEM_INFO[p.name].avatar, 1, '') : ''}${esc(p.name)}</button>`).join('')}</div>`;
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
      q.cost /= Math.max(1, q.cells); q.startMax = Math.round(WAR_MODELS[WAR_MODEL].raw(q.start.cells, q.start.pers, q.start.jobs));
    });
    const avgT = st.reduce((s, q) => s + q.cost, 0) / n, avgM = st.reduce((s, q) => s + q.startMax, 0) / n;
    st.forEach(q => { q.factor = Math.round(clamp(Math.sqrt(avgM / q.startMax) * (q.cost / avgT), 1, 3) * 10) / 10; });
    return (this._gs = st);
  },
  startGame(gid) {
    const M = this.map; this.me = this.players[gid - 1]; this.me.bot = false;
    this.lvl = WAR_LEVELS[this.level || 'normal']; const gs = this.gemStats(); this.startFloor = this.troopFloor = Math.round(gs.reduce((s, q) => s + q.startMax, 0) / gs.length); this.startCells = 0; this.warnedShrink = 0;
    this.owner.fill(0); this.buildings = []; this.attacks = []; this.feed = []; this.t = 0; this.tk = 0; this.game = (this.game || 0) + 1; this.bAt = new Map(); this.conq = 0; this.lost = 0; this.lostQ = null; this.had = new Uint8Array(M.N); this.ease = 1; this.event = null; this.nextEv = 170 + Math.random() * 50; this.easeSaid = 0; this.closeMenu(); this.build = null; this.over = false; this.score = 0; this.firstHit = false; this.pacts = new Map(); this.lastHit = {}; this.refused = {}; this.maxWarned = -999; this.nextOffer = 60;
    const R = 14;
    for (const p of this.players) {
      p.cells = p.pers = p.jobs = 0; p.alive = true; p.gold = 120; p.traitorUntil = 0; p.wUsed = false; p.wUntil = 0; p.safeUntil = 0; p.helpT = 0; p.merc = 0; p.mercT = -1e9; p.peak = 0; p.growth = 0; p.goldRate = 0; p.nextAi = 20 + Math.random() * 20;
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
    this.trace = { v: 1, session: (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2) + Date.now()), gemeinde: this.me.name, level: this.level || 'normal', modell: WAR_MODEL === 'flaeche' ? 'flaeche-' + FL_E : WAR_MODEL,
      geraet: `${innerWidth}x${innerHeight}${matchMedia('(pointer:coarse)').matches ? ' touch' : ''}`, start: new Date().toISOString(),
      spalten: 't, felder, truppen, max, gold, wachstum, angriffe_auf_mich, eigene_angriffe, gebaeude, top5 [id, felder, truppen]', snaps: [], ev: [] };
    this.labels(); this.updateHud(); this.layout(); snd('start'); if (this.onPhase) this.onPhase('play');
    if (!store.get('laendle-kampf-tut')) this.tutorial(0);
  },

  // Kurzname des Oberhaupts für Meldungen
  boss(p) { const g = typeof GEM_INFO !== 'undefined' && GEM_INFO[p.name]; return g ? `${g.short} (${p.name})` : p.name; },
  /* ---------- Regeln ---------- */
  wOn(p, id) { const w = p.tr.w; return !!w && w.id === id && p.wUntil > this.t; },
  maxTroops(p) { return Math.round(Math.max(this.troopFloor || 0, WAR_MODELS[WAR_MODEL].raw(p.cells, p.pers, p.jobs)) * (p.tr.max || 1) + 1500 * Math.pow(this.count(p, 'siedlung'), .7)); },
  count(p, type) { let n = 0; for (const b of this.buildings) if (b.owner === p.id && b.type === type) n++; return n; },
  costOf(p, type) { if (type === 'soeldner') return Math.round(WAR_BUILD.soeldner.cost * Math.pow(2, p.merc || 0)); let n = 0; for (const b of this.buildings) if (b.by === p.id && b.type === type) n++; return Math.round(WAR_BUILD[type].cost * Math.pow(1.5, n) * (p.tr.cost && p.tr.cost[type] || 1)); },
  setOwner(i, pid, silent) {
    const M = this.map, old = this.owner[i];
    if (old) { const q = this.players[old - 1]; q.cells--; q.pers -= M.pers[i]; q.jobs -= M.jobs[i]; }
    this.owner[i] = pid;
    if (pid) { const p = this.players[pid - 1]; p.cells++; p.pers += M.pers[i]; p.jobs += M.jobs[i]; }
    if (this.me && pid === this.me.id) { if (!silent) { if (!this.had[i]) this.score += old ? 3 : 1; this.conq = (this.conq || 0) + 1; } this.had[i] = 1; }
    else if (!silent && this.me && old === this.me.id) this.lost = (this.lost || 0) + 1;
    const b = this.bAt.get(i); if (b && b.owner !== pid) { const was = b.owner; b.owner = pid; if (!silent && pid === this.me.id) this.log(`${WAR_BUILD[b.type].name} erobert!`); if (!silent && was === this.me.id) { const q = this.lostQ || (this.lostQ = {}); q[b.type] = (q[b.type] || 0) + 1; } }
    if (!silent) { this.paint(i); const w = M.w; this.paint(i - 1); this.paint(i + 1); this.paint(i - w); this.paint(i + w); }
  },
  defense(i, pid) {
    let f = 1;
    for (const b of this.buildings) if (b.type === 'burg' && b.owner === pid) { const M = this.map, dx = b.i % M.w - i % M.w, dy = Math.floor(b.i / M.w) - Math.floor(i / M.w); if (dx * dx + dy * dy < BURG_R * BURG_R) { f = BURG_F; break; } }
    return f;
  },
  neighbors(i) { const M = this.map, x = i % M.w, out = []; if (x > 0) out.push(i - 1); if (x < M.w - 1) out.push(i + 1); if (i >= M.w) out.push(i - M.w); if (i < M.N - M.w) out.push(i + M.w); return out; },
  passable(i) { return this.map.pass[i] === 1; },
  // Zahl der Nachbarfelder im Besitz von pid (ohne ein Feld anzulegen: läuft sehr oft)
  nbOwn(i, pid) { const M = this.map, w = M.w, o = this.owner, x = i % w; return (x > 0 && o[i - 1] === pid ? 1 : 0) + (x < w - 1 && o[i + 1] === pid ? 1 : 0) + (i >= w && o[i - w] === pid ? 1 : 0) + (i < M.N - w && o[i + w] === pid ? 1 : 0); },
  // Angriff: von pid auf Besitzer target (0 = neutrales Land), Zielpunkt für die Stossrichtung
  attack(pid, target, troops, tx, ty) {
    const p = this.players[pid - 1]; troops = Math.min(Math.floor(troops), p.troops); if (troops < 10 || target === pid) return false;
    if (target && this.allied(pid, target)) return false;
    if (target && this.players[target - 1].safeUntil > this.t) return false;
    if (target) this.lastHit[pid + '-' + target] = this.t;
    let a = this.attacks.find(a => a.att === pid && a.def === target);
    if (!a) {
      const M = this.map, cand = [], inSet = new Set(), o = this.owner, pass = M.pass;
      for (let i = 0; i < M.N; i++) if (o[i] === target && pass[i] && this.nbOwn(i, pid)) { cand.push(i); inSet.add(i); }
      if (!cand.length) return false;
      a = { att: pid, def: target, troops: 0, cand, inSet, tx, ty, stall: 0 };
      this.attacks.push(a);
      if (target && this.players[target - 1] === this.me) { this.log(`${this.boss(p)} greift dich an!`, 'bad'); snd('attack'); if (!this.firstHit) { this.firstHit = true; this.banner('ANGRIFF!', '#ff004d'); } }
    }
    a.tx = tx; a.ty = ty; a.troops += troops; p.troops -= troops;
    return true;
  },
  stepAttack(a) {
    const M = this.map, att = this.players[a.att - 1], def = a.def ? this.players[a.def - 1] : null;
    if (!att.alive) return false;
    let budget = (2 + Math.sqrt(a.troops) / 7) * (att.tr.speed || 1) * (this.wOn(att, 'rush') ? 3 : 1), won = 0, short = false;
    const ev = this.event ? this.event.id : '', esel = this.wOn(att, 'esel'), dial = this.wOn(att, 'dialect'), fire = this.wOn(att, 'firework');
    const drop = k => { const i = a.cand[k]; a.cand[k] = a.cand[a.cand.length - 1]; a.cand.pop(); a.inSet.delete(i); };
    while (budget > 0 && a.troops > 0 && a.cand.length) {
      // aus einer Stichprobe den besten Kandidaten nehmen: viele eigene Nachbarn, nahe am Zielpunkt
      let bestK = -1, bestS = -1e9, bestI = -1;
      for (let s = 0; s < 10 && a.cand.length; s++) {
        const k = Math.floor(Math.random() * a.cand.length), i = a.cand[k];
        // veraltete Kandidaten entfernen: Feld gehört nicht mehr dem Ziel, oder die eigene Grenze dort ist verloren
        if (this.owner[i] !== a.def) { drop(k); continue; }
        const own = this.nbOwn(i, a.att);
        if (!own) { drop(k); continue; }
        const dx = i % M.w - a.tx, dy = Math.floor(i / M.w) - a.ty, sc = own * 3 - Math.sqrt(dx * dx + dy * dy) / 12 + Math.random() * 2;
        if (sc > bestS) { bestS = sc; bestK = k; bestI = i; }
      }
      if (bestK < 0 || bestK >= a.cand.length || a.cand[bestK] !== bestI) { budget -= .5; continue; }
      const i = bestI;
      // Heimat zuerst: freies Land der eigenen Gemeinde ist billig, fremdes teurer
      const hm = M.hoehe[i] || 500;
      let c = M.cost[i] * 1.6 * (M.gem[i] === a.att ? .5 : 1.6), dens = 0;
      if (def) {
        const home = M.gem[i] === def.id, dt = def.tr; dens = Math.min(10, def.troops / Math.max(1, def.cells));
        c = M.cost[i] * (2.5 + (dial ? 0 : dens) * 1.1) * (def.traitorUntil > this.t ? .6 : 1) * (esel ? 1 : this.defense(i, def.id) * (home ? 1.6 : 1));
        c *= (dt.def || 1) * (dt.defAt ? dt.defAt(hm, M.boden[i] & 15) : 1) * (home ? (dt.defHome || 1) * (this.wOn(def, 'fortress') ? 5 : 1) : 1) * (this.wOn(def, 'wet') ? 2 : 1) * this.ease;
        if (ev === 'foehn' && hm < 600) c *= .6;
      }
      if (att.tr.atk) c *= att.tr.atk(hm); if (fire) c *= .5;
      if ((ev === 'hochwasser' && hm < 455) || (ev === 'winter' && hm >= 1200)) c *= 2;
      // reicht es für dieses Feld nicht, ein anderes versuchen; die Resttruppen gehen nicht verloren
      if (a.troops < c) { short = true; budget -= 1; continue; }
      a.troops -= c; budget -= M.cost[i]; won++;
      // Verteidiger verliert die Truppen, die auf dem Feld standen (höchstens wie bisher): dünn besetztes Land blutet nicht aus
      if (def) def.troops = Math.max(0, def.troops - Math.min(c * .55, dens * 1.1));
      drop(bestK);
      this.setOwner(i, a.att);
      const w = M.w, o = this.owner, pass = M.pass, x = i % w;
      if (x > 0) { const n = i - 1; if (o[n] === a.def && pass[n] && !a.inSet.has(n)) { a.cand.push(n); a.inSet.add(n); } }
      if (x < w - 1) { const n = i + 1; if (o[n] === a.def && pass[n] && !a.inSet.has(n)) { a.cand.push(n); a.inSet.add(n); } }
      if (i >= w) { const n = i - w; if (o[n] === a.def && pass[n] && !a.inSet.has(n)) { a.cand.push(n); a.inSet.add(n); } }
      if (i < M.N - w) { const n = i + w; if (o[n] === a.def && pass[n] && !a.inSet.has(n)) { a.cand.push(n); a.inSet.add(n); } }
      if (def && def.cells <= 0) { this.eliminate(def, att); break; }
    }
    // kommt der Angriff eine Sekunde lang nicht voran (Truppen reichen für kein Feld mehr), endet er
    a.stall = won ? 0 : a.stall + 1;
    if (a.troops <= 0 || !a.cand.length || (short && a.stall >= 10) || a.stall >= 50) { att.troops += Math.max(0, a.troops); a.troops = 0; return false; }
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
    this.attacks = this.attacks.filter(a => a.def !== p.id || (this.players[a.att - 1].troops += Math.max(0, a.troops), false));
    this.eliminate(p, by);
  },
  eliminate(p, by) {
    p.alive = false; p.troops = 0; this.attacks = this.attacks.filter(a => a.att !== p.id);
    for (const b of this.buildings) if (b.owner === p.id) b.owner = by.id;
    by.gold += Math.round(p.gold); p.gold = 0; if (by === this.me) { this.score += 5000; snd('conquest'); }
    this.log(`${p.name} wurde von ${by.name} erobert.`, p === this.me ? 'bad' : by === this.me ? 'good' : '');
    if (p === this.me && !this.over) this.end(false);
  },
  tick() {
    const k = ++this.tk, M = this.map; this.t = k / 10;
    for (const p of this.players) {
      if (!p.alive) continue;
      const max = this.maxTroops(p), T = p.troops;
      p.growth = (max * .006 + T * .06) * Math.max(0, 1 - T / max) * (p.bot ? this.lvl.grow : 1) * (p.tr.grow || 1) * (this.wOn(p, 'candle') ? 2 : 1) * (this.event && this.event.id === 'fasnacht' && this.event.gem === p.id ? 0 : 1);
      p.troops = T > max ? T - (T - max) * .02 : Math.min(max, T + p.growth * .1);
      p.goldRate = (WAR_MODELS[WAR_MODEL].gold(p.cells, p.pers, p.jobs) + this.count(p, 'markt') * 6) * (p.tr.gold || 1) * (this.event && this.event.id === 'feiertag' ? 2 : 1);
      p.gold += p.goldRate * .1;
    }
    this.attacks = this.attacks.filter(a => this.stepAttack(a));
    if (k % 4 === 0) { if (this.conq) snd('tick'); if (this.lost > 3) snd('hit'); this.conq = 0; this.lost = 0; }
    if (k % 20 === 0) {
      this.adjacency();
      // Aufholhilfe: Niemand fällt unter die Hälfte der durchschnittlichen Truppenstärke (Grundwert ohne Siedlungen)
      const al = this.players.filter(p => p.alive), raw = p => WAR_MODELS[WAR_MODEL].raw(p.cells, p.pers, p.jobs);
      this.troopFloor = Math.max(this.startFloor || 0, Math.round(.5 * al.reduce((s, p) => s + raw(p), 0) / Math.max(1, al.length)));
      // verlorene Gebäude gesammelt melden (eine Meldung und ein Ton statt einer Flut)
      if (this.lostQ) { const q = this.lostQ, n = Object.values(q).reduce((a, b) => a + b, 0), pl = { burg: ['Burg', 'Burgen'], siedlung: ['Siedlung', 'Siedlungen'], markt: ['Markt', 'Märkte'] };
        this.log(n === 1 ? `Deine ${pl[Object.keys(q)[0]][0]} ist verloren!` : `${n} Gebäude verloren: ${Object.entries(q).map(([k, v]) => v + ' ' + pl[k][v > 1 ? 1 : 0]).join(', ')}.`, 'bad'); snd('lost'); this.lostQ = null; }
      // Stimmung des Trommelspiels: leise und langsam bei schwachen Truppen, schneller wenn ein Gegner sich den 50 % nähert
      if (this.me && this.me.alive && typeof Snd !== 'undefined' && Snd.setMood) Snd.setMood({ low: this.me.troops < this.maxTroops(this.me) * .2, danger: al.some(q => q.bot && q.cells / M.land >= .4) });
      // Kleinstreste nicht künstlich weiterspielen: ab Minute 6 bricht zusammen, wer unter 1 % fällt
      for (const p of al) { const sh = p.cells / M.land; p.peak = Math.max(p.peak || 0, sh); if (!this.over && this.t > COLLAPSE_AFTER && sh < COLLAPSE_SHARE) this.collapse(p); }
    }
    for (const p of this.players) if (p.bot && p.alive && this.t >= p.nextAi) { this.botThink(p); p.nextAi = this.t + 1.2 + Math.random() * 2.2; }
    if (k % 10 === 0) { this.eventTick(); this.labels(); this.updateHud(); this.pactTick(); }
    if (this.trace && k % 150 === 0) { const me = this.me;
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
    const M = this.map, n = this.players.length + 1, A = this.adj = Array.from({ length: n }, () => new Int32Array(n)), o = this.owner, pass = M.pass, w = M.w, N = M.N;
    for (let i = 0; i < N; i++) {
      if (!pass[i]) continue; const a = o[i];
      if (i % w < w - 1 && pass[i + 1]) { const b = o[i + 1]; if (b !== a) { A[a][b]++; A[b][a]++; } }
      if (i < N - w && pass[i + w]) { const b = o[i + w]; if (b !== a) { A[a][b]++; A[b][a]++; } }
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
    // Geheimwaffe zur Abwehr, wenn ein grosser Angriff läuft
    if (!p.wUsed && p.tr.w && !p.tr.w.off && this.t > 240) { let inc = 0; for (const a of this.attacks) if (a.def === p.id) inc += a.troops; if (inc > p.troops * .6 && inc > max * .1) this.useWeapon(p); }
    // bauen
    const type = Math.random() < .5 ? 'siedlung' : Math.random() < .6 ? 'markt' : 'burg', cost = this.costOf(p, type);
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
      if (target > 0 && best > 1.4 / this.ease && neutral > 0) target = 0;
      if (target > 0 && best > 2.2 / this.ease) return;
    }
    if (target < 0) return;
    const tq = target ? this.players[target - 1] : null;
    const tx = tq ? tq.lx : p.lx + (Math.random() - .5) * 200, ty = tq ? tq.ly : p.ly + (Math.random() - .5) * 200;
    // Geheimwaffe für den Angriff (einmal pro Partie, nicht in den ersten Minuten)
    if (target && !p.wUsed && p.tr.w && p.tr.w.off && this.t > 240 && Math.random() < .3) this.useWeapon(p);
    this.attack(p.id, target, p.troops * (target ? .35 : .25), tx, ty);
  },
  /* ---------- Geheimwaffen ---------- */
  useWeapon(p) {
    const w = p.tr && p.tr.w, me = this.me; if (!w || p.wUsed || !p.alive || this.over || this.phase !== 'play') return false;
    p.wUsed = true; p.wUntil = this.t + w.dur; let hitMe = false; const max = this.maxTroops(p);
    if (w.id === 'volley') { for (const q of this.players) if (q.alive && q !== p && this.adj && this.adj[p.id][q.id] && !this.allied(p.id, q.id)) { q.troops *= .85; if (q === me) hitMe = true; } }
    else if (w.id === 'refill') p.troops = Math.min(max, p.troops + max * .4);
    else if (w.id === 'shell') { for (const a of this.attacks) if (a.def === p.id) { a.troops *= .5; if (a.att === me.id) hitMe = true; } }
    else if (w.id === 'pause') { p.safeUntil = this.t + w.dur; this.attacks = this.attacks.filter(a => a.def !== p.id || (this.players[a.att - 1].troops += Math.max(0, a.troops), a.att === me.id && (hitMe = true), false)); }
    if (p === me) { this.banner(w.name.toUpperCase(), '#ffec27'); this.log(`Geheimwaffe ${w.name}: ${w.text}`, 'good'); }
    else this.log(`${this.boss(p)} zündet die Geheimwaffe: ${w.name}!`, hitMe ? 'bad' : 'warn');
    snd('weapon'); this.updateHud(); return true;
  },
  /* ---------- Ereignisse und Schlussphase ---------- */
  eventTick() {
    const me = this.me;
    // Schlussphase: Angriffe auf Gegner werden laufend billiger, damit die Partie ein Ende findet
    this.ease = this.t <= EASE_AFTER ? 1 : Math.max(EASE_MIN, 1 - (this.t - EASE_AFTER) / EASE_SPAN * (1 - EASE_MIN));
    const stage = this.t > EASE_AFTER + EASE_SPAN ? 3 : this.t > EASE_AFTER + EASE_SPAN / 2 ? 2 : this.t > EASE_AFTER ? 1 : 0;
    if (stage > this.easeSaid) { this.easeSaid = stage; if (stage === 1) this.banner('ENTSCHEIDUNG NAHT', '#ffa300'); this.log(['', 'Minute 12: Ab jetzt werden Angriffe auf Gegner laufend billiger.', 'Die Fronten bröckeln: Angriffe auf Gegner kosten nur noch 65 %.', 'Endkampf: Angriffe auf Gegner kosten nur noch 30 %.'][stage], 'warn'); snd('event'); }
    const E = this.event;
    if (E && this.t >= E.until) { this.event = null; this.log(`${E.name} ist vorbei.`); this.nextEv = this.t + 150 + Math.random() * 60; }
    else if (!E && this.t >= this.nextEv && !this.over) {
      const def = WAR_EVENTS[Math.floor(Math.random() * WAR_EVENTS.length)], ev = this.event = { id: def.id, name: def.name, until: this.t + def.dur, text: def.text };
      if (def.id === 'fasnacht') { const al = this.players.filter(p => p.alive), g = al[Math.floor(Math.random() * al.length)]; ev.gem = g.id; ev.text = `${g.name} ${def.text}`; }
      this.banner(def.name, '#29adff'); this.log(`${def.name}: ${ev.text}`, ev.gem === me.id ? 'bad' : 'warn'); snd('event');
    }
    const el = $('#wEvent'); if (!el) return; const lines = [];
    if (this.event) lines.push(`<b>${esc(this.event.name)} ${Math.max(0, Math.ceil(this.event.until - this.t))} s</b> ${esc(this.event.text)}`);
    if (me.tr.w && me.wUntil > this.t) lines.push(`<b class="w">${esc(me.tr.w.name.toUpperCase())} ${Math.ceil(me.wUntil - this.t)} s</b>`);
    if (me.safeUntil > this.t) lines.push(`<b class="w">NIEMAND GREIFT DICH AN ${Math.ceil(me.safeUntil - this.t)} s</b>`);
    if (this.ease < 1) lines.push(`<b class="e">SCHLUSSPHASE: ANGRIFFE AUF GEGNER ${Math.round(this.ease * 100)} %</b>`);
    const html = lines.join('<br>'); if (el._h !== html) { el._h = html; el.innerHTML = html; el.hidden = !html; }
  },
  // Schutz des Spielers vor zu vielen gleichzeitigen Angreifern. Zählt nur ernsthafte Angriffe (mind. 3 % des Truppen-Maximums
  // des Angreifers). Mit LEADER_HUNT wäre der Führende ab Minute 6 und 10 % Land ungeschützt (zurzeit aus).
  shielded(p) {
    const me = this.me; if (!me || !me.alive) return false;
    if (LEADER_HUNT && this.t > LEADER_HUNT_AFTER && me.cells / this.map.land >= LEADER_HUNT_SHARE && this.players.every(q => !q.alive || q === me || q.cells <= me.cells)) return false;
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
    p.gold -= cost; const nb = { type, owner: p.id, by: p.id, i }; this.buildings.push(nb); this.bAt.set(i, nb);
    if (p === this.me) { this.log(`${WAR_BUILD[type].name} gebaut.`); this.score += 50; snd('build'); }
    return true;
  },
  end(win, winner) {
    this.over = true; this.halt.add('end');
    const land = Math.round(this.me.cells / this.map.land * 100), min = Math.max(1, Math.round(this.t / 60));
    const bonus = win ? 50000 + Math.max(0, Math.round((1500 - this.t) * 40)) : 0, total = Math.round((this.score + bonus) * this.factor * this.lvl.score);
    // Schlussplatz: Sieger ist Erster; sonst zählen alle Gemeinden, die noch leben und mehr Land haben (wer erobert ist, steht hinter allen Lebenden)
    const others = this.players.filter(q => q !== this.me && q.alive), platz = win ? 1 : this.me.alive ? 1 + others.filter(q => q.cells > this.me.cells).length : 1 + others.length;
    if (this.trace) this.trace.platz = platz;
    if (this.onPhase) this.onPhase('end');
    snd(win ? 'win' : 'lose'); this.upload(win ? 'sieg' : winner ? 'niederlage:' + winner.name : 'erobert', total);
    if (this.onEnd) this.onEnd({ win, winner, land, min, base: this.score, bonus, factor: this.factor, level: this.lvl, total, platz, gem: this.me.name, color: this.me.color });
  },
  continueAfterWin() { if (this.onPhase) this.onPhase('play'); this.halt.delete('end'); },
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
    if (o && this.players[o - 1].safeUntil > this.t) { toast(`${this.players[o - 1].name} ist gerade unangreifbar (Geheimwaffe).`); return; }
    const sent = Math.floor(me.troops * this.ratio), ok = this.attack(me.id, o, sent, i % M.w, Math.floor(i / M.w)); if (ok) snd(o ? 'charge' : 'tap');
    if (!ok) toast(sent < 10 ? 'Zu wenig Truppen.' : 'Keine gemeinsame Grenze.');
    else if (o) this.log(`Angriff auf ${this.players[o - 1].name} mit ${fmtK(sent)} Truppen.`);
    this.updateHud();
  },
  hover(sx, sy, sticky) {
    if (!this.map) return; const i = this.cellAt(sx, sy), tip = $('#wTip');
    if (i < 0 || !this.map.gem[i] || this.phase === 'off') { tip.hidden = true; return; }
    const M = this.map, o = this.owner[i], q = o ? this.players[o - 1] : null, c = M.cost[i], me = this.me;
    const terr = c === Infinity ? 'WASSER' : c < 1.3 ? 'LEICHT' : c < 2 ? 'MITTEL' : c < 3 ? 'SCHWER' : 'SEHR SCHWER';
    const lines = [q ? `<b style="color:${q.color}">${esc(q.name.toUpperCase())}</b>${q === me ? ' (DU)' : me && this.allied(q.id, me.id) ? ' (VERBÜNDET)' : ''}` : '<b>FREIES LAND</b>'];
    if (q && q !== me) lines.push(`TRUPPEN ${fmtK(q.troops)}`);
    if (c !== Infinity) lines.push(`EROBERN: ${terr}${q && q !== me && M.gem[i] === q.id ? ', HEIMVORTEIL' : ''}${q && this.defense(i, q.id) > 1 ? ', BURG' : ''}`); else lines.push('NICHT EROBERBAR');
    if (sticky) { lines.push(`${Math.round(M.hoehe[i] || 0)} M Ü. M.`); if (q && q !== me && this.phase === 'play' && q.tr.plus) lines.push(`+ ${esc(q.tr.plus)}`, `- ${esc(q.tr.minus)}`); }
    tip.hidden = false; tip.innerHTML = lines.join('<br>');
    // im Bild halten; beim langen Druck über dem Finger
    const w = tip.offsetWidth, h = tip.offsetHeight; tip.style.left = clamp(sticky ? sx - w / 2 : sx + 14, 6, innerWidth - w - 6) + 'px'; tip.style.top = clamp(sticky ? sy - h - 28 : sy + 14, 6, innerHeight - h - 6) + 'px';
  },
  zoomAt(sx, sy, f) {
    if (this.is3D()) { this.cam.s = clamp(this.cam.s * f, this.minS || .3, 40); return; }
    const r = this.cv.getBoundingClientRect(), [gx, gy] = this.s2g(sx - r.left, sy - r.top);
    this.cam.s = clamp(this.cam.s * f, this.minS || .3, 40); this.cam.x = gx - (sx - r.left - this.W / 2) / this.cam.s; this.cam.y = gy - (sy - r.top - this.H / 2) / this.cam.s; this.clampCam();
  },
  fit() { const M = this.map, top = 64, bot = this.W < 700 ? 150 : 100; this.minS = Math.min(this.W / M.w, (this.H - top - bot) / M.h) * .95; this.cam.s = this.minS; this.cam.x = M.w / 2; this.cam.y = M.h / 2 + (bot - top) / 2 / this.cam.s; },
  clampCam() { const M = this.map; this.cam.x = clamp(this.cam.x, 0, M.w); this.cam.y = clamp(this.cam.y, 0, M.h); },
  updateBuildBtns() {
    document.querySelectorAll('#wBuild button').forEach(b => { const t = b.dataset.b, c = this.me ? this.costOf(this.me, t) : WAR_BUILD[t].cost; b.querySelector('small').innerHTML = fmtK(c) + '<u> Gold</u>'; b.querySelector('em').textContent = WAR_BUILD[t].eff; b.setAttribute('aria-pressed', this.build === t); b.classList.toggle('poor', !this.me || this.me.gold < c);
      if (t === 'soeldner') { const left = Math.max(0, MERC_MAX - (this.me ? this.me.merc || 0 : 0)); b.dataset.left = left + '×'; b.title = `Söldner: sofort +20 % Truppen für Gold. Noch ${left} von ${MERC_MAX} Anwerbungen.`; if (!left) { b.querySelector('small').textContent = 'GENUTZT'; b.classList.add('poor'); } } });
    const wb = $('#wWeapon'), mw = this.me && this.me.tr.w; if (wb && mw) { const used = this.me.wUsed; wb.classList.toggle('used', !!used); wb.title = `Geheimwaffe ${mw.name}: ${mw.text} Einmal pro Partie.`; const h = `<i>${Spr.img('stern', 2)}</i><span>${esc(mw.name.toUpperCase())}</span><small>${used ? 'VERBRAUCHT' : 'GEHEIMWAFFE'}</small>`; if (wb._h !== h) { wb._h = h; wb.innerHTML = h; } }
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
    // PC und Tablet: immer alle 11 mit beschrifteten Bündnisknöpfen; Handy: aufklappbar, nur Symbole
    const wide = innerWidth > 700 && innerHeight > 500, rank = all.indexOf(me), open = wide || this.boardOpen, L = (img, txt) => wide ? `${img}<b>${txt}</b>` : img;
    let rows = open ? all : all.filter(p => p.alive).slice(0, 3); if (!open && !rows.includes(me)) rows = rows.concat([me]);
    const row = p => {
      const k = all.indexOf(p), pact = this.pacts.get(this.pk(me.id, p.id)), left = pact ? Math.max(0, Math.round(pact.until - this.t)) : 0;
      const act = !open ? '' : p === me || !p.alive ? `<button class="ph" tabindex="-1" aria-hidden="true">${L(Spr.img('pakt', 1), 'BÜNDNIS')}</button>` : pact ? `<button class="ally" data-a="ally" data-p="${p.id}" title="Verbündeter: Hilfe rufen, Gold oder Truppen schicken, Bündnis brechen">${L(Spr.img('pakt', 1), 'AKTION')}</button>` : this.refused[p.id] > this.t ? `<button disabled title="Abgelehnt, bald wieder möglich">${L(Spr.img('pakt', 1), 'BÜNDNIS')}</button>` : `<button data-a="offer" data-p="${p.id}" title="Bündnis anbieten">${L(Spr.img('pakt', 1), 'BÜNDNIS')}</button>`;
      return `<div class="${p === me ? 'me' : ''}${p.alive ? '' : ' dead'}" data-f="${p.id}"><i style="background:${p.color}"></i><em>${k + 1}.</em> ${esc(p.name)}${pact ? ` <small class="pact" title="Bündnis, noch ${left} s">${Spr.img('pakt', 1)}${wide ? 'VERBÜNDET ' : ''}${Math.ceil(left / 60)}M</small>` : ''}${p.traitorUntil > this.t ? ` ${Spr.img('warn', 1, 'Verräter')}` : ''}<span>${p.alive ? (p.cells / M.land * 100).toFixed(1) + ' %' : 'erobert'}</span>${open ? `<span class="tr">${p.alive ? fmtK(p.troops) : ''}</span>` : ''}${act}</div>`;
    };
    const html = rows.map(row).join('') + (wide ? '' : `<button class="more" data-a="toggle">${open ? 'WENIGER' : `ALLE ${all.length} GEMEINDEN`}</button>`) + `<div class="goal">ZIEL: ${WIN_SHARE * 100} %</div>`;
    const el = $('#wBoard'); el.classList.toggle('open', !!open); el.classList.toggle('wide', wide); if (el._html === html) return; el._html = html; el.innerHTML = html;
    el.querySelectorAll('[data-a]').forEach(b => b.onclick = e => { e.stopPropagation(); const a = b.dataset.a, q = this.players[(+b.dataset.p || 1) - 1];
      if (a === 'toggle') this.boardOpen = !this.boardOpen; else if (a === 'offer') this.offer(me, q); else if (a === 'ally') this.allyMenu(q);
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
    const L = this.leader(), land = this.map.land; let w = .3 + (q.tr.pact || 0);
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
    if (betray) { a.traitorUntil = this.t + TRAITOR_TIME; this.log(`${a.name} bricht das Bündnis mit ${b.name}! ${TRAITOR_TIME} s lang verteidigt ${a.name} schlechter.`, b === this.me ? 'bad' : a === this.me ? 'warn' : ''); if (b === this.me) snd('betray'); }
  },
  pactTick() {
    const me = this.me;
    for (const [k, v] of [...this.pacts.entries()]) {
      const [a, b] = k.split('-').map(n => this.players[n - 1]);
      if (!a.alive || !b.alive || v.until <= this.t) { this.pacts.delete(k); if (a.alive && b.alive) this.log(`Das Bündnis ${a.name} und ${b.name} ist abgelaufen.`, a === me || b === me ? 'warn' : ''); continue; }
      const other = a === me ? b : b === me ? a : null;
      if (other && !v.warned && v.until - this.t < 25) { v.warned = true; this.ask(`Bündnis mit ${other.name} endet bald. Verlängern?`, 'Verlängern', () => { if (v.bond || Math.random() < this.willing(other, me) + .25) { v.until = this.t + PACT_TIME; v.warned = false; this.log(`Bündnis mit ${other.name} verlängert.`, 'good'); } else this.log(`${other.name} will nicht verlängern.`); }); }
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
    if (y === me) snd('offer');
    if (y === me) this.ask(`${this.boss(x)} bietet dir ein Bündnis an (${PACT_TIME / 60} Minuten).`, 'Annehmen', () => { if (x.alive && !this.allied(x.id, me.id)) this.makePact(x, me); });
    else this.makePact(x, y);
  },
  // Aktionen mit einem Verbündeten: Hilfe rufen, Gold oder Truppen schicken, Bündnis brechen
  allyMenu(q) {
    const me = this.me; if (!q.alive || !this.allied(me.id, q.id)) return;
    const gold = Math.floor(me.gold * .25), tr = Math.floor(me.troops * .2);
    this.menu(`${this.boss(q)}, dein Verbündeter`, [
      { label: 'HILFE RUFEN', hint: 'greift deinen Gegner an', fn: () => this.callHelp(q) },
      { label: `GOLD SCHICKEN (${fmtK(gold)})`, hint: 'ein Viertel deines Goldes', off: gold < 50, fn: () => this.gift(q, 'gold') },
      { label: `TRUPPEN SCHICKEN (${fmtK(tr)})`, hint: 'ein Fünftel deiner Truppen', off: tr < 100, fn: () => this.gift(q, 'troops') },
      { label: 'BÜNDNIS BRECHEN', cls: 'red', hint: `${TRAITOR_TIME} s Verräter`, fn: () => this.breakPact(me, q, true) },
    ]);
  },
  // Der Verbündete greift an: zuerst den stärksten Angreifer auf dich, sonst dein letztes Ziel (jeweils an seiner Grenze)
  callHelp(q) {
    const me = this.me, A = this.adj; if (!q.alive || !this.allied(me.id, q.id)) return;
    if (this.t < q.helpT) { this.log(`${this.boss(q)} hat gerade erst geholfen. Frag in ${Math.ceil(q.helpT - this.t)} s wieder.`); return; }
    const ok = x => x && x.alive && x !== q && x !== me && A && A[q.id][x.id] && !this.allied(q.id, x.id) && !(x.safeUntil > this.t);
    let target = null, best = 0;
    for (const a of this.attacks) if (a.def === me.id && a.troops > best && ok(this.players[a.att - 1])) { best = a.troops; target = this.players[a.att - 1]; }
    if (!target) { let last = -1e9; for (const x of this.players) { const h = this.lastHit[me.id + '-' + x.id]; if (h != null && this.t - h < 90 && h > last && ok(x)) { last = h; target = x; } } }
    q.helpT = this.t + 60;
    if (!target) { this.log(`${this.boss(q)}: Kein gemeinsamer Gegner an meiner Grenze. Greif zuerst jemanden an, der auch an mich grenzt.`); return; }
    if (q.troops < this.maxTroops(q) * .25) { this.log(`${this.boss(q)} hat zu wenig Truppen, um zu helfen.`); return; }
    if (this.attack(q.id, target.id, q.troops * .4, target.lx, target.ly)) { this.log(`${this.boss(q)} greift ${target.name} an, um dir zu helfen.`, 'good'); snd('pact'); }
    else this.log(`${this.boss(q)} kommt nicht an ${target.name} heran.`);
  },
  // Geschenk an den Verbündeten: stärkt ihn und das Bündnis (eine Minute länger, er verlängert danach sicher)
  gift(q, kind) {
    const me = this.me, pact = this.pacts.get(this.pk(me.id, q.id)); if (!q.alive || !pact || pact.until <= this.t) return;
    if (kind === 'gold') { const g = Math.floor(me.gold * .25); if (g < 50) return; me.gold -= g; q.gold += g; this.log(`${fmtK(g)} Gold an ${q.name} geschickt.`, 'good'); }
    else { const n = Math.floor(me.troops * .2); if (n < 100) return; me.troops -= n; q.troops += n; this.log(`${fmtK(n)} Truppen an ${q.name} geschickt.`, 'good'); }
    pact.until = Math.min(pact.until + 60, this.t + PACT_TIME + 120); pact.bond = true; snd('pact'); this.updateHud();
  },
  // kleines Auswahlmenü über der Fussleiste
  menu(title, opts) {
    const el = $('#wMenu'), game = this.game; if (!el) return;
    el.innerHTML = `<button class="px-x" aria-label="Schliessen">X</button><b>${esc(title)}</b>` + opts.map((o, k) => `<button class="mo${o.cls ? ' ' + o.cls : ''}" data-k="${k}"${o.off ? ' disabled' : ''}>${esc(o.label)}${o.hint ? `<small>${esc(o.hint)}</small>` : ''}</button>`).join('');
    el.hidden = false; clearTimeout(this._mt); this._mt = setTimeout(() => this.closeMenu(), 15000);
    el.querySelector('.px-x').onclick = () => this.closeMenu();
    el.querySelectorAll('.mo').forEach(b => b.onclick = () => { this.closeMenu(); if (game === this.game && this.phase === 'play' && !this.over) { snd('tap'); opts[+b.dataset.k].fn(); } });
  },
  closeMenu() { const el = $('#wMenu'); if (el) el.hidden = true; clearTimeout(this._mt); },
  ask(msg, label, fn) {
    const el = $('#wFeed'), game = this.game; const d = document.createElement('div'); d.className = 'ask';
    d.innerHTML = `${esc(msg)} <button>${esc(label)}</button><button class="no">X</button>`; el.prepend(d);
    const close = () => d.remove(); d.querySelector('button').onclick = () => { if (game === this.game && this.phase === 'play' && !this.over) fn(); close(); }; d.querySelector('.no').onclick = close; setTimeout(close, 20000);
  },

  /* ---------- Anleitung ---------- */
  tutSteps() {
    return [
      { t: 'Kampf um Liechtenstein', b: `Du führst eine Gemeinde. Wer ${WIN_SHARE * 100} % des Landes hält, gewinnt. Die anderen zehn Gemeinden spielt der Computer.` },
      { sel: '#wTroopsBox', t: 'Truppen', b: 'Deine Truppen, dahinter das Maximum und das Wachstum pro Sekunde. Das Maximum steigt mit deiner Fläche und deinen Siedlungen. Am schnellsten wachsen sie bei etwa der Hälfte des Maximums. AM MAXIMUM WÄCHST NICHTS MEHR: dann angreifen oder Land dazugewinnen.' },
      { sel: '#wGoldBox', t: 'Gold', b: 'Gold kommt von den Einwohnern und Arbeitsplätzen in deinem Gebiet: Dorfzentren und Gewerbegebiete machen reich. Du brauchst es für Gebäude und Söldner.' },
      { sel: '#wScoreBox', t: 'Punkte', b: 'Neutrales Feld 1 Punkt, feindliches Feld 3 (jedes Feld zählt nur beim ersten Mal), Gebäude 50, ausgelöschte Gemeinde 5000, Sieg 50000 plus Zeitbonus. Schwache Startgemeinden zählen mehr (Faktor bis ×3).' },
      { sel: '#w3d', t: 'Ansicht und Hilfe', b: 'Ziehen verschiebt die Karte, Mausrad oder zwei Finger zoomen. Zwei Finger gemeinsam hoch oder runter kippen die Karte in 3D, Drehen dreht sie. Am Computer mit der rechten Maustaste. Der Knopf 3D/2D schaltet um. Während die Anleitung offen ist, ruht das Spiel. Mit ? kommt sie wieder.' },
      { sel: '#wBoard', t: 'Rangliste und Bündnisse', b: 'Die drei Führenden. Aufklappen zeigt alle Gemeinden. Mit ' + Spr.img('pakt', 1) + ' bietest du ein Bündnis an (5 Minuten). Verbündete greifen sich nicht an. Bei einem Verbündeten öffnet derselbe Knopf ein Menü: HILFE RUFEN (er greift deinen Gegner an), GOLD oder TRUPPEN SCHICKEN (hält das Bündnis länger) oder BRECHEN. Wer ein Bündnis bricht, gilt 30 s als Verräter.' },
      { last: true, t: 'Ereignisse und Schlussphase', b: 'Alle paar Minuten passiert etwas im Ländle, für alle gleich: FÖHNSTURM (im Tal verteidigt man schlechter), RHEINHOCHWASSER (Talboden doppelt so teuer), STAATSFEIERTAG (doppeltes Gold), FASNACHT (eine Gemeinde wächst kurz nicht), WINTEREINBRUCH (Berge doppelt so teuer). Ab Minute 12 werden Angriffe auf Gegner laufend billiger, damit die Partie ein Ende findet.' },
      { sel: '#wc', t: 'Ausbreiten', b: 'Tippe auf ungefärbtes Land neben deinem Gebiet. Langes Drücken auf ein Feld zeigt, wem es gehört und wie schwer es zu erobern ist. Talboden ist billig, Hang, Wald und Berge kosten viel mehr Truppen pro Feld. Hauptstrassen sind billig, Wasser geht nicht. Freies Land deiner eigenen Gemeinde kostet nur die Hälfte, fremdes mehr. Und daheim verteidigst du dich besser (Heimvorteil).' },
      { sel: '#wWeapon', t: 'Geheimwaffe', b: 'Jedes Oberhaupt hat eine Stärke, eine Schwäche und eine Geheimwaffe. Die Geheimwaffe zündest du mit diesem Knopf, einmal pro Partie. Was sie tut, steht im Menü unter DIE GEMEINDEN und erscheint, wenn du den Knopf lange drückst oder mit der Maus darauf zeigst. Auch die Gegner haben eine.' },
      { sel: '.wr', t: 'Angriffsstärke', b: 'So viel Prozent deiner Truppen schickt ein Tippen los. Nicht verbrauchte Truppen kehren zurück. Nachbarn kosten mehr, je dichter sie besetzt sind.' },
      { sel: '#wBuild', t: 'Gebäude und Söldner', b: 'SIEDLUNG: +1500 Truppen-Maximum, also schnelleres Wachstum.<br>BURG: Gegner brauchen im Umkreis von 500 m dreimal so viele Truppen pro Feld.<br>MARKT: +6 Gold pro Sekunde.<br>SÖLDNER: sofort Truppen in Höhe von 20 % deines Maximums. Du kannst pro Partie 4 Mal anwerben, jedes Mal doppelt so teuer (400, 800, 1600, 3200 Gold), danach 60 s Pause. Die Zahl oben rechts am Knopf zeigt, wie oft du noch kannst.<br>Jedes weitere Gebäude derselben Art wird teurer.' },
    ];
  },
  tutorial(k) {
    const el = $('#wTut'); this.layout();
    // Reihenfolge nach Bildschirmposition: oben von links nach rechts, dann Rangliste, dann Karte, dann unten
    if (k === 0 || !this._tutSteps) {
      const zone = st => { if (!st.sel) return [st.last ? 5 : -1, 0]; if (st.sel === '#wBoard') return [1, 0]; if (st.sel === '#wc') return [2, 0]; const e = $(st.sel), r = e && e.getBoundingClientRect(); if (!r || !r.width) return [4, 0]; return [r.top + r.height / 2 < innerHeight * .4 ? 0 : 3, r.left]; };
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
    const M = this.map; if (i < 0 || i >= M.N) return; const d = this.ovImg.data, ow = this.owner, o = ow[i], w = M.w, x = i % w, y = (i / w) | 0;
    const D = this.dr || (this.dr = [1e9, 1e9, -1, -1]); if (x < D[0]) D[0] = x; if (y < D[1]) D[1] = y; if (x > D[2]) D[2] = x; if (y > D[3]) D[3] = y;
    this.ovDirty = true;
    if (!o) { d[i * 4 + 3] = 0; return; }
    const c = this.rgb(this.players[o - 1].color);
    const border = (x > 0 && ow[i - 1] !== o) || (x < w - 1 && ow[i + 1] !== o) || (i >= w && ow[i - w] !== o) || (i < M.N - w && ow[i + w] !== o), on = border || ((x + y) & 1) === 0;
    d[i * 4] = c[0]; d[i * 4 + 1] = c[1]; d[i * 4 + 2] = c[2]; d[i * 4 + 3] = border ? 255 : on ? 150 : 60;
  },
  fullRepaint() {
    const M = this.map, d = this.ovImg.data;
    if (this.phase === 'choose') {
      // Gemeindegrenzen als Vorschau
      for (let i = 0; i < M.N; i++) { const g = M.gem[i]; if (!g) { d[i * 4 + 3] = 0; continue; } const c = this.rgb(WAR_COLORS[g]); let b = false; for (const n of this.neighbors(i)) if (M.gem[n] !== g) b = true; d[i * 4] = c[0]; d[i * 4 + 1] = c[1]; d[i * 4 + 2] = c[2]; d[i * 4 + 3] = b ? 255 : (((i % M.w) + ((i / M.w) | 0)) & 1) ? 0 : 90; }
    } else for (let i = 0; i < M.N; i++) this.paint(i);
    this.ovDirty = true; this.dr = [0, 0, M.w - 1, M.h - 1];
  },
  render() {
    const g = this.ctx, M = this.map; if (!M) return;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0); g.fillStyle = '#000'; g.fillRect(0, 0, this.W, this.H);
    if (this.ovDirty) { const D = this.dr; if (D && D[2] >= D[0]) this.ovCtx.putImageData(this.ovImg, 0, 0, D[0], D[1], D[2] - D[0] + 1, D[3] - D[1] + 1); this.dr = null; this.ovDirty = false; if (typeof War3D !== 'undefined') War3D.dirty = true; }
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
      for (const b of this.buildings) if (b.type === 'burg' && b.owner === this.me.id) { const bx = b.i % M.w + .5, by = Math.floor(b.i / M.w) + .5; g.strokeStyle = '#fff1e8'; g.beginPath(); for (let k = 0; k <= 24; k++) { const a = k / 24 * Math.PI * 2, [x, y] = P(bx + Math.cos(a) * BURG_R, by + Math.sin(a) * BURG_R); k ? g.lineTo(x, y) : g.moveTo(x, y); } g.stroke(); }
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
