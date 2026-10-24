'use strict';
/* Datenzugriff: Kacheln (Gebäude, Bodenbedeckung, Schilder, Orte, Horizont), Gelände, Fahrplan, Wetter, Vereine */
const CFG = Object.assign({ dataBase: '' }, window.LAENDLE_CONFIG || {});
(() => { const q = new URLSearchParams(location.search).get('data'); if (q) CFG.dataBase = q; if (CFG.dataBase && !CFG.dataBase.endsWith('/')) CFG.dataBase += '/'; })();
const O0 = [2754000, 1212000];   // lokaler Ursprung (wie gwr.json)

/* ---------- Geometrie-Helfer ---------- */
function bboxOf(p) { let a = 1e9, b = 1e9, c = -1e9, d = -1e9; for (let k = 0; k < p.length; k += 2) { a = Math.min(a, p[k]); c = Math.max(c, p[k]); b = Math.min(b, p[k + 1]); d = Math.max(d, p[k + 1]); } return [a, b, c, d]; }
function polyArea(p) { let s = 0; const n = p.length; for (let k = 0; k < n; k += 2) { const j = (k + 2) % n; s += p[k] * p[j + 1] - p[j] * p[k + 1]; } return Math.abs(s) / 2; }
function inPoly(p, x, y) { let c = false; const n = p.length; for (let i = 0, j = n - 2; i < n; j = i, i += 2) { const yi = p[i + 1], yj = p[j + 1]; if ((yi > y) !== (yj > y) && x < (p[j] - p[i]) * (y - yi) / (yj - yi) + p[i]) c = !c; } return c; }
function obb(pts) {
  let best = null;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length], ang = Math.atan2(b[1] - a[1], b[0] - a[0]), c = Math.cos(ang), s = Math.sin(ang);
    let u0 = 1e9, u1 = -1e9, v0 = 1e9, v1 = -1e9;
    for (const [x, z] of pts) { const u = x * c + z * s, v = -x * s + z * c; u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v); }
    const A = (u1 - u0) * (v1 - v0);
    if (!best || A < best.A) { const uc = (u0 + u1) / 2, vc = (v0 + v1) / 2; best = { A, w: u1 - u0, d: v1 - v0, ang, cx: uc * c - vc * s, cz: uc * s + vc * c }; }
  }
  if (best.w < best.d) { [best.w, best.d] = [best.d, best.w]; best.ang += Math.PI / 2; }
  return best;
}
function wgs84ToLocal(lat, lon) {
  const p = (lat * 3600 - 169028.66) / 10000, l = (lon * 3600 - 26782.5) / 10000;
  const e = 2600072.37 + 211455.93 * l - 10938.51 * l * p - 0.36 * l * p * p - 44.54 * l ** 3;
  const n = 1200147.07 + 308807.95 * p + 3745.25 * l * l + 76.63 * p * p - 194.56 * l * l * p + 119.79 * p ** 3;
  return [e - O0[0], n - O0[1]];
}
function localToWgs84(x, y) {
  const yy = (x + O0[0] - 2600000) / 1e6, xx = (y + O0[1] - 1200000) / 1e6;
  const lon = 2.6779094 + 4.728982 * yy + 0.791484 * yy * xx + 0.1306 * yy * xx * xx - 0.0436 * yy ** 3;
  const lat = 16.9023892 + 3.238272 * xx - 0.270978 * yy * yy - 0.002528 * xx * xx - 0.0447 * yy * yy * xx - 0.014 * xx ** 3;
  return [lat * 100 / 36, lon * 100 / 36];
}
const LC_MAP = { strasse: '#b9bcc2', trottoir: '#cfd1d4', erschliessung: '#d9d5cc', befestigt: '#d2cfc9', garten: '#c9dcb4', wiese: '#d3e2bd', humusiert: '#cfe0bb', wald: '#9fbf93', bestockt: '#b3cfa3', wasser: '#a9cde6', reben: '#c6d8a6', bahn: '#c4c0b8', vegetationslos: '#ddd6c4' };
const LC_GROUND = { strasse: '#6e7278', trottoir: '#b9b5ae', erschliessung: '#cfc7b8', befestigt: '#bdb7ad', garten: '#97c46e', wiese: '#acc97e', humusiert: '#9fbf74', wald: '#4f7440', bestockt: '#6a8f50', wasser: '#5f9cc8', reben: '#8bad5c', bahn: '#8f8a80', vegetationslos: '#cbbf9f' };

