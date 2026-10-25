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
