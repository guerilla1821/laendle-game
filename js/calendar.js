'use strict';
/* Feiertage und Schulferien Liechtenstein.
   Feiertage nach Kalender (Ostern per Gauss/Meeus), Schulferien nach der Schulorganisationsverordnung (LR 411.201, Anhang 2). */
const Cal = (() => {
  const D = (y, m, d) => new Date(Date.UTC(y, m - 1, d));
  const add = (dt, n) => new Date(dt.getTime() + n * 864e5);
  const iso = dt => dt.toISOString().slice(0, 10);
  const dow = dt => dt.getUTCDay();  // 0 = Sonntag
  function easter(y) {
    const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
    const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
    const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
    return D(y, month, day);
  }
  // frei = arbeitsfreier Feiertag; sonst nur Bankfeiertag (Banken und Teile der Verwaltung geschlossen)
  function holidays(y) {
    const E = easter(y);
    return [[D(y, 1, 1), 'Neujahr', 1], [D(y, 1, 2), 'Berchtoldstag', 0], [D(y, 1, 6), 'Heilige Drei Könige', 1], [D(y, 2, 2), 'Mariä Lichtmess', 1],
      [add(E, -47), 'Fasnachtsdienstag', 0], [D(y, 3, 19), 'Josefstag', 1], [add(E, -2), 'Karfreitag', 0], [add(E, 1), 'Ostermontag', 1],
      [D(y, 5, 1), 'Tag der Arbeit', 1], [add(E, 39), 'Auffahrt', 1], [add(E, 50), 'Pfingstmontag', 1], [add(E, 60), 'Fronleichnam', 1],
      [D(y, 8, 15), 'Staatsfeiertag', 1], [D(y, 9, 8), 'Mariä Geburt', 1], [D(y, 11, 1), 'Allerheiligen', 1], [D(y, 12, 8), 'Mariä Empfängnis', 1],
      [D(y, 12, 24), 'Heiligabend', 0], [D(y, 12, 25), 'Weihnachten', 1], [D(y, 12, 26), 'Stephanstag', 1], [D(y, 12, 31), 'Silvester', 0]]
      .map(([d, name, frei]) => ({ date: iso(d), name, frei: !!frei }));
  }
  const firstSat = (y, m) => { let d = D(y, m, 1); while (dow(d) !== 6) d = add(d, 1); return d; };
  function schoolStart(y) { let d = D(y, 8, 17); const w = dow(d); if (w === 4 || w === 5 || w === 6 || w === 0) while (dow(d) !== 1) d = add(d, 1); return d; }
  // Ferien des Schuljahres, das im August des Jahres y beginnt
  function schoolYear(y) {
    const out = [], P = (name, a, b) => out.push({ name, from: iso(a), to: iso(b) });
    const h = firstSat(y, 10); P('Herbstferien', h, add(h, 15));
    const w0 = dow(D(y, 12, 24)) === 2 ? D(y, 12, 21) : D(y, 12, 24), w1 = dow(D(y + 1, 1, 6)) === 4 ? D(y + 1, 1, 9) : D(y + 1, 1, 6); P('Weihnachtsferien', w0, w1);
    const E = easter(y + 1);
    P('Sportferien', add(E, -50), add(E, -42));
    P('Osterferien', add(E, -3), add(E, 14));
    P('Auffahrtsbrücke', add(E, 39), add(E, 42));
    P('Fronleichnamsbrücke', add(E, 60), add(E, 63));
    let s = firstSat(y + 1, 7); if (s.getUTCDate() === 1) s = add(s, 7);
    P('Sommerferien', s, add(schoolStart(y + 1), -1));
    return out;
  }
  const cache = new Map();
  const yearData = y => { if (!cache.has(y)) cache.set(y, { hol: holidays(y), fer: [...schoolYear(y - 1), ...schoolYear(y)] }); return cache.get(y); };
  function holidayOn(isoDay) { return yearData(+isoDay.slice(0, 4)).hol.find(h => h.date === isoDay) || null; }
  function ferienOn(isoDay) { const f = yearData(+isoDay.slice(0, 4)).fer.find(p => p.from <= isoDay && isoDay <= p.to); return f ? f.name : null; }
  return { easter: y => iso(easter(y)), holidays, schoolYear, holidayOn, ferienOn };
})();