function decRing(a, ox, oy) { const p = new Float32Array(a.length); let x = 0, y = 0; for (let k = 0; k < a.length; k += 2) { x += a[k]; y += a[k + 1]; p[k] = x / 10 + ox; p[k + 1] = y / 10 + oy; } return p; }

/* ---------- Kacheln ---------- */
const Tiles = {
  ok: false, index: null, ids: new Set(), terrIds: new Set(), cache: new Map(), loading: new Map(), terr: new Map(), terrLoading: new Map(),
  geIdx: null, foot: new Set(), listeners: [], gsd: 2,
  async init() {
    if (!CFG.dataBase) return false;
    try {
      const r = await fetch(CFG.dataBase + 'index.json', { cache: 'no-cache' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      this.index = await r.json();
      this.ids = new Set(this.index.tiles.map(t => t.id));
      this.terrIds = new Set(this.index.tiles.filter(t => t.terrain).map(t => t.id));
      const m = /e \+ ([\d.]+)/.exec((this.index.terrain || {}).first_point || '');
      this.gsd = m ? 2 * parseFloat(m[1]) : 2;
      this.ok = true;
    } catch (e) { console.warn('Kacheln nicht erreichbar', e); this.ok = false; }
    return this.ok;
  },
  idAt(x, y) { return Math.floor((x + O0[0]) / 1000) + '-' + Math.floor((y + O0[1]) / 1000); },
  idsAround(x, y, r) {
    const out = [];
    for (let E = Math.floor((x - r + O0[0]) / 1000); E <= Math.floor((x + r + O0[0]) / 1000); E++)
      for (let N = Math.floor((y - r + O0[1]) / 1000); N <= Math.floor((y + r + O0[1]) / 1000); N++) { const id = E + '-' + N; if (this.ids.has(id)) out.push(id); }
    return out;
  },
  get(id) {
    if (this.cache.has(id)) return Promise.resolve(this.cache.get(id));
    if (this.loading.has(id)) return this.loading.get(id);
    const p = fetch(CFG.dataBase + 'tiles/' + id + '.json').then(r => { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(j => { const t = this.decode(id, j); this.cache.set(id, t); this.loading.delete(id); this.listeners.forEach(f => f(id, t)); return t; })
      .catch(e => { this.loading.delete(id); console.warn('Kachel', id, e); return null; });
    this.loading.set(id, p);
    return p;
  },
  decode(id, j) {
    const ox = j.origin[0] - O0[0], oy = j.origin[1] - O0[1];
    if (!this.geIdx) { this.geIdx = new Map(); DATA.b.forEach((b, i) => this.geIdx.set(b[7], i)); }
    const polys = g => (g || []).map(rings => rings.map(r => decRing(r, ox, oy)));
    const lines = g => (g || []).map(r => decRing(r, ox, oy));
    const pt = a => [a[0] / 10 + ox, a[1] / 10 + oy];
    const withBB = o => { o.p = o.polys[0] ? o.polys[0][0] : new Float32Array(0); o.bb = bboxOf(o.p); return o; };
    const bld = (j.buildings || []).map(b => {
      const bi = b.egid != null && this.geIdx.has(b.egid) ? this.geIdx.get(b.egid) : -1;
      if (bi >= 0) this.foot.add(bi);
      return withBB({ eg: b.egid, bi, polys: polys(b.geom), area: b.area, h: b.h, roof: b.roof, cat: b.cat, catIdx: DATA.cats.indexOf(b.cat), ground: b.ground || [], floors: b.floors, hsrc: b.hsrc, street: b.street, nr: b.nr });
    });
    const lc = [];
    for (const [k, arr] of Object.entries(j.landcover || {})) for (const rings of polys(arr)) lc.push({ k, rings, p: rings[0], bb: bboxOf(rings[0]) });
    return {
      id, ox, oy, bld, lc,
      parcels: (j.parcels || []).map(p => withBB({ n: p.nr, polys: polys(p.geom) })),
      objects: (j.objects || []).map(o => withBB({ art: o.art, polys: polys(o.geom) })),
      roads: (j.roads || []).map(r => ({ name: r.name, hw: r.hw, maxspeed: r.maxspeed, lanes: r.lanes, oneway: r.oneway, bridge: r.bridge, tunnel: r.tunnel, layer: r.layer, lines: lines(r.geom) })),
      streets: (j.streets || []).map(r => ({ name: r.name, lines: lines(r.geom) })),
      water: (j.water || []).map(r => ({ name: r.name, lines: lines(r.geom) })),
      rail: (j.rail || []).map(r => ({ lines: lines(r.geom) })),
      trees: (j.trees || []).filter(Boolean).map(pt),
      signs: (j.signs || []).map(s => ({ kind: s[0], value: s[1], angle: s[2], x: s[3] / 10 + ox, y: s[4] / 10 + oy })),
      pois: (j.pois || []).map(p => ({ name: p.name, kind: p.kind, type: p.type, hours: p.hours, web: p.web, cuisine: p.cuisine, x: p.p[0] / 10 + ox, y: p.p[1] / 10 + oy })),
      horizon: j.horizon || null,
      trails: (j.trails || []).map(r => ({ kind: r.kind, ref: r.ref, name: r.name, network: r.network, lines: lines(r.geom) })),
      heritage: (j.heritage || []).map(p => ({ name: p.name, historic: p.historic, heritage: p.heritage, wiki: p.wiki, x: p.p[0] / 10 + ox, y: p.p[1] / 10 + oy })),
    };
  },
  terrain(id) {
    if (this.terr.has(id)) return Promise.resolve(this.terr.get(id));
    if (this.terrLoading.has(id)) return this.terrLoading.get(id);
    const p = fetch(CFG.dataBase + 'terrain/' + id + '.bin').then(r => { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); })
      .then(buf => { const g = new Int16Array(buf); this.terr.set(id, g); this.terrLoading.delete(id); return g; })
      .catch(e => { this.terrLoading.delete(id); console.warn('Gelände', id, e); return null; });
    this.terrLoading.set(id, p);
    return p;
  },
  // Geländehöhe (m ü. M.) an lokaler Position, NaN wenn keine Daten
  hAt(x, y) {
    if (!this.index) return NaN;
    const ax = x + O0[0], ay = y + O0[1], E = Math.floor(ax / 1000), N = Math.floor(ay / 1000), g = this.terr.get(E + '-' + N);
    if (!g) return NaN;
    const T = this.index.terrain, n = T.n, step = T.step, half = this.gsd / 2;
    const fx = Math.min(Math.max((ax - (E * 1000 + half)) / step, 0), n - 1.001), fy = Math.min(Math.max(((N * 1000 + 1000 - half) - ay) / step, 0), n - 1.001);
    const i = Math.floor(fx), j = Math.floor(fy), a = fx - i, b = fy - j;
    const v = (ii, jj) => g[ii + jj * n];
    const q = [v(i, j), v(i + 1, j), v(i, j + 1), v(i + 1, j + 1)];
    if (q.some(z => z === -32768)) { const ok = q.filter(z => z !== -32768); return ok.length ? ok.reduce((s, z) => s + z, 0) / ok.length / 10 : NaN; }
    return ((q[0] * (1 - a) + q[1] * a) * (1 - b) + (q[2] * (1 - a) + q[3] * a) * b) / 10;
  },
  async loadArea(x, y, r) {
    const ids = this.idsAround(x, y, r);
    await Promise.all(ids.map(id => Promise.all([this.get(id), this.terrIds.has(id) ? this.terrain(id) : null])));
    return ids.map(id => this.cache.get(id)).filter(Boolean);
  },
  buildingByEgid(eg) { for (const t of this.cache.values()) for (const b of t.bld) if (b.eg === eg) return b; return null; },
};

/* ---------- Öffentlicher Verkehr ---------- */
const Transit = {
  data: null,
  async load() {
    const f = Tiles.ok && Tiles.index.files && Tiles.index.files.transit;
    if (!f) return null;
    try { this.prepare(await (await fetch(CFG.dataBase + f.path)).json()); } catch (e) { console.warn('Fahrplan', e); }
    return this.data;
  },
  prepare(j) {
    const ox = j.origin[0] - O0[0], oy = j.origin[1] - O0[1];
    const stops = j.stops.map(s => ({ name: s[0], x: s[1] + ox, y: s[2] + oy }));
    const routes = j.routes.map(r => {
      const pieces = (r.shape || []).map(l => { const p = decRing(l, ox, oy); const cum = [0]; for (let k = 2; k < p.length; k += 2) cum.push(cum[cum.length - 1] + Math.hypot(p[k] - p[k - 2], p[k + 1] - p[k - 1])); return { p, cum }; });
      return { short: r.short, long: r.long, type: r.type, color: r.color ? '#' + r.color.replace('#', '') : null, agency: r.agency, pieces, proj: new Map() };
    });
    this.data = { stops, routes, days: j.days || {} };
  },
  dayKey(dow) { return dow < 5 ? 'werktag' : dow === 5 ? 'samstag' : 'sonntag'; },
  isTrain(r) { return r.type === 2 || (r.type >= 100 && r.type < 200); },
  project(piece, x, y) {
    let best = 1e18, bd = 0; const p = piece.p;
    for (let k = 0; k < p.length - 2; k += 2) {
      const ax = p[k], ay = p[k + 1], bx = p[k + 2], by = p[k + 3], dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy || 1;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / L2)), qx = ax + dx * t, qy = ay + dy * t, d2 = (x - qx) ** 2 + (y - qy) ** 2;
      if (d2 < best) { best = d2; bd = piece.cum[k / 2] + Math.sqrt(L2) * t; }
    }
    return [Math.sqrt(best), bd];
  },
  at(piece, d) {
    const c = piece.cum, p = piece.p; d = Math.max(0, Math.min(c[c.length - 1], d));
    let lo = 0, hi = c.length - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (c[m] <= d) lo = m; else hi = m; }
    const t = (d - c[lo]) / ((c[hi] - c[lo]) || 1);
    return [p[lo * 2] + (p[hi * 2] - p[lo * 2]) * t, p[lo * 2 + 1] + (p[hi * 2 + 1] - p[lo * 2 + 1]) * t, Math.atan2(p[hi * 2] - p[lo * 2], p[hi * 2 + 1] - p[lo * 2 + 1])];
  },
  // Position eines Fahrzeugs zwischen Halt a und b (Anteil f), entlang des OSM-Linienverlaufs wenn möglich
  position(route, a, b, f) {
    const A = this.data.stops[a], B = this.data.stops[b];
    const key = a + '-' + b;
    let pr = route.proj.get(key);
    if (pr === undefined) {
      pr = null;
      for (const pc of route.pieces) { const [da, sa] = this.project(pc, A.x, A.y), [db, sb] = this.project(pc, B.x, B.y); if (da < 80 && db < 80 && (!pr || da + db < pr.err)) pr = { pc, sa, sb, err: da + db }; }
      route.proj.set(key, pr);
    }
    if (pr) return this.at(pr.pc, pr.sa + (pr.sb - pr.sa) * f).concat([true]);
    return [A.x + (B.x - A.x) * f, A.y + (B.y - A.y) * f, Math.atan2(B.x - A.x, B.y - A.y), false];
  },
  // aktive Fahrten zu einer Tageszeit (Sekunden) für einen Wochentag
  active(dow, sec) {
    const d = this.data && this.data.days[this.dayKey(dow)];
    if (!d) return [];
    const out = [];
    for (const t of d.trips) {
      const times = t[3];
      if (sec < times[0] || sec > times[times.length - 1]) continue;
      let k = 0; while (k < times.length - 2 && times[k + 1] <= sec) k++;
      const f = Math.max(0, Math.min(1, (sec - times[k]) / ((times[k + 1] - times[k]) || 1)));
      out.push({ trip: t, route: this.data.routes[t[0]], a: t[2][k], b: t[2][k + 1], f });
    }
    return out;
  },
};

