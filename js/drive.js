'use strict';
/* Fahrmodus: frei durch Liechtenstein fahren.
   Welt wird kachelweise nachgeladen (Gelände, Bodenbedeckung, Gebäude, Bäume, Schilder, Ampeln).
   Verkehr fährt auf dem OSM-Strassennetz: rechts, mit Abstand, Einbahnstrassen, Stopp, Ampeln; Busse nach Fahrplan.
   Koordinaten: lokal x = Ost, y = Nord (wie gwr.json). Szene: X = x, Z = -y. Richtung hd: 0 = Nord, im Uhrzeigersinn. */
const CAR_HW = ['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'residential', 'living_street', 'service',
  'motorway_link', 'trunk_link', 'primary_link', 'secondary_link', 'tertiary_link'];
const HW_SPEED = { motorway: 120, trunk: 80, primary: 60, secondary: 50, tertiary: 50, unclassified: 50, residential: 40, living_street: 20, service: 20,
  motorway_link: 60, trunk_link: 50, primary_link: 50, secondary_link: 40, tertiary_link: 40 };
const HW_WEIGHT = { motorway: 4, trunk: 3.5, primary: 3, secondary: 2.5, tertiary: 2, unclassified: 1.2, residential: 1, living_street: .4, service: .15 };
const HW_WIDTH = { motorway: 4.5, trunk: 4, primary: 3.6, secondary: 3.4, tertiary: 3.2, unclassified: 2.8, residential: 2.8, living_street: 2.4, service: 2.2 };

