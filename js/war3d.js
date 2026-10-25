'use strict';
/* Schrägansicht für "Kampf um Liechtenstein": Gelände aus dem 25-m-Raster als Pixel-Relief (Stil Comanche, 1992).
   Die Felder bleiben in voller Auflösung (Textur 1 Pixel = 1 Feld), nur das Höhengitter nutzt jeden zweiten Punkt. */
const War3D = {
  ok: false, EX: 1.6, BASE: 430, STEP: 2, FOV: 45,
  init(war) {
    if (this.ok || !window.THREE) return this.ok;
    try {
      const c = this.cv = $('#wc3');
      const R = this.R = new THREE.WebGLRenderer({ canvas: c, antialias: false, powerPreference: 'high-performance' });
      R.setPixelRatio(1); R.setClearColor(0x000000);
      this.scene = new THREE.Scene(); this.scene.fog = new THREE.Fog(0x000000, 400, 1600);
      this.cam = new THREE.PerspectiveCamera(this.FOV, 1, 1, 6000);
      this.war = war; this.build(war.map); this.ok = true; this.resize();
    } catch (e) { console.warn('3D nicht verfügbar', e); this.ok = false; }
    return this.ok;
  },
  resize() { if (!this.R || !this.war) return; this.R.setSize(this.war.W, this.war.H, false); this.cam.aspect = this.war.W / this.war.H; this.cam.updateProjectionMatrix(); },
  // Höhe in Szeneneinheiten (1 Einheit = 1 Feld = 25 m), ausserhalb des Landes etwas tiefer
  y(M, i) {
    const h = M.gem[i] ? M.hoehe[i] : 0; if (h) return (h - this.BASE) / M.cell * this.EX;
    const u = M.um ? this.war.umHeight(i % M.w + .5, ((i / M.w) | 0) + .5) : 0; return u ? (u - this.BASE) / M.cell * this.EX : -3;
  },
  yu(gx, gy) { const u = this.war.umHeight(gx, gy); return u ? (u - this.BASE) / this.war.map.cell * this.EX : -3; },
  hAt(gx, gy) {
    const M = this.war.map; if (M.um && (gx < 0 || gy < 0 || gx > M.w || gy > M.h)) return this.yu(gx, gy);
    const x = clamp(gx - .5, 0, M.w - 1.001), z = clamp(gy - .5, 0, M.h - 1.001), i = Math.floor(x), j = Math.floor(z), a = x - i, b = z - j, k = j * M.w + i;
    return (this.y(M, k) * (1 - a) + this.y(M, k + 1) * a) * (1 - b) + (this.y(M, k + M.w) * (1 - a) + this.y(M, k + M.w + 1) * a) * b;
  },
  build(M) {
    let mx = 0; for (let i = 0; i < M.N; i++) if (M.gem[i]) mx = Math.max(mx, M.hoehe[i]); this.maxY = (mx - this.BASE) / M.cell * this.EX + 1;
    const S = this.STEP, nx = Math.ceil(M.w / S) + 1, nz = Math.ceil(M.h / S) + 1, N = nx * nz;
    const pos = new Float32Array(N * 3), uv = new Float32Array(N * 2);
    for (let r = 0; r < nz; r++) for (let q = 0; q < nx; q++) {
      const x = Math.min(q * S, M.w), z = Math.min(r * S, M.h), v = r * nx + q;
      pos[v * 3] = x; pos[v * 3 + 1] = this.hAtRaw(M, x, z); pos[v * 3 + 2] = z;
      uv[v * 2] = x / M.w; uv[v * 2 + 1] = 1 - z / M.h;
    }
    const idx = new Uint32Array((nx - 1) * (nz - 1) * 6); let o = 0;
    for (let r = 0; r < nz - 1; r++) for (let q = 0; q < nx - 1; q++) { const a = r * nx + q, b = a + 1, c = a + nx, d = c + 1; idx[o++] = a; idx[o++] = c; idx[o++] = b; idx[o++] = b; idx[o++] = c; idx[o++] = d; }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); geo.setIndex(new THREE.BufferAttribute(idx, 1));
    // Textur: Grundkarte plus Gebiete, ein Pixel je Feld
    const tc = this.tc = document.createElement('canvas'); tc.width = M.w; tc.height = M.h; this.tctx = tc.getContext('2d');
    const tex = this.tex = new THREE.CanvasTexture(tc); tex.magFilter = THREE.NearestFilter; tex.minFilter = THREE.LinearMipmapLinearFilter; tex.anisotropy = 4;
    this.mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: tex, alphaTest: .5 })); this.scene.add(this.mesh);
    this.buildUmland(M);
    // dunkler Boden ringsum, damit am Rand kein Loch entsteht
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(M.w * 6, M.h * 6), new THREE.MeshBasicMaterial({ color: 0x000000 })); floor.rotation.x = -Math.PI / 2; floor.position.set(M.w / 2, -3.2, M.h / 2); (this.umScene || this.scene).add(floor);
    this.dirty = true;
  },
  // Umland als eigenes Netz in eigener Szene: wird zuerst gezeichnet, das Spielfeld liegt immer darüber
  buildUmland(M) {
    const U = M.um, W = this.war; if (!U || !W.umCanvas) return;
    this.umScene = new THREE.Scene(); this.umScene.fog = this.scene.fog;
    const S = 2, nx = Math.ceil(U.w / S) + 1, nz = Math.ceil(U.h / S) + 1, pos = new Float32Array(nx * nz * 3), uv = new Float32Array(nx * nz * 2);
    for (let r = 0; r < nz; r++) for (let q = 0; q < nx; q++) {
      const ux = Math.min(q * S, U.w), uz = Math.min(r * S, U.h), gx = U.gx0 + ux * U.k, gz = U.gy0 + uz * U.k, v = r * nx + q;
      const edge = q === 0 || r === 0 || q === nx - 1 || r === nz - 1; pos[v * 3] = gx; pos[v * 3 + 1] = edge ? -3.2 : this.yu(gx, gz) - .6; pos[v * 3 + 2] = gz; uv[v * 2] = ux / U.w; uv[v * 2 + 1] = 1 - uz / U.h;
    }
    const idx = new Uint32Array((nx - 1) * (nz - 1) * 6); let o = 0;
    for (let r = 0; r < nz - 1; r++) for (let q = 0; q < nx - 1; q++) { const a = r * nx + q, b = a + 1, c = a + nx, d = c + 1; idx[o++] = a; idx[o++] = c; idx[o++] = b; idx[o++] = b; idx[o++] = c; idx[o++] = d; }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); geo.setIndex(new THREE.BufferAttribute(idx, 1));
    const tex = new THREE.CanvasTexture(W.umCanvas); tex.magFilter = THREE.NearestFilter; tex.minFilter = THREE.LinearMipmapLinearFilter;
    this.umScene.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: tex })));
    this.R.autoClear = false;
  },
  hAtRaw(M, x, z) { // Mittel der bis zu vier angrenzenden Felder
    let s = 0, n = 0;
    for (const [dx, dz] of [[-1, -1], [0, -1], [-1, 0], [0, 0]]) { const i = x + dx, j = z + dz; if (i < 0 || j < 0 || i >= M.w || j >= M.h) continue; s += this.y(M, j * M.w + i); n++; }
    return n ? s / n : -3;
  },
  place() {
    const W = this.war, c = W.cam, d = (W.H / c.s) / (2 * Math.tan(this.FOV * Math.PI / 360));
    const ty = this.hAt(c.x, c.y), st = Math.sin(c.tilt), ct = Math.cos(c.tilt), sy = Math.sin(c.yaw), cy = Math.cos(c.yaw);
    this.cam.position.set(c.x + d * st * sy, ty + d * ct, c.y + d * st * cy);
    this.cam.up.set(-sy, 0, -cy); this.cam.lookAt(c.x, ty, c.y);
    this.cam.near = Math.max(.5, d / 50); this.cam.far = d * 6 + 2000; this.cam.updateProjectionMatrix(); this.cam.updateMatrixWorld();
    this.scene.fog.near = d * 1.8; this.scene.fog.far = d * 5.5;
  },
  render() {
    if (!this.ok) return;
    if (this.dirty) { const W = this.war, g = this.tctx; g.clearRect(0, 0, this.tc.width, this.tc.height); g.drawImage(W.base, 0, 0); g.drawImage(W.ov, 0, 0); this.tex.needsUpdate = true; this.dirty = false; }
    this.place();
    if (this.umScene) { this.R.clear(); this.R.render(this.umScene, this.cam); this.R.clearDepth(); }
    this.R.render(this.scene, this.cam);
  },
  project(gx, gy, lift = 0) {
    const v = this._v || (this._v = new THREE.Vector3()); v.set(gx, this.hAt(gx, gy) + lift, gy).project(this.cam);
    if (v.z > 1 || v.z < -1) return [-9999, -9999];
    return [(v.x + 1) / 2 * this.war.W, (1 - v.y) / 2 * this.war.H];
  },
  // Feld unter dem Finger: Strahl durch das Höhenfeld verfolgen
  pick(sx, sy) {
    const W = this.war, M = W.map; this.place();
    const ndc = new THREE.Vector3(sx / W.W * 2 - 1, 1 - sy / W.H * 2, .5).unproject(this.cam), o = this.cam.position, dir = ndc.sub(o).normalize();
    let t = 0, prev = null;
    for (let k = 0; k < 20000; k++) {
      const x = o.x + dir.x * t, y = o.y + dir.y * t, z = o.z + dir.z * t;
      if (y < -3.5) break;
      if (x >= 0 && z >= 0 && x < M.w && z < M.h && y <= this.hAt(x, z)) { const p = prev || [x, z]; const gx = Math.floor((x + p[0]) / 2), gy = Math.floor((z + p[1]) / 2); return gy * M.w + gx; }
      prev = [x, z]; t += Math.max(.4, (y - this.maxY) * .8);
    }
    return -1;
  },
};