/* ---------- Wetter und Föhn ---------- */
const WMO = { 0: 'klar', 1: 'überwiegend klar', 2: 'teilweise bewölkt', 3: 'bedeckt', 45: 'Nebel', 48: 'Nebel mit Reif', 51: 'leichter Niesel', 53: 'Niesel', 55: 'starker Niesel', 56: 'gefrierender Niesel', 57: 'gefrierender Niesel',
  61: 'leichter Regen', 63: 'Regen', 65: 'starker Regen', 66: 'gefrierender Regen', 67: 'gefrierender Regen', 71: 'leichter Schneefall', 73: 'Schneefall', 75: 'starker Schneefall', 77: 'Schneegriesel',
  80: 'Regenschauer', 81: 'Regenschauer', 82: 'heftige Regenschauer', 85: 'Schneeschauer', 86: 'starke Schneeschauer', 95: 'Gewitter', 96: 'Gewitter mit Hagel', 99: 'Gewitter mit Hagel' };
const Weather = {
  data: null,
  async load() {
    if (!Tiles.ok) return null;
    try { const r = await fetch(CFG.dataBase + 'live/weather.json', { cache: 'no-cache' }); if (r.ok) this.data = await r.json(); } catch (e) { console.warn('Wetter', e); }
    return this.data;
  },
  pointFor(x, y) {
    if (!this.data || !this.data.points || !this.data.points.length) return null;
    let best = null, bd = 1e18;
    for (const p of this.data.points) { if (!p.hourly) continue; const [px, py] = wgs84ToLocal(p.lat, p.lon); const d = (px - x) ** 2 + (py - y) ** 2; if (d < bd) { bd = d; best = p; } }
    return best;
  },
  // Wetter zur Spielzeit (lokales Datum + Stunde), sofern im Vorhersagefenster
  at(x, y, isoDay, hour) {
    const P = this.pointFor(x, y);
    if (!P) return null;
    const h = P.hourly, key = isoDay + 'T' + String(hour).padStart(2, '0') + ':00', i = h.time.indexOf(key);
    if (i < 0) return null;
    const g = k => (h[k] ? h[k][i] : null);
    return { point: P.name, temp: g('temperature_2m'), code: g('weather_code'), text: WMO[g('weather_code')] || '', cloud: (g('cloud_cover') ?? 40) / 100, precip: g('precipitation') || 0,
      snow: g('snowfall') || 0, wind: g('wind_speed_10m') || 0, gust: g('wind_gusts_10m') || 0, windDir: g('wind_direction_10m') || 0, vis: g('visibility') ?? 30000, freezing: g('freezing_level_height') };
  },
  // Föhnindex nur, wenn die Spielzeit nahe an der echten Zeit liegt (Messwert, keine Vorhersage)
  foehn(gameDate) {
    const f = this.data && this.data.foehn;
    if (!f || !f.nearest || f.nearest.value == null) return null;
    if (Math.abs(gameDate.getTime() - Date.now()) > 3 * 3600e3) return null;
    return { value: f.nearest.value, station: f.nearest.name, text: (f.legend || {})[String(Math.round(f.nearest.value))] || '' };
  },
};

