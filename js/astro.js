'use strict';
/* Sonnen- und Mondstand (nach den Formeln von SunCalc, V. Agafonkin, BSD-Lizenz) und Zeitzone Vaduz */
const Astro = (() => {
  const rad = Math.PI / 180, dayMs = 864e5, J1970 = 2440588, J2000 = 2451545, e = rad * 23.4397;
  const toDays = d => d.valueOf() / dayMs - 0.5 + J1970 - J2000;
  const ra = (l, b) => Math.atan2(Math.sin(l) * Math.cos(e) - Math.tan(b) * Math.sin(e), Math.cos(l));
  const dec = (l, b) => Math.asin(Math.sin(b) * Math.cos(e) + Math.cos(b) * Math.sin(e) * Math.sin(l));
  const azimuth = (H, phi, d) => Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(phi) - Math.tan(d) * Math.cos(phi));
  const altitude = (H, phi, d) => Math.asin(Math.sin(phi) * Math.sin(d) + Math.cos(phi) * Math.cos(d) * Math.cos(H));
  const sidereal = (d, lw) => rad * (280.16 + 360.9856235 * d) - lw;
  const meanAnomaly = d => rad * (357.5291 + 0.98560028 * d);
  const eclLon = M => M + rad * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M)) + rad * 102.9372 + Math.PI;
  const sunCoords = d => { const L = eclLon(meanAnomaly(d)); return { dec: dec(L, 0), ra: ra(L, 0) }; };
  const moonCoords = d => {
    const L = rad * (218.316 + 13.176396 * d), M = rad * (134.963 + 13.064993 * d), F = rad * (93.272 + 13.22935 * d);
    const l = L + rad * 6.289 * Math.sin(M), b = rad * 5.128 * Math.sin(F), dist = 385001 - 20905 * Math.cos(M);
    return { ra: ra(l, b), dec: dec(l, b), dist };
  };
  // Rückgabe: Höhe und Kompassrichtung in Grad (0 = Nord, im Uhrzeigersinn)
  const toCompass = az => ((az / rad + 180) % 360 + 360) % 360;
  function sun(date, lat, lon) {
    const lw = rad * -lon, phi = rad * lat, d = toDays(date), c = sunCoords(d), H = sidereal(d, lw) - c.ra;
    const h = altitude(H, phi, c.dec);
    return { alt: h / rad, az: toCompass(azimuth(H, phi, c.dec)) };
  }
  function moon(date, lat, lon) {
    const lw = rad * -lon, phi = rad * lat, d = toDays(date), c = moonCoords(d), H = sidereal(d, lw) - c.ra;
    let h = altitude(H, phi, c.dec);
    h += rad * 0.017 / Math.tan(h + rad * 10.26 / (h + rad * 5.1));
    return { alt: h / rad, az: toCompass(azimuth(H, phi, c.dec)) };
  }
  function moonIllum(date) {
    const d = toDays(date), s = sunCoords(d), m = moonCoords(d), sdist = 149598000;
    const phi = Math.acos(Math.sin(s.dec) * Math.sin(m.dec) + Math.cos(s.dec) * Math.cos(m.dec) * Math.cos(s.ra - m.ra));
    const inc = Math.atan2(sdist * Math.sin(phi), m.dist - sdist * Math.cos(phi));
    const angle = Math.atan2(Math.cos(s.dec) * Math.sin(s.ra - m.ra), Math.sin(s.dec) * Math.cos(m.dec) - Math.cos(s.dec) * Math.sin(m.dec) * Math.cos(s.ra - m.ra));
    return { fraction: (1 + Math.cos(inc)) / 2, phase: 0.5 + 0.5 * inc * (angle < 0 ? -1 : 1) / Math.PI };
  }
  const offFmt = (() => { try { return new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Vaduz', timeZoneName: 'shortOffset' }); } catch (e) { return null; } })();
  // Minuten Abstand zu UTC in Vaduz zu einem Zeitpunkt (Sommerzeit beachtet)
  function vaduzOffset(utcMs) {
    if (!offFmt) return 60;
    const p = offFmt.formatToParts(new Date(utcMs)).find(x => x.type === 'timeZoneName');
    const m = p && /GMT([+-]\d+)(?::(\d+))?/.exec(p.value);
    return m ? (+m[1]) * 60 + (m[2] ? Math.sign(+m[1]) * (+m[2]) : 0) : 60;
  }
  // Lokale Vaduzer Zeit (Datum 'YYYY-MM-DD' + Minuten) -> Date (UTC-Zeitpunkt)
  function localToDate(isoDay, minutes) {
    const [y, mo, dd] = isoDay.split('-').map(Number);
    const guess = Date.UTC(y, mo - 1, dd) + minutes * 60000;
    return new Date(guess - vaduzOffset(guess - 60 * 60000) * 60000);
  }
  function todayVaduz() {
    const ms = Date.now() + vaduzOffset(Date.now()) * 60000;
    return new Date(ms).toISOString().slice(0, 10);
  }
  return { sun, moon, moonIllum, localToDate, todayVaduz, vaduzOffset };
})();
