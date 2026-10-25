'use strict';
/* Kleine Pixel-Sprites (8 x 8) statt Emojis, im Stil der 8-Bit-Heimcomputer. */
const PAL = { K: '#000000', W: '#fff1e8', R: '#ff004d', D: '#5f574f', G: '#c2c3c7', Y: '#ffec27', O: '#ab5236', B: '#29adff', N: '#7e2553', S: '#ffccaa', L: '#00e436', A: '#ffa300' };
const SPRITES = {
  siedlung: ['...RR...', '..RRRR..', '.RRRRRR.', 'RRRRRRRR', '.WWWWWW.', '.WBWWOW.', '.WWWWOW.', '.WWWWOW.'],
  burg: ['G.G..G.G', 'GGG..GGG', 'GGGGGGGG', '.GDGGDG.', '.GGGGGG.', '.GGDDGG.', '.GGDDGG.', 'GGGDDGGG'],
  markt: ['..YYYY..', '.YYAAYY.', 'YYAYYYYY', 'YYYAAYYY', 'YYYYYAYY', '.YYAAYY.', '..YYYY..', '........'],
  schwert: ['......GW', '.....GWG', '....GWG.', 'O..GWG..', '.OGWG...', '..OG....', '.O.O....', 'O.......'],
  gold: ['..YYYY..', '.YAAAAY.', 'YAYYYYAY', 'YAYYYYAY', 'YAYYYYAY', 'YAYYYYAY', '.YAAAAY.', '..YYYY..'],
  stern: ['...YY...', '...YY...', 'YYYYYYYY', '.YYYYYY.', '..YYYY..', '.YY..YY.', 'YY....YY', '........'],
  fahne: ['W.......', 'WBBBBB..', 'WBBBBB..', 'WRRRRR..', 'WRRRRR..', 'W.......', 'W.......', 'W.......'],
  pakt: ['........', 'BB....RR', 'BBSSSSRR', 'BBSSSSRR', 'BB.SS.RR', '........', '........', '........'],
  pokal: ['YYYYYYYY', 'Y.YYYY.Y', 'Y.YYYY.Y', '.YYYYYY.', '..YYYY..', '...YY...', '..YYYY..', '.YYYYYY.'],
  warn: ['...RR...', '...RR...', '...RR...', '...RR...', '...RR...', '........', '...RR...', '...RR...'],
  bruch: ['R......R', '.R....R.', '..R..R..', '...RR...', '...RR...', '..R..R..', '.R....R.', 'R......R'],
};
const Spr = {
  cache: new Map(),
  canvas(name, scale = 1) {
    const key = name + scale; if (this.cache.has(key)) return this.cache.get(key);
    const rows = SPRITES[name], c = document.createElement('canvas'); c.width = 8 * scale; c.height = 8 * scale; const g = c.getContext('2d');
    rows.forEach((r, y) => [...r].forEach((ch, x) => { if (ch !== '.') { g.fillStyle = PAL[ch]; g.fillRect(x * scale, y * scale, scale, scale); } }));
    this.cache.set(key, c); return c;
  },
  url(name, scale = 2) { const k = 'u' + name + scale; if (!this.cache.has(k)) this.cache.set(k, this.canvas(name, scale).toDataURL()); return this.cache.get(k); },
  img(name, scale = 2, title = '') { return `<img class="spr" src="${this.url(name, scale)}" width="${8 * scale}" height="${8 * scale}" alt="${title}">`; },
  fill(root = document) { root.querySelectorAll('i[data-spr]').forEach(i => { i.outerHTML = this.img(i.dataset.spr, +(i.dataset.sc || 2), i.title || ''); }); },
};