/* ---------- Vereine ---------- */
const Vereine = {
  list: [],
  async load() {
    const f = Tiles.ok && Tiles.index.files && Tiles.index.files.vereine;
    if (!f) return [];
    try { this.list = await (await fetch(CFG.dataBase + f.path)).json(); } catch (e) { console.warn('Vereine', e); }
    return this.list;
  },
  of(gem) { return this.list.filter(v => (v.gemeinde || '').startsWith(gem) || v.gemeinde === 'Liechtenstein'); },
};

/* ---------- Bevölkerungs- und Arbeitsplatzdichte (Hektarraster) ---------- */
const Density = {
  cells: null, map: new Map(), stand: null,
  async load() {
    const f = Tiles.ok && Tiles.index.files && Tiles.index.files.dichte;
    if (!f) return null;
    try {
      const j = await (await fetch(CFG.dataBase + f.path)).json();
      this.stand = j.stand;
      this.cells = j.cells.map(c => ({ hx: c[0], hy: c[1], x: c[0] * 100 + 50 - O0[0], y: c[1] * 100 + 50 - O0[1], p: c[2], j: c[3], pc: c[4], jc: c[5] }));
      for (const c of this.cells) this.map.set(c.hx + ',' + c.hy, c);
    } catch (e) { console.warn('Dichte', e); }
    return this.cells;
  },
  at(x, y) { return this.map.get(Math.floor((x + O0[0]) / 100) + ',' + Math.floor((y + O0[1]) / 100)) || null; },
  around(x, y, r) {
    let p = 0, j = 0; if (!this.cells) return { p, j };
    const hx0 = Math.floor((x - r + O0[0]) / 100), hx1 = Math.floor((x + r + O0[0]) / 100), hy0 = Math.floor((y - r + O0[1]) / 100), hy1 = Math.floor((y + r + O0[1]) / 100);
    for (let hx = hx0; hx <= hx1; hx++) for (let hy = hy0; hy <= hy1; hy++) { const c = this.map.get(hx + ',' + hy); if (c && (c.x - x) ** 2 + (c.y - y) ** 2 <= r * r) { p += c.p; j += c.j; } }
    return { p, j };
  },
};