const Drive = {
  inited: false, active: false, chunks: new Map(), nodes: new Map(), segGrid: new Map(), lights: [], ai: [], busPool: [],
  car: { x: 0, y: 0, hd: 0, v: 0, steer: 0, z: 0 }, keys: {}, touch: { x: 0, y: 0 }, camMode: 0, timeOffset: 0, edgeSeq: 0,

  /* ---------- Einrichtung ---------- */
  init() {
    if (this.inited) return; this.inited = true;
    const c = $('#dc');
    const R = this.R = new THREE.WebGLRenderer({ canvas: c, antialias: true });
    R.setPixelRatio(Math.min(devicePixelRatio || 1, 1.75)); R.shadowMap.enabled = true; R.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene = new THREE.Scene(); this.cam = new THREE.PerspectiveCamera(62, 1, .3, 5000);
    this.hemi = new THREE.HemisphereLight(0xdfeeff, 0x6b7a52, .6);
    const sun = this.sun = new THREE.DirectionalLight(0xfff3dd, .8); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -90, right: 90, top: 90, bottom: -90, near: 1, far: 500 }); sun.shadow.bias = -.0005;
    this.scene.add(this.hemi, sun, sun.target);
    this.scene.fog = new THREE.Fog(0xbcd3e3, 350, 1500);
    this.world = new THREE.Group(); this.scene.add(this.world);
    this.player = this.makeCar(0xc41f3a, true); this.scene.add(this.player);
    this.headlight = new THREE.SpotLight(0xfff2cc, 0, 90, .5, .5, 1.2); this.headlight.position.set(0, 1, 1.5); this.player.add(this.headlight);
    this.headlight.target.position.set(0, 0, 30); this.player.add(this.headlight.target);
    this.buildBackdrop();
    addEventListener('resize', () => this.resize()); this.resize();
    addEventListener('keydown', e => { if (!this.active) return; if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
      this.keys[e.code] = true; if (e.code === 'KeyC') this.camMode = (this.camMode + 1) % 3; if (e.code === 'KeyR') this.resetToRoad(); if (e.code === 'KeyT') this.shiftTime(1); if (e.code === 'Escape') this.exit(); });
    addEventListener('keyup', e => { this.keys[e.code] = false; });
    addEventListener('blur', () => { this.keys = {}; });
    // zwei Daumen-Joysticks: links lenken (waagrecht), rechts Gas und Bremse (senkrecht)
    document.querySelectorAll('#dTouch .stick').forEach(el => {
      const axis = el.dataset.axis, knob = el.querySelector('.knob'); let id = null;
      const set = e => {
        const r = el.getBoundingClientRect(), R = r.width / 2 - knob.offsetWidth / 2 - 3;
        let v = axis === 'x' ? (e.clientX - r.left - r.width / 2) / R : -(e.clientY - r.top - r.height / 2) / R;
        v = clamp(v, -1, 1); const dz = .12, out = Math.abs(v) < dz ? 0 : Math.sign(v) * (Math.abs(v) - dz) / (1 - dz);
        this.touch[axis] = out; knob.style.transform = axis === 'x' ? `translateX(${v * R}px)` : `translateY(${-v * R}px)`;
      };
      const end = e => { if (e.pointerId !== id) return; id = null; this.touch[axis] = 0; knob.style.transform = ''; el.classList.remove('on'); };
      el.addEventListener('pointerdown', e => { e.preventDefault(); id = e.pointerId; el.setPointerCapture(id); el.classList.add('on'); set(e); });
      el.addEventListener('pointermove', e => { if (e.pointerId === id) { e.preventDefault(); set(e); } });
      el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end); el.addEventListener('lostpointercapture', end);
    });
    $('#dExit').onclick = () => this.exit(); $('#dCam').onclick = () => { this.camMode = (this.camMode + 1) % 3; };
    $('#dReset').onclick = () => this.resetToRoad(); $('#dTime').onclick = () => this.shiftTime(1);
    let last = performance.now();
    const loop = t => { const dt = Math.min(.05, (t - last) / 1000); last = t; if (this.active) this.frame(dt); requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  },
  resize() { if (!this.R) return; this.R.setSize(innerWidth, innerHeight, false); this.cam.aspect = innerWidth / innerHeight; this.cam.fov = this.cam.aspect < 1 ? 80 : 62; this.cam.updateProjectionMatrix(); },
  buildBackdrop() {
    // ferne Berge rund um das Land (die echten Hänge in der Nähe kommen aus dem Gelände)
    const g = new THREE.Group(), r = rng(7), cx = 5000, cy = 12000;
    for (let k = 0; k < 40; k++) {
      const a = k / 40 * Math.PI * 2, east = Math.sin(a) > 0, d = 17000 + r() * 6000, h = (east ? 1700 : 1300) + r() * 900;
      const m = new THREE.Mesh(new THREE.ConeGeometry(3500 + r() * 2500, h, 6), new THREE.MeshBasicMaterial({ color: east ? 0x8c9fb0 : 0x97a8b6, fog: false }));
      m.position.set(cx + Math.sin(a) * d, h / 2 + 300, -(cy + Math.cos(a) * d)); g.add(m);
      if (h > 2200) { const cap = new THREE.Mesh(new THREE.ConeGeometry(900, h * .2, 6), new THREE.MeshBasicMaterial({ color: 0xf2f5f8, fog: false })); cap.position.set(m.position.x, h + 300 - h * .1, m.position.z); g.add(cap); }
    }
    this.backdrop = g; this.scene.add(g);
  },

  /* ---------- Start und Ende ---------- */
  async start(bIdx) {
    this.init();
    if (!Tiles.ok) { toast('Die Kartendaten sind gerade nicht erreichbar.'); return; }
    const b = DATA.b[bIdx];
    $('#title').hidden = true; $('#mapScreen').hidden = true; $('#driveScreen').hidden = false; $('#loadOverlay').hidden = false;
    this.resize(); this.clearWorld();
    this.car = { x: b[0], y: b[1], hd: 0, v: 0, steer: 0, z: 0 };
    try {
      const ids = Tiles.idsAround(b[0], b[1], 650);
      for (const id of ids) { const t = await Tiles.get(id); if (Tiles.terrIds.has(id)) await Tiles.terrain(id); if (t) this.buildChunk(t); }
    } catch (e) { console.warn(e); }
    $('#loadOverlay').hidden = true;
    this.resetToRoad(true);
    this.active = true; this.spawnT = 0; this.wxKey = null;
    toast(`Losfahren in ${DATA.gems[b[3]]}. Pfeiltasten oder W A S D, Leertaste bremst.`);
  },
  exit() {
    this.active = false; this.keys = {}; this.clearWorld();
    $('#driveScreen').hidden = true; $('#mapScreen').hidden = false; MapV.resize();
  },
  clearWorld() {
    for (const id of [...this.chunks.keys()]) this.unloadChunk(id);
    for (const a of this.ai) this.world.remove(a.m); this.ai = [];
    for (const b of this.busPool) if (b) this.world.remove(b); this.busPool = [];
    this.lights = []; this.nodes.clear(); this.segGrid.clear();
  },
  resetToRoad(initial) {
    const n = this.nearestEdgePoint(this.car.x, this.car.y, initial ? 400 : 150);
    if (n) { this.car.x = n.x; this.car.y = n.y; this.car.hd = n.hd; const r = this.laneOffset(n.e); this.car.x += Math.cos(this.car.hd) * r; this.car.y -= Math.sin(this.car.hd) * r; }
    this.car.v = 0; this.car.steer = 0;
  },
  shiftTime(h) { this.timeOffset += h * 3600e3; this.wxKey = null; const t = this.localTime(); toast(`Uhrzeit: ${t.hhmm}${this.timeOffset ? ' (verschoben)' : ''}`); },
  localTime() {
    const ms = Date.now() + this.timeOffset, loc = new Date(ms + Astro.vaduzOffset(ms) * 60000).toISOString();
    return { date: new Date(ms), iso: loc.slice(0, 10), hour: +loc.slice(11, 13), min: +loc.slice(14, 16), hhmm: loc.slice(11, 16) };
  },

  /* ---------- Welt-Kacheln ---------- */
  chunkOrigin(id) { const [E, N] = id.split('-').map(Number); return [E * 1000 - O0[0], N * 1000 - O0[1]]; },
  heightFn(id) {
    const grid = Tiles.terr.get(id), [x0, y0] = this.chunkOrigin(id);
    if (!grid) return () => this.lastH || 450;
    const T = Tiles.index.terrain, n = T.n, step = T.step, half = Tiles.gsd / 2;
    return (x, y) => {
      const fx = Math.min(Math.max((x - (x0 + half)) / step, 0), n - 1.001), fy = Math.min(Math.max(((y0 + 1000 - half) - y) / step, 0), n - 1.001);
      const i = Math.floor(fx), j = Math.floor(fy), a = fx - i, b = fy - j, q = [grid[i + j * n], grid[i + 1 + j * n], grid[i + (j + 1) * n], grid[i + 1 + (j + 1) * n]];
      if (q.some(v => v === -32768)) { const ok = q.filter(v => v !== -32768); return ok.length ? ok.reduce((s, v) => s + v, 0) / ok.length / 10 : (this.lastH || 450); }
      return ((q[0] * (1 - a) + q[1] * a) * (1 - b) + (q[2] * (1 - a) + q[3] * a) * b) / 10;
    };
  },
  hAt(x, y) { const ch = this.chunks.get(Tiles.idAt(x, y)); if (ch) return ch.h(x, y); const v = Tiles.hAt(x, y); return isNaN(v) ? (this.lastH || 450) : v; },
  buildChunk(t) {
    if (this.chunks.has(t.id)) return;
    const [x0, y0] = this.chunkOrigin(t.id), h = this.heightFn(t.id), g = new THREE.Group();
    const ch = { id: t.id, g, h, edges: [], polys: [], cells: [], lights: [] };
    // Gelände
    const SEG = 125, geo = new THREE.PlaneGeometry(1000, 1000, SEG, SEG); geo.rotateX(-Math.PI / 2); geo.translate(x0 + 500, 0, -(y0 + 500));
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) pos.setY(i, h(pos.getX(i), -pos.getZ(i)) - .15);
    geo.computeVertexNormals();
    // Bodentextur
    const TS = 1024, cv = document.createElement('canvas'); cv.width = cv.height = TS; const c = cv.getContext('2d'), k = TS / 1000;
    const P = (x, y) => [(x - x0) * k, (y0 + 1000 - y) * k];
    const ring = p => { for (let i = 0; i < p.length; i += 2) { const [px, py] = P(p[i], p[i + 1]); i ? c.lineTo(px, py) : c.moveTo(px, py); } c.closePath(); };
    const line = p => { c.beginPath(); for (let i = 0; i < p.length; i += 2) { const [px, py] = P(p[i], p[i + 1]); i ? c.lineTo(px, py) : c.moveTo(px, py); } };
    c.fillStyle = '#a6c47c'; c.fillRect(0, 0, TS, TS);
    for (const o of t.lc) { c.fillStyle = LC_GROUND[o.k] || '#a6c47c'; c.beginPath(); for (const r of o.rings) ring(r); c.fill('evenodd'); }
    c.fillStyle = '#8a8580'; for (const b of t.bld) for (const rings of b.polys) { c.beginPath(); for (const r of rings) ring(r); c.fill('evenodd'); }
    // Strassen aus OSM, falls die Vermessungsfläche fehlt (z. B. Kachelrand), plus Markierungen
    for (const r of t.roads) { if (!CAR_HW.includes(r.hw) || (r.tunnel && r.tunnel !== 'no')) continue; const w = (HW_WIDTH[r.hw] || 3) * 2 * k; c.strokeStyle = '#6e7278'; c.lineWidth = w; c.lineCap = 'round'; c.lineJoin = 'round'; for (const l of r.lines) { line(l); c.stroke(); } }
    for (const r of t.roads) {
      if (!['motorway', 'trunk', 'primary', 'secondary', 'tertiary'].includes(r.hw)) continue;
      const w = (HW_WIDTH[r.hw] || 3) * k; c.lineCap = 'butt';
      c.setLineDash([]); c.strokeStyle = 'rgba(255,255,255,.75)'; c.lineWidth = Math.max(1, .15 * k);
      for (const l of r.lines) for (const side of [-1, 1]) { const off = this.offsetLine(l, side * (w / k - .3)); line(off); c.stroke(); }
      c.setLineDash([3 * k, 6 * k]); c.lineWidth = Math.max(1, .15 * k); for (const l of r.lines) { line(l); c.stroke(); }
    }
    c.setLineDash([]);
    for (const r of t.trails) { const hike = r.kind === 'hiking' || r.kind === 'foot'; c.strokeStyle = hike ? 'rgba(232,180,0,.8)' : 'rgba(42,127,212,.75)'; c.lineWidth = .6 * k; c.setLineDash([2 * k, 2 * k]); for (const l of r.lines) { line(l); c.stroke(); } }
    c.setLineDash([]);
    const tex = new THREE.CanvasTexture(cv); tex.anisotropy = Math.min(8, this.R.capabilities.getMaxAnisotropy());
    const terr = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ map: tex })); terr.receiveShadow = true; g.add(terr); ch.tex = tex;
    // Gebäude (zusammengeführt, damit es wenige Zeichenaufrufe bleiben)
    const parts = [], walls = [0xf1ede4, 0xe9e2d3, 0xf4f1ea, 0xe6ddd0, 0xdfe3e2], roofs = [0x8e3d2c, 0x6b4a3a, 0x5b5f66, 0x9a5236], col = new THREE.Color();
    for (const b of t.bld) {
      const outer = b.polys[0] && b.polys[0][0]; if (!outer || outer.length < 6) continue;
      const pts = []; for (let i = 0; i < outer.length; i += 2) pts.push([outer[i], -outer[i + 1]]);
      let gmin = b.ground && b.ground[0] != null ? b.ground[0] : 1e9, gmax = b.ground && b.ground[1] != null ? b.ground[1] : -1e9;
      if (gmin > 1e8) for (const [X, Z] of pts) { const v = h(X, -Z); gmin = Math.min(gmin, v); gmax = Math.max(gmax, v); }
      const hh = b.h > 1 ? b.h : 6, top = gmax + hh, depth = top - gmin + .5;
      const r = rng((b.eg || Math.round(b.area * 100)) * 7 + 3), cat = b.catIdx >= 0 ? b.catIdx : 3, res = cat <= 2;
      const wc = res ? (r() < .15 ? 0xb98b5e : walls[Math.floor(r() * 5)]) : [0xc9cdd1, 0xb7bec4, 0xd3d0c8][Math.floor(r() * 3)];
      try {
        const eg = new THREE.ExtrudeGeometry(new THREE.Shape(pts.map(([X, Z]) => new THREE.Vector2(X, Z))), { depth, bevelEnabled: false });
        eg.rotateX(Math.PI / 2); eg.translate(0, top, 0); parts.push({ geo: eg, color: wc, roof: 0x8f949a });
        const ob = obb(pts);
        if (b.roof && b.roof !== 'flat' && b.area / ob.A > .7 && b.area < 900) {
          const rg = Game.gable(ob.w + .8, ob.d + .9, Math.min(4.2, ob.d * .42)); rg.rotateY(-ob.ang); rg.translate(ob.cx, top, ob.cz);
          parts.push({ geo: rg, color: roofs[Math.floor(r() * 4)] });
        }
      } catch (e) { /* ungültiger Grundriss */ }
      const bb = bboxOf(outer); ch.polys.push({ p: outer, bb });
    }
    if (parts.length) { const m = new THREE.Mesh(this.mergeColored(parts), new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide })); m.castShadow = m.receiveShadow = true; g.add(m); }
    // Strassen als eigene Bänder über dem Gelände (schärfer als die Bodentextur)
    const rm = this.roadMesh(t, h); if (rm) g.add(rm);
    // Bäume
    const rr = rng(Number(t.id.replace('-', ''))), tp = [];
    for (const [x, y] of t.trees) tp.push([x, y, 1]);
    for (const o of t.lc) {
      if (o.k !== 'wald' && o.k !== 'bestockt' && o.k !== 'garten') continue;
      let n = Math.min(400, Math.round(polyArea(o.p) / (o.k === 'wald' ? 70 : o.k === 'bestockt' ? 90 : 450)));
      for (let tries = 0; tries < n * 4 && n > 0; tries++) { const x = lerp(o.bb[0], o.bb[2], rr()), y = lerp(o.bb[1], o.bb[3], rr()); if (!inPoly(o.p, x, y)) continue; tp.push([x, y, o.k === 'wald' ? 1.15 : .85]); n--; }
      if (tp.length > 1600) break;
    }
    if (tp.length) {
      const crown = new THREE.InstancedMesh(new THREE.ConeGeometry(1.7, 5, 7), new THREE.MeshLambertMaterial({ color: 0xffffff }), tp.length);
      const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(.18, .28, 1.6, 5), new THREE.MeshLambertMaterial({ color: 0x6b4a33 }), tp.length);
      const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), sc = new THREE.Vector3(), dark = new THREE.Color(0x355c2f), light = new THREE.Color(0x5b8a45), cc = new THREE.Color();
      tp.forEach(([x, y, s0], i) => { const s = s0 * (.8 + rr() * .5), yy = h(x, y); sc.set(s, s * (.9 + rr() * .4), s); v.set(x, yy + 1.4 * s + 2.4 * sc.y, -y); m4.compose(v, q, sc); crown.setMatrixAt(i, m4); v.set(x, yy + .8 * s, -y); m4.compose(v, q, sc); trunk.setMatrixAt(i, m4); crown.setColorAt(i, cc.copy(dark).lerp(light, rr())); });
      crown.castShadow = true; g.add(crown, trunk);
    }
    // Strassengraph
    for (const r of t.roads) { if (!CAR_HW.includes(r.hw) || (r.tunnel && r.tunnel !== 'no')) continue; for (const l of r.lines) if (l.length >= 4) ch.edges.push(this.addEdge(l, r, ch)); }
    // Schilder und Ampeln
    for (const s of t.signs) this.addSign(s, g, ch, h);
    this.world.add(g); this.chunks.set(t.id, ch);
    this.linkControls(ch);
  },
  roadMesh(t, h) {
    const P = [], C = [], asph = new THREE.Color(0x5a5e64), white = new THREE.Color(0xf2f2ee), yel = new THREE.Color(0xf0c419);
    const strip = (l, off0, off1, y0, col, dash, hfn) => {
      // gleichmässig neu abtasten (alle 4 m), dann seitlich versetzen
      const pts = []; for (let k = 0; k < l.length - 2; k += 2) { const ax = l[k], ay = l[k + 1], bx = l[k + 2], by = l[k + 3], L = Math.hypot(bx - ax, by - ay), n = Math.max(1, Math.ceil(L / 4)); for (let i = 0; i < n; i++) pts.push([ax + (bx - ax) * i / n, ay + (by - ay) * i / n]); }
      pts.push([l[l.length - 2], l[l.length - 1]]); if (pts.length < 2) return;
      let run = 0;
      for (let i = 0; i < pts.length - 1; i++) {
        const [ax, ay] = pts[i], [bx, by] = pts[i + 1], dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy) || 1, nx = dy / L, ny = -dx / L;
        const seg0 = run; run += L;
        if (dash && ((seg0 % 9) > 3)) continue;
        const q = [[ax + nx * off0, ay + ny * off0], [ax + nx * off1, ay + ny * off1], [bx + nx * off1, by + ny * off1], [bx + nx * off0, by + ny * off0]];
        const ha = hfn(ax, ay, i / (pts.length - 1)) + y0, hb = hfn(bx, by, (i + 1) / (pts.length - 1)) + y0;
        const v = [[q[0][0], ha, -q[0][1]], [q[1][0], ha, -q[1][1]], [q[2][0], hb, -q[2][1]], [q[3][0], hb, -q[3][1]]];
        for (const idx of [0, 2, 1, 0, 3, 2]) { P.push(...v[idx]); C.push(col.r, col.g, col.b); }
      }
    };
    for (const r of t.roads) {
      if (!CAR_HW.includes(r.hw) || (r.tunnel && r.tunnel !== 'no')) continue;
      const w = HW_WIDTH[r.hw] || 3, ow = r.oneway === 'yes' || r.oneway === '1' || r.oneway === '-1', main = ['motorway', 'trunk', 'primary', 'secondary', 'tertiary'].includes(r.hw);
      const ww = ow && !main ? w * .8 : w;
      for (const l of r.lines) {
        if (l.length < 4) continue;
        const isBridge = r.bridge && r.bridge !== 'no', h0 = h(l[0], l[1]), h1 = h(l[l.length - 2], l[l.length - 1]);
        const hfn = isBridge ? (x, y, f) => h0 + (h1 - h0) * f + .4 : (x, y) => h(x, y);
        strip(l, -ww, ww, .07, asph, false, hfn);
        if (main) { strip(l, ww - .45, ww - .3, .1, white, false, hfn); strip(l, -ww + .3, -ww + .45, .1, white, false, hfn); }
        if (main && !ow) strip(l, -.08, .08, .11, r.hw === 'motorway' ? white : white, true, hfn);
      }
    }
    if (!P.length) return null;
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); geo.setAttribute('color', new THREE.Float32BufferAttribute(C, 3)); geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, side: THREE.DoubleSide }));
    m.receiveShadow = true; return m;
  },
  unloadChunk(id) {
    const ch = this.chunks.get(id); if (!ch) return;
    this.world.remove(ch.g);
    ch.g.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => { if (m.map && m.map !== ch.tex) { } m.dispose(); }); });
    if (ch.tex) ch.tex.dispose();
    for (const e of ch.edges) { e.dead = true; for (const key of [e.a, e.b]) { const s = this.nodes.get(key); if (s) { s.delete(e); if (!s.size) this.nodes.delete(key); } } }
    for (const key of ch.cells) { const arr = this.segGrid.get(key); if (arr) { const f = arr.filter(x => !x[0].dead); if (f.length) this.segGrid.set(key, f); else this.segGrid.delete(key); } }
    this.lights = this.lights.filter(L => L.chunk !== id);
    this.chunks.delete(id);
  },
  async stream() {
    if (this.streaming) return; this.streaming = true;
    try {
      const { x, y } = this.car, need = Tiles.idsAround(x, y, 650).sort((a, b) => { const [ax, ay] = this.chunkOrigin(a), [bx, by] = this.chunkOrigin(b); return Math.hypot(ax + 500 - x, ay + 500 - y) - Math.hypot(bx + 500 - x, by + 500 - y); });
      for (const id of need) {
        if (this.chunks.has(id)) continue;
        const t = await Tiles.get(id); if (Tiles.terrIds.has(id)) await Tiles.terrain(id);
        if (t && this.active) this.buildChunk(t);
        break; // eine Kachel pro Durchgang, damit es nicht ruckelt
      }
      for (const id of [...this.chunks.keys()]) { const [cx, cy] = this.chunkOrigin(id); if (Math.hypot(cx + 500 - x, cy + 500 - y) > 1700) this.unloadChunk(id); }
    } finally { this.streaming = false; }
  },
  mergeColored(parts) {
    let n = 0; const list = parts.map(p => { const g = p.geo.index ? p.geo.toNonIndexed() : p.geo; if (!g.attributes.normal) g.computeVertexNormals(); n += g.attributes.position.count; return [g, p]; });
    const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), col = new Float32Array(n * 3), a = new THREE.Color(), r = new THREE.Color(); let o = 0;
    for (const [g, p] of list) {
      const P = g.attributes.position.array, N = g.attributes.normal.array, cnt = g.attributes.position.count; pos.set(P, o * 3); nor.set(N, o * 3);
      a.set(p.color); r.set(p.roof != null ? p.roof : p.color);
      for (let i = 0; i < cnt; i++) { const cc = p.roof != null && N[i * 3 + 1] > .8 ? r : a; col[(o + i) * 3] = cc.r; col[(o + i) * 3 + 1] = cc.g; col[(o + i) * 3 + 2] = cc.b; }
      o += cnt; g.dispose(); if (g !== p.geo) p.geo.dispose();
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.BufferAttribute(pos, 3)); out.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); out.setAttribute('color', new THREE.BufferAttribute(col, 3));
    return out;
  },
  offsetLine(l, off) { // Linie seitlich versetzen (für Randlinien)
    const out = new Float32Array(l.length);
    for (let i = 0; i < l.length; i += 2) {
      const i0 = Math.max(0, i - 2), i1 = Math.min(l.length - 2, i + 2), dx = l[i1] - l[i0], dy = l[i1 + 1] - l[i0 + 1], L = Math.hypot(dx, dy) || 1;
      out[i] = l[i] + dy / L * off; out[i + 1] = l[i + 1] - dx / L * off;
    }
    return out;
  },

  /* ---------- Strassengraph ---------- */
  key(x, y) { return Math.round(x * 2) + ',' + Math.round(y * 2); },
  addEdge(l, r, ch) {
    const cum = [0]; for (let k = 2; k < l.length; k += 2) cum.push(cum[cum.length - 1] + Math.hypot(l[k] - l[k - 2], l[k + 1] - l[k - 1]));
    const ow = r.oneway === 'yes' || r.oneway === 'true' || r.oneway === '1' ? 1 : r.oneway === '-1' ? -1 : 0;
    const ms = parseFloat(r.maxspeed);
    const e = { id: ++this.edgeSeq, p: l, cum, len: cum[cum.length - 1], name: r.name, hw: r.hw, limit: isNaN(ms) ? (HW_SPEED[r.hw] || 50) : ms, oneway: ow,
      halfW: (ow && !['motorway', 'trunk', 'primary', 'secondary', 'tertiary'].includes(r.hw) ? .8 : 1) * (HW_WIDTH[r.hw] || 3), lanes: parseInt(r.lanes) || (ow ? 1 : 2), a: this.key(l[0], l[1]), b: this.key(l[l.length - 2], l[l.length - 1]), ctrlA: null, ctrlB: null, chunk: ch.id };
    for (const key of [e.a, e.b]) { let s = this.nodes.get(key); if (!s) this.nodes.set(key, s = new Set()); s.add(e); }
    for (let k = 0; k < l.length - 2; k += 2) {
      const cells = new Set([Math.floor(l[k] / 50) + ',' + Math.floor(l[k + 1] / 50), Math.floor(l[k + 2] / 50) + ',' + Math.floor(l[k + 3] / 50), Math.floor((l[k] + l[k + 2]) / 100) + ',' + Math.floor((l[k + 1] + l[k + 3]) / 100)]);
      for (const ck of cells) { let arr = this.segGrid.get(ck); if (!arr) this.segGrid.set(ck, arr = []); arr.push([e, k]); ch.cells.push(ck); }
    }
    return e;
  },
  laneOffset(e) { return e.oneway ? (e.lanes >= 2 ? 1.8 : 0) : (e.lanes >= 4 ? 3.4 : 1.7); },
  pointAt(e, d) {
    const c = e.cum, p = e.p; d = Math.max(0, Math.min(e.len, d));
    let lo = 0, hi = c.length - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (c[m] <= d) lo = m; else hi = m; }
    const f = (d - c[lo]) / ((c[hi] - c[lo]) || 1), dx = p[hi * 2] - p[lo * 2], dy = p[hi * 2 + 1] - p[lo * 2 + 1];
    return [p[lo * 2] + dx * f, p[lo * 2 + 1] + dy * f, Math.atan2(dx, dy)];
  },
  nearestEdgePoint(x, y, maxD) {
    let best = null, bd = maxD * maxD; const r = Math.ceil(maxD / 50);
    const cx = Math.floor(x / 50), cy = Math.floor(y / 50);
    for (let i = cx - r; i <= cx + r; i++) for (let j = cy - r; j <= cy + r; j++) {
      const arr = this.segGrid.get(i + ',' + j); if (!arr) continue;
      for (const [e, k] of arr) {
        if (e.dead) continue; const p = e.p, ax = p[k], ay = p[k + 1], dx = p[k + 2] - ax, dy = p[k + 3] - ay, L2 = dx * dx + dy * dy || 1;
        const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / L2)), qx = ax + dx * t, qy = ay + dy * t, d2 = (x - qx) ** 2 + (y - qy) ** 2;
        if (d2 < bd) { bd = d2; best = { e, x: qx, y: qy, hd: Math.atan2(dx, dy), d: Math.sqrt(d2), along: e.cum[k / 2] + Math.sqrt(L2) * t }; }
      }
    }
    return best;
  },
  // Stopp-, Kein-Vortritt-Signale und Ampeln an die nahen Wegenden hängen
  addSign(s, g, ch, h) {
    const a = (s.angle || 0) * Math.PI / 180, off = s.kind === 'strassenname' ? 4.2 : 3.4;
    let sx = s.x + Math.cos(a) * off, sy = s.y - Math.sin(a) * off;
    if (s.kind === 'stop' || s.kind === 'vortritt') ch.lights.push({ x: s.x, y: s.y, stop: s.kind });
    // Pfosten nie auf der Fahrbahn: vom nächsten Strassenstück weg an den Rand schieben, sonst weglassen
    for (let it = 0; it < 3; it++) {
      const n = this.nearestEdgePoint(sx, sy, 12); if (!n) break;
      const need = n.e.halfW + 1.1; if (n.d >= need) break;
      let dx = sx - n.x, dy = sy - n.y, L = Math.hypot(dx, dy);
      if (L < .05) { dx = Math.cos(n.hd); dy = -Math.sin(n.hd); L = 1; } // rechts der Fahrtrichtung
      sx = n.x + dx / L * need; sy = n.y + dy / L * need;
      if (it === 2) { const m = this.nearestEdgePoint(sx, sy, 12); if (m && m.d < m.e.halfW + .9) return; }
    }
    const y = h(sx, sy);
    const grp = new THREE.Group(); grp.position.set(sx, y, -sy); grp.rotation.y = Math.atan2(-Math.sin(a), Math.cos(a));
    const pole = new THREE.MeshLambertMaterial({ color: 0x9aa1a8 });
    if (s.kind === 'ampel') {
      const p = new THREE.Mesh(new THREE.CylinderGeometry(.07, .07, 3.2, 8), pole); p.position.y = 1.6; grp.add(p);
      const bx = new THREE.Mesh(new THREE.BoxGeometry(.34, .95, .26), new THREE.MeshLambertMaterial({ color: 0x1d2126 })); bx.position.y = 3.25; grp.add(bx);
      const mats = [0x5a1010, 0x5a4a10, 0x10401c].map(c => new THREE.MeshBasicMaterial({ color: c }));
      [3.55, 3.25, 2.95].forEach((yy, i) => { const l = new THREE.Mesh(new THREE.SphereGeometry(.1, 10, 8), mats[i]); l.position.set(0, yy, .14); grp.add(l); });
      const L = { x: s.x, y: s.y, off: (Math.abs(Math.round(s.x * 7 + s.y * 3)) % 40), mats, chunk: ch.id, axisHd: a };
      this.lights.push(L); ch.lights.push(L); g.add(grp); return;
    }
    const tx = Game.signTex(s.kind, s.value); if (!tx) return;
    const ph = s.kind === 'ortstafel' ? 2.1 : s.kind === 'strassenname' ? 2.6 : 2.2;
    const p = new THREE.Mesh(new THREE.CylinderGeometry(.045, .045, ph, 6), pole); p.position.y = ph / 2; grp.add(p);
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(tx.w, tx.h), new THREE.MeshBasicMaterial({ map: tx.t, transparent: s.kind !== 'ortstafel' && s.kind !== 'strassenname', alphaTest: .1 }));
    plate.position.set(0, ph + tx.h / 2 - .05, .03); grp.add(plate);
    const back = new THREE.Mesh(new THREE.PlaneGeometry(tx.w * .96, tx.h * .96), new THREE.MeshLambertMaterial({ color: 0xb7bcc2 })); back.rotation.y = Math.PI; back.position.set(0, ph + tx.h / 2 - .05, .02); grp.add(back);
    g.add(grp);
  },
  linkControls(ch) {
    // jedes Wegende in 22 m Umkreis einer Ampel oder eines Stoppsignals bekommt diese Regel
    const ends = [];
    for (const c2 of this.chunks.values()) for (const e of c2.edges) ends.push(e);
    for (const L of ch.lights) for (const e of ends) {
      if (e.dead) continue;
      const da = Math.hypot(e.p[0] - L.x, e.p[1] - L.y), db = Math.hypot(e.p[e.p.length - 2] - L.x, e.p[e.p.length - 1] - L.y), lim = L.stop ? 15 : 24;
      if (da < lim && (!e.ctrlA || da < e.ctrlA.d)) e.ctrlA = { L, d: da };
      if (db < lim && (!e.ctrlB || db < e.ctrlB.d)) e.ctrlB = { L, d: db };
    }
  },
  // Ampelphase für eine Zufahrtsrichtung: Nord-Süd und Ost-West wechseln sich ab (40-s-Umlauf)
  lightState(L, hd) {
    const ns = Math.abs(Math.cos(hd)) > .707, t = (((this.clock || 0) + L.off + (ns ? 0 : 20)) % 40);
    return t < 16 ? 'green' : t < 19 ? 'yellow' : 'red';
  },

  /* ---------- Verkehr ---------- */
  makeCar(color, player) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.8, .7, 4.3), new THREE.MeshLambertMaterial({ color })); body.position.y = .62; body.castShadow = true; g.add(body);
    const cab = new THREE.Mesh(new THREE.BoxGeometry(1.62, .58, 2.2), new THREE.MeshLambertMaterial({ color: 0x27303a })); cab.position.set(0, 1.24, -.25); cab.castShadow = true; g.add(cab);
    const wm = new THREE.MeshLambertMaterial({ color: 0x15171a });
    for (const [x, z] of [[-.85, 1.35], [.85, 1.35], [-.85, -1.35], [.85, -1.35]]) { const w = new THREE.Mesh(new THREE.CylinderGeometry(.34, .34, .25, 12), wm); w.rotation.z = Math.PI / 2; w.position.set(x, .34, z); g.add(w); }
    const hl = new THREE.MeshBasicMaterial({ color: 0xfff2c0 }), tl = new THREE.MeshBasicMaterial({ color: 0x8a1018 });
    for (const x of [-.6, .6]) { const a = new THREE.Mesh(new THREE.BoxGeometry(.32, .14, .04), hl); a.position.set(x, .7, 2.16); g.add(a); const b = new THREE.Mesh(new THREE.BoxGeometry(.32, .14, .04), tl); b.position.set(x, .7, -2.16); g.add(b); }
    g.userData.tail = tl; g.userData.body = body;
    return g;
  },
  makeBus(train) {
    const g = new THREE.Group(), L = train ? 26 : 12;
    const body = new THREE.Mesh(new THREE.BoxGeometry(2.55, 3, L), new THREE.MeshLambertMaterial({ color: 0xc41f3a })); body.position.y = 1.75; body.castShadow = true; g.add(body);
    const win = new THREE.Mesh(new THREE.BoxGeometry(2.58, .9, L * .92), new THREE.MeshLambertMaterial({ color: 0x26313d })); win.position.y = 2.3; g.add(win);
    g.userData.body = body; g.userData.train = train; return g;
  },
  trafficCurve() {
    const t = this.localTime(), tod = t.hour + t.min / 60, dow = (new Date(t.iso + 'T12:00:00Z').getUTCDay() + 6) % 7, hol = Cal.holidayOn(t.iso), wk = dow < 5 && !(hol && hol.frei);
    const pts = wk ? [[0, .05], [5, .15], [7, 1.1], [8, 1.2], [9, .7], [12, .65], [13, .7], [16, .9], [17.5, 1.2], [19, .6], [22, .2], [24, .05]] : [[0, .05], [8, .2], [11, .6], [17, .6], [20, .3], [24, .05]];
    for (let i = 1; i < pts.length; i++) if (tod <= pts[i][0]) { const [a, va] = pts[i - 1], [b, vb] = pts[i]; return va + (vb - va) * (tod - a) / (b - a); }
    return .05;
  },
  targetTraffic() { const d = Density.around(this.car.x, this.car.y, 500); return clamp(Math.round((d.p + d.j) / 180 * this.trafficCurve()), 3, 40); },
  spawnAI() {
    const { x, y } = this.car, cand = [];
    for (const ch of this.chunks.values()) for (const e of ch.edges) {
      if (e.dead || e.len < 30 || e.hw === 'service' && Math.random() < .85) continue;
      const m = this.pointAt(e, e.len / 2), d = Math.hypot(m[0] - x, m[1] - y); if (d > 140 && d < 420) cand.push(e);
    }
    if (!cand.length) return;
    // Hauptstrassen häufiger
    let tot = 0; for (const e of cand) tot += HW_WEIGHT[e.hw] || 1; let r = Math.random() * tot, e = cand[0];
    for (const c of cand) { r -= HW_WEIGHT[c.hw] || 1; if (r <= 0) { e = c; break; } }
    const dir = e.oneway === 1 ? 1 : e.oneway === -1 ? -1 : (Math.random() < .5 ? 1 : -1), d = Math.random() * e.len;
    if (this.ai.some(a => a.e === e && Math.abs(a.d - d) < 20)) return;
    const col = [0xe9ecef, 0x1c1f24, 0x6b7280, 0xa61e2d, 0x1d4f9c, 0xd9d2c3, 0x2f5d3a, 0xf0f0f0, 0x3a3f46][Math.floor(Math.random() * 9)];
    const m = this.makeCar(col); this.world.add(m);
    const [px, py, ph] = this.pointAt(e, d);
    this.ai.push({ e, dir, d, v: Math.min(e.limit, 50) / 3.6 * .7, f: .88 + Math.random() * .2, m, wait: 0, stopped: false, next: null, x: px, y: py, hd: ph + (dir > 0 ? 0 : Math.PI) });
  },
  chooseNext(a) {
    const e = a.e, endKey = a.dir > 0 ? e.b : e.a, set = this.nodes.get(endKey);
    const hdEnd = this.pointAt(e, a.dir > 0 ? e.len : 0)[2] + (a.dir > 0 ? 0 : Math.PI);
    const opts = [];
    if (set) for (const c of set) {
      if (c === e || c.dead) continue;
      const fromA = c.a === endKey; if (!fromA && c.b !== endKey) continue;
      if (c.oneway === 1 && !fromA) continue; if (c.oneway === -1 && fromA) continue;
      const hd0 = fromA ? this.pointAt(c, Math.min(5, c.len))[2] : this.pointAt(c, Math.max(0, c.len - 5))[2] + Math.PI;
      let dh = Math.abs(((hd0 - hdEnd + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
      if (dh > 2.6) continue;
      opts.push({ c, dir: fromA ? 1 : -1, w: (HW_WEIGHT[c.hw] || 1) / (.25 + dh), turn: dh });
    }
    if (!opts.length) return null;
    let tot = opts.reduce((s, o) => s + o.w, 0), r = Math.random() * tot;
    for (const o of opts) { r -= o.w; if (r <= 0) return o; }
    return opts[0];
  },
  updateAI(dt) {
    this.clock = (this.clock || 0) + dt;
    const P = this.car, pfx = Math.sin(P.hd), pfy = Math.cos(P.hd);
    for (let i = this.ai.length - 1; i >= 0; i--) {
      const a = this.ai[i], e = a.e;
      if (e.dead || Math.hypot(a.x - P.x, a.y - P.y) > 560) { this.world.remove(a.m); this.ai.splice(i, 1); continue; }
      const endDist = a.dir > 0 ? e.len - a.d : a.d;
      let target = Math.min(e.limit, 80) / 3.6 * a.f;
      if (!a.next && endDist < 60) a.next = this.chooseNext(a) || { uturn: true };
      if (a.next && a.next.turn > .7 && endDist < 25) target = Math.min(target, 6.5);
      if (a.next && a.next.uturn && endDist < 15) target = Math.min(target, 3);
      // Verkehrsregeln am Wegende
      const ctrl = a.dir > 0 ? e.ctrlB : e.ctrlA;
      if (ctrl && ctrl.L.stop === 'stop' && !a.stopped && endDist < 35) { target = Math.min(target, Math.max(0, (endDist - 3) * .5)); if (endDist < 5 && a.v < .4) { a.wait += dt; if (a.wait > 1.4) a.stopped = true; } }
      if (ctrl && ctrl.L.stop === 'vortritt' && endDist < 25) target = Math.min(target, 5);
      if (ctrl && ctrl.L.mats) { const hd = this.pointAt(e, a.dir > 0 ? e.len : 0)[2] + (a.dir > 0 ? 0 : Math.PI), st = this.lightState(ctrl.L, hd); if (st !== 'green' && endDist > 2 && endDist < 32 && !(st === 'yellow' && endDist < 8)) target = Math.min(target, Math.max(0, (endDist - 4) * .45)); }
      // Kreuzung frei? Wer gerade drin ist und fährt, hat Vorrang
      if (endDist < 11 && endDist > 1.5) {
        const [ex, ey] = this.pointAt(e, a.dir > 0 ? e.len : 0);
        for (const b of this.ai) if (b !== a && b.v > 1 && Math.hypot(b.x - ex, b.y - ey) < 6.5 && Math.cos(b.hd - a.hd) < .85) { target = Math.min(target, Math.max(0, (endDist - 4) * .5)); break; }
      }
      // Abstand halten: Fahrzeuge voraus (gleiche Richtung)
      let gap = 1e9;
      for (const b of this.ai) {
        if (b === a) continue; const dx = b.x - a.x, dy = b.y - a.y, ahead = dx * Math.sin(a.hd) + dy * Math.cos(a.hd);
        if (ahead <= 0 || ahead > 45) continue; const lat = Math.abs(dx * Math.cos(a.hd) - dy * Math.sin(a.hd)); if (lat > 2.2) continue;
        if (Math.cos(b.hd - a.hd) < .3) continue; gap = Math.min(gap, ahead);
      }
      { const dx = P.x - a.x, dy = P.y - a.y, ahead = dx * Math.sin(a.hd) + dy * Math.cos(a.hd), lat = Math.abs(dx * Math.cos(a.hd) - dy * Math.sin(a.hd)); if (ahead > 0 && ahead < 45 && lat < 2.4) gap = Math.min(gap, ahead); }
      if (gap < 1e9) target = Math.min(target, Math.max(0, (gap - 7) * .55));
      const acc = clamp((target - a.v) * 1.6, -7, 2.4); a.v = Math.max(0, a.v + acc * dt); a.d += a.dir * a.v * dt;
      if (a.d < 0 || a.d > e.len) {
        const nx = a.next; a.next = null; a.stopped = false; a.wait = 0;
        if (nx && nx.c && !nx.c.dead) { const over = a.d < 0 ? -a.d : a.d - e.len; a.e = nx.c; a.dir = nx.dir; a.d = nx.dir > 0 ? Math.min(over, nx.c.len) : Math.max(0, nx.c.len - over); }
        else { a.dir *= -1; a.d = clamp(a.d, 0, e.len); if (e.oneway) { this.world.remove(a.m); this.ai.splice(i, 1); continue; } }
      }
      const [x, y, hd0] = this.pointAt(a.e, a.d), hd = hd0 + (a.dir > 0 ? 0 : Math.PI), off = this.laneOffset(a.e);
      a.x = x + Math.cos(hd) * off; a.y = y - Math.sin(hd) * off; a.hd = hd;
      a.m.position.set(a.x, this.hAt(a.x, a.y), -a.y); a.m.rotation.y = Math.PI - hd;
      a.m.userData.tail.color.setHex(acc < -1 || a.v < .3 ? 0xff2030 : 0x8a1018);
    }
  },
  updateBuses() {
    if (!Transit.data) return;
    const t = this.localTime(), dow = (new Date(t.iso + 'T12:00:00Z').getUTCDay() + 6) % 7, sec = (t.hour * 60 + t.min) * 60 + (Date.now() / 1000 % 60);
    let used = 0;
    for (const a of Transit.active(dow, sec)) {
      const [x, y, ang] = Transit.position(a.route, a.a, a.b, a.f); if (Math.hypot(x - this.car.x, y - this.car.y) > 650 || used >= 12) continue;
      const train = Transit.isTrain(a.route); let m = this.busPool[used];
      if (!m || m.userData.train !== train) { if (m) this.world.remove(m); m = this.makeBus(train); this.busPool[used] = m; this.world.add(m); }
      m.visible = true; m.userData.body.material.color.set(a.route.color || (train ? '#e9eef2' : '#c41f3a'));
      m.position.set(x, this.hAt(x, y), -y); m.rotation.y = Math.PI - ang; used++;
    }
    for (let k = used; k < this.busPool.length; k++) if (this.busPool[k]) this.busPool[k].visible = false;
  },

  /* ---------- Spielerauto ---------- */
  collides(x, y, hd) {
    const cs = Math.cos(hd), sn = Math.sin(hd), corners = [[-.85, 2.1], [.85, 2.1], [-.85, -2.1], [.85, -2.1], [0, 2.2]];
    const ids = new Set([Tiles.idAt(x, y), Tiles.idAt(x + 5, y), Tiles.idAt(x - 5, y), Tiles.idAt(x, y + 5), Tiles.idAt(x, y - 5)]);
    for (const id of ids) {
      const ch = this.chunks.get(id); if (!ch) continue;
      for (const b of ch.polys) {
        if (x < b.bb[0] - 4 || x > b.bb[2] + 4 || y < b.bb[1] - 4 || y > b.bb[3] + 4) continue;
        for (const [lx, ly] of corners) { const px = x + lx * cs + ly * sn, py = y - lx * sn + ly * cs; if (inPoly(b.p, px, py)) return true; }
      }
    }
    return false;
  },
  updatePlayer(dt) {
    const k = this.keys, t = this.touch, C = this.car;
    const thr = (k.ArrowUp || k.KeyW) ? 1 : Math.max(0, t.y), brk = (k.ArrowDown || k.KeyS) ? 1 : Math.max(0, -t.y), hb = k.Space ? 1 : 0;
    const st = clamp(((k.ArrowRight || k.KeyD) ? 1 : 0) - ((k.ArrowLeft || k.KeyA) ? 1 : 0) + t.x, -1, 1);
    C.steer += (st - C.steer) * Math.min(1, dt * (st ? 4 : 6));
    const near = this.nearestEdgePoint(C.x, C.y, 25); this.nearRoad = near;
    const onRoad = near && near.d < (HW_WIDTH[near.e.hw] || 3) * (near.e.oneway ? 1 : 1.25) + 1;
    const vmax = onRoad ? 190 / 3.6 : 45 / 3.6;
    let acc = 0;
    if (thr) acc += thr * (C.v < 0 ? 8 : 3.4 * Math.max(0, 1 - C.v / vmax));
    if (brk) acc += brk * (C.v > .5 ? -9 : -2.6);
    if (hb) acc += -7 * Math.sign(C.v);
    acc -= .00045 * C.v * Math.abs(C.v) * 9 + .18 * Math.sign(C.v) + (onRoad ? 0 : 2.2 * Math.sign(C.v) * Math.min(1, Math.abs(C.v) / 3));
    // Hangabtrieb
    const hf = this.hAt(C.x + Math.sin(C.hd) * 2, C.y + Math.cos(C.hd) * 2), hb2 = this.hAt(C.x - Math.sin(C.hd) * 2, C.y - Math.cos(C.hd) * 2), slope = (hf - hb2) / 4;
    acc -= 9.81 * slope * .8;
    C.v = clamp(C.v + acc * dt, -7, vmax);
    if (!thr && !brk && Math.abs(C.v) < .25) C.v = 0;
    const delta = C.steer * .6 / (1 + Math.abs(C.v) / 11), yawRate = C.v / 2.65 * Math.tan(delta) * (hb ? 1.35 : 1);
    const nhd = C.hd + yawRate * dt, nx = C.x + Math.sin(nhd) * C.v * dt, ny = C.y + Math.cos(nhd) * C.v * dt;
    if (this.collides(nx, ny, nhd)) { C.v = -C.v * .25; if (!this.bumpT || performance.now() - this.bumpT > 1500) { this.bumpT = performance.now(); toast('Rums! Gebäude gestreift.'); } }
    else { C.x = nx; C.y = ny; C.hd = nhd; }
    for (const a of this.ai) { const dx = C.x - a.x, dy = C.y - a.y, d = Math.hypot(dx, dy); if (d < 3.3) {
      const push = (3.3 - d) / (d || 1); C.x += dx * push; C.y += dy * push; C.v *= -.3; a.v = 0;
      if (!this.crashT || performance.now() - this.crashT > 2000) { this.crashT = performance.now(); toast('Zusammenstoss! Vorsicht im Verkehr.'); } } }
    const h = this.hAt(C.x, C.y); this.lastH = h;
    const hl = this.hAt(C.x - Math.cos(C.hd) * 1, C.y + Math.sin(C.hd) * 1), hr = this.hAt(C.x + Math.cos(C.hd) * 1, C.y - Math.sin(C.hd) * 1);
    const m = this.player; m.position.set(C.x, h, -C.y);
    m.rotation.set(0, 0, 0); m.rotation.order = 'YXZ'; m.rotation.y = Math.PI - C.hd; m.rotation.x = -Math.atan(slope); m.rotation.z = Math.atan((hr - hl) / 2) * .8;
    m.userData.tail.color.setHex(brk && C.v > 0 ? 0xff2030 : 0x8a1018);
  },
  updateCamera(dt) {
    const C = this.car, fx = Math.sin(C.hd), fy = Math.cos(C.hd), h = this.player.position.y;
    const modes = [[-8.5, 3.3, 1.4], [.4, 1.35, 1.2], [-22, 13, 0]], [back, up, look] = modes[this.camMode];
    const tx = C.x + fx * back, ty = C.y + fy * back, tz = Math.max(this.hAt(tx, ty) + 1.2, h + up);
    const k = this.camMode === 1 ? 1 : 1 - Math.exp(-dt * 5);
    if (!this.camPos) this.camPos = new THREE.Vector3(tx, tz, -ty);
    this.camPos.lerp(new THREE.Vector3(tx, tz, -ty), k);
    this.cam.position.copy(this.camPos);
    const ahead = this.camMode === 1 ? 30 : 6;
    this.cam.lookAt(C.x + fx * ahead, h + look, -(C.y + fy * ahead));
  },

  /* ---------- Licht, Wetter ---------- */
  updateLight() {
    const C = this.car, t = this.localTime(), [lat, lon] = localToWgs84(C.x, C.y), sun = Astro.sun(t.date, lat, lon), moon = Astro.moon(t.date, lat, lon);
    const hk = t.iso + 'T' + t.hour;
    if (this.wxKey !== hk) { this.wxKey = hk; this.wx = Weather.at(C.x, C.y, t.iso, t.hour); this.fx = Weather.foehn(t.date); this.illum = Astro.moonIllum(t.date); }
    const tile = Tiles.cache.get(Tiles.idAt(C.x, C.y)), H = tile && tile.horizon, hz = H ? H[Math.round(sun.az / 2) % 180] / 10 : 0;
    const wx = this.wx, cloud = wx ? wx.cloud : .35, sm = (a, b, x) => { const q = clamp((x - a) / (b - a), 0, 1); return q * q * (3 - 2 * q); };
    const dayF = sm(-7, 7, sun.alt), direct = sm(hz - .3, hz + 2.2, sun.alt) * sm(-1, 2, sun.alt), useMoon = direct < .02 && moon.alt > 2;
    const body = useMoon ? moon : sun, cb = Math.cos(body.alt * Math.PI / 180), vx = Math.sin(body.az * Math.PI / 180) * cb, vy = Math.cos(body.az * Math.PI / 180) * cb, vz = Math.max(.1, Math.sin(body.alt * Math.PI / 180));
    const p = this.player.position;
    this.sun.position.set(p.x + vx * 200, p.y + vz * 200, p.z - vy * 200); this.sun.target.position.copy(p);
    const ml = useMoon ? .16 * (this.illum ? this.illum.fraction : .5) * (1 - .8 * cloud) : 0;
    this.sun.intensity = useMoon ? ml : direct * (1 - .78 * cloud) * .8; this.sun.color.set(useMoon ? 0xaabbe0 : (sun.alt < 8 ? 0xffc89a : 0xfff3dd)); this.sun.castShadow = this.sun.intensity > .05;
    this.hemi.intensity = .13 + dayF * (.38 - .14 * cloud) + ml * .5;
    const sky = new THREE.Color(0x0c1426).lerp(new THREE.Color(0xa7cbe6).lerp(new THREE.Color(0xaeb6bf), clamp(cloud * 1.1, 0, 1)), dayF);
    if (sun.alt > -6 && sun.alt < 9) sky.lerp(new THREE.Color(0xe9a37a), .32 * (1 - cloud) * (1 - Math.abs(sun.alt - 1) / 9));
    if (wx && wx.precip > .2) sky.lerp(new THREE.Color(0x7d858e), clamp(wx.precip / 4, 0, .5) * dayF);
    this.scene.background = sky; this.scene.fog.color.copy(sky);
    const vis = wx ? clamp(wx.vis, 200, 3000) : 1500; this.scene.fog.far = Math.min(1500, vis); this.scene.fog.near = this.scene.fog.far * .25;
    this.headlight.intensity = dayF < .35 ? 2.2 : 0;
    this.night = dayF < .35;
    this.updatePrecip(wx);
    const el = $('#dWx');
    if (el) el.innerHTML = `${t.hhmm}${this.timeOffset ? ' *' : ''} · ${wx ? `<b>${Math.round(wx.temp)}°</b> ${esc(wx.text)}` : 'Wetter nicht verfügbar'}${this.fx && this.fx.value >= 1 ? ` · <span class="foehn">${esc(this.fx.text || 'Föhn')}</span>` : ''}`;
  },
  updatePrecip(wx) {
    const want = wx && wx.precip > .1 ? (wx.snow > 0 || wx.temp < .8 ? 'snow' : 'rain') : null, P = this.precip;
    if (!want) { if (P) P.pts.visible = false; return; }
    if (!P || P.kind !== want) {
      if (P) this.scene.remove(P.pts);
      const n = 5000, pos = new Float32Array(n * 3); for (let i = 0; i < n; i++) { pos[i * 3] = (Math.random() - .5) * 120; pos[i * 3 + 1] = Math.random() * 50; pos[i * 3 + 2] = (Math.random() - .5) * 120; }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      const pts = new THREE.Points(g, new THREE.PointsMaterial({ color: want === 'snow' ? 0xffffff : 0xaec4dc, size: want === 'snow' ? .3 : .12, transparent: true, opacity: .8, depthWrite: false }));
      this.scene.add(pts); this.precip = { kind: want, pts, n };
    }
    const Q = this.precip; Q.pts.visible = true; Q.pts.geometry.setDrawRange(0, Math.floor(Q.n * clamp(wx.precip / 3, .15, 1)));
  },
  tickPrecip(dt) {
    const Q = this.precip; if (!Q || !Q.pts.visible) return; Q.pts.position.set(this.player.position.x, this.player.position.y - 5, this.player.position.z);
    const a = Q.pts.geometry.attributes.position, v = Q.kind === 'snow' ? 1.5 : 17;
    for (let i = 0; i < a.count; i++) { let y = a.array[i * 3 + 1] - v * dt; if (y < 0) y += 50; a.array[i * 3 + 1] = y; } a.needsUpdate = true;
  },

  /* ---------- Anzeige ---------- */
  updateHud() {
    const C = this.car, kmh = Math.abs(C.v) * 3.6, n = this.nearRoad;
    $('#dSpeed').textContent = Math.round(kmh);
    const lim = n ? n.e.limit : null, over = lim && kmh > lim + 5;
    $('#dLimit').textContent = lim || '–'; $('#dLimit').classList.toggle('over', !!over);
    let gem = '';
    const bi = MapV.nearest(...MapV.w2s(C.x, C.y), 300 * MapV.s); if (bi >= 0) gem = DATA.gems[DATA.b[bi][3]];
    $('#dStreet').textContent = (n && n.e.name ? n.e.name : (n ? 'Strasse ohne Namen' : 'abseits der Strasse')) + (gem ? ' · ' + gem : '');
    // Rotlicht-Hinweis
    if (n && Math.abs(C.v) > 3) {
      const e = n.e, toA = n.along, toB = e.len - n.along, movingToB = Math.cos(C.hd - n.hd) > 0, ctrl = movingToB ? e.ctrlB : e.ctrlA, dist = movingToB ? toB : toA;
      if (ctrl && ctrl.L.mats && dist < 6) { const st = this.lightState(ctrl.L, movingToB ? n.hd : n.hd + Math.PI); if (st === 'red' && (!this.redT || performance.now() - this.redT > 4000)) { this.redT = performance.now(); toast('Rotlicht überfahren!'); } }
    }
    this.drawMinimap();
  },
  drawMinimap() {
    const cv = $('#dMap'); if (!cv) return; const g = cv.getContext('2d'), W = cv.width, H = cv.height, C = this.car, s = W / 360;
    g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, W, H); g.fillStyle = 'rgba(24,34,58,.72)'; g.fillRect(0, 0, W, H);
    g.translate(W / 2, H / 2); g.rotate(-C.hd); g.scale(s, s);
    const seen = new Set(); g.lineCap = 'round';
    for (let i = Math.floor((C.x - 200) / 50); i <= Math.floor((C.x + 200) / 50); i++) for (let j = Math.floor((C.y - 200) / 50); j <= Math.floor((C.y + 200) / 50); j++) {
      const arr = this.segGrid.get(i + ',' + j); if (!arr) continue;
      for (const [e] of arr) {
        if (seen.has(e) || e.dead) continue; seen.add(e);
        g.strokeStyle = ['primary', 'secondary', 'trunk'].includes(e.hw) ? '#f2d230' : '#e8edf2'; g.lineWidth = ['primary', 'secondary', 'trunk'].includes(e.hw) ? 7 : 4.5;
        g.beginPath(); for (let k = 0; k < e.p.length; k += 2) { const x = e.p[k] - C.x, y = -(e.p[k + 1] - C.y); k ? g.lineTo(x, y) : g.moveTo(x, y); } g.stroke();
      }
    }
    g.fillStyle = '#ff6b6b'; for (const a of this.ai) { const x = a.x - C.x, y = -(a.y - C.y); if (Math.abs(x) < 200 && Math.abs(y) < 200) { g.beginPath(); g.arc(x, y, 4, 0, 7); g.fill(); } }
    g.setTransform(1, 0, 0, 1, 0, 0); g.fillStyle = '#c41f3a'; g.strokeStyle = '#fff'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(W / 2, H / 2 - 9); g.lineTo(W / 2 + 6, H / 2 + 7); g.lineTo(W / 2 - 6, H / 2 + 7); g.closePath(); g.fill(); g.stroke();
  },

  /* ---------- Hauptschleife ---------- */
  frame(dt) {
    this.updatePlayer(dt);
    this.spawnT -= dt;
    if (this.spawnT <= 0) {
      this.spawnT = .5; this.stream();
      if (this.ai.length < this.targetTraffic()) this.spawnAI();
      this.updateBuses();
      for (const L of this.lights) { const st = this.lightState(L, L.axisHd || 0); L.mats[0].color.setHex(st === 'red' ? 0xff2a2a : 0x5a1010); L.mats[1].color.setHex(st === 'yellow' ? 0xffcc33 : 0x5a4a10); L.mats[2].color.setHex(st === 'green' ? 0x33dd66 : 0x10401c); }
    }
    this.updateAI(dt);
    this.updateCamera(dt);
    this.hudT = (this.hudT || 0) - dt; if (this.hudT <= 0) { this.hudT = .2; this.updateLight(); this.updateHud(); }
    this.tickPrecip(dt);
    this.R.render(this.scene, this.cam);
  },
};