/* Pixel-Porträts der Gemeindeoberhäupter, 24 x 24, aus Bausteinen zusammengesetzt */
Spr.portrait = function (o, scale = 4) {
  const key = 'p' + JSON.stringify(o) + scale; if (this.cache.has(key)) return this.cache.get(key);
  const c = document.createElement('canvas'); c.width = c.height = 24 * scale; const g = c.getContext('2d');
  const px = (x, y, w, h, col) => { g.fillStyle = col; g.fillRect(x * scale, y * scale, w * scale, h * scale); };
  const shade = (hex, f) => '#' + [1, 3, 5].map(k => Math.round(clamp(parseInt(hex.slice(k, k + 2), 16) * f, 0, 255)).toString(16).padStart(2, '0')).join('');
  const S = o.skin || '#e8b896', H = o.hair || '#4a2a14', C = o.cloth || '#29adff', K = '#000000', Sd = shade(S, .8), Hd = shade(H, .7);
  px(0, 0, 24, 24, o.bg || '#1d2b53'); for (let y = 0; y < 24; y += 2) px(0, y, 24, 1, shade(o.bg || '#1d2b53', .85));
  // Kleidung und Hals
  px(3, 20, 18, 4, C); px(5, 19, 14, 1, C); px(2, 22, 20, 2, shade(C, .8)); px(10, 17, 4, 3, Sd); px(9, 19, 6, 1, shade(C, 1.25));
  if (o.extra === 'schal') { px(6, 18, 12, 2, o.extraColor || '#ff004d'); px(14, 20, 2, 3, o.extraColor || '#ff004d'); }
  if (o.extra === 'orden' || o.extra2 === 'orden') { px(15, 21, 2, 2, '#ffec27'); px(15, 20, 2, 1, '#ff004d'); }
  // lange Haare hinter dem Kopf
  if (o.style === 'lang') { px(5, 7, 14, 13, H); px(4, 10, 16, 9, H); }
  if (o.style === 'zoepfe') { px(4, 11, 2, 9, H); px(18, 11, 2, 9, H); px(4, 20, 2, 1, o.extraColor || '#ff004d'); px(18, 20, 2, 1, o.extraColor || '#ff004d'); }
  // Kopf
  px(7, 6, 10, 12, S); px(6, 8, 12, 8, S); px(8, 17, 8, 1, S); px(5, 11, 1, 2, S); px(18, 11, 1, 2, S);
  // Haare oben
  if (o.style === 'kurz' || o.style === 'lang' || o.style === 'dutt' || o.style === 'zoepfe') { px(7, 5, 10, 2, H); px(6, 6, 12, 2, H); px(6, 8, 1, 3, H); px(17, 8, 1, 3, H); }
  if (o.style === 'dutt') { px(10, 2, 4, 3, H); px(11, 1, 2, 1, Hd); }
  if (o.style === 'locken') { for (const [x, y] of [[6, 5], [8, 4], [10, 4], [12, 4], [14, 4], [16, 5], [5, 7], [17, 7], [5, 9], [17, 9]]) px(x, y, 2, 2, H); px(7, 6, 10, 1, H); }
  if (o.style === 'glatze') { px(6, 9, 1, 3, H); px(17, 9, 1, 3, H); px(9, 7, 2, 1, shade(S, 1.15)); }
  if (o.style === 'irokese') { px(11, 2, 2, 5, H); px(10, 3, 1, 3, H); px(13, 3, 1, 3, H); }
  // Augenbrauen, Augen
  px(8, 9, 3, 1, Hd); px(13, 9, 3, 1, Hd);
  if (o.eyes === 'muede') { px(8, 11, 3, 1, K); px(13, 11, 3, 1, K); }
  else if (o.eyes === 'boese') { px(8, 9, 3, 1, K); px(13, 9, 3, 1, K); px(10, 10, 1, 1, K); px(13, 10, 1, 1, K); px(9, 11, 2, 1, K); px(13, 11, 2, 1, K); }
  else { px(9, 10, 1, 2, '#fff'); px(10, 10, 1, 2, K); px(13, 10, 1, 2, K); px(14, 10, 1, 2, '#fff'); }
  if (o.glasses === 'brille') { g.strokeStyle = K; g.lineWidth = scale; g.strokeRect(8 * scale + scale / 2, 9.5 * scale, 3 * scale, 3 * scale); g.strokeRect(13 * scale - scale / 2, 9.5 * scale, 3 * scale, 3 * scale); px(11, 10, 2, 1, K); }
  if (o.glasses === 'monokel') { g.strokeStyle = '#ffec27'; g.lineWidth = scale; g.strokeRect(12.5 * scale, 9.5 * scale, 3 * scale, 3 * scale); px(15, 12, 1, 6, '#ffec27'); }
  if (o.glasses === 'augenklappe') { px(13, 9, 3, 3, K); px(6, 8, 12, 1, K); }
  if (o.glasses === 'sonne') { px(8, 10, 3, 2, K); px(13, 10, 3, 2, K); px(11, 10, 2, 1, K); }
  // Nase, Wangen, Mund
  px(11, 12, 2, 2, Sd); if (o.blush) { px(7, 13, 2, 1, '#ff77a8'); px(15, 13, 2, 1, '#ff77a8'); }
  const m = o.mouth || 'laecheln';
  if (m === 'laecheln') { px(10, 15, 4, 1, '#7e2553'); px(9, 14, 1, 1, '#7e2553'); px(14, 14, 1, 1, '#7e2553'); }
  if (m === 'grinsen') { px(9, 14, 6, 2, '#7e2553'); px(10, 14, 4, 1, '#fff'); }
  if (m === 'streng') px(10, 15, 4, 1, '#7e2553');
  if (m === 'oh') px(11, 14, 2, 2, '#7e2553');
  if (m === 'schief') { px(10, 15, 3, 1, '#7e2553'); px(13, 14, 1, 1, '#7e2553'); }
  // Bart
  if (o.beard === 'voll') { px(7, 13, 10, 5, H); px(8, 18, 8, 1, H); px(10, 15, 4, 1, '#7e2553'); px(11, 12, 2, 1, Sd); }
  if (o.beard === 'schnauz') { px(8, 13, 8, 1, H); px(8, 14, 1, 1, H); px(15, 14, 1, 1, H); }
  if (o.beard === 'spitz') { px(11, 16, 2, 3, H); px(9, 13, 6, 1, H); }
  // Kopfbedeckung
  const hat = o.hat;
  if (hat === 'krone') { px(6, 3, 12, 3, '#ffec27'); px(6, 1, 2, 2, '#ffec27'); px(11, 1, 2, 2, '#ffec27'); px(16, 1, 2, 2, '#ffec27'); px(11, 4, 2, 1, '#ff004d'); px(7, 4, 1, 1, '#29adff'); px(16, 4, 1, 1, '#29adff'); px(6, 5, 12, 1, '#ffa300'); }
  if (hat === 'diadem') { px(7, 5, 10, 1, '#ffec27'); px(11, 3, 2, 2, '#ffec27'); px(11, 4, 2, 1, '#00e436'); }
  if (hat === 'helm') { px(6, 3, 12, 5, '#c2c3c7'); px(5, 6, 14, 2, '#83769c'); px(11, 7, 2, 5, '#83769c'); px(11, 1, 2, 2, '#ff004d'); }
  if (hat === 'walserhut') { px(4, 6, 16, 2, K); px(7, 2, 10, 4, K); px(7, 5, 10, 1, o.extraColor || '#ff004d'); px(16, 1, 1, 4, '#00e436'); }
  if (hat === 'kappe') { px(6, 3, 12, 4, o.hatColor || '#ff004d'); px(14, 6, 7, 1, shade(o.hatColor || '#ff004d', .7)); px(11, 3, 2, 1, '#fff'); }
  if (hat === 'feder') { px(6, 4, 12, 3, o.hatColor || '#008751'); px(5, 6, 14, 1, shade(o.hatColor || '#008751', .7)); px(17, 0, 2, 5, '#fff1e8'); px(18, 0, 1, 2, '#c2c3c7'); }
  if (hat === 'stirnband') { px(6, 7, 12, 1, o.hatColor || '#ff004d'); px(4, 8, 2, 3, o.hatColor || '#ff004d'); }
  if (hat === 'kochmuetze') { px(7, 1, 10, 5, '#fff1e8'); px(6, 0, 4, 3, '#fff1e8'); px(14, 0, 4, 3, '#fff1e8'); px(7, 5, 10, 1, '#c2c3c7'); }
  // Extras
  if (o.extra === 'pfeife' || o.extra2 === 'pfeife') { px(14, 15, 4, 1, '#ab5236'); px(17, 13, 2, 2, '#ab5236'); px(17, 11, 1, 1, '#c2c3c7'); px(18, 10, 1, 1, '#c2c3c7'); }
  if (o.extra === 'ohrring' || o.extra2 === 'ohrring') { px(5, 13, 1, 2, '#ffec27'); px(18, 13, 1, 2, '#ffec27'); }
  if (o.extra === 'blume') { px(16, 5, 3, 3, '#ff77a8'); px(17, 6, 1, 1, '#ffec27'); }
  if (o.extra === 'kopfhoerer') { px(5, 9, 2, 5, K); px(17, 9, 2, 5, K); px(6, 4, 12, 1, K); }
  g.strokeStyle = K; g.lineWidth = scale; g.strokeRect(scale / 2, scale / 2, 23 * scale, 23 * scale);
  this.cache.set(key, c); return c;
};
Spr.portraitImg = function (o, scale = 4, alt = '') { const k = 'pu' + JSON.stringify(o) + scale; if (!this.cache.has(k)) this.cache.set(k, this.portrait(o, scale).toDataURL()); return `<img class="spr" src="${this.cache.get(k)}" width="${24 * scale}" height="${24 * scale}" alt="${esc(alt)}">`; };
