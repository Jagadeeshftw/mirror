// Generator for Mirror design proposal 2. Run: node build.mjs  -> index.html
// Shared primitives are copied from ../app-proposal/build.mjs (approved proposal) so both stay visually identical.
// Every phone screen is written once and rendered into a light and a dark frame; laptop layouts (1440x900) and
// share cards (1200x630, 1080x1080) are rendered the same way.
import { writeFileSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = dirname(fileURLToPath(import.meta.url));

const BRAND = 'Mirror'; // single replaceable product-name token
const DOMAIN = 'mirror.0xo.in';

// ---------- utils ----------
let seed = 7;
const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
const hex = (n) => Array.from({ length: n }, () => '0123456789abcdef'[Math.floor(rnd() * 16)]).join('');
const tx = () => { const h = hex(64); return { short: `0x${h.slice(0, 4)}…${h.slice(-4)}`, full: `0x${h}` }; };
const M = '−'; // true minus
const sgn = (n, d = 2) => (n >= 0 ? '+' : M) + Math.abs(n).toFixed(d);
const pct = (n, d = 1) => sgn(n, d) + '%';
const comma = (n, d = 0) => n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const hash = (s) => { let h = 2166136261; for (const c of s) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };

// ---------- icons ----------
const P = {
  home: '<path d="M3.5 10.2 12 3.5l8.5 6.7V19a1.5 1.5 0 0 1-1.5 1.5h-4.2v-6h-5.6v6H5A1.5 1.5 0 0 1 3.5 19z"/>',
  leaders: '<path d="M3.5 20.5h17M5.5 20.5v-6h4v6M10 20.5V8h4v12.5M14.5 20.5v-9h4v9"/>',
  feed: '<path d="M13.2 2.8 5 13.5h6.2l-1 7.7 8.3-10.8h-6.3z"/>',
  positions: '<path d="M11 3.6a8.5 8.5 0 1 0 9.4 9.4H11z"/><path d="M14 3.2a8.5 8.5 0 0 1 6.8 6.8H14z"/>',
  back: '<path d="M19.5 12h-15M10.5 6l-6 6 6 6"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  chev: '<path d="M9.5 6l6 6-6 6"/>',
  down: '<path d="M7 10l5 5 5-5"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  copy: '<rect x="8.5" y="8.5" width="11.5" height="11.5" rx="2.5"/><path d="M15.5 8.5V6A2 2 0 0 0 13.5 4H6A2 2 0 0 0 4 6v7.5a2 2 0 0 0 2 2h2.5"/>',
  ext: '<path d="M14 4h6v6M20 4l-8.5 8.5M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4"/>',
  fp: '<path d="M7.6 4.6A8.6 8.6 0 0 1 20.4 12v1"/><path d="M3.6 15.5a14 14 0 0 0 .4-3.5 8 8 0 0 1 1.6-4.8"/><path d="M6.6 19.2A13 13 0 0 0 8 12a4 4 0 0 1 8 0v1.5"/><path d="M12 12v1.5a17 17 0 0 1-2.2 8.2"/><path d="M15.8 17a22 22 0 0 1-1.4 4.3"/><path d="M19.6 16.8a20 20 0 0 1-.6 2.6"/>',
  bell: '<path d="M6 16.5V11a6 6 0 1 1 12 0v5.5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>',
  gear: '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
  shield: '<path d="M12 3l7.5 3v5.2c0 4.6-3.1 8.4-7.5 9.8-4.4-1.4-7.5-5.2-7.5-9.8V6z"/><path d="M9 12l2.2 2.2L15.5 10"/>',
  pause: '<path d="M9 5.5v13M15 5.5v13"/>',
  ban: '<circle cx="12" cy="12" r="8.5"/><path d="M6 6l12 12"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  arrdown: '<path d="M12 4.5v15M6 13.5l6 6 6-6"/>',
  arrup: '<path d="M12 19.5v-15M6 10.5l6-6 6 6"/>',
  tune: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.2M12 7.8v.1"/>',
  warn: '<path d="M10.3 4.2 2.9 17.4A2 2 0 0 0 4.6 20.4h14.8a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0z"/><path d="M12 9.5v4.2M12 16.8v.1"/>',
  wifioff: '<path d="M3 3l18 18M8.6 16.4a4.8 4.8 0 0 1 6.3-.5M5.2 12.9a9.6 9.6 0 0 1 4.6-2.5M18.8 12.9a9.7 9.7 0 0 0-2.1-1.5M2 9a14.5 14.5 0 0 1 4.3-2.8M22 9a14.6 14.6 0 0 0-10.4-3.5M12 20v.1"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  key: '<circle cx="8" cy="15.5" r="4.5"/><path d="M11.2 12.3 20 3.5M17 6.5l2.5 2.5M14.5 9l2 2"/>',
  moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
  globe: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.4 2.4 3.5 5.3 3.5 8.5s-1.1 6.1-3.5 8.5c-2.4-2.4-3.5-5.3-3.5-8.5s1.1-6.1 3.5-8.5z"/>',
  doc: '<path d="M14 3.5H7.5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2V8z"/><path d="M14 3.5V8h4.5M9 13h6M9 16.5h4"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/>',
  edit: '<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>',
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="2.5"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/>',
  wallet: '<path d="M4 7.5h15a1 1 0 0 1 1 1V19a1 1 0 0 1-1 1H5.5A1.5 1.5 0 0 1 4 18.5z"/><path d="M4 7.5V6.5A2 2 0 0 1 6 4.5h10.5v3M16 14h.1"/>',
  share: '<circle cx="17.5" cy="5.5" r="2.5"/><circle cx="6.5" cy="12" r="2.5"/><circle cx="17.5" cy="18.5" r="2.5"/><path d="M8.7 10.7l6.6-3.9M8.7 13.3l6.6 3.9"/>',
  refresh: '<path d="M20 11.5a8 8 0 1 0-2.4 5.9"/><path d="M20.5 4.5v7h-7"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6 6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4"/>',
  phone: '<rect x="6.5" y="2.5" width="11" height="19" rx="2.5"/><path d="M11 18.5h2"/>',
  star: '<path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.8l-5.2 2.8 1-5.8-4.3-4.1 5.9-.8z"/>',
  bksp: '<path d="M9 5.5h10.5a1.5 1.5 0 0 1 1.5 1.5v10a1.5 1.5 0 0 1-1.5 1.5H9L3 12z"/><path d="M11.5 9.5l5 5M16.5 9.5l-5 5"/>',
  tag: '<path d="M3.5 12.6V4.5a1 1 0 0 1 1-1h8.1l8 8a1.4 1.4 0 0 1 0 2l-7.1 7.1a1.4 1.4 0 0 1-2 0z"/><circle cx="8" cy="8" r="1.4"/>',
  layers: '<path d="M12 3.5 21 8l-9 4.5L3 8z"/><path d="M3 12.5l9 4.5 9-4.5M3 16.5l9 4.5 9-4.5"/>',
  cal: '<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  hourglass: '<path d="M6.5 3.5h11M6.5 20.5h11M7.5 3.5c0 4.5 4.5 5.5 4.5 8.5s-4.5 4-4.5 8.5M16.5 3.5c0 4.5-4.5 5.5-4.5 8.5s4.5 4 4.5 8.5"/>',
  more: '<circle cx="12" cy="5.5" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="12" cy="18.5" r="1.2"/>',
};
const I = (n, s = 24, cls = '') => `<svg class="ic ${cls}" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[n]}</svg>`;

const brandMark = (s = 28) => `<svg class="bm" width="${s}" height="${s}" viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="9" fill="var(--ac)"/><path d="M15 7.5 6.5 24.5H15z" fill="var(--on-ac)"/><path d="M17 7.5l8.5 17H17z" fill="var(--on-ac)" fill-opacity=".45"/></svg>`;

const identicon = (s, size = 36) => {
  const h = hash(s);
  let rects = '';
  for (let r = 0; r < 5; r++) for (let c = 0; c < 3; c++) {
    if ((h >> (r * 3 + c)) & 1) {
      rects += `<rect x="${c}" y="${r}" width="1" height="1"/>`;
      if (c < 2) rects += `<rect x="${4 - c}" y="${r}" width="1" height="1"/>`;
    }
  }
  return `<span class="idn" style="width:${size}px;height:${size}px"><svg viewBox="-1 -1 7 7" width="${size * 0.72}" height="${size * 0.72}" shape-rendering="crispEdges" fill="var(--ac)" aria-hidden="true">${rects}</svg></span>`;
};

const coin = '<span class="coin" aria-hidden="true">A</span>';

// ---------- data ----------
const ME = { short: '0x4b21…9e07', full: '0x4b21C7e05A93d1F2bE6c8a04D71f3e2290a19e07' };
const ACCT = { equity: 21.37, balance: 20.45, upnl: 0.92, rpnl: 0.45, today: 0.84, margin: 9.21, withdrawable: 11.24, deposited: 20.0, cap: 25 };
const L = {
  a: { addr: '0x7a3f…c91e', labels: ['Smart Trader', '30D Smart Trader'], r30: 38.4, r7: 6.2, dd: 9.2, win: 61, lev: 4.1, mk: ['BTC', 'SOL', 'ETH'], freq: 14.2, score: 92, fol: 212 },
  b: { addr: '0x19be…04d2', labels: ['Fund'], r30: 24.1, r7: 3.9, dd: 6.8, win: 57, lev: 2.8, mk: ['BTC', 'ETH'], freq: 3.1, score: 89, fol: 148 },
  e: { addr: '0xe8a9…33c6', labels: [], r30: 15.2, r7: 2.4, dd: 4.1, win: 66, lev: 2.1, mk: ['ZEC', 'ETH'], freq: 5.6, score: 84, fol: 61 },
  c: { addr: '0xc4e0…7b13', labels: ['Smart Trader', 'Whale'], r30: 51.7, r7: 9.8, dd: 22.5, win: 48, lev: 9.6, mk: ['HYPE', 'SOL', 'MON', 'BTC'], freq: 9.4, score: 81, fol: 97 },
  d: { addr: '0x5d21…a8f0', labels: ['Whale'], r30: 17.9, r7: -1.3, dd: 11.3, win: 54, lev: 5.2, mk: ['BTC', 'ETH', 'ZEC'], freq: 6.8, score: 78, fol: 54 },
  f: { addr: '0x2f70…d5a4', labels: [], r30: 12.6, r7: 4.4, dd: 14.0, win: 52, lev: 3.4, mk: ['SOL', 'MON', 'PUMP'], freq: 11.0, score: 74, fol: 23 },
};
const MARKETS = ['BTC', 'ETH', 'SOL', 'MON', 'HYPE', 'ZEC', 'LIT', 'VVV', 'PUMP', 'NEAR', 'UNI'];

// Leader C equity series (30 days, 4 pts/day) built from control points + small noise.
function buildSeries(points, perDay, noise) {
  const out = [];
  for (let k = 0; k < points.length - 1; k++) {
    const [d0, v0] = points[k], [d1, v1] = points[k + 1];
    const steps = (d1 - d0) * perDay;
    for (let i = 0; i < steps; i++) {
      const t = i / steps; const e = t * t * (3 - 2 * t);
      const base = v0 + (v1 - v0) * e;
      out.push(i === 0 ? v0 : base * (1 + (rnd() - 0.5) * noise));
    }
  }
  out.push(points[points.length - 1][1]);
  return out;
}
const cSeries = buildSeries([[0, 93400], [5, 103200], [10, 118600], [16, 91900], [22, 111800], [27, 129500], [30, 141700]], 4, 0.012);
const cRet = (cSeries.at(-1) / cSeries[0] - 1) * 100;
const cPnl = cSeries.at(-1) - cSeries[0];
let peak = cSeries[0], peakI = 0, dd = 0, ddPeakI = 0, ddTroughI = 0;
cSeries.forEach((v, i) => { if (v > peak) { peak = v; peakI = i; } const d = (peak - v) / peak; if (d > dd) { dd = d; ddPeakI = peakI; ddTroughI = i; } });
const cDD = dd * 100;
L.c.r30 = +cRet.toFixed(1); L.c.dd = +cDD.toFixed(1);
const dayStr = (i) => { const d = new Date(Date.UTC(2026, 8, 5) + Math.floor(i / 4) * 864e5); return d.toLocaleString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }); };
const ddFrom = dayStr(ddPeakI), ddTo = dayStr(ddTroughI), ddDays = Math.floor(ddTroughI / 4) - Math.floor(ddPeakI / 4);

const spark = (ret, n = 30, s = 1) => { seed = 11 + s * 97; const pts = [[0, 100]]; const steps = 5; for (let i = 1; i <= steps; i++) pts.push([i * (n / steps), 100 + (ret * i) / steps + (i < steps ? (rnd() - 0.45) * ret * 0.5 : 0)]); return buildSeries(pts.map(([d, v]) => [Math.round(d), v]), 1, 0.02); };
seed = 41;
const homeSeries = buildSeries([[0, 20.31], [2, 20.48], [3, 20.36], [5, 20.62], [6, 20.53], [7, 21.37]], 6, 0.003);

// ---------- charts ----------
function chart({ data, w = 320, h = 120, padL = 0, padR = 0, padT = 6, padB = 6, color = 'var(--pos)', area = true, yTicks = [], xTicks = [], band = null, endDot = true, min, max, cls = '' }) {
  const lo = min ?? Math.min(...data), hi = max ?? Math.max(...data);
  const X = (i) => padL + (i / (data.length - 1)) * (w - padL - padR);
  const Y = (v) => padT + ((hi - v) / (hi - lo)) * (h - padT - padB);
  const d = data.map((v, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)} ${Y(v).toFixed(1)}`).join('');
  let g = '';
  yTicks.forEach(([v, lab]) => { g += `<line x1="${padL}" x2="${w - padR}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}" class="gl"/>`; if (lab) g += `<text x="${w}" y="${(Y(v) + 3.5).toFixed(1)}" text-anchor="end" class="ct">${lab}</text>`; });
  xTicks.forEach(([i, lab, anchor = 'middle']) => { g += `<text x="${X(i).toFixed(1)}" y="${h - 1}" text-anchor="${anchor}" class="ct">${lab}</text>`; });
  let b = '';
  if (band) {
    const x0 = X(band.from), x1 = X(band.to);
    b = `<rect x="${x0.toFixed(1)}" y="${padT}" width="${(x1 - x0).toFixed(1)}" height="${h - padT - padB}" fill="var(--neg)" fill-opacity=".08"/>`
      + `<line x1="${x0.toFixed(1)}" x2="${x0.toFixed(1)}" y1="${Y(data[band.from]).toFixed(1)}" y2="${Y(data[band.to]).toFixed(1)}" stroke="var(--neg)" stroke-width="1" stroke-dasharray="0"/>`
      + `<circle cx="${x1.toFixed(1)}" cy="${Y(data[band.to]).toFixed(1)}" r="3.5" fill="var(--neg)" stroke="var(--sf)" stroke-width="2"/>`
      + `<text x="${((x0 + x1) / 2).toFixed(1)}" y="${padT - 2}" text-anchor="middle" class="ct ct-b">${band.label}</text>`;
  }
  const ar = area ? `<path d="${d}L${X(data.length - 1).toFixed(1)} ${h - padB}L${X(0).toFixed(1)} ${h - padB}Z" fill="${color}" fill-opacity=".1"/>` : '';
  const ed = endDot ? `<circle cx="${X(data.length - 1).toFixed(1)}" cy="${Y(data.at(-1)).toFixed(1)}" r="4" fill="${color}" stroke="var(--sf)" stroke-width="2"/>` : '';
  return `<svg class="chart ${cls}" viewBox="0 0 ${w} ${h}" role="img" aria-label="Equity curve">${g}${b}${ar}<path d="${d}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>${ed}</svg>`;
}
const sparkSvg = (ret, s) => chart({ data: spark(ret, 30, s), w: 64, h: 28, padT: 4, padB: 4, padR: 4, area: true, color: ret >= 0 ? 'var(--pos)' : 'var(--neg)', cls: 'spark' });

// QR-like matrix (illustrative placeholder; production uses a real encoder)
function qr(size = 29, px = 6) {
  seed = 2024;
  const m = Array.from({ length: size }, () => Array(size).fill(0));
  const finder = (r0, c0) => { for (let r = 0; r < 7; r++) for (let c = 0; c < 7; c++) m[r0 + r][c0 + c] = (r === 0 || r === 6 || c === 0 || c === 6 || (r >= 2 && r <= 4 && c >= 2 && c <= 4)) ? 1 : 0; };
  const reserved = (r, c) => (r < 8 && c < 8) || (r < 8 && c >= size - 8) || (r >= size - 8 && c < 8);
  for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) if (!reserved(r, c)) m[r][c] = rnd() > 0.52 ? 1 : 0;
  for (let i = 8; i < size - 8; i++) { m[6][i] = i % 2 === 0 ? 1 : 0; m[i][6] = i % 2 === 0 ? 1 : 0; }
  finder(0, 0); finder(0, size - 7); finder(size - 7, 0);
  // alignment pattern
  const a = size - 9; for (let r = -2; r <= 2; r++) for (let c = -2; c <= 2; c++) m[a + r][a + c] = (Math.max(Math.abs(r), Math.abs(c)) !== 1) ? 1 : 0;
  let d = '';
  m.forEach((row, r) => row.forEach((v, c) => { if (v) d += `M${c} ${r}h1v1h-1z`; }));
  return `<svg viewBox="-2 -2 ${size + 4} ${size + 4}" width="${(size + 4) * px}" height="${(size + 4) * px}" shape-rendering="crispEdges" role="img" aria-label="QR code for deposit address"><rect x="-2" y="-2" width="${size + 4}" height="${size + 4}" fill="#FFFFFF"/><path d="${d}" fill="#0E0F12"/></svg>`;
}

// ---------- shared UI pieces ----------
const statusIcons = '<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M1 14h2v-3H1zM5 14h2V9H5zM9 14h2V6H9zM13 14h2V2h-2z" fill="currentColor"/></svg><svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 13.5 1 6.3a10 10 0 0 1 14 0z" fill="currentColor"/></svg><svg width="24" height="16" viewBox="0 0 24 16" aria-hidden="true"><rect x="1" y="3" width="19" height="10" rx="3" fill="none" stroke="currentColor" stroke-opacity=".5"/><rect x="3" y="5" width="12" height="6" rx="1.5" fill="currentColor"/><rect x="21" y="6" width="2" height="4" rx="1" fill="currentColor" fill-opacity=".5"/></svg>';
const SB = (cls = '') => `<div class="sb ${cls}"><span class="n">9:41</span><span class="sb-i">${statusIcons}</span></div>`;
const GEST = '<div class="gest" aria-hidden="true"></div>';
const BAL = (v = ACCT.balance) => `<div class="bal" aria-label="AUSD balance">${coin}<span class="n">${v.toFixed(2)}</span><span class="u">AUSD</span></div>`;
const AV = `<span class="avb" aria-label="Account">${identicon(ME.full, 34)}</span>`;
const AB = (title, o = {}) => `<header class="ab">${o.back ? `<span class="ib">${I('back')}</span>` : ''}${o.brand ? `<span class="ab-brand">${brandMark(26)}<b>${BRAND}</b></span>` : `<h1 class="ab-t">${title}</h1>`}${o.noBal ? '' : BAL(o.bal)}${o.noAv ? '' : AV}</header>`;
const NAV = (on, badge) => `<nav class="bot">${[['home', 'Home'], ['leaders', 'Leaders'], ['feed', 'Feed'], ['positions', 'Positions']].map(([k, t]) => `<span class="nv ${on === k ? 'on' : ''}"><span class="nvi">${I(k, 22)}${badge && k === 'feed' ? `<span class="badge n">${badge}</span>` : ''}</span><span>${t}</span></span>`).join('')}</nav>${GEST}`;
const label = (t) => `<span class="nl">${I('tag', 12)}${t}</span>`;
const labels = (arr) => arr.map(label).join('');
const side = (s) => `<span class="side ${s === 'Long' ? 'sd-l' : 'sd-s'}">${s}</span>`;
const mk = (t, s = 32) => `<span class="mk" style="width:${s}px;height:${s}px">${t}</span>`;
const commit = (state) => { const st = ['Proposed', 'Voted', 'Finalized']; const k = st.indexOf(state); return `<span class="cm" aria-label="Commit state ${state}">${st.map((x, i) => `<span class="cm-s ${i <= k ? 'done' : ''} ${i === k ? 'cur' : ''}"><i></i>${i === k ? x : ''}</span>`).join('')}</span>`; };
const sw = (on) => `<span class="sw ${on ? 'on' : ''}" role="switch" aria-checked="${on}"><i></i></span>`;
const slider = (frac, ticks) => `<div class="sl"><div class="sl-t"><div class="sl-f" style="width:${frac * 100}%"></div></div><span class="sl-h" style="left:${frac * 100}%"></span></div>${ticks ? `<div class="sl-k n">${ticks.map(([t, p]) => `<span style="left:${p * 100}%">${t}</span>`).join('')}</div>` : ''}`;

// feed data
seed = 99;
const FEED = [
  { L: 'a', ago: '4s', mkt: 'MON', side: 'Short', act: 'Close', size: '220.0 MON', ntl: 9.2, px: '0.04180', lev: '3x', lat: '0.64', st: 'Proposed', pnl: 0.11, tx: tx() },
  { L: 'b', ago: '9s', mkt: 'BTC', side: 'Long', act: 'Close', size: '0.00005 BTC', ntl: 5.92, px: '118,402.0', lev: '2x', lat: '0.58', st: 'Voted', pnl: 0.06, tx: tx() },
  { L: 'c', ago: '1m', mkt: 'BTC', side: 'Long', act: 'Open', blocked: true, size: '1.50 BTC', lev: '20x', px: '118,390.0', tx: tx() },
  { L: 'c', ago: '38m', mkt: 'HYPE', side: 'Long', act: 'Open', size: '0.1000 HYPE', ntl: 4.69, px: '45.42', lev: '5x', lat: '0.61', st: 'Finalized', tx: tx() },
  { L: 'a', ago: '2h', mkt: 'SOL', side: 'Long', act: 'Open', size: '0.0467 SOL', ntl: 9.92, px: '198.10', lev: '3x', lat: '0.59', st: 'Finalized', tx: tx() },
  { L: 'b', ago: '3h', mkt: 'ETH', side: 'Short', act: 'Open', size: '0.00139 ETH', ntl: 6.0, px: '4,350.00', lev: '3x', lat: '0.66', st: 'Finalized', tx: tx() },
];
const feedItem = (f, o = {}) => {
  const ld = L[f.L];
  if (f.blocked) return `<article class="fi blk ${o.hl ? 'hl' : ''}"><div class="fi-h">${identicon(ld.addr, 28)}<span class="addr">${ld.addr}</span><span class="mu xs n">${f.ago} ago</span><span class="txl n">${f.tx.short}${I('ext', 13)}</span></div>
    <div class="fi-m">${mk(f.mkt)}<div class="fi-c"><div class="fi-t"><b>${f.mkt}</b> ${side(f.side)} <span class="mu sm">Leader ${f.act.toLowerCase()} · ${f.lev}</span></div><div class="sm"><span class="n">${f.size} @ ${f.px}</span></div></div></div>
    <div class="fi-f blkf">${I('ban', 16)}<span class="grow"><b>Not copied.</b> ${f.rule || 'Max leverage 5x'}</span><span class="lnk">Details ${I('chev', 14)}</span></div></article>`;
  return `<article class="fi"><div class="fi-h">${identicon(ld.addr, 28)}<span class="addr">${ld.addr}</span><span class="mu xs n">${f.ago} ago</span><span class="txl n">${f.tx.short}${I('ext', 13)}</span></div>
    <div class="fi-m">${mk(f.mkt)}<div class="fi-c"><div class="fi-t"><b>${f.mkt}</b> ${side(f.side)} <span class="mu sm">${f.act} · ${f.lev}</span></div><div class="sm n">${f.size} · ${f.ntl.toFixed(2)} AUSD @ ${f.px}</div></div>${f.pnl != null ? `<div class="fi-r"><span class="n pos sm">${sgn(f.pnl)}</span><span class="xs mu">realised</span></div>` : ''}</div>
    <div class="fi-f"><span class="lat n">${I('feed', 14)}Copied in ${f.lat} s</span>${commit(f.st)}</div></article>`;
};


// ---------- helpers copied from the approved proposal ----------
const S = {};
// Profile chart ticks
const profChart = () => {
  const lo = 85000, hi = 150000;
  return chart({ data: cSeries, w: 316, h: 176, padT: 18, padB: 18, padR: 32, min: lo, max: hi, yTicks: [[90000, '90k'], [110000, '110k'], [130000, '130k'], [150000, '150k']], xTicks: [[0, 'Sep 5', 'start'], [40, 'Sep 15'], [80, 'Sep 25'], [120, 'Oct 5', 'end']], band: { from: ddPeakI, to: ddTroughI, label: `Max DD ${M}${cDD.toFixed(1)}%` } });
};
const step = (state, t, sub) => `<li class="ck ${state}"><span class="ck-i">${state === 'done' ? I('check', 16) : ''}</span><div><b>${t}</b><div class="xs mu">${sub}</div></div></li>`;
const bars = (rows) => rows.map(([k, v]) => `<div class="hb"><span class="hb-k sm">${k}</span><span class="hb-t"><i style="width:${v}%"></i></span><span class="n sm hb-v">${v}%</span></div>`).join('');
const flag = (kind, t, sub) => `<div class="flag ${kind}">${I(kind === 'ok' ? 'check' : kind === 'info' ? 'info' : 'warn', 18)}<div><b class="sm">${t}</b><div class="xs mu">${sub}</div></div></div>`;
const statC = (k, v, sub, cls = '') => `<div class="st"><span class="xs mu">${k}</span><b class="n ${cls}">${v}</b>${sub ? `<span class="xs mu">${sub}</span>` : ''}</div>`;
const fsSec = (t, sub, body, ico) => `<section class="fs"><div class="fs-h">${I(ico, 18)}<div class="grow"><b>${t}</b>${sub ? `<div class="xs mu">${sub}</div>` : ''}</div></div>${body}</section>`;
const rv = (k, v) => `<div><span class="mu sm">${k}</span><span class="sm n">${v}</span></div>`;
const posRow = (p) => `<div class="po"><div class="po-h">${mk(p.m, 36)}<div class="grow"><div><b>${p.m}</b> ${side(p.s)} <span class="mu sm n">${p.lev}</span></div><div class="xs mu n">${p.size} · ${p.ntl.toFixed(2)} AUSD</div></div><div class="right"><div class="n b6 ${p.pnl >= 0 ? 'pos-i' : 'neg'}">${sgn(p.pnl)}</div><div class="xs mu n">${pct(p.roe)} ROE</div></div></div>
  <div class="po-g xs n"><div><span class="mu">Entry</span>${p.entry}</div><div><span class="mu">Mark</span>${p.mark}</div><div><span class="mu">Liq.</span>${p.liq}</div><div><span class="mu">Leader</span>${L[p.L].addr.slice(0, 6)}</div></div></div>`;
const push = (title, body, time, ico = '') => `<div class="psh"><div class="psh-h xs">${brandMark(18)}<span>${BRAND}</span><span class="psh-dot">·</span><span>${time}</span></div><b class="sm">${title}</b><div class="sm psh-b">${body}</div></div>`;
const nt = (ico, cls, t, b, time, unread) => `<div class="nt ${unread ? 'un' : ''}"><span class="nt-i ${cls}">${I(ico, 18)}</span><div class="grow mn0"><div class="row-c"><b class="sm">${t}</b><span class="xs mu right grow n">${time}</span></div><div class="sm mu">${b}</div></div></div>`;
const setRow = (ico, t, sub, right = I('chev', 18)) => `<div class="sr">${I(ico, 20)}<div class="grow mn0"><div class="sm">${t}</div>${sub ? `<div class="xs mu">${sub}</div>` : ''}</div>${right}</div>`;

// =====================================================================================
// Proposal 2 additions
// =====================================================================================
Object.assign(P, {
  target: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
  users: '<circle cx="9" cy="8.5" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 5.2a3.5 3.5 0 0 1 0 6.6M18 14.2a6.5 6.5 0 0 1 3.5 5.8"/>',
  split: '<path d="M4 6h16M4 12h10M4 18h6"/><path d="M17 15l3 3-3 3"/>',
  laptop: '<rect x="4" y="5" width="16" height="11" rx="1.5"/><path d="M2 19.5h20"/>',
  qr: '<rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><path d="M14 14h2v2h-2zM18 18h2v2h-2zM14 18v2M18 14h2"/>',
  dl: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
  msg: '<path d="M4 5.5h16v11H9.5L4 20.5z"/>',
  activity: '<path d="M3 12h4l3-7 4 14 3-7h4"/>',
  list: '<path d="M4 6.5h16M4 12h16M4 17.5h16"/>',
  stats: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  flame: '<path d="M12 21a6.5 6.5 0 0 0 6.5-6.5c0-4-3-6-4-10-2 2-3 4-3 6-1-1-1.5-2-1.8-3.2C7.6 9.3 5.5 11.6 5.5 14.5A6.5 6.5 0 0 0 12 21z"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  flag: '<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>',
  img: '<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><circle cx="9" cy="10" r="1.8"/><path d="M20.5 16l-5-5-9 8.5"/>',
});

const TEAM = (t = 'Team-run') => `<span class="team">${I('users', 12)}${t}</span>`;
const SIM = (t = 'Simulation, not a promise') => `<span class="simp">${I('info', 13)}${t}</span>`;
const LIVE = (t = 'Live') => `<span class="live xs"><i></i>${t}</span>`;
const okc = (t) => `<span class="chip-s okc">${I('check', 13)}${t}</span>`;
const ngc = (t) => `<span class="chip-s neg">${I('close', 13)}${t}</span>`;
const acc = (t) => `<span class="chip-s acc">${t}</span>`;
const TXL = (t, lab = '') => `<span class="txl n">${lab}${t.short}${I('ext', 13)}</span>`;
const DEMO = { fol: '0xde70…41a2', folFull: '0xde70b1c94e2f07a3d5c8e91b04f6a7c3d2e941a2', leader: 'Perpl #5416' };
const HOST = 'rpc.monad.xyz';

seed = 4242;
const T = { lead: tx(), mine: tx(), blk: tx(), demo1: tx(), demo2: tx(), demo3: tx(), stop: tx(), lvl: tx(), sug: tx(), c1: tx(), c2: tx(), c3: tx(), c4: tx() };

// --- multi-leader account (24.00 AUSD deposited, split across three leaders) ---
const ACC2 = { dep: 24.0, equity: 24.16, balance: 23.82, upnl: 0.34, rpnl: -0.18, today: 0.21 };
const BUD = [
  { k: 'a', budget: 12.0, used: 4.31, pnl: 0.62, eq: 12.62, ls: 15, lsAt: 10.2, st: 'on', pos: 2 },
  { k: 'b', budget: 8.0, used: 2.0, pnl: 0.14, eq: 8.14, ls: 10, lsAt: 7.2, st: 'on', pos: 1 },
  { k: 'c', budget: 4.0, used: 0, pnl: -0.6, eq: 3.4, ls: 15, lsAt: 3.4, st: 'hit', pos: 0 },
];
const LCOL = { a: 'var(--ac)', b: 'var(--ac2)', c: 'var(--mu)' };

// feed for the user's account: every copy carries proof (deviation, blocks, ms)
const FEED2 = [
  { L: 'a', ago: '4s', mkt: 'BTC', side: 'Long', act: 'Open', size: '0.0001 BTC', ntl: '11.84', px: '118,414.0', lev: '4x', lat: '0.61', blk: 2, dev: '+1.0', st: 'Finalized', tx: T.mine },
  { L: 'a', ago: '2m', mkt: 'SOL', side: 'Long', act: 'Add', blocked: true, size: '0.0500 SOL', px: '203.45', lev: '3x', rule: 'Price moved 2.7% past the leader\'s entry. Your limit is 1%', tx: T.blk },
  { L: 'b', ago: '38m', mkt: 'ETH', side: 'Short', act: 'Open', size: '0.0014 ETH', ntl: '6.09', px: '4,350.0', lev: '3x', lat: '0.66', blk: 2, dev: '−0.7', st: 'Finalized', tx: T.c1 },
  { L: 'b', ago: '3h', mkt: 'BTC', side: 'Long', act: 'Close', size: '0.00005 BTC', ntl: '5.92', px: '118,402.0', lev: '2x', lat: '0.92', blk: 3, dev: '+2.3', st: 'Finalized', pnl: 0.06, tx: T.c2 },
];
// watch mode: copies landing on the team-run demo follower
const WFEED = [
  { team: true, ago: '12s', mkt: 'BTC', side: 'Long', act: 'Open', size: '0.0001 BTC', ntl: '11.84', px: '118,414.0', lev: '2x', lat: '0.61', blk: 2, dev: '+1.0', st: 'Voted', tx: T.demo1 },
  { team: true, ago: '3m', mkt: 'BTC', side: 'Long', act: 'Open', blocked: true, size: '0.0001 BTC', px: '118,391.0', lev: '12x', rule: 'Leader used 12x. The demo rule is max 5x', tx: T.demo2 },
  { team: true, ago: '9m', mkt: 'BTC', side: 'Long', act: 'Close', size: '0.0001 BTC', ntl: '11.84', px: '118,380.0', lev: '2x', lat: '0.58', blk: 2, dev: '−0.4', st: 'Finalized', pnl: -0.01, tx: T.demo3 },
];

const feed2 = (f, o = {}) => {
  const who = f.team ? DEMO.leader : L[f.L].addr;
  const head = `<div class="fi-h">${identicon(f.team ? '5416' : L[f.L].addr, 28)}<span class="addr">${who}</span>${f.team ? TEAM() : ''}<span class="mu xs n">${f.ago} ago</span><span class="txl n">${f.tx.short}${I('ext', 13)}</span></div>`;
  if (f.blocked) return `<article class="fi blk ${o.hl ? 'hl' : ''}">${head}
    <div class="fi-m">${mk(f.mkt)}<div class="fi-c"><div class="fi-t"><b>${f.mkt}</b> ${side(f.side)} <span class="mu sm">Leader ${f.act.toLowerCase()} · ${f.lev}</span></div><div class="sm"><span class="n">${f.size} @ ${f.px}</span></div></div></div>
    <div class="fi-f blkf">${I('ban', 16)}<span class="grow"><b>Not copied.</b> ${f.rule}</span><span class="lnk">Details ${I('chev', 14)}</span></div></article>`;
  return `<article class="fi ${o.hl ? 'hl2' : ''}">${head}
    <div class="fi-m">${mk(f.mkt)}<div class="fi-c"><div class="fi-t"><b>${f.mkt}</b> ${side(f.side)} <span class="mu sm">${f.act} · ${f.lev}</span></div><div class="sm n">${f.size} · ${f.ntl} AUSD @ ${f.px}</div></div>${f.pnl != null ? `<div class="fi-r"><span class="n ${f.pnl >= 0 ? 'pos-i' : 'neg'} sm">${sgn(f.pnl)}</span><span class="xs mu">realised</span></div>` : ''}</div>
    <div class="fi-f"><span class="lat n">${I('feed', 14)}${f.lat} s · ${f.blk} blocks</span><span class="dvc n">${f.dev} bps</span>${commit(f.st)}</div></article>`;
};

// small helpers
const meter = (parts, h = 8) => `<div class="mtr" style="height:${h}px">${parts.map(([w, c, op = 1]) => `<i style="width:${w}%;background:${c};opacity:${op}"></i>`).join('')}</div>`;
const lg = (c, t, op = 1) => `<span class="lgi"><i style="background:${c};opacity:${op}"></i>${t}</span>`;
const cst = (state, t, sub, extra = '') => `<li class="ck ${state}"><span class="ck-i">${state === 'done' ? I('check', 14) : state === 'blk' ? I('ban', 14) : ''}</span><div class="mn0 grow"><b class="sm">${t}</b>${sub ? `<div class="xs mu">${sub}</div>` : ''}${extra ? `<div class="ck-x">${extra}</div>` : ''}</div></li>`;
const kvs = (rows) => `<div class="kvl">${rows.map(([k, v]) => rv(k, v)).join('')}</div>`;
const WB = (url) => `${SB()}<div class="wb"><span class="wb-u">${I('lock', 12)}<span class="n">${url}</span></span><span class="ib s">${I('more', 18)}</span></div>`;
const SITEH = () => `<header class="siteh">${brandMark(26)}<b>${BRAND}</b><span class="grow"></span><span class="ib s bd">${I('sun', 16)}</span><span class="ib s bd">${I('list', 18)}</span></header>`;

// histogram (vertical bars) with labels under
const hist = (rows, { w = 320, h = 110, hl = -1, fmt = (v) => v, color = 'var(--ac)' } = {}) => {
  const mx = Math.max(...rows.map((r) => r[1])); const n = rows.length; const gap = 6; const bw = (w - gap * (n - 1)) / n;
  return `<svg class="chart" viewBox="0 0 ${w} ${h + 30}" role="img" aria-label="Histogram">${rows.map(([lab, v], i) => { const bh = Math.max(2, (v / mx) * h); const x = i * (bw + gap); return `<rect x="${x.toFixed(1)}" y="${(h - bh).toFixed(1)}" width="${bw.toFixed(1)}" height="${bh.toFixed(1)}" rx="3" fill="${color}" fill-opacity="${hl < 0 || hl === i ? 1 : 0.5}"/><text x="${(x + bw / 2).toFixed(1)}" y="${(h - bh - 4).toFixed(1)}" text-anchor="middle" class="ct">${fmt(v)}</text><text x="${(x + bw / 2).toFixed(1)}" y="${h + 14}" text-anchor="middle" class="ct">${lab}</text>`; }).join('')}<line x1="0" x2="${w}" y1="${h}" y2="${h}" class="gl"/></svg>`;
};
// horizontal count bars
const hbars = (rows, unit = '') => { const mx = Math.max(...rows.map((r) => r[1])); return rows.map(([k, v, cls = '']) => `<div class="hb2"><span class="sm">${k}</span><span class="hb-t"><i class="${cls}" style="width:${(v / mx) * 100}%"></i></span><span class="n sm right">${v}${unit}</span></div>`).join(''); };

// band chart: simulated equity with a range band and an optional stop line
function bandChart({ mid, lo, hi, w = 320, h = 150, min, max, stop, xTicks = [], yTicks = [], padR = 34 }) {
  const padT = 8, padB = 18, padL = 0;
  const X = (i) => padL + (i / (mid.length - 1)) * (w - padL - padR);
  const Y = (v) => padT + ((max - v) / (max - min)) * (h - padT - padB);
  const line = (arr) => arr.map((v, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)} ${Y(v).toFixed(1)}`).join('');
  const band = `${line(hi)}${lo.map((v, i) => [i, v]).reverse().map(([i, v]) => `L${X(i).toFixed(1)} ${Y(v).toFixed(1)}`).join('')}Z`;
  let g = '';
  yTicks.forEach(([v, lab]) => { g += `<line x1="0" x2="${w - padR}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}" class="gl"/><text x="${w}" y="${(Y(v) + 3.5).toFixed(1)}" text-anchor="end" class="ct">${lab}</text>`; });
  xTicks.forEach(([i, lab, a = 'middle']) => { g += `<text x="${X(i).toFixed(1)}" y="${h - 2}" text-anchor="${a}" class="ct">${lab}</text>`; });
  const st = stop ? `<line x1="0" x2="${w - padR}" y1="${Y(stop.v).toFixed(1)}" y2="${Y(stop.v).toFixed(1)}" stroke="var(--neg)" stroke-dasharray="4 4" stroke-width="1"/><text x="2" y="${(Y(stop.v) - 4).toFixed(1)}" class="ct ct-b">${stop.label}</text>` : '';
  return `<svg class="chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="Simulated equity">${g}${st}<path d="${band}" fill="var(--ac)" fill-opacity=".14"/><path d="${line(mid)}" fill="none" stroke="var(--ac)" stroke-width="2" stroke-linejoin="round"/><circle cx="${X(mid.length - 1).toFixed(1)}" cy="${Y(mid.at(-1)).toFixed(1)}" r="4" fill="var(--ac)" stroke="var(--sf)" stroke-width="2"/></svg>`;
}
seed = 808;
const simMid = buildSeries([[0, 4.0], [5, 4.18], [10, 4.36], [16, 4.09], [22, 4.31], [27, 4.47], [30, 4.55]], 4, 0.006);
const simLo = simMid.map((v, i) => v - (i / (simMid.length - 1)) * 0.17 - 0.01);
const simHi = simMid.map((v, i) => v + (i / (simMid.length - 1)) * 0.16 + 0.01);
simLo[simLo.length - 1] = 4.38; simHi[simHi.length - 1] = 4.71;
const simChart = (w = 320, h = 150) => bandChart({ mid: simMid, lo: simLo, hi: simHi, w, h, min: 3.3, max: 4.9, stop: { v: 3.4, label: 'Loss stop 3.40' }, yTicks: [[3.5, '3.50'], [4.0, '4.00'], [4.5, '4.50']], xTicks: [[0, 'Sep 7', 'start'], [60, 'Sep 22'], [120, 'Oct 7', 'end']] });

// price chart with horizontal level lines (position detail)
seed = 515;
const pxSeries = buildSeries([[0, 117880], [2, 116900], [4, 118900], [6, 117600], [8, 118420]], 8, 0.0025);
function levelChart({ w = 350, h = 170, levels, data = pxSeries, min = 104000, max = 145000 }) {
  const padR = 64;
  const X = (i) => (i / (data.length - 1)) * (w - padR);
  const Y = (v) => 6 + ((max - v) / (max - min)) * (h - 12);
  const d = data.map((v, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)} ${Y(v).toFixed(1)}`).join('');
  const lv = levels.map(([v, lab, col, dash]) => `<line x1="0" x2="${w - padR + 4}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}" stroke="${col}" stroke-width="1" ${dash ? 'stroke-dasharray="4 4"' : ''}/><rect x="${w - padR + 6}" y="${(Y(v) - 8).toFixed(1)}" width="${padR - 6}" height="16" rx="4" fill="${col}" fill-opacity=".14"/><text x="${w - 4}" y="${(Y(v) + 3.5).toFixed(1)}" text-anchor="end" class="ct" style="fill:${col}">${lab}</text>`).join('');
  return `<svg class="chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="Price with levels">${lv}<path d="${d}" fill="none" stroke="var(--tx)" stroke-width="1.6" stroke-linejoin="round"/><circle cx="${X(data.length - 1).toFixed(1)}" cy="${Y(data.at(-1)).toFixed(1)}" r="3.5" fill="var(--tx)" stroke="var(--sf)" stroke-width="2"/></svg>`;
}
const LV_BTC = (sl = 108450, tp = 141456) => [[tp, (tp / 1000).toFixed(1) + 'k TP', 'var(--pos)', true], [117880, '117.9k entry', 'var(--mu)', false], [sl, (sl / 1000).toFixed(1) + 'k SL', 'var(--neg)', true]];

// QR-like matrix with its own seed (illustrative; production uses a real encoder)
function qr2(s, px = 4, size = 25, label = 'QR code linking to the onchain proof') {
  seed = s;
  const m = Array.from({ length: size }, () => Array(size).fill(0));
  const finder = (r0, c0) => { for (let r = 0; r < 7; r++) for (let c = 0; c < 7; c++) m[r0 + r][c0 + c] = (r === 0 || r === 6 || c === 0 || c === 6 || (r >= 2 && r <= 4 && c >= 2 && c <= 4)) ? 1 : 0; };
  const reserved = (r, c) => (r < 8 && c < 8) || (r < 8 && c >= size - 8) || (r >= size - 8 && c < 8);
  for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) if (!reserved(r, c)) m[r][c] = rnd() > 0.52 ? 1 : 0;
  for (let i = 8; i < size - 8; i++) { m[6][i] = i % 2 === 0 ? 1 : 0; m[i][6] = i % 2 === 0 ? 1 : 0; }
  finder(0, 0); finder(0, size - 7); finder(size - 7, 0);
  let d = ''; m.forEach((row, r) => row.forEach((v, c) => { if (v) d += `M${c} ${r}h1v1h-1z`; }));
  return `<svg viewBox="-2 -2 ${size + 4} ${size + 4}" width="${(size + 4) * px}" height="${(size + 4) * px}" shape-rendering="crispEdges" role="img" aria-label="${label}"><rect x="-2" y="-2" width="${size + 4}" height="${size + 4}" fill="#FFFFFF"/><path d="${d}" fill="#0E0F12"/></svg>`;
}

// =====================================================================================
// 1. Watch mode
// =====================================================================================
const demoCard = (o = {}) => `<div class="card wm">
  <div class="row-c">${identicon(DEMO.folFull, 36)}<div class="grow mn0"><div class="row-c gap6"><b class="sm">Demo follower</b>${TEAM()}</div><div class="xs mu n">${DEMO.fol} · copies ${DEMO.leader}</div></div>${o.live === false ? '<span class="xs mu">From Monad</span>' : LIVE()}</div>
  <div class="kv3"><div><span class="xs mu">Balance</span><b class="n">9.87</b></div><div><span class="xs mu">Open</span><b class="n">${o.flat ? 'Flat' : 'BTC long'}</b></div><div><span class="xs mu">Copies today</span><b class="n">${o.today ?? 14}</b></div></div>
  <div class="xs mu wm-r">${I('shield', 14)}<span>Its rules: max 5x · BTC only · 100% of leader size · within 1% of the leader's entry. Not counted in ${BRAND}'s public numbers.</span></div>
</div>`;
const runBtns = (o = {}) => `<div class="stack8">${o.dis ? `<span class="btn dis">${I('feed', 20)}${o.dis}</span><span class="btn dis">${I('ban', 20)}Run blocked trade</span>` : `<span class="btn pri">${I('feed', 20)}Run demo trade</span><span class="btn out">${I('ban', 20)}Run blocked trade</span>`}</div>
  <p class="xs mu center">${o.note || 'Uses the team\'s money on Perpl mainnet, never yours. 6 runs per hour per network · 41 left today.'}</p>`;
const depNudge = () => `<div class="card dep"><div class="row-c">${I('arrdown', 20)}<div class="grow"><b class="sm">Copy with your own limits</b><div class="xs mu">Deposit up to 25.00 AUSD during beta. One passkey signature, no gas.</div></div></div><span class="btn pri sm-b">Add funds</span></div>`;

S.watchHome = () => `<div class="scr">${SB()}${AB('', { brand: true, bal: 0 })}<main class="main">
  <section class="hero"><div class="lbl">Your account</div><div class="big n">0.00<span class="u">AUSD</span></div><div class="delta"><span class="mu sm">Nothing deposited yet. Watch real copies land below.</span></div>
    <div class="acts"><span class="btn pri sm-b">${I('arrdown', 18)}Add funds</span><span class="btn out sm-b">${I('leaders', 18)}Browse leaders</span></div></section>
  <section class="sec-l"><div class="sh"><h2>Watch mode</h2><span class="xs mu">real copies, team money</span></div>${demoCard()}${runBtns()}</section>
  <section class="sec-l"><div class="sh"><h2>Copies landing now</h2><span class="lnk sm">Feed</span></div></section>
  <div class="feed">${WFEED.map((f) => feed2(f)).join('')}</div>
  <section class="sec-l">${depNudge()}</section>
</main>${NAV('home')}</div>`;

S.watchRun = () => `<div class="scr">${SB()}${AB('', { brand: true, bal: 0 })}<main class="main">
  <section class="sec-l"><div class="sh"><h2>Watch mode</h2>${LIVE()}</div>${demoCard({ today: 15 })}
  <div class="card cyc"><div class="row-c"><b class="sm grow">Demo trade · #213</b>${acc('Running')}</div><ol class="cks tight2">
    ${cst('done', 'Leader opened 0.0001 BTC long', `${DEMO.leader} · 118,402.0 · 2x · block 18,204,331`, TXL(T.lead))}
    ${cst('done', 'Checked by the demo account\'s contract', '2x ≤ 5x · BTC allowed · 0.01% from entry, limit 1%')}
    ${cst('done', 'Copy filled 0.0001 BTC at 118,414.0', '+1.0 bps vs the leader · block 18,204,333', `<span class="lat n">${I('feed', 14)}0.61 s · 2 blocks</span>${TXL(T.demo1)}`)}
    ${cst('now', 'Waiting for finality', 'Voted. Finality usually follows about 0.55 s after Proposed.', commit('Voted'))}
  </ol></div>
  <div class="card cyc"><div class="row-c"><b class="sm grow">Blocked trade · #212</b>${okc('Done')}</div><ol class="cks tight2">
    ${cst('done', 'Leader opened 0.0001 BTC long at 12x', `${DEMO.leader} · block 18,203,902`)}
    ${cst('blk', 'Blocked by the max leverage rule', '12x is above the demo rule of 5x. Recorded onchain as Blocked by your rule.', TXL(T.demo2))}
  </ol></div>
  ${runBtns({ dis: 'Demo trade running', note: 'One run at a time. The buttons come back when this one is final.' })}</section>
  <section class="sec-l">${depNudge()}</section>
</main>${NAV('home')}</div>`;

S.skel = () => `<div class="scr">${SB()}${AB('', { brand: true, bal: 0 })}<main class="main">
  <section class="hero"><div class="lbl">Your account</div><div class="big n">0.00<span class="u">AUSD</span></div><div class="delta"><span class="mu sm">Read from Monad · 9:41:02</span></div></section>
  <section class="sec-l"><div class="sk w40"></div><div class="sk card-sk"></div><div class="sk w60"></div><div class="sk card-sk s"></div><div class="sk card-sk s"></div></section>
  <p class="xs mu center pad-x">Connecting to ${BRAND} · 2 s</p>
</main>${NAV('home')}</div>`;

S.slow = () => `<div class="scr">${SB()}${AB('', { brand: true, bal: 0 })}<main class="main pad">
  <div class="card slowc"><div class="row-c"><span class="sl-i">${I('clock', 20)}</span><div class="grow"><b>Still connecting to ${BRAND}</b><div class="xs mu n">6 s so far. Here is what has loaded.</div></div></div>
  <ol class="cks tight2">
    ${cst('done', 'Signed in with your passkey', 'Pixel 9 · fingerprint')}
    ${cst('done', 'Monad reachable', `Checked from this phone · ${HOST} · 41 ms · block 18,204,402`)}
    ${cst('done', 'Your account, read from Monad', `${ME.short} · 0.00 AUSD · no positions`)}
    ${cst('now', `${BRAND} server`, 'No answer yet. Leaders, the feed and history come from here.')}
  </ol></div>
  <p class="note sm">${I('info', 16)}<span>The balance at the top comes straight from Monad, so it is correct while we wait.</span></p>
  <div class="stack8"><span class="btn pri">${I('eye', 20)}Watch the demo meanwhile</span><span class="btn out">${I('refresh', 18)}Retry now</span></div>
  <div class="grow"></div>
  <p class="xs mu center">Still nothing after 30 s? We show "Can't reach ${BRAND}" and keep retrying every 10 s.</p>
</main>${NAV('home')}</div>`;

S.mirrorDown = () => `<div class="scr">${SB()}${AB('', { brand: true, bal: 0 })}<main class="main">
  <div class="banner">${I('wifioff', 20)}<div class="grow"><b class="sm">Can't reach ${BRAND}</b><div class="xs">Our server hasn't answered for 30 s. Your account lives on Monad, so your balance and limits are fine.</div></div><span class="btn ton xs-b">${I('refresh', 16)}Retry</span></div>
  <section class="sec-l"><div class="sh"><h2>Watch mode</h2><span class="xs mu">read from Monad</span></div>${demoCard({ live: false })}
  ${runBtns({ dis: 'Run demo trade', note: `Starting a demo needs the ${BRAND} server. The copies below are read straight from Monad and stay current.` })}</section>
  <div class="feed">${WFEED.slice(0, 2).map((f) => feed2(f)).join('')}</div>
</main>${NAV('home')}</div>`;

S.watchQuiet = () => `<div class="scr">${SB()}${AB('', { brand: true, bal: 0 })}<main class="main">
  <section class="sec-l"><div class="sh"><h2>Watch mode</h2>${LIVE()}</div>${demoCard({ flat: true, today: 0 })}</section>
  <div class="empty card"><span class="em-i">${I('clock', 22)}</span><h2 class="t-l center">No demo copies in the last 2 hours</h2><p class="sm mu center">The demo leader only trades when someone runs a demo. Start one: the copy lands in about a second.</p>${runBtns()}</div>
  <section class="sec-l"><div class="card row-c"><span class="sm grow">Last copy: BTC long closed</span><span class="xs mu">2 h ago</span>${TXL(T.demo3)}</div>${depNudge()}</section>
</main>${NAV('home')}</div>`;

// =====================================================================================
// 2. Copy quality
// =====================================================================================
const feedBg = (hlIdx = -1) => `${SB()}${AB('Feed', { bal: ACC2.balance })}<main class="main"><div class="filt"><div class="chips"><span class="chip on">All</span><span class="chip">Copied</span><span class="chip">Blocked <span class="n">1</span></span><span class="chip">Closes</span></div><span class="live xs"><i></i>Live</span></div>
  <div class="feed">${FEED2.map((f, i) => feed2(f, { hl: i === hlIdx })).join('')}</div></main>${NAV('feed')}`;

const proofBody = (o = {}) => `
  <div class="card pxc">
    <div class="px3"><div><span class="xs mu">Leader fill</span><b class="n">118,402.0</b></div><div><span class="xs mu">Your fill</span><b class="n">118,414.0</b></div><div><span class="xs mu">Deviation</span><b class="n">+1.0 bps</b><span class="xs mu n">12.0 worse</span></div></div>
    <div class="gd"><div class="row-c xs"><span class="mu">Entry filter</span><span class="grow right n">within 1% of leader entry</span></div>
      <div class="gd-t"><span class="gd-f" style="left:1%"></span></div>
      <div class="row-c xs n"><span>118,402.0 <span class="mu">leader entry</span></span><span class="grow right"><span class="mu">bound</span> 119,586.0</span></div>
      <div class="xs mu">Used 0.01% of your 1% allowance.</div></div>
  </div>
  <div class="card tl">
    <div class="tl-r"><i></i><div class="grow"><b class="sm">Leader's fill Proposed</b><div class="xs mu n">block 18,204,331 · 09:41:02.118</div></div></div>
    <div class="tl-r cur"><i></i><div class="grow"><b class="sm">Your copy Proposed</b><div class="xs mu n">block 18,204,333 · 09:41:02.730</div></div><span class="lat n">${I('feed', 14)}612 ms · 2 blocks</span></div>
    <div class="tl-r"><i class="ok"></i><div class="grow"><b class="sm">Your copy Finalized</b><div class="xs mu n">09:41:03.281 · 551 ms after Proposed</div></div>${commit('Finalized')}</div>
  </div>
  <div class="rules">${okc('Leverage 4x ≤ 5x')}${okc('Notional 11.84 ≤ 12.00')}${okc('Market BTC')}${okc('Entry 0.01% ≤ 1%')}${okc('Budget')}${okc('Loss stops')}</div>
  ${o.noTx ? '' : `<div class="card">${kvs([['Size', 'Leader 0.0500 BTC · you 0.0001 BTC'], ["Leader's transaction", TXL(T.lead)], ['Your transaction', TXL(T.mine)]])}</div>`}`;

S.copyDetail = () => `<div class="scr fullsheet"><div class="dimtop">${SB()}${AB('Feed', { bal: ACC2.balance })}</div>
<div class="sheet tall"><div class="handle"></div>
  <div class="sh-hd">${mk('BTC', 40)}<div class="grow"><div class="lbl">Copied · Open · 4x · 4s ago</div><b class="t-l">BTC ${side('Long')} <span class="n">0.0001 BTC</span></b></div><span class="ib">${I('close')}</span></div>
  <div class="cd-b">
  <div class="row-c xs mu">${identicon(L.a.addr, 20)}<span>From <span class="n tx">${L.a.addr}</span> · 11.84 AUSD notional</span></div>
  ${proofBody()}
  <span class="btn out">${I('ext', 18)}Verify on MonadVision</span>
  <p class="xs mu center">Every number above is in the CopyExecuted event of your transaction.</p></div>
${GEST}</div></div>`;

S.blockedEntry = () => `<div class="scr">${feedBg(1)}
<div class="ov"><div class="sheet">
  <div class="handle"></div>
  <div class="bl-hd"><span class="bl-i">${I('ban', 22)}</span><div><div class="lbl neg">Not copied · 2m ago</div><h2 class="t-l">Blocked by your entry filter</h2></div></div>
  <p class="bl-p">Price moved <b class="n">2.7%</b> past the leader's entry; your limit is <b class="n">1%</b>.</p>
  <div class="card cmp">
    <div class="cmp-r w"><span class="sm">Leader's entry</span><span class="cmp-t"><i style="width:2%"></i></span><b class="n">198.10</b></div>
    <div class="cmp-r w"><span class="sm">Your limit (1%)</span><span class="cmp-t"><i style="width:37%"></i><span class="cmp-cap" style="left:37%"></span></span><b class="n">200.08</b></div>
    <div class="cmp-r w"><span class="sm">Price for copy</span><span class="cmp-t"><i class="over" style="width:100%"></i><span class="cmp-cap" style="left:37%"></span></span><b class="n">203.45</b></div>
  </div>
  ${kvs([['Leader', `${L.a.addr}`], ['Leader trade', 'Added 2.0 SOL long · fill #48,211'], ['Leader ref', 'block 18,204,120'], ['Recorded', 'Blocked by your rule · block 18,204,126']])}
  <div class="rules">${okc('Leverage')}${okc('Market')}${okc('Notional')}${okc('Budget')}${ngc('Entry 2.70% > 1%')}</div>
  <div class="row-c xs"><span class="mu">Your funds were not touched.</span>${TXL(T.blk)}</div>
  <div class="acts"><span class="btn out">Done</span><span class="btn pri">${I('edit', 18)}Edit entry filter</span></div>
  ${GEST}</div></div></div>`;

const DEVB = [['≤−5', 21], ['−5…−2', 64], ['−2…0', 288], ['0…2', 512], ['2…5', 271], ['5…10', 98], ['>10', 30]];
const BLKR = [['Max leverage', 41], ['Entry filter', 27], ['Market not allowed', 18], ['Max notional', 12], ['Budget', 6], ['Loss stop', 4]];
const LATB = [['1 block', 18], ['2 blocks', 61], ['3 blocks', 15], ['4+', 6]];

S.statsPhone = () => `<div class="scr web">${WB(`${DOMAIN}/stats#copy-quality`)}${SITEH()}<main class="main pad wpg">
  <div class="eyb">Public stats</div><h1 class="wh1">Copy quality</h1>
  <p class="sm mu">How close copies land to the leader, and how fast. Derived from CopyExecuted and CopyBlocked events on Monad. Team-run accounts are excluded.</p>
  <div class="seg"><span>7D</span><span class="on">30D</span><span>All</span></div>
  <div class="card stg2">${statC('Median, Proposed → copy', '0.61 s', '2 blocks')}${statC('p90', '0.94 s', '3 blocks')}${statC('Median deviation', '+0.8 bps', 'vs leader fill')}${statC('p90 deviation', '+4.6 bps', '1,284 copies')}</div>
  <div class="card pad16"><div class="row-c"><b class="sm grow">Deviation from leader fill</b><span class="xs mu">bps · + is worse</span></div>${hist(DEVB, { hl: 3 })}</div>
  <div class="card pad16"><b class="sm">Blocks between leader and copy</b>${hbars(LATB, '%')}</div>
  <div class="card pad16"><div class="row-c"><b class="sm grow">Blocked by reason</b><span class="xs mu n">108 total</span></div>${hbars(BLKR)}</div>
  <div class="card row-c tr-c">${TEAM()}<span class="xs mu grow">Demo follower: 214 copies, median 0.60 s. Shown separately, never counted above.</span></div>
  <p class="xs mu">Indexer at block 18,204,402 · <span class="lnk">Download CSV</span> · <span class="lnk">Contracts</span></p>
</main></div>`;

// =====================================================================================
// 3. What if I had followed (inside the follow sheet)
// =====================================================================================
const whatIfBody = (o = {}) => `
  <div class="row-c wi-h"><b class="grow">What if I had followed</b>${SIM()}</div>
  <div class="seg"><span>7 days</span><span class="on">30 days</span><span>90 days</span></div>
  <div class="wi-lim xs"><span class="mu">With your limits:</span> <span class="n">25% sizing · 5x · 6.00/market · within 1% · 4.00 budget · loss stop 15%</span> <span class="lnk">Edit</span></div>
  <div class="card pad16 wi-r">
    <div class="lbl">Final PnL, likely range</div>
    <div class="big2 n">+0.38 to +0.71<span class="u">AUSD</span></div>
    <div class="xs mu n">+9.5% to +17.8% of 4.00 · leader on full size +51.7%</div>
    <div class="wi-ch">${simChart(o.w || 320, o.h || 150)}</div>
    <div class="row-c xs mu">${lg('var(--ac)', 'Middle case')}${lg('var(--ac)', 'Range', 0.3)}${lg('var(--neg)', 'Your loss stop')}</div>
  </div>
  <div class="card pad16 wi-b">
    <div class="row-c"><b class="sm grow">86 leader trades</b><span class="n sm"><span class="pos-i">61 copied</span> · <span class="neg">25 blocked</span></span></div>
    ${meter([[71, 'var(--pos)'], [29, 'var(--neg)']], 10)}
    ${hbars([['Max leverage 5x', 14, 'ng'], ['Entry filter 1%', 6, 'ng'], ['Max notional 6.00', 3, 'ng'], ['Market not allowed', 2, 'ng']])}
  </div>
  <div class="card stg2">${statC('Worst drawdown', `${M}0.31`, `${M}7.4% · Sep 22`, 'neg')}${statC('Loss stop hit', '0 times', 'daily stop: 1 day')}${statC('Fees', `${M}0.09`, 'Perpl taker rate')}${statC('Avg slippage used', '+1.4 bps', 'measured, 30 days')}</div>
  <div class="card pad16 asm"><b class="sm">Assumptions</b><ul class="xs">
    <li>Fills at the leader's fill price ± your measured average slippage (+1.4 bps), shown as the range.</li>
    <li>Fees at Perpl's taker rate. No funding payments. No liquidations modelled beyond your loss stops.</li>
    <li>Your rules applied to each leader trade in order, with your budget as the starting balance.</li>
    <li>Past trades only. The leader can trade differently tomorrow.</li></ul></div>`;

S.whatIf = () => `<div class="scr fullsheet"><div class="dimtop">${SB()}<header class="ab"><span class="ib">${I('back')}</span><h1 class="ab-t addr-t">${L.c.addr}</h1>${BAL(ACC2.balance)}</header></div>
<div class="sheet tall"><div class="handle"></div>
  <div class="sh-hd">${identicon(L.c.addr, 40)}<div class="grow"><div class="lbl">Follow</div><b class="addr">${L.c.addr}</b></div><span class="ib">${I('close')}</span></div>
  <div class="sh-steps xs"><span class="done">1 Set limits</span><span class="on">2 What if</span><span>3 Review</span></div>
  <div class="cd-b">${whatIfBody()}</div>
  <div class="sh-cta acts"><span class="btn out">Change limits</span><span class="btn pri">Review follow</span></div>
${GEST}</div></div>`;

// =====================================================================================
// 4. Follow sheet changes
// =====================================================================================
const collapsed = (ico, t, v) => `<div class="fs-c">${I(ico, 18)}<span class="sm grow">${t}</span><span class="sm n mu">${v}</span>${I('chev', 16)}</div>`;
const entrySec = () => fsSec('Entry filter', 'Only copy if the price is close to where the leader got in', `<div class="row-c"><span class="sm">Only copy if within</span><span class="n big-v right grow">1.0%</span></div>${slider(0.16, [['0.25%', 0], ['1%', 0.16], ['2%', 0.37], ['5%', 1]])}<p class="hint xs">Uses the leader's average entry, read onchain. Also applies to "Match the leader now". Last 30 days: 6 of 86 leader trades would have been skipped.</p>`, 'target');
const sltpSec = () => fsSec('Stop-loss and take-profit', 'Set on every new copied position. You can change them per position.', `<div class="two"><div class="field"><span class="sm mu">Stop-loss</span><span class="n grow right">−8%</span></div><div class="field"><span class="sm mu">Take-profit</span><span class="n grow right">+20%</span></div></div><p class="hint xs">Example: BTC long at 117,880.0 gets a stop at 108,450.0 and a take-profit at 141,456.0. Signed once by you, stored in your account contract.</p>`, 'flag');
const stopsSec = (budget = '12.00', at = '10.20') => fsSec('Loss stops', 'Close this leader\'s positions and stop copying when losses reach', `<div class="ls2"><div class="row-c"><span class="sm grow">This leader</span><span class="n b6">15%</span><span class="xs mu n">stops at ${at} of ${budget}</span></div>${slider(0.3, null)}<div class="row-c"><span class="sm grow">Whole account</span><span class="n b6">20%</span><span class="xs mu n">stops at 19.20 of 24.00</span></div>${slider(0.4, null)}</div>
  <div class="anyone"><div class="row-c"><div class="grow"><b class="sm">Loss stops can be executed by anyone</b></div>${sw(true)}</div><p class="sm">If a stop is hit, anyone can trigger it onchain, so it still works if ${BRAND}'s servers are down.</p><p class="xs mu">The check reads Perpl's mark price and must agree with Chainlink's price when Chainlink is fresh.</p></div>`, 'shield');

S.follow2 = () => `<div class="scr fullsheet"><div class="dimtop">${SB()}<header class="ab"><span class="ib">${I('back')}</span><h1 class="ab-t addr-t">${L.a.addr}</h1>${BAL(24.0)}</header></div>
<div class="sheet tall"><div class="handle"></div>
  <div class="sh-hd">${identicon(L.a.addr, 40)}<div class="grow"><div class="lbl">Follow</div><b class="addr">${L.a.addr}</b></div><span class="ib">${I('close')}</span></div>
  <div class="sh-steps xs"><span class="on">1 Set limits</span><span>2 What if</span><span>3 Review</span></div>
  ${fsSec('Budget for this leader', 'Margin this leader can use from your 24.00 AUSD deposit', `<div class="field big-f"><span class="n">12.00</span><span class="u">AUSD</span><span class="xs mu right grow">12.00 left for other leaders</span></div><div class="chips"><span class="chip">6</span><span class="chip on">12</span><span class="chip">18</span><span class="chip">All 24.00</span></div>`, 'wallet')}
  ${fsSec('Sizing', 'How big each copied order is', `<div class="seg"><span>% of leader size</span><span class="on">Fixed fraction</span></div><div class="row-c"><span class="sm">Margin per copy</span><span class="n sm b6 right grow">25% of budget · 3.00 AUSD</span></div>`, 'layers')}
  ${entrySec()}
  ${sltpSec()}
  ${stopsSec()}
  ${collapsed('tune', 'Max leverage', '5x')}${collapsed('layers', 'Max notional per market', '12.00')}${collapsed('globe', 'Allowed markets', 'BTC, SOL, ETH')}${collapsed('pause', 'Daily loss stop', '10%')}${collapsed('cal', 'Expiry', 'Jan 5, 2027')}
  <div class="sh-cta"><span class="btn pri">See what if</span></div>
${GEST}</div></div>`;

S.followSecond = () => `<div class="scr fullsheet"><div class="dimtop">${SB()}<header class="ab"><span class="ib">${I('back')}</span><h1 class="ab-t addr-t">${L.b.addr}</h1>${BAL(24.0)}</header></div>
<div class="sheet tall"><div class="handle"></div>
  <div class="sh-hd">${identicon(L.b.addr, 40)}<div class="grow"><div class="lbl">Follow a second leader</div><b class="addr">${L.b.addr}</b></div><span class="ib">${I('close')}</span></div>
  <div class="sh-steps xs"><span class="on">1 Set limits</span><span>2 What if</span><span>3 Review</span></div>
  ${fsSec('Split your deposit', 'One deposit, one account. Each leader trades only with its own budget.', `
    ${meter([[50, LCOL.a], [33.3, LCOL.b], [16.7, 'var(--sf2)']], 12)}
    <div class="spl">
      <div class="row-c">${identicon(L.a.addr, 24)}<span class="addr sm grow">${L.a.addr}</span><span class="n sm">12.00</span></div>
      <div class="xs mu n spl-s">4.31 margin in use, so it can't go below 4.31</div>
      <div class="row-c on">${identicon(L.b.addr, 24)}<span class="addr sm grow">${L.b.addr}</span><span class="stp n"><span class="ib s">−</span>8.00<span class="ib s">+</span></span></div>
      <div class="row-c"><span class="sw-dot"></span><span class="sm grow mu">Not assigned</span><span class="n sm mu">4.00</span></div>
    </div>
    <p class="hint xs">A market belongs to the leader whose copy opened it. You hold BTC and SOL from ${L.a.addr}, so this leader's BTC trades are blocked until that position closes.</p>`, 'split')}
  ${fsSec('Loss stop for this leader', 'Stops this leader only. The other leader keeps copying.', `<div class="row-c"><span class="n big-v">10%</span><span class="sm mu right grow n">stops at 7.20 of 8.00</span></div>${slider(0.2, [['0', 0], ['10%', 0.2], ['25%', 0.5], ['50%', 1]])}<div class="row-c xs mu">${I('shield', 14)}<span>Executable by anyone · same as your account setting</span></div>`, 'shield')}
  ${entrySec()}
  ${collapsed('layers', 'Sizing', 'Fixed 25% · 2.00')}${collapsed('tune', 'Max leverage', '3x')}${collapsed('flag', 'Stop-loss / take-profit', '8% / 20%')}${collapsed('globe', 'Allowed markets', 'BTC, ETH')}${collapsed('cal', 'Expiry', 'Jan 5, 2027')}
  <div class="sh-cta"><span class="btn pri">See what if</span></div>
${GEST}</div></div>`;

S.followReview = () => `<div class="clip">${S.home2()}</div><div class="ov"><div class="sheet">
  <div class="handle"></div>
  <div class="sh-hd"><span class="ib">${I('back')}</span><div class="grow"><div class="lbl">Review</div><b>Follow <span class="addr">${L.b.addr}</span></b></div></div>
  <div class="kvl rvl">${rv('Budget', '8.00 of 24.00 AUSD')}${rv('Sizing', 'Fixed 25% · 2.00 AUSD margin')}${rv('Max leverage', '3x')}${rv('Entry filter', 'Within 1.0% of leader entry')}${rv('Stop-loss / take-profit', '8% / 20% on new positions')}${rv('Loss stop, this leader', '10% · at 7.20 AUSD')}${rv('Loss stop, account', '20% · at 19.20 AUSD')}${rv('Who can execute stops', 'Anyone')}${rv('Markets', 'BTC, ETH · BTC blocked while 0x7a3f holds it')}</div>
  <div class="note acn sm">${I('shield', 18)}<span>Written to your account contract and checked on every copy. ${BRAND} can trade within these limits but can never withdraw.</span></div>
  <span class="btn pri">${I('fp', 20)}Approve with passkey</span>
  ${GEST}</div></div>`;

// =====================================================================================
// 5. Several leaders from one budget
// =====================================================================================
const budRow = (b, o = {}) => { const l = L[b.k]; const hit = b.st === 'hit';
  return `<div class="br ${hit ? 'hit' : ''}"><div class="row-c">${identicon(l.addr, 36)}<div class="grow mn0"><div class="lr-t"><span class="addr">${l.addr}</span>${hit ? `<span class="chip-s neg">${I('pause', 12)}Stopped by loss stop</span>` : `<span class="chip-s okc">Copying</span>`}</div><div class="xs mu n">${hit ? 'Oct 6 · 14:02 · positions closed' : `Budget ${b.budget.toFixed(2)} · ${b.pos} open`}</div></div><div class="right"><div class="n b6 ${b.pnl >= 0 ? 'pos-i' : 'neg'}">${sgn(b.pnl)}</div><div class="xs mu n">${pct((b.pnl / b.budget) * 100)}</div></div></div>
  ${hit ? `<div class="xs br-s"><span class="neg">Lost 0.60 of 4.00 (15%).</span> <span class="mu">3.40 AUSD waiting in this budget.</span></div>` : `${meter([[(b.used / b.budget) * 100, LCOL[b.k]]], 6)}<div class="row-c xs mu n"><span>Margin used ${b.used.toFixed(2)} of ${b.budget.toFixed(2)}</span><span class="grow right">Loss stop at ${b.lsAt.toFixed(2)} · ${(b.eq - b.lsAt).toFixed(2)} away</span></div>`}</div>`; };

S.home2 = () => `<div class="scr">${SB()}${AB('', { brand: true, bal: ACC2.balance })}<main class="main">
  <section class="hero">
    <div class="lbl">Equity</div>
    <div class="big n">${ACC2.equity.toFixed(2)}<span class="u">AUSD</span></div>
    <div class="delta"><span class="n pos-i b6">${sgn(ACC2.today)} (${pct((ACC2.today / (ACC2.equity - ACC2.today)) * 100, 2)})</span><span class="mu sm">today</span></div>
    <div class="kv3 hero-kv"><div><span class="xs mu">AUSD balance</span><b class="n">${ACC2.balance.toFixed(2)}</b></div><div><span class="xs mu">Unrealised</span><b class="n pos-i">${sgn(ACC2.upnl)}</b></div><div><span class="xs mu">Realised</span><b class="n neg">${sgn(ACC2.rpnl)}</b></div></div>
  </section>
  <section class="sec-l"><div class="card pad14 dsp"><div class="row-c"><b class="sm grow">Deposit split</b><span class="n sm">24.00 / 25.00 AUSD</span></div>
    ${meter([[50, LCOL.a], [33.3, LCOL.b], [16.7, LCOL.c, 0.5]], 10)}
    <div class="row-c xs mu n lgw">${lg(LCOL.a, '0x7a3f 12.00')}${lg(LCOL.b, '0x19be 8.00')}${lg(LCOL.c, '0xc4e0 4.00, stopped', 0.5)}</div></div></section>
  <section class="sec-l"><div class="sh"><h2>Leaders <span class="mu n">3</span></h2><span class="lnk sm">Budgets</span></div>
    <div class="card list">${BUD.map((b) => budRow(b)).join('')}</div>
    <div class="acts"><span class="btn ton sm-b">${I('plus', 18)}Add leader</span><span class="btn out sm-b">${I('split', 18)}Move funds</span></div></section>
  <section class="sec-l"><div class="sh"><h2>Recent copies</h2><span class="lnk sm">Feed</span></div>
    <div class="card list">${FEED2.slice(0, 3).map((f) => `<div class="rc">${mk(f.mkt, 32)}<div class="grow mn0"><div class="sm"><b>${f.mkt}</b> ${side(f.side)} <span class="mu">${f.act}</span></div><div class="xs mu"><span class="n">${L[f.L].addr}</span> · ${f.ago} ago</div></div>${f.blocked ? `<span class="chip-s neg">${I('ban', 13)}Blocked</span>` : `<div class="right"><div class="xs n">${f.lat} s · ${f.dev} bps</div><div class="xs mu">${f.st}</div></div>`}</div>`).join('')}</div></section>
</main>${NAV('home')}</div>`;

S.budgets = () => `<div class="scr">${SB()}<header class="ab"><span class="ib">${I('back')}</span><h1 class="ab-t">Budgets</h1>${BAL(ACC2.balance)}</header><main class="main pad">
  <div class="card pad16 dsp"><div class="lbl">Deposited</div><div class="big2 n">24.00<span class="u">AUSD</span></div>
    ${meter([[50, LCOL.a], [25, LCOL.b], [25, 'var(--sf2)']], 12)}<div class="xs mu">Moving budget between leaders doesn't move money. It changes how much margin each leader may use.</div></div>
  <div class="card list">
    <div class="bud"><div class="row-c">${identicon(L.a.addr, 32)}<span class="addr sm grow">${L.a.addr}</span><span class="stp n"><span class="ib s">−</span>12.00<span class="ib s">+</span></span></div><div class="xs mu n">Margin in use 4.31 · minimum 4.31 · loss stop 15%</div></div>
    <div class="bud"><div class="row-c">${identicon(L.b.addr, 32)}<span class="addr sm grow">${L.b.addr}</span><span class="stp n"><span class="ib s">−</span>6.00<span class="ib s">+</span></span></div><div class="xs mu n">Was 8.00 · margin in use 2.00 · loss stop 10% now at 5.40</div></div>
    <div class="bud dim"><div class="row-c">${identicon(L.c.addr, 32)}<span class="addr sm grow">${L.c.addr}</span><span class="chip-s neg">Stopped</span></div><div class="xs mu n">3.40 left after its loss stop · moved to Not assigned</div></div>
    <div class="bud"><div class="row-c"><span class="sw-dot"></span><span class="sm grow">Not assigned</span><b class="n">6.00</b></div><div class="xs mu">Free for a new leader or to withdraw.</div></div>
  </div>
  <p class="note sm">${I('info', 16)}<span>Lowering a budget below its margin in use isn't possible. Close positions first, or lower it later.</span></p>
  <div class="grow"></div>
  <div class="row-c xs mu"><span>Network fee</span><span class="right grow"><b class="pos-i">Free</b> · sponsored</span></div>
  <span class="btn pri">${I('fp', 20)}Save budgets with passkey</span>
</main>${GEST}</div>`;

S.leaderStopped = () => `<div class="scr">${SB()}<header class="ab"><span class="ib">${I('back')}</span><h1 class="ab-t addr-t">${L.c.addr}</h1>${BAL(ACC2.balance)}</header><main class="main pad">
  <div class="card stopc"><div class="row-c"><span class="bl-i">${I('pause', 22)}</span><div class="grow"><div class="lbl neg">Stopped · Oct 6, 14:02</div><b class="t-l">Your loss stop closed this leader</b></div></div>
    <p class="sm">This leader's budget fell to <b class="n">3.40</b> AUSD, 15% below <b class="n">4.00</b>. Its positions were closed and copying stopped. Your other leaders kept running.</p></div>
  <div class="card">${kvs([['Trigger', 'Budget 3.40 ≤ stop 3.40'], ['Perpl mark, HYPE', '41.12'], ['Chainlink, HYPE', '41.09 · 4 s old · agrees'], ['Executed by', `<span class="n">0x9f3a…22c1</span> · not ${BRAND}`], ['Block', '18,190,042'], ['Transaction', TXL(T.stop)]])}</div>
  <div class="card list"><div class="rc">${mk('HYPE', 32)}<div class="grow"><div class="sm"><b>HYPE</b> ${side('Long')} <span class="mu">Closed by stop</span></div><div class="xs mu n">0.1000 HYPE · entry 46.92 → 41.12</div></div><span class="n neg sm">${M}0.58</span></div><div class="rc"><span class="mk" style="width:32px;height:32px">FEE</span><div class="grow sm">Perpl taker fee</div><span class="n neg sm">${M}0.02</span></div></div>
  <p class="note sm">${I('shield', 16)}<span>Anyone could execute this stop. It ran even though nobody at ${BRAND} pressed anything.</span></p>
  <div class="grow"></div>
  <div class="stack8"><span class="btn pri">Resume with a new loss stop</span><span class="btn out">Move 3.40 to Not assigned</span><span class="btn txt">Stop following</span></div>
</main>${GEST}</div>`;

// =====================================================================================
// 6. Position detail
// =====================================================================================
const posDetailBase = (o = {}) => { const sl = o.sl || 108450, tp = o.tp || 141456; return `${SB()}<header class="ab"><span class="ib">${I('back')}</span><h1 class="ab-t">BTC long</h1>${BAL(ACC2.balance)}</header><main class="main pad">
  <div class="row-c">${mk('BTC', 40)}<div class="grow"><div><b>BTC</b> ${side('Long')} <span class="mu sm n">4x</span></div><div class="xs mu n">0.0001 BTC · 11.84 AUSD · from ${L.a.addr}</div></div><div class="right"><div class="n b6 pos-i">+0.05</div><div class="xs mu n">+1.8% ROE</div></div></div>
  <div class="card pad14">${levelChart({ levels: LV_BTC(sl, tp) })}<div class="po-g xs n"><div><span class="mu">Entry</span>117,880.0</div><div><span class="mu">Mark</span>118,420.5</div><div><span class="mu">Liq.</span>90,610</div><div><span class="mu">Margin</span>2.96</div></div></div>
  <div class="card lvl">
    <div class="lv-r"><span class="lv-i ng">${I('flag', 16)}</span><div class="grow"><div class="sm">Stop-loss</div><div class="xs mu n">${pct(((sl / 117880) - 1) * 100)} from entry · ${pct(((sl / 118420.5) - 1) * 100)} from mark · about ${sgn((sl - 117880) * 0.0001)} AUSD</div></div><b class="n">${comma(sl, 1)}</b></div>
    <div class="lv-r"><span class="lv-i ok">${I('flag', 16)}</span><div class="grow"><div class="sm">Take-profit</div><div class="xs mu n">${pct(((tp / 117880) - 1) * 100)} from entry · about ${sgn((tp - 117880) * 0.0001)} AUSD</div></div><b class="n">${comma(tp, 1)}</b></div>
    <div class="lv-f xs">${I('shield', 14)}<span class="grow">${o.accepted ? `Onchain since 09:14 · from a suggestion you accepted` : 'Onchain · anyone can execute when hit · signed by you'}</span>${TXL(o.accepted ? T.sug : T.lvl)}</div>
  </div>
  ${o.accepted ? `<div class="note acn sm">${I('check', 18)}<span>Levels updated. Stop-loss 108,450.0 → 112,000.0 and take-profit 141,456.0 → 135,000.0.</span></div>` : ''}
  <div class="acts"><span class="btn ton sm-b">${I('edit', 18)}Edit levels</span><span class="btn out sm-b">${I('share', 18)}Share</span></div>
  <div class="card list flat">${setRow('feed', 'Copy proof', '+1.0 bps · 2 blocks · 612 ms · Finalized')}${setRow('users', `Leader ${L.a.addr}`, 'Budget 12.00 · copying')}</div>
  <div class="grow"></div>
  <div class="acts"><span class="btn dng-o sm-b">Close position</span><span class="btn out sm-b">Stop following…</span></div>
</main>${GEST}`; };
S.posDetail = () => `<div class="scr">${posDetailBase()}</div>`;
S.stopFollow = () => `<div class="scr">${posDetailBase()}<div class="ov"><div class="sheet">
  <div class="handle"></div>
  <div class="sh-hd">${identicon(L.a.addr, 40)}<div class="grow"><div class="lbl">Stop following</div><b class="addr">${L.a.addr}</b></div></div>
  <p class="sm mu">No new copies from this leader either way. Choose what happens to its 2 open positions.</p>
  <div class="opt on"><span class="rad2 on"></span><div class="grow"><b class="sm">Stop following, keep my positions</b><div class="xs mu">BTC long and SOL long stay open with their stop-loss and take-profit. Close them yourself when you want. Their margin stays in this budget until they close.</div></div></div>
  <div class="opt"><span class="rad2"></span><div class="grow"><b class="sm">Stop and close</b><div class="xs mu n">Closes 2 positions at market now, about +0.32 AUSD after fees, and returns 12.00 to Not assigned.</div></div></div>
  <div class="acts"><span class="btn out">Cancel</span><span class="btn pri">${I('fp', 18)}Stop following</span></div>
  ${GEST}</div></div></div>`;

// =====================================================================================
// 7. Shared position + suggested levels
// =====================================================================================
const sharedPosCard = () => `<div class="card pad16 spc">
  <div class="row-c xs mu">${identicon(ME.full, 20)}<span>Shared by <span class="n tx">${ME.short}</span> · read-only</span></div>
  <div class="row-c">${mk('BTC', 40)}<div class="grow"><div><b>BTC</b> ${side('Long')} <span class="mu sm n">4x</span></div><div class="xs mu n">0.0001 BTC · copied from ${L.a.addr}</div></div><div class="right"><div class="n b6 pos-i">+1.8%</div><div class="xs mu">ROE</div></div></div>
  <div class="po-g xs n"><div><span class="mu">Entry</span>117,880.0</div><div><span class="mu">Mark</span>118,420.5</div><div><span class="mu">Stop</span>108,450.0</div><div><span class="mu">Target</span>141,456.0</div></div>
  <div class="row-c xs"><span class="mu grow">Live from Monad · block 18,204,402</span><span class="lnk">Verify ${I('ext', 13)}</span></div>
</div>`;
S.shareWeb = () => `<div class="scr web">${WB(`${DOMAIN}/p/7Hq2Xk`)}${SITEH()}<main class="main pad wpg">
  <div class="eyb">Shared position</div>
  ${sharedPosCard()}
  <div class="card pad16 sgf"><b>Suggest levels</b><p class="xs mu">The owner sees your suggestion and decides. Nothing changes unless they approve it with their passkey.</p>
    <label class="xs mu">Stop-loss</label><div class="field"><span class="n">112,000.0</span><span class="xs mu right grow">${M}5.0% from entry</span></div>
    <label class="xs mu">Take-profit</label><div class="field"><span class="n">135,000.0</span><span class="xs mu right grow">+14.5% from entry</span></div>
    <label class="xs mu">Short note (optional)</label><div class="field ta"><span class="sm">Funding flipped negative this morning. I'd tighten the stop and take profit earlier.</span></div><div class="xs mu right n">88 / 140</div>
    <span class="btn pri">Send suggestion</span></div>
  <p class="xs mu center">No sign-in. We don't store who you are. One suggestion per link per hour.</p>
</main></div>`;
S.shareSent = () => `<div class="scr web">${WB(`${DOMAIN}/p/7Hq2Xk`)}${SITEH()}<main class="main pad wpg">
  <div class="rs-ok">${I('check', 28)}</div><h1 class="t-xl center">Suggestion sent</h1>
  <p class="sm mu center">The owner can accept or decline it in ${BRAND}. If they accept, the levels below become onchain levels on this position.</p>
  <div class="card">${kvs([['Stop-loss', '108,450.0 → 112,000.0'], ['Take-profit', '141,456.0 → 135,000.0'], ['Note', 'Funding flipped negative…'], ['Status', 'Waiting for the owner']])}</div>
  ${sharedPosCard()}
  <p class="xs mu center">This page stays live. It stops taking suggestions when the position closes.</p>
</main></div>`;
const sugBody = () => `<div class="sh-hd"><span class="nt-i ac">${I('msg', 18)}</span><div class="grow"><div class="lbl">Suggestion · 09:12</div><b class="t-l">New levels for BTC long</b></div></div>
  <p class="xs mu">From someone with your share link. ${BRAND} doesn't know who; there is no account behind it.</p>
  <table class="tb sgt"><thead><tr><th></th><th class="r">Now</th><th class="r">Suggested</th></tr></thead><tbody>
    <tr><td>Stop-loss</td><td class="r n">108,450.0</td><td class="r n b6">112,000.0</td></tr><tr><td class="xs mu">if hit</td><td class="r n xs neg">${M}0.94</td><td class="r n xs neg">${M}0.59</td></tr>
    <tr><td>Take-profit</td><td class="r n">141,456.0</td><td class="r n b6">135,000.0</td></tr><tr><td class="xs mu">if hit</td><td class="r n xs pos-i">+2.36</td><td class="r n xs pos-i">+1.71</td></tr></tbody></table>
  <blockquote class="sgq sm">"Funding flipped negative this morning. I'd tighten the stop and take profit earlier."</blockquote>`;
S.suggestReview = () => `<div class="scr">${posDetailBase()}<div class="ov"><div class="sheet">
  <div class="handle"></div>${sugBody()}
  <div class="row-c xs mu">${I('shield', 14)}<span>If you accept, both levels are written onchain and anyone can execute them when hit.</span></div>
  <div class="acts"><span class="btn out">Decline</span><span class="btn pri">${I('fp', 18)}Accept</span></div>
  ${GEST}</div></div></div>`;
S.suggestPasskey = () => `<div class="scr">${posDetailBase()}<div class="ov"><div class="sys">
  <div class="handle"></div><div class="sys-ic">${I('key', 22)}</div>
  <h2 class="sys-h">Use your passkey for ${BRAND}?</h2>
  <p class="sys-p">Set stop-loss 112,000.0 and take-profit 135,000.0 on BTC long.</p>
  <div class="sys-acct">${identicon(ME.full, 36)}<div><b class="n">${ME.short}</b><div class="xs sys-mu">Passkey on this device</div></div></div>
  <div class="sys-fp"><span class="sys-fpc">${I('fp', 34)}</span><span class="sm">Touch the fingerprint sensor</span></div>
  <div class="sys-btns"><span class="sys-b">Cancel</span></div>
  ${GEST}</div></div></div>`;
S.suggestDone = () => `<div class="scr">${posDetailBase({ sl: 112000, tp: 135000, accepted: true })}</div>`;

// =====================================================================================
// 8. Shareable cards (rendered as images: 1200x630 and 1080x1080)
// =====================================================================================
const CARDS = {};
const cardFoot = (url, qs) => `<div class="cc-proof"><div class="cc-qr">${qr2(qs, 5)}</div><div><div class="cc-k">Onchain proof</div><div class="cc-url n">${url}</div><div class="cc-k2">Every number links to its Monad transaction.</div></div></div>`;
seed = 31; const leadSpark = buildSeries([[0, 100], [6, 109], [12, 104], [18, 121], [24, 128], [30, 138.4]], 3, 0.01);
CARDS.leader = () => `<div class="cc og"><div class="cc-l">
  <div class="cc-top">${brandMark(40)}<b>${BRAND}</b><span class="cc-tag">Leader record · 30 days</span></div>
  <div class="cc-who">${identicon(L.a.addr, 64)}<div><div class="cc-addr n">${L.a.addr}</div><div class="cc-lb">${label('Smart Trader')}<span class="cc-k2">On Perpl since Jun 2026</span></div></div></div>
  <div class="cc-big n pos-i">+38.4%</div>
  <div class="cc-ch">${chart({ data: leadSpark, w: 560, h: 120, padT: 8, padB: 8, padR: 8 })}</div>
  <div class="cc-st">${statC('Max drawdown', `${M}9.2%`, '', 'neg')}${statC('Win rate', '61%')}${statC('Trades', '426')}${statC('Followers on Mirror', '212')}</div>
</div><div class="cc-r">${cardFoot(`${DOMAIN}/l/0x7a3f…c91e`, 101)}<div class="cc-fine">From Perpl fills on Monad. Past results don't predict future returns.</div></div></div>`;
CARDS.follower = () => `<div class="cc og"><div class="cc-l">
  <div class="cc-top">${brandMark(40)}<b>${BRAND}</b><span class="cc-tag">My copy result · since Sep 14</span></div>
  <div class="cc-who">${identicon(ME.full, 64)}<div><div class="cc-addr n">${ME.short}</div><div class="cc-k2">Following 2 leaders on Perpl</div></div></div>
  <div class="cc-big n pos-i">+0.92 <span class="cc-u">AUSD</span></div>
  <div class="cc-sub n">+4.6% on 20.00 AUSD deposited</div>
  <div class="cc-st">${statC('Copies', '61')}${statC('Median copy time', '0.61 s')}${statC('Median deviation', '+0.8 bps')}${statC('Blocked by my rules', '7')}</div>
</div><div class="cc-r">${cardFoot(`${DOMAIN}/a/0x4b21…9e07`, 202)}<div class="cc-fine">Real account, real fills. Beta deposits are capped at 25 AUSD.</div></div></div>`;
CARDS.blocked = () => `<div class="cc sq">
  <div class="cc-top">${brandMark(40)}<b>${BRAND}</b>${TEAM('Team-run demo account')}</div>
  <div class="cc-blk"><span class="cc-bi">${I('ban', 44)}</span><div class="cc-h">Blocked by its rule</div></div>
  <div class="cc-p">Leader opened <b class="n">12x</b> BTC long. The demo account's max leverage is <b class="n">5x</b>. Not copied.</div>
  <div class="cc-cmp"><div><span class="cc-k">Leader's order</span><b class="n">12x</b></div><div><span class="cc-k">Rule</span><b class="n">max 5x</b></div><div><span class="cc-k">Block</span><b class="n">18,203,902</b></div></div>
  <div class="cc-acct">${identicon(DEMO.folFull, 48)}<div><div class="cc-addr n s">${DEMO.fol}</div><div class="cc-k2">Demo follower · copies ${DEMO.leader}</div></div></div>
  <div class="cc-rules">${okc('Market BTC')}${okc('Notional')}${okc('Entry filter')}${ngc('Leverage 12x > 5x')}</div>
  ${cardFoot(`${DOMAIN}/tx/${T.demo2.short}`, 303)}
  <div class="cc-fine">Run by the ${BRAND} team for demos. Not counted in ${BRAND}'s public numbers.</div></div>`;
CARDS.sim = () => `<div class="cc sq">
  <div class="cc-top">${brandMark(40)}<b>${BRAND}</b>${SIM('Simulation')}</div>
  <div class="cc-k">What if I had followed ${L.c.addr} · 30 days · my limits</div>
  <div class="cc-big n">+0.38 to +0.71 <span class="cc-u">AUSD</span></div>
  <div class="cc-sub n">on a 4.00 AUSD budget · 61 copied · 25 blocked by my rules</div>
  <div class="cc-ch">${simChart(920, 300)}</div>
  ${cardFoot(`${DOMAIN}/l/0xc4e0…7b13`, 404)}
  <div class="cc-fine">Simulation, not a promise. Leader fills ± measured slippage, Perpl taker fees, no funding.</div></div>`;
CARDS.mineBlocked = () => `<div class="cc sq">
  <div class="cc-top">${brandMark(40)}<b>${BRAND}</b><span class="cc-tag">Blocked by my rule</span></div>
  <div class="cc-blk"><span class="cc-bi">${I('ban', 44)}</span><div class="cc-h">Blocked by my entry filter</div></div>
  <div class="cc-p">Price moved <b class="n">2.7%</b> past the leader's entry; my limit is <b class="n">1%</b>. Not copied.</div>
  <div class="cc-cmp"><div><span class="cc-k">Leader entry</span><b class="n">198.10</b></div><div><span class="cc-k">Price for copy</span><b class="n">203.45</b></div><div><span class="cc-k">My bound</span><b class="n">200.08</b></div></div>
  <div class="cc-acct">${identicon(L.a.addr, 48)}<div><div class="cc-addr n s">${L.a.addr}</div><div class="cc-k2">Leader added 2.0 SOL long · block 18,204,120</div></div></div>
  <div class="cc-rules">${okc('Leverage')}${okc('Market')}${okc('Notional')}${ngc('Entry 2.70% > 1%')}</div>
  ${cardFoot(`${DOMAIN}/tx/${T.blk.short}`, 505)}
  <div class="cc-fine">Recorded onchain by my account contract. My funds were not touched.</div></div>`;

S.shareSheet = () => `<div class="scr">${feedBg(1)}<div class="ov"><div class="sheet">
  <div class="handle"></div>
  <div class="sh-hd"><div class="grow"><div class="lbl">Share</div><b class="t-l">Blocked by my rule</b></div><span class="ib">${I('close')}</span></div>
  <div class="cardprev">${CARDS.mineBlocked()}</div>
  <div class="seg"><span class="on">Square</span><span>Wide</span></div>
  <div class="ctl-r"><div class="grow"><b class="sm">Show AUSD amounts</b><div class="xs mu">Off shows percentages only</div></div>${sw(true)}</div>
  <div class="acts a3"><span class="btn out sm-b">${I('link', 18)}Copy link</span><span class="btn out sm-b">${I('img', 18)}Save image</span><span class="btn pri sm-b">${I('share', 18)}Share</span></div>
  ${GEST}</div></div></div>`;

// =====================================================================================
// 10. First-run fixes
// =====================================================================================
const followDoneBase = () => `${SB()}<header class="ab"><span class="ib">${I('close')}</span><span class="grow"></span>${BAL(24.0)}</header><main class="main pad rs">
  <div class="rs-ok">${I('check', 28)}</div>
  <h1 class="t-xl center">Following ${L.a.addr.slice(0, 6)}</h1>
  <p class="center mu sm">Your limits are onchain. The next trade from <span class="n">${L.a.addr}</span> is copied within about a second.</p>
  <div class="card">${kvs([['Budget', '12.00 AUSD'], ['Entry filter', 'within 1.0%'], ['Loss stop', '15% · anyone can execute'], ['Transaction', TXL(T.c3)]])}</div>
  <div class="card pad16 alrt"><div class="row-c"><span class="nt-i ac">${I('bell', 18)}</span><div class="grow"><b class="sm">Get alerts for this follow?</b><div class="xs mu">When a copy lands, a copy is blocked by your rule, or a loss stop fires.</div></div></div>
    <div class="acts"><span class="btn txt">Not now</span><span class="btn pri sm-b">${I('bell', 18)}Turn on alerts</span></div></div>
  <div class="grow"></div><span class="btn out">View feed</span>
</main>${GEST}`;
S.followDone = () => `<div class="scr">${followDoneBase()}</div>`;
S.notifPrompt = () => `<div class="scr">${followDoneBase()}<div class="ov ctr"><div class="sysd">
  <span class="sysd-i">${I('bell', 26)}</span><h2>Allow <b>${BRAND}</b> to send you notifications?</h2>
  <span class="sysd-b">Allow</span><span class="sysd-b">Don't allow</span></div></div></div>`;

S.errMirror = () => `<div class="scr">${SB()}${AB('', { brand: true, bal: ACC2.balance })}<main class="main">
  <div class="banner">${I('wifioff', 20)}<div class="grow"><b class="sm">Can't reach ${BRAND}</b><div class="xs">Our server isn't answering. Balance and positions below are read from Monad; your follows keep running onchain.</div></div><span class="btn ton xs-b">${I('refresh', 16)}Retry</span></div>
  <section class="hero"><div class="lbl">Equity · from Monad</div><div class="big n">${ACC2.equity.toFixed(2)}<span class="u">AUSD</span></div><div class="delta"><span class="mu sm">Read at 9:41:02 · block 18,204,402</span></div></section>
  <section class="sec-l"><div class="sh"><h2>Leaders <span class="mu n">3</span></h2></div><div class="card list">${BUD.slice(0, 2).map((b) => budRow(b)).join('')}</div></section>
  <section class="sec-l"><div class="card row-c"><span class="sm grow mu">Feed and history need the ${BRAND} server.</span><span class="lnk sm">Status</span></div></section>
</main>${NAV('home')}</div>`;
S.errMonad = () => `<div class="scr">${SB()}${AB('Feed', { bal: ACC2.balance })}<main class="main">
  <div class="banner">${I('wifioff', 20)}<div class="grow"><b class="sm">Can't reach Monad</b><div class="xs">The Monad RPC isn't answering from this phone. Balances are from 9:38. ${BRAND}'s server is fine and copying continues.</div></div><span class="btn ton xs-b">${I('refresh', 16)}Retry</span></div>
  <div class="feed stale">${FEED2.slice(2).map((f) => feed2(f)).join('')}</div>
</main>${NAV('feed')}</div>`;

S.settingsNet = () => `<div class="scr">${SB()}<header class="ab"><span class="ib">${I('back')}</span><h1 class="ab-t">Settings</h1>${BAL(ACC2.balance)}</header><main class="main pad set">
  <div class="lbl">Network</div>
  <div class="card list flat">
    ${setRow('globe', 'Monad RPC · checked from this phone', `<span class="n">${HOST} · 38 ms · block 18,204,402</span>`, '<span class="live xs"><i></i>Online</span>')}
    ${setRow('activity', `${BRAND} server`, '<span class="n">api.mirror.0xo.in · 112 ms</span>', '<span class="live xs"><i></i>Online</span>')}
    ${setRow('clock', 'Last checked 9:41:02', 'Both checked directly, every 30 s while open', '<span class="lnk sm">Check now</span>')}
  </div>
  <p class="xs mu">If only one is down, the app says which: "Can't reach Monad" for the RPC, "Can't reach ${BRAND}" for our server.</p>
  <div class="lbl">Alerts</div>
  <div class="card list flat">${setRow('bell', 'Notifications', 'Off · asked only when you turn alerts on', sw(false))}</div>
  <div class="lbl">About</div>
  <div class="card list flat">${setRow('info', `${BRAND} 0.9.2 (beta)`, 'Same version as the download page')}</div>
</main>${GEST}</div>`;

S.welcomeFix = () => `<div class="scr">${SB()}<main class="main wl">
  <div class="wl-top">${brandMark(32)}<b>${BRAND}</b><span class="pill-beta">Beta</span></div>
  <div class="wl-demo" aria-label="Latest real copy">
    <div class="row-c xs"><span class="live"><i></i>Latest real copy</span>${TEAM()}<span class="mu grow right n">2 min ago</span></div>
    <div class="wd-card"><div class="wd-row">${identicon('5416', 28)}<span class="addr">${DEMO.leader}</span></div><div class="sm mu">Opened <b class="tx">BTC</b> ${side('Long')} <span class="n">0.0001 BTC · 2x</span></div></div>
    <div class="wd-link"><span class="lat n">${I('feed', 14)}copied in 0.61 s · 2 blocks</span></div>
    <div class="wd-card me"><div class="wd-row">${identicon(DEMO.folFull, 28)}<b>Demo follower</b><span class="st-ok n">${I('check', 14)}Finalized</span></div><div class="sm n">0.0001 BTC · 11.84 AUSD · +1.0 bps</div><div class="wd-rule xs">${I('shield', 14)}<span class="grow">Checked onchain: under its 5x limit</span>${TXL(T.demo1)}</div></div>
  </div>
  <h1 class="wl-h">Copy top Perpl traders. Your limits, enforced onchain.</h1>
  <p class="wl-p">A smart contract checks every copied order against your rules. ${BRAND} can trade for you but can never withdraw.</p>
  <div class="grow"></div>
  <div class="stack8"><span class="btn pri">${I('fp', 20)}Create account</span><span class="btn txt">I already have an account</span></div>
  <p class="wl-foot xs mu">If no real copy is available, this card shows a labelled "Example".<br>Passkeys by Mera · Built on Monad · Trades on Perpl</p>
</main>${GEST}</div>`;

S.downloadWeb = () => `<div class="scr web">${WB(`${DOMAIN}/download`)}${SITEH()}<main class="main pad wpg">
  <div class="eyb">Download</div><h1 class="wh1">${BRAND} for Android</h1>
  <p class="sm mu">The beta is an APK you install directly, outside the Play Store.</p>
  <span class="btn pri">${I('dl', 20)}Download APK · 58.3 MB</span>
  <div class="card">${kvs([['Version', '0.9.2 (beta) · build 42'], ['Published', 'Oct 7, 2026'], ['Size', '58.3 MB (61,132,288 bytes)'], ['Package', 'com.zeroxo.mirror'], ['Requires', 'Android 9 (API 28)+']])}
    <div class="sha"><span class="xs mu">SHA-256</span><div class="n xs">9c1e 4f7a 02bd 8e63 d5a1 7c90 3b4e f218 6ad0 95c7 e3f1 0b82 4d6c a917 58e0 2f3b</div><span class="lnk sm">${I('copy', 14)}Copy</span></div></div>
  <div class="card pad14"><b class="sm">Check the file</b><div class="code n xs">sha256sum mirror-0.9.2.apk</div><p class="xs mu">The output must match the hash above. Release notes and the signing certificate fingerprint are on GitHub.</p></div>
</main></div>`;

// =====================================================================================
// 9. Perpl-wide analytics and risk (web)
// =====================================================================================
const MKT = [
  ['BTC', '118,420.5', 6.42, 2.91, 54, '+0.0021%', 84.2], ['ETH', '4,312.80', 3.18, 1.44, 49, '−0.0008%', 41.0], ['SOL', '212.44', 1.37, 0.61, 58, '+0.0034%', 22.7],
  ['MON', '0.04180', 1.12, 0.52, 61, '+0.0052%', 31.9], ['HYPE', '46.92', 0.84, 0.38, 57, '+0.0029%', 18.4], ['ZEC', '58.20', 0.41, 0.2, 52, '+0.0011%', 6.1],
  ['LIT', '1.284', 0.22, 0.13, 63, '+0.0061%', 3.4], ['VVV', '3.920', 0.19, 0.11, 48, '−0.0015%', 1.9], ['PUMP', '0.004812', 0.17, 0.12, 66, '+0.0083%', 1.2],
  ['NEAR', '2.710', 0.16, 0.09, 51, '+0.0009%', 0.8], ['UNI', '9.840', 0.12, 0.08, 47, '−0.0004%', 0.8],
];
seed = 909; const volDays = Array.from({ length: 30 }, (_, i) => +(9 + i * 0.12 + (rnd() - 0.5) * 5 + (i === 21 ? 6 : 0)).toFixed(1)); volDays[29] = 14.2;
const oiSeries = buildSeries([[0, 4.9], [6, 5.4], [12, 5.1], [18, 6.0], [24, 6.3], [30, 6.6]], 2, 0.01);
const volBars = (w = 560, h = 150) => { const mx = 22, n = volDays.length, gap = 4, bw = (w - gap * (n - 1)) / n; return `<svg class="chart" viewBox="0 0 ${w} ${h + 16}" role="img" aria-label="Daily volume, 30 days">${[5, 10, 15, 20].map((v) => `<line x1="0" x2="${w}" y1="${(h - (v / mx) * h).toFixed(1)}" y2="${(h - (v / mx) * h).toFixed(1)}" class="gl"/><text x="0" y="${(h - (v / mx) * h - 3).toFixed(1)}" class="ct">${v}M</text>`).join('')}${volDays.map((v, i) => `<rect x="${(i * (bw + gap)).toFixed(1)}" y="${(h - (v / mx) * h).toFixed(1)}" width="${bw.toFixed(1)}" height="${((v / mx) * h).toFixed(1)}" rx="2" fill="var(--ac)" fill-opacity="${i === n - 1 ? 1 : 0.55}"/>`).join('')}<text x="0" y="${h + 13}" class="ct">Sep 8</text><text x="${w}" y="${h + 13}" text-anchor="end" class="ct">Today</text></svg>`; };
const oiChart = (w = 560, h = 150) => chart({ data: oiSeries, w, h, padT: 10, padB: 18, padR: 36, color: 'var(--ac)', min: 4.5, max: 7, yTicks: [[5, '5.0M'], [6, '6.0M'], [7, '7.0M']], xTicks: [[0, 'Sep 8', 'start'], [60, 'Today', 'end']] });
const LEVD = [['1–2x', 412], ['2–5x', 803], ['5–10x', 466], ['10–20x', 171], ['20x+', 60]];
const LIQS = [['BTC', 'Long', '#7712', '0.12 BTC', '14,210', '2m'], ['MON', 'Long', '#3305', '96,000 MON', '4,013', '11m'], ['SOL', 'Short', '#6120', '18 SOL', '3,824', '26m'], ['PUMP', 'Long', '#8841', '410k PUMP', '1,973', '41m']];
const NEARL = [['#7290', 'BTC long', '18.4x', '91%', '1.2%'], ['#4471', 'MON long', '12.0x', '86%', '2.9%'], ['#2118', 'HYPE short', '9.7x', '82%', '4.1%']];
const ak = (k, v, sub, cls = '') => `<div class="ak"><span class="xs mu">${k}</span><b class="n ${cls}">${v}</b><span class="xs mu n">${sub}</span></div>`;
const mktTable = (rows, compact) => `<table class="tb mkt"><thead><tr><th>Market</th><th class="r">Mark</th><th class="r">24h vol</th>${compact ? '' : '<th class="r">Open interest</th><th class="r">Long / short</th>'}<th class="r">Funding 1h</th>${compact ? '' : '<th class="r">Liq. 24h</th>'}</tr></thead><tbody>${rows.map(([m, px, v, oi, ls, f, lq]) => `<tr><td><span class="row-c">${mk(m, 24)}<b class="sm">${m}</b></span></td><td class="r n">${px}</td><td class="r n">${v.toFixed(2)}M</td>${compact ? '' : `<td class="r n">${oi.toFixed(2)}M</td><td class="r"><span class="lsb"><i style="width:${ls}%"></i></span><span class="n xs">${ls}/${100 - ls}</span></td>`}<td class="r n ${f.startsWith('−') ? 'neg' : 'pos-i'}">${f}</td>${compact ? '' : `<td class="r n">${lq.toFixed(1)}k</td>`}</tr>`).join('')}</tbody></table>`;

// wallet drill-down data: Perpl account #2291 (leader 0x7a3f…c91e)
const WPOS = [['BTC', 'Long', '0.50 BTC', '117,880.0', '118,420.5', '92,400', '22.0%', 270, '4.0x'], ['SOL', 'Long', '120 SOL', '198.10', '212.44', '165.30', '22.2%', 1721, '5.1x'], ['ETH', 'Short', '2.00 ETH', '4,350.00', '4,312.80', '5,610.00', '30.1%', 74, '3.2x']];
seed = 77; const levHist = buildSeries([[0, 3.2], [5, 4.6], [9, 3.9], [14, 6.2], [18, 4.4], [24, 3.6], [30, 4.1]], 2, 0.04);
const levChart = (w = 560, h = 140) => chart({ data: levHist, w, h, padT: 10, padB: 18, padR: 30, color: 'var(--wrn)', area: false, min: 0, max: 8, yTicks: [[2, '2x'], [4, '4x'], [6, '6x'], [8, '8x']], xTicks: [[0, 'Sep 8', 'start'], [28, 'Sep 22 · peak 6.2x'], [60, 'Today', 'end']] });
seed = 78; const wPnl = buildSeries([[0, 34800], [8, 39200], [14, 37100], [22, 44600], [30, 48212]], 2, 0.01);
const wPnlChart = (w = 560, h = 140) => chart({ data: wPnl, w, h, padT: 10, padB: 18, padR: 36, min: 33000, max: 50000, yTicks: [[35000, '35k'], [40000, '40k'], [45000, '45k'], [50000, '50k']], xTicks: [[0, 'Sep 8', 'start'], [60, 'Today', 'end']] });
const posTable = (compact) => `<table class="tb"><thead><tr><th>Market</th><th class="r">Size</th>${compact ? '' : '<th class="r">Entry</th><th class="r">Mark</th><th class="r">Liq.</th>'}<th class="r">To liq.</th>${compact ? '' : '<th class="r">Lev.</th>'}<th class="r">uPnL</th></tr></thead><tbody>${WPOS.map(([m, s, sz, e, mk2, lq, d, p, lv]) => `<tr><td><span class="row-c">${mk(m, 22)}<b class="sm">${m}</b>${side(s)}</span></td><td class="r n">${sz}</td>${compact ? '' : `<td class="r n">${e}</td><td class="r n">${mk2}</td><td class="r n">${lq}</td>`}<td class="r n">${d}</td>${compact ? '' : `<td class="r n">${lv}</td>`}<td class="r n pos-i">+${comma(p)}</td></tr>`).join('')}</tbody></table>`;

S.anaPhone = () => `<div class="scr web">${WB(`${DOMAIN}/perpl`)}${SITEH()}<main class="main pad wpg">
  <div class="eyb">Perpl analytics</div><h1 class="wh1">All of Perpl, read from Monad</h1>
  <div class="srch">${I('search', 18)}<span class="mu sm">Any Perpl account: id or 0x address</span></div>
  <div class="ak2">${ak('24h volume', '14.2M', '+11.8% vs 7d avg')}${ak('Open interest', '6.6M', 'AUSD')}${ak('Active traders', '1,912', '24h')}${ak('Liquidations', '212.4k', '38 accounts · 24h')}</div>
  <div class="card pad14"><div class="row-c"><b class="sm grow">Daily volume</b><span class="xs mu">AUSD · 30d</span></div>${volBars(330, 110)}</div>
  <div class="card pad14"><b class="sm">Markets</b>${mktTable(MKT.slice(0, 6), true)}<span class="lnk sm">All 11 markets</span></div>
  <div class="card pad14"><div class="row-c"><b class="sm grow">Closest to liquidation</b><span class="xs mu">margin used</span></div>${NEARL.map(([a, p, l, m, d]) => `<div class="row-c nl-r"><span class="n sm">${a}</span><span class="sm grow">${p} · ${l}</span><span class="n sm neg">${m}</span><span class="xs mu n">${d} away</span></div>`).join('')}</div>
  <p class="xs mu">Block 18,204,402 · 4 s ago · Perpl contracts on Monad</p>
</main></div>`;
S.walletPhone = () => `<div class="scr web">${WB(`${DOMAIN}/perpl/2291`)}${SITEH()}<main class="main pad wpg">
  <div class="row-c">${identicon(L.a.addr, 40)}<div class="grow"><div class="eyb">Perpl account #2291</div><div class="addr">${L.a.addr}</div></div>${label('Smart Trader')}</div>
  <div class="ak2">${ak('Equity', '48,212', 'AUSD')}${ak('Unrealised', '+2,065', 'AUSD', 'pos-i')}${ak('Realised, 30d', '+13,380', 'AUSD', 'pos-i')}${ak('Leverage now', '4.1x', 'peak 6.2x in 30d', 'wrn-i')}</div>
  <div class="card pad14"><div class="row-c"><b class="sm grow">Risk</b><span class="chip-s wrn">Medium</span></div>${kvs([['Margin used', '31%'], ['Closest liquidation', 'SOL · 22.2% away'], ['Largest position', 'SOL · 53% of equity']])}</div>
  <div class="card pad14"><b class="sm">Open positions</b>${posTable(true)}</div>
  <div class="card pad14"><b class="sm">Leverage history</b>${levChart(330, 110)}</div>
  <div class="card row-c">${brandMark(24)}<span class="sm grow">212 ${BRAND} accounts copy this trader</span><span class="lnk sm">Open in ${BRAND}</span></div>
</main></div>`;

// =====================================================================================
// 11. Laptop layouts (1440x900)
// =====================================================================================
const LAPS = {};
const LNAV = (on) => `<aside class="lsd"><div class="lsd-b">${brandMark(28)}<b>${BRAND}</b><span class="pill-beta">Beta</span></div>
  <nav>${[['home', 'Home'], ['leaders', 'Leaders'], ['feed', 'Feed'], ['positions', 'Positions']].map(([k, t]) => `<span class="lnv ${on === k ? 'on' : ''}">${I(k, 20)}${t}${k === 'feed' ? '<span class="lnv-c n">1</span>' : ''}</span>`).join('')}
  <div class="lsd-sep">Public</div><span class="lnv ${on === 'analytics' ? 'on' : ''}">${I('activity', 20)}Perpl analytics</span><span class="lnv ${on === 'stats' ? 'on' : ''}">${I('stats', 20)}${BRAND} stats</span></nav>
  <div class="grow"></div>
  <div class="lsd-cap xs"><div class="row-c"><span class="grow mu">Beta deposit limit</span><span class="n">24.00 / 25.00</span></div>${meter([[96, 'var(--ac)']], 6)}</div>
  <div class="lsd-me">${identicon(ME.full, 32)}<div class="grow mn0"><div class="n sm">${ME.short}</div><div class="xs mu">Passkey · this laptop</div></div>${I('gear', 18)}</div></aside>`;
const LTOP = (title, sub = '', extra = '') => `<header class="ltp"><div class="grow mn0"><h1>${title}</h1>${sub ? `<div class="xs mu">${sub}</div>` : ''}</div>${extra}${BAL(ACC2.balance)}<span class="btn ton xs-b">${I('arrdown', 16)}Add funds</span><span class="ib bd">${I('bell', 20)}</span></header>`;
const LAP = (on, title, sub, body, extra = '') => `<div class="lap">${LNAV(on)}<div class="lmain">${LTOP(title, sub, extra)}<div class="lbody">${body}</div></div></div>`;

LAPS.home = () => LAP('home', 'Home', 'All numbers read from Monad · block 18,204,402', `<div class="lg-home">
  <div class="card lc eqc"><div class="row-c"><div class="grow"><div class="lbl">Equity</div><div class="big n">${ACC2.equity.toFixed(2)}<span class="u">AUSD</span></div><div class="delta"><span class="n pos-i b6">${sgn(ACC2.today)} (+0.88%)</span><span class="mu sm">today</span></div></div>
    <div class="kv4">${statC('AUSD balance', ACC2.balance.toFixed(2))}${statC('Unrealised', sgn(ACC2.upnl), '', 'pos-i')}${statC('Realised', sgn(ACC2.rpnl), '', 'neg')}${statC('Margin in use', '6.31')}</div>
    <div class="seg sm-seg grow-0"><span>7D</span><span class="on">30D</span><span>All</span></div></div>
    <div class="lch">${chart({ data: homeSeries.map((v) => v + 2.79), w: 880, h: 280, padT: 26, padB: 18, padR: 40, yTicks: [[23.5, '23.50'], [24.0, '24.00'], [24.5, '24.50']], xTicks: [[0, 'Sep 7', 'start'], [21, 'Sep 21'], [42, 'Today', 'end']] })}</div></div>
  <div class="card lc dspc"><div class="row-c"><b class="grow">Deposit split</b><span class="n sm">24.00 AUSD</span></div>${meter([[50, LCOL.a], [33.3, LCOL.b], [16.7, LCOL.c, 0.5]], 12)}
    ${BUD.map((b) => `<div class="row-c sm"><i class="lsq" style="background:${LCOL[b.k]};opacity:${b.st === 'hit' ? 0.5 : 1}"></i><span class="addr sm grow">${L[b.k].addr}</span><span class="n">${b.budget.toFixed(2)}</span></div>`).join('')}
    ${kvs([['Not assigned', '0.00'], ['Withdrawable now', '17.51 AUSD'], ['Beta cap room', '1.00 AUSD']])}
    <div class="acts"><span class="btn ton sm-b">${I('plus', 18)}Add leader</span><span class="btn out sm-b">${I('split', 18)}Edit budgets</span></div></div>
  <div class="card lc ldc"><div class="row-c lc-h"><b class="grow">Leaders</b><span class="xs mu">budget · margin used · PnL · loss stop</span></div>
    <table class="tb lt"><thead><tr><th>Leader</th><th>Status</th><th class="r">Budget</th><th>Margin used</th><th class="r">PnL</th><th class="r">Loss stop</th><th class="r">Open</th></tr></thead><tbody>
    ${BUD.map((b) => `<tr class="${b.st === 'hit' ? 'dimr' : ''}"><td><span class="row-c">${identicon(L[b.k].addr, 28)}<span class="addr sm">${L[b.k].addr}</span></span></td><td>${b.st === 'hit' ? `<span class="chip-s neg">${I('pause', 12)}Stopped by loss stop</span>` : '<span class="chip-s okc">Copying</span>'}</td><td class="r n">${b.budget.toFixed(2)}</td><td>${b.st === 'hit' ? '<span class="xs mu">Closed Oct 6, 14:02</span>' : `<div class="mu-w">${meter([[(b.used / b.budget) * 100, LCOL[b.k]]], 6)}<span class="xs n">${b.used.toFixed(2)}</span></div>`}</td><td class="r n ${b.pnl >= 0 ? 'pos-i' : 'neg'}">${sgn(b.pnl)}</td><td class="r n xs">${b.st === 'hit' ? 'hit at 3.40' : `${b.lsAt.toFixed(2)} · ${(b.eq - b.lsAt).toFixed(2)} away`}</td><td class="r n">${b.pos}</td></tr>`).join('')}</tbody></table>
    <div class="acst row-c">${I('shield', 18)}<div class="grow"><b class="sm">Account loss stop 20%</b><div class="xs mu n">Stops everything at 19.20 AUSD equity · now 24.16, 4.96 away · executable by anyone</div></div><span class="lnk sm">Edit</span></div></div>
  <div class="card lc rcc"><div class="row-c lc-h"><b class="grow">Recent copies</b><span class="lnk sm">Feed</span></div>
    ${FEED2.map((f) => `<div class="rc">${mk(f.mkt, 30)}<div class="grow mn0"><div class="sm"><b>${f.mkt}</b> ${side(f.side)} <span class="mu">${f.act}</span></div><div class="xs mu"><span class="n">${L[f.L].addr}</span> · ${f.ago} ago</div></div>${f.blocked ? `<span class="chip-s neg">${I('ban', 13)}Entry filter</span>` : `<div class="right"><div class="xs n">${f.lat} s · ${f.blk} blocks</div><div class="xs n mu">${f.dev} bps</div></div>`}</div>`).join('')}</div>
</div>`);

Object.assign(L, { g: { addr: '0x93d4…1e7b', labels: [], r30: 11.8, dd: 7.7, win: 58, lev: 2.4, mk: ['ETH', 'NEAR'], freq: 2.2, score: 72, fol: 18 }, h: { addr: '0x6b0e…c402', labels: ['Smart Trader'], r30: 21.3, dd: 19.6, win: 50, lev: 6.8, mk: ['MON', 'PUMP', 'VVV'], freq: 17.5, score: 70, fol: 41 }, i: { addr: '0xa71c…58d9', labels: [], r30: 9.4, dd: 5.2, win: 63, lev: 1.9, mk: ['BTC', 'UNI'], freq: 1.6, score: 69, fol: 12 }, j: { addr: '0x0f5a…9b26', labels: ['Fund'], r30: 8.1, dd: 6.3, win: 55, lev: 2.0, mk: ['BTC', 'ETH', 'SOL'], freq: 4.0, score: 67, fol: 30 } });
const LDROWS = ['a', 'b', 'e', 'c', 'd', 'f', 'g', 'h', 'i', 'j'];
LAPS.leaders = () => LAP('leaders', 'Leaders', 'Ranked by Mirror score from onchain Perpl fills · labels by Nansen', `<div class="lg-split">
  <div class="card lc"><div class="row-c lc-h"><div class="seg sm-seg grow-0"><span>7D</span><span class="on">30D</span><span>90D</span></div><div class="chips"><span class="chip on">${I('check', 14)}Max DD ≤ 25%</span><span class="chip">Markets: All${I('down', 14)}</span><span class="chip">Nansen labeled</span></div><span class="grow"></span><div class="srch s">${I('search', 16)}<span class="mu sm">Search address</span></div></div>
  <table class="tb lt"><thead><tr><th>#</th><th>Trader</th><th class="r">30D</th><th></th><th class="r">Max DD</th><th class="r">Win</th><th class="r">Avg lev.</th><th class="r">Trades/day</th><th class="r">Followers</th><th class="r">Score</th></tr></thead><tbody>
  ${LDROWS.map((k, i) => { const l = L[k]; return `<tr class="${k === 'c' ? 'sel' : ''}"><td class="n mu">${i + 1}</td><td><span class="row-c">${identicon(l.addr, 32)}<span><span class="addr sm">${l.addr}</span><span class="row-c gap6 tcell">${l.labels[0] ? label(l.labels[0]) : ''}<span class="xs mu n">${l.mk.join(' ')}</span></span></span></span></td><td class="r n pos-i b6">${pct(l.r30)}</td><td>${sparkSvg(l.r30, i)}</td><td class="r n ${l.dd > 15 ? 'neg' : ''}">${M}${l.dd.toFixed(1)}%</td><td class="r n">${l.win}%</td><td class="r n">${l.lev.toFixed(1)}x</td><td class="r n">${l.freq.toFixed(1)}</td><td class="r n">${l.fol}</td><td class="r n b6">${l.score}</td></tr>`; }).join('')}</tbody></table>
  <p class="xs mu">Past results don't predict future returns. Click a row to open the profile on the right.</p></div>
  <div class="card lc lpanel"><div class="row-c">${identicon(L.c.addr, 48)}<div class="grow mn0"><div class="addr lg">${L.c.addr}</div><div class="row-c gap6">${labels(L.c.labels)}</div></div><span class="ib">${I('close')}</span></div>
    <div class="row-c"><div class="grow"><div class="lbl">PnL · 30 days</div><div class="big2 n pos-i">${pct(cRet)}</div></div><span class="xs mu">97 followers · score 81</span></div>
    ${profChart()}
    <div class="stg">${statC('Max drawdown', `${M}${cDD.toFixed(1)}%`, `${ddDays} days`, 'neg')}${statC('Win rate', '48%', '212 trades')}${statC('Avg leverage', '9.6x', 'peak 20x', 'wrn-i')}</div>
    <div class="flags">${flag('warn', 'High leverage', 'Reached 20x twice. A 5x limit would block those trades.')}${flag('warn', 'Deep drawdown', `${cDD.toFixed(1)}% from peak, ${ddFrom} to ${ddTo}.`)}</div>
    <div class="card wi-mini pad14"><div class="row-c"><b class="sm grow">What if I had followed · 30d</b>${SIM('Simulation')}</div><div class="n b6">+0.38 to +0.71 AUSD</div><div class="xs mu">on a 4.00 budget with your default limits</div></div>
    <div class="acts"><span class="btn out sq">${I('bell', 20)}</span><span class="btn pri grow">Follow ${L.c.addr}</span></div></div>
</div>`);

LAPS.feed = () => LAP('feed', 'Feed', 'Every leader trade and what happened to your copy', `<div class="lg-split fd">
  <div class="card lc"><div class="row-c lc-h"><div class="chips"><span class="chip on">All</span><span class="chip">Copied</span><span class="chip">Blocked <span class="n">1</span></span><span class="chip">Closes</span><span class="chip">Leader: All${I('down', 14)}</span></div><span class="grow"></span>${LIVE()}</div>
  <table class="tb lt"><thead><tr><th>Time</th><th>Leader</th><th>Trade</th><th class="r">Your fill</th><th class="r">Deviation</th><th class="r">Proposed → copy</th><th>State</th></tr></thead><tbody>
  ${FEED2.map((f, i) => `<tr class="${i === 0 ? 'sel' : ''} ${f.blocked ? 'blkr' : ''}"><td class="n xs mu">${f.ago} ago</td><td>${identicon(L[f.L].addr, 24)}</td><td><span class="row-c">${mk(f.mkt, 24)}<b class="sm">${f.mkt}</b>${side(f.side)}<span class="xs mu">${f.act} · ${f.lev}</span></span></td>${f.blocked ? `<td colspan="3" class="neg sm wrap"><span class="row-c">${I('ban', 14)}Not copied. ${f.rule}</span></td><td><span class="chip-s neg">Blocked</span></td>` : `<td class="r n">${f.px}</td><td class="r n">${f.dev} bps</td><td class="r n">${f.lat} s · ${f.blk} blocks</td><td>${commit(f.st)}</td>`}</tr>`).join('')}
  ${[['4h', 'a', 'SOL', 'Long', 'Open', '0.0467 SOL', '198.12', '+1.0', '0.59', 2], ['5h', 'b', 'ETH', 'Short', 'Close', '0.0014 ETH', '4,298.5', '+0.4', '0.63', 2], ['7h', 'a', 'BTC', 'Long', 'Add', '0.0001 BTC', '117,890.0', '+0.8', '0.71', 2], ['9h', 'b', 'BTC', 'Long', 'Open', '0.00005 BTC', '117,402.0', '+3.1', '0.94', 3], ['11h', 'a', 'SOL', 'Long', 'Close', '0.0467 SOL', '201.30', '+0.6', '0.60', 2], ['14h', 'b', 'ETH', 'Short', 'Open', '0.0014 ETH', '4,301.2', '−0.2', '0.62', 2], ['Yday', 'a', 'BTC', 'Long', 'Open', '0.0001 BTC', '116,940.0', '+1.7', '0.66', 2]].map(([ago, k, m, s, a, sz, px, dv, lt, bk]) => `<tr><td class="n xs mu">${ago} ago</td><td>${identicon(L[k].addr, 24)}</td><td><span class="row-c">${mk(m, 24)}<b class="sm">${m}</b>${side(s)}<span class="xs mu">${a}</span></span></td><td class="r n">${px}</td><td class="r n">${dv} bps</td><td class="r n">${lt} s · ${bk} blocks</td><td>${commit('Finalized')}</td></tr>`).join('')}
  </tbody></table></div>
  <div class="card lc lpanel"><div class="row-c">${mk('BTC', 40)}<div class="grow"><div class="lbl">Copied · Open · 4x · 4s ago</div><b class="t-l">BTC ${side('Long')} <span class="n">0.0001 BTC</span></b><div class="xs mu">from <span class="n tx">${L.a.addr}</span> · 11.84 AUSD notional</div></div><span class="ib">${I('close')}</span></div>
    ${proofBody()}
    <span class="btn out">${I('ext', 18)}Verify on MonadVision</span></div>
</div>`);

LAPS.follow = () => `<div class="lap">${LNAV('leaders')}<div class="lmain">${LTOP('Leaders', 'Ranked by Mirror score from onchain Perpl fills')}<div class="lbody"><div class="ghostg"><div class="card lc"></div><div class="card lc"></div></div></div></div>
<div class="lmodal-ov"><div class="lmodal">
  <div class="lm-h">${identicon(L.c.addr, 40)}<div class="grow"><div class="lbl">Follow a second leader</div><span class="row-c gap6"><b class="addr lg">${L.c.addr}</b>${labels(L.c.labels)}</span></div><div class="sh-steps xs lm-st"><span class="done">1 Set limits</span><span class="on">2 What if</span><span>3 Review</span></div><span class="ib">${I('close')}</span></div>
  <div class="lm-b"><div class="lm-l">
    ${fsSec('Split your deposit', 'One deposit, one account. Each leader trades only with its own budget.', `${meter([[50, LCOL.a], [16.7, LCOL.b], [33.3, 'var(--sf2)']], 12)}<div class="spl"><div class="row-c">${identicon(L.a.addr, 24)}<span class="addr sm grow">${L.a.addr}</span><span class="xs mu">min 4.31</span><span class="n sm">12.00</span></div><div class="row-c on">${identicon(L.c.addr, 24)}<span class="addr sm grow">${L.c.addr}</span><span class="stp n"><span class="ib s">−</span>4.00<span class="ib s">+</span></span></div><div class="row-c"><span class="sw-dot"></span><span class="sm grow mu">Not assigned</span><span class="n sm mu">8.00</span></div></div><p class="hint xs">A market belongs to the leader whose copy opened it. BTC is held by ${L.a.addr}, so this leader's BTC trades are blocked until it closes.</p>`, 'split')}
    ${entrySec()}
    ${stopsSec('4.00', '3.40')}
    ${collapsed('layers', 'Sizing', 'Fixed 25% · 1.00')}${collapsed('tune', 'Max leverage', '5x')}${collapsed('layers', 'Max notional per market', '6.00')}${collapsed('flag', 'Stop-loss / take-profit', '8% / 20%')}${collapsed('globe', 'Allowed markets', 'HYPE, SOL, MON, BTC, ETH')}${collapsed('cal', 'Expiry', 'Jan 5, 2027')}
  </div><div class="lm-r">${whatIfBody({ w: 460, h: 170 }).replace('<b class="grow">What if I had followed</b>', `<b class="grow">What if I had followed ${L.c.addr}</b>`)}</div></div>
  <div class="lm-f"><span class="xs mu grow">Limits are written to your account contract and checked on every copy. ${BRAND} can trade within them but can never withdraw.</span><span class="btn out">Back to limits</span><span class="btn pri">Review follow</span></div>
</div></div></div>`;

LAPS.positions = () => LAP('positions', 'Positions', 'Every position traces back to the leader whose copy opened it', `<div class="lg-split ps">
  <div class="lcol"><div class="ak4">${ak('Total PnL', '+0.16', 'AUSD since first deposit', 'pos-i')}${ak('Unrealised', '+0.34', '3 open positions', 'pos-i')}${ak('Realised', '−0.18', 'incl. loss stop on 0xc4e0', 'neg')}${ak('Margin in use', '6.31', 'of 24.00 deposited')}</div>
  <div class="card lc"><div class="row-c lc-h"><b class="grow">Open positions</b><div class="seg sm-seg grow-0"><span class="on">Market</span><span>Leader</span></div></div>
  <table class="tb lt"><thead><tr><th>Market</th><th>Leader</th><th class="r">Entry</th><th class="r">Mark</th><th class="r">Liq.</th><th class="r">Stop-loss</th><th class="r">Take-profit</th><th class="r">PnL</th></tr></thead><tbody>
    <tr class="sel"><td><span class="row-c">${mk('BTC', 26)}<b class="sm">BTC</b>${side('Long')}<span class="xs mu n">4x</span></span></td><td>${identicon(L.a.addr, 24)}</td><td class="r n">117,880.0</td><td class="r n">118,420.5</td><td class="r n">90,610</td><td class="r n">108,450.0</td><td class="r n">141,456.0</td><td class="r n pos-i">+0.05</td></tr>
    <tr><td><span class="row-c">${mk('SOL', 26)}<b class="sm">SOL</b>${side('Long')}<span class="xs mu n">3x</span></span></td><td>${identicon(L.a.addr, 24)}</td><td class="r n">198.10</td><td class="r n">212.44</td><td class="r n">135.20</td><td class="r n">182.25</td><td class="r n">237.72</td><td class="r n pos-i">+0.67</td></tr>
    <tr><td><span class="row-c">${mk('ETH', 26)}<b class="sm">ETH</b>${side('Short')}<span class="xs mu n">3x</span></span></td><td>${identicon(L.b.addr, 24)}</td><td class="r n">4,350.00</td><td class="r n">4,312.80</td><td class="r n">5,720.00</td><td class="r n">4,698.00</td><td class="r n">3,480.00</td><td class="r n pos-i">+0.05</td></tr>
  </tbody></table></div>
  <div class="card lc"><div class="row-c lc-h"><b class="grow">PnL by leader</b><span class="xs mu">since follow</span></div>
    ${BUD.map((b) => `<div class="row-c pbl">${identicon(L[b.k].addr, 26)}<span class="addr sm">${L[b.k].addr}</span><span class="grow">${meter([[Math.min(100, Math.abs(b.pnl) / 0.7 * 100), b.pnl >= 0 ? 'var(--pos)' : 'var(--neg)']], 8)}</span><span class="n sm ${b.pnl >= 0 ? 'pos-i' : 'neg'}">${sgn(b.pnl)}</span><span class="xs mu">${b.st === 'hit' ? 'stopped' : 'copying'}</span></div>`).join('')}</div>
  <div class="card lc"><div class="row-c lc-h"><b class="grow">Closed</b><span class="xs mu">last 7 days</span></div><table class="tb lt"><tbody>
    ${[['HYPE', 'Long', L.c.addr, 'Closed by loss stop · anyone-executable', '46.92 → 41.12', -0.58, 'Oct 6'], ['BTC', 'Long', L.b.addr, 'Leader closed', '117,402.0 → 118,402.0', 0.06, 'Oct 7'], ['MON', 'Short', L.a.addr, 'Take-profit hit', '0.04420 → 0.04180', 0.11, 'Oct 5']].map(([m, sd, a, why, px, p, d]) => `<tr><td><span class="row-c">${mk(m, 24)}<b class="sm">${m}</b>${side(sd)}</span></td><td>${identicon(a, 22)}</td><td class="xs">${why}</td><td class="r n sm">${px}</td><td class="r n ${p >= 0 ? 'pos-i' : 'neg'}">${sgn(p)}</td><td class="r xs mu">${d}</td></tr>`).join('')}</tbody></table></div></div>
  <div class="card lc lpanel"><div class="row-c">${mk('BTC', 40)}<div class="grow"><div><b>BTC</b> ${side('Long')} <span class="mu sm n">4x · 0.0001 BTC</span></div><div class="xs mu n">from ${L.a.addr}</div></div><div class="right"><div class="n b6 pos-i">+0.05</div><div class="xs mu n">+1.8% ROE</div></div></div>
    ${levelChart({ levels: LV_BTC(), w: 440, h: 230 })}
    <div class="card lvl"><div class="lv-r"><span class="lv-i ng">${I('flag', 16)}</span><div class="grow"><div class="sm">Stop-loss</div><div class="xs mu n">−8.0% from entry · about −0.94 AUSD</div></div><b class="n">108,450.0</b></div><div class="lv-r"><span class="lv-i ok">${I('flag', 16)}</span><div class="grow"><div class="sm">Take-profit</div><div class="xs mu n">+20.0% from entry · about +2.36 AUSD</div></div><b class="n">141,456.0</b></div><div class="lv-f xs">${I('shield', 14)}<span class="grow">Onchain · anyone can execute when hit</span>${TXL(T.lvl)}</div></div>
    <div class="acts"><span class="btn ton sm-b">${I('edit', 18)}Edit levels</span><span class="btn out sm-b">${I('share', 18)}Share</span></div>
    <div class="acts"><span class="btn dng-o sm-b">Close position</span><span class="btn out sm-b">Stop following…</span></div>
    <div class="card list flat">${setRow('feed', 'Copy proof', '+1.0 bps · 2 blocks · 612 ms · Finalized')}${setRow('users', `Leader ${L.a.addr}`, 'Budget 12.00 · margin used 4.31 · copying')}</div></div>
</div>`);

LAPS.analytics = () => LAP('analytics', 'Perpl analytics', 'Every Perpl account, read from Perpl contracts on Monad · block 18,204,402 · 4 s ago', `<div class="lg-ana">
  <div class="ak5">${ak('24h volume', '14.2M', '+11.8% vs 7d avg')}${ak('Open interest', '6.6M', 'AUSD · +4.1% 24h')}${ak('Active traders', '1,912', 'accounts that traded, 24h')}${ak('Liquidations', '212.4k', '38 accounts · 24h', 'neg')}${ak('Funding, OI-weighted', '+0.0024%', 'per hour · longs pay', 'pos-i')}</div>
  <div class="card lc"><div class="row-c lc-h"><b class="grow">Daily volume</b><span class="xs mu">AUSD · 30 days</span></div>${volBars(340, 150)}</div>
  <div class="card lc"><div class="row-c lc-h"><b class="grow">Open interest</b><span class="xs mu">AUSD · 30 days</span></div>${oiChart(340, 168)}</div>
  <div class="card lc mk-c"><div class="row-c lc-h"><b class="grow">Markets</b><span class="xs mu">11 markets</span></div>${mktTable(MKT, false)}</div>
  <div class="card lc"><div class="row-c lc-h"><b class="grow">Open positions by leverage</b><span class="xs mu n">1,912 positions</span></div>${hist(LEVD, { w: 380, h: 96, hl: 1 })}
    <div class="row-c lc-h"><b class="grow sm">Closest to liquidation</b><span class="xs mu">margin used · distance</span></div>${NEARL.map(([a, p, l, m, d]) => `<div class="row-c nl-r"><span class="n sm lnk">${a}</span><span class="sm grow">${p} · ${l}</span><span class="n sm neg">${m}</span><span class="xs mu n">${d}</span></div>`).join('')}
    <div class="row-c lc-h"><b class="grow sm">Latest liquidations</b></div>${LIQS.map(([m, s, a, sz, v, t]) => `<div class="row-c nl-r">${mk(m, 22)}${side(s)}<span class="n sm lnk">${a}</span><span class="n xs mu grow">${sz}</span><span class="n sm">${v}</span><span class="xs mu n">${t}</span></div>`).join('')}</div>
</div>`, `<div class="srch s w320">${I('search', 16)}<span class="mu sm">Any Perpl account: id or 0x address</span></div>`);

LAPS.wallet = () => LAP('analytics', 'Perpl account #2291', `<span class="n">${L.a.addr}</span> · active on Perpl since Jun 2026 · Nansen: Smart Trader`, `<div class="lg-ana w">
  <div class="ak5">${ak('Equity', '48,212', 'AUSD')}${ak('Unrealised', '+2,065', 'AUSD · 3 positions', 'pos-i')}${ak('Realised, 30 days', '+13,380', 'AUSD · 426 trades', 'pos-i')}${ak('Leverage now', '4.1x', 'peak 6.2x on Sep 22', 'wrn-i')}${ak('Closest liquidation', '22.0%', 'BTC long · 92,400')}</div>
  <div class="card lc"><div class="row-c lc-h"><b class="grow">Equity</b><div class="seg sm-seg grow-0"><span>7D</span><span class="on">30D</span><span>90D</span></div></div>${wPnlChart(340, 168)}</div>
  <div class="card lc"><div class="row-c lc-h"><b class="grow">Leverage history</b><span class="xs mu">effective, hourly</span></div>${levChart(340, 168)}</div>
  <div class="card lc mk-c"><div class="row-c lc-h"><b class="grow">Open positions</b><span class="xs mu">live</span></div>${posTable(false)}
    <div class="row-c lc-h"><b class="grow sm">Recent fills</b></div>
    <table class="tb"><tbody>${[['09:41:02', 'BTC', 'Long', 'Open', '0.0500 BTC', '118,402.0'], ['09:12:47', 'SOL', 'Long', 'Add', '2.0 SOL', '203.45'], ['08:30:11', 'ETH', 'Short', 'Open', '0.50 ETH', '4,350.0'], ['Yday 22:04', 'ETH', 'Short', 'Add', '1.50 ETH', '4,362.5'], ['Yday 17:40', 'MON', 'Short', 'Close', '220,000 MON', '0.04180']].map(([t, m, s, a, sz, px]) => `<tr><td class="n xs mu">${t}</td><td><span class="row-c">${mk(m, 22)}${side(s)}<span class="xs">${a}</span></span></td><td class="r n">${sz}</td><td class="r n">${px}</td><td class="r">${TXL(tx())}</td></tr>`).join('')}</tbody></table></div>
  <div class="card lc"><div class="row-c lc-h"><b class="grow">Risk</b><span class="chip-s wrn">Medium</span></div>
    <div class="dl"><b class="sm">Distance to liquidation</b>${hbars([['BTC long', 22.0], ['SOL long', 22.2], ['ETH short', 30.1]], '%')}</div>
    ${kvs([['Margin used', '31% of equity'], ['Largest position', 'SOL · 53% of equity'], ['Liquidations, 90 days', '0'], ['Worst day, 30 days', `${M}4.1% · Sep 22`], ['Max drawdown, 30 days', `${M}9.2%`]])}
    <div class="card row-c pad14 brg">${brandMark(24)}<span class="sm grow">212 ${BRAND} accounts copy this trader</span><span class="btn pri xs-b">Open in ${BRAND}</span></div></div>
</div>`, `<div class="srch s w320">${I('search', 16)}<span class="sm n">2291</span></div>`);

// public stats page (website, not the signed-in app)
LAPS.stats = () => `<div class="lap site"><header class="sitel">${brandMark(28)}<b>${BRAND}</b><nav><span>Product</span><span>Docs</span><span class="on">Stats</span><span>Perpl analytics</span><span>Download</span></nav><span class="grow"></span><span class="ib bd">${I('sun', 18)}</span><span class="btn pri xs-b">${I('dl', 16)}Get the app</span></header>
<div class="site-b"><div class="site-hd"><div><div class="eyb">Public stats</div><h1 class="wh1 xl">Every copy, onchain.</h1><p class="sm mu">From Monad mainnet through the ${BRAND} indexer. Team-run demo accounts are excluded from every number and shown separately.</p></div>
  <div class="ak6">${ak('Accounts created', '96', 'excl. team-run')}${ak('Funded accounts', '37', '')}${ak('Net AUSD deposited', '612.40', '')}${ak('Copies executed', '1,284', '30 days')}${ak('Blocked by a rule', '108', '30 days')}${ak('Active followers', '29', '7 days')}</div></div>
  <div class="row-c site-sh"><h2 id="cq">Copy quality</h2><span class="xs mu grow">Derived from CopyExecuted and CopyBlocked events. Team-run excluded.</span><div class="seg sm-seg grow-0"><span>7D</span><span class="on">30D</span><span>All</span></div></div>
  <div class="lg-cq">
    <div class="card lc"><div class="row-c lc-h"><b class="grow">Deviation from leader fill</b><span class="xs mu">bps · + is worse · 1,284 copies</span></div>${hist(DEVB, { w: 440, h: 150, hl: 3 })}<div class="row-c xs mu"><span>Median <b class="n tx">+0.8 bps</b></span><span>p90 <b class="n tx">+4.6 bps</b></span></div></div>
    <div class="card lc"><div class="row-c lc-h"><b class="grow">Leader fill Proposed → copy</b></div><div class="kv2"><div><span class="xs mu">Median</span><b class="n big2">0.61 s</b><span class="xs mu">2 blocks</span></div><div><span class="xs mu">p90</span><b class="n big2">0.94 s</b><span class="xs mu">3 blocks</span></div></div>${hbars(LATB, '%')}<p class="xs mu">Monad blocks are about 300 ms; finality follows about 550 ms after Proposed.</p></div>
    <div class="card lc"><div class="row-c lc-h"><b class="grow">Blocked by reason</b><span class="xs mu n">108</span></div>${hbars(BLKR)}<div class="card row-c tr-c">${TEAM()}<span class="xs mu grow mn0">Demo follower: 214 copies, median 0.60 s. Not counted.</span></div></div>
  </div>
  <div class="card lc"><div class="row-c lc-h"><b class="grow">Recent copies</b><span class="lnk sm">Download CSV</span></div><table class="tb lt"><thead><tr><th>Time</th><th>Account</th><th>Leader</th><th>Market</th><th class="r">Leader fill</th><th class="r">Copy fill</th><th class="r">Deviation</th><th class="r">Blocks</th><th class="r">ms</th><th class="r">Tx</th></tr></thead><tbody>
  ${[['09:41:02', ME.short, L.a.addr, 'BTC', '118,402.0', '118,414.0', '+1.0', 2, 612], ['09:40:41', '0x8e12…07fa', L.b.addr, 'ETH', '4,350.0', '4,349.7', '−0.7', 2, 655], ['09:38:19', '0x2c90…b3d1', L.e.addr, 'ZEC', '58.21', '58.24', '+5.2', 3, 921], ['09:36:02', '0x51ad…e840', L.a.addr, 'SOL', '212.40', '212.42', '+0.9', 2, 598], ['09:31:47', '0x8e12…07fa', L.b.addr, 'BTC', '118,380.0', '118,391.0', '+0.9', 2, 607]].map(([t, a, l, m, lf, cf, d, b, ms]) => `<tr><td class="n xs mu">${t}</td><td class="addr sm">${a}</td><td class="addr sm">${l}</td><td><span class="row-c">${mk(m, 22)}<b class="sm">${m}</b></span></td><td class="r n">${lf}</td><td class="r n">${cf}</td><td class="r n">${d} bps</td><td class="r n">${b}</td><td class="r n">${ms}</td><td class="r">${TXL(tx())}</td></tr>`).join('')}</tbody></table></div>
</div></div>`;

// =====================================================================================
// Page sections
// =====================================================================================
const ph = (k, t, p, i, o = {}) => ({ kind: 'phone', k, t, p, i, ...o });
const lp = (k, t, p, i) => ({ kind: 'lap', k, t, p, i });
const cd = (k, t, p, i, size) => ({ kind: 'card', k, t, p, i, size });
const SECTIONS = [
  { id: 'watch', n: '01', t: 'Watch mode (no funds)', d: 'A new user with no deposit watches real copies land on the team-run demo follower, can run a demo or a blocked trade, and always sees the way to deposit. No dead "Loading your account" spinner.', states: [
    ph('watchHome', 'Watch mode on Home', 'Replaces the empty Home for a 0.00 AUSD account. Real copies from the team-run demo follower, each with its proof line.', 'Run demo trade and Run blocked trade start a cycle (rate-limited). Add funds sits in the hero and again at the end. Team-run label on the account and on each copy. Feed opens the demo feed.', { tall: true }),
    ph('watchRun', 'Demo trade running', 'Shows each step of the cycle as it happens: leader fill, onchain check, copy fill with deviation and blocks, finality.', 'Buttons are disabled while a cycle runs. Every step with a transaction has a MonadVision link. The previous blocked run stays visible below.', { tall: true }),
    ph('skel', 'First 5 seconds', 'Layout skeleton with the balance already read from Monad. Never a lone spinner.', 'No interaction. After 5 s it becomes the next state if the server is still silent.'),
    ph('slow', 'Slow backend, after 5 s', 'Says what has loaded and what hasn\'t, and offers watch mode.', 'Watch the demo meanwhile opens watch mode. Retry now retries the server. After 30 s it becomes "Can\'t reach Mirror".'),
    ph('mirrorDown', 'Offline: can\'t reach Mirror', 'Server down. Watch mode still works because the demo account\'s copies are read straight from Monad.', 'Run buttons disabled with the reason. Retry. The feed keeps updating from Monad events.'),
    ph('watchQuiet', 'Empty: no demo copies lately', 'The demo leader hasn\'t traded in 2 hours.', 'Run demo trade starts one. Last copy links to its transaction.'),
  ] },
  { id: 'quality', n: '02', t: 'Copy quality', d: 'Every copy carries proof: leader fill, leader entry, your fill, deviation in bps and timing from the leader\'s fill being Proposed to the copy. Deviation is signed against you: + is worse.', states: [
    ph('copyDetail', 'Copy detail sheet', 'Opened from any copied item in the feed.', 'Both transactions link to MonadVision. Verify on MonadVision opens your copy\'s transaction, where the CopyExecuted event holds every number shown.', { tall: true }),
    ph('blockedEntry', 'Blocked by the entry filter', 'The rule, the numbers, the leader reference and the onchain record.', 'Edit entry filter opens the follow sheet at that control. Done closes. Tx link opens the BlockedCopy record.'),
    ph('statsPhone', 'Public stats: Copy quality (web, phone)', 'New section of /stats. All numbers derived from onchain events, team-run excluded and shown separately.', 'Period switch 7D/30D/All. CSV download. Laptop version below.', { tall: true }),
    lp('stats', 'Public stats: Copy quality (web, laptop)', 'The same section on a laptop, under the existing totals.', 'Recent copies table links each row to its transaction.'),
  ] },
  { id: 'whatif', n: '03', t: 'What if I had followed', d: 'A look-back on the leader\'s history with the follower\'s own limits applied, inside the follow sheet. Always labelled "Simulation, not a promise", with its assumptions.', states: [
    ph('whatIf', 'What if, 30 days', 'Step 2 of the follow sheet: equity curve with a range, copied vs blocked by rule, final PnL range, assumptions.', 'Switch 7/30/90 days. Edit jumps back to the limit. Change limits and Review follow.', { tall: true }),
  ] },
  { id: 'follow', n: '04', t: 'Follow sheet changes', d: 'New controls: entry filter, stop-loss and take-profit defaults, loss stops anyone can execute, and a budget per leader. Controls that did not change are collapsed to one row.', states: [
    ph('follow2', 'First leader', 'Budget, entry filter, SL/TP defaults, loss stops with the "executed by anyone" toggle in one plain sentence.', 'Sliders and chips as today. Collapsed rows open the existing controls. See what if goes to step 2.', { tall: true }),
    ph('followSecond', 'Second leader: split the deposit', 'One deposit split across leaders; shows the market-ownership rule with the real conflict.', 'Stepper changes this leader\'s budget; the first leader can\'t go below its margin in use.', { tall: true }),
    ph('followReview', 'Review', 'The exact limits the contract will enforce.', 'Approve with passkey signs once; gas is sponsored.'),
  ] },
  { id: 'leaders-budget', n: '05', t: 'Several leaders, one deposit', d: 'Home shows each leader with its budget, margin used, PnL and loss-stop status. One leader can stop without touching the others.', states: [
    ph('home2', 'Home with three leaders', 'Deposit split, per-leader budget meter, distance to each loss stop, a stopped leader.', 'Rows open the leader\'s follow. Add leader opens the leaderboard. Move funds opens Budgets.', { tall: true }),
    ph('budgets', 'Budgets', 'Moves budget between leaders without moving money.', 'Steppers; minimums enforced. Save with passkey.'),
    ph('leaderStopped', 'Leader stopped by its loss stop', 'What fired, the prices it used, who executed it and what closed.', 'Resume with a new loss stop, move the rest to Not assigned, or stop following.'),
  ] },
  { id: 'position', n: '06', t: 'Position detail', d: 'Stop-loss and take-profit are onchain levels on each position. Stopping a leader asks what happens to its positions.', states: [
    ph('posDetail', 'Position with levels', 'Price with entry, stop and target, each level with its distance and AUSD result.', 'Edit levels (passkey). Share creates a read-only link. Copy proof opens the copy detail.'),
    ph('stopFollow', 'Stop following', 'Two plain choices: keep positions, or stop and close.', 'Choice then passkey. Cancel keeps everything.'),
  ] },
  { id: 'share', n: '07', t: 'Shared position and suggested levels', d: 'A friend opens a shared link, sees a read-only position and can suggest a stop and target with a short note. No login, no chat, no friend list. The owner decides.', states: [
    ph('shareWeb', 'Shared link (web)', 'Read-only position card and the suggestion form.', 'Send suggestion. Verify opens the position\'s onchain state.', { tall: true }),
    ph('shareSent', 'Suggestion sent (web)', 'Confirms what was sent and what happens next.', 'No further action.'),
    ph('suggestReview', 'Owner reviews the suggestion', 'Current vs suggested levels with the AUSD result of each, and the note.', 'Decline discards. Accept asks for the passkey.'),
    ph('suggestPasskey', 'Accept with passkey', 'The system passkey sheet states exactly what is signed.', 'Fingerprint signs; Cancel returns.'),
    ph('suggestDone', 'Accepted: onchain levels', 'The levels are now onchain on the position.', 'Tx link to the level change.'),
  ] },
  { id: 'cards', n: '08', t: 'Shareable cards', d: 'Rendered as images at 1200×630 and 1080×1080. Each links to its onchain proof by URL and QR. Team-run and simulation are labelled on the image itself.', states: [
    cd('leader', 'Leader record · 1200×630', 'A leader\'s 30-day record.', 'QR opens the leader page with every fill.', 'og'),
    cd('follower', 'Follower result · 1200×630', 'Your own result.', 'QR opens your public account page.', 'og'),
    cd('blocked', 'Blocked, team-run · 1080×1080', 'A blocked copy on the team-run demo account, labelled as such.', 'QR opens the BlockedCopy transaction.', 'sq'),
    cd('sim', 'Simulation · 1080×1080', 'A what-if result, labelled as a simulation.', 'QR opens the leader page.', 'sq'),
    ph('shareSheet', 'Share sheet in the app', 'Preview of the card before sharing.', 'Square or wide, amounts on or off, copy link, save image, share.'),
  ] },
  { id: 'analytics', n: '09', t: 'Perpl analytics and risk', d: 'For Perpl\'s Analytics / Risk Tool bounty: protocol overview and a drill-down into any Perpl account. Laptop first, phone too, dark mode. Public; signed-out visitors see it without the balance chip.', states: [
    lp('analytics', 'Protocol overview (laptop)', 'Volume, open interest, active traders, liquidations, funding, markets, leverage distribution, accounts near liquidation.', 'Search any account by id or address. Rows open the wallet drill-down.'),
    lp('wallet', 'Wallet drill-down (laptop)', 'Any Perpl account: positions, PnL, risk, leverage history, recent fills.', 'Open in Mirror goes to that trader\'s leader profile.'),
    ph('anaPhone', 'Overview (phone)', 'The same data in one column.', 'Search; All 11 markets expands the table.', { tall: true }),
    ph('walletPhone', 'Wallet (phone)', 'Drill-down in one column.', 'Open in Mirror.', { tall: true }),
  ] },
  { id: 'firstrun', n: '10', t: 'First-run fixes', d: 'Fixes to existing screens found in the first-three-minutes review.', states: [
    ph('followDone', 'Alerts asked after the first follow', 'No permission prompt right after account creation. Asked here, or when alerts are turned on in Settings.', 'Turn on alerts shows the Android prompt; Not now asks again only from Settings.'),
    ph('notifPrompt', 'Android permission, only after the tap', 'The system dialog appears only after Turn on alerts.', 'Allow or Don\'t allow.'),
    ph('errMirror', '"Can\'t reach Mirror"', 'Used only when our server fails. Onchain numbers still shown.', 'Retry. Status opens the network rows in Settings.'),
    ph('errMonad', '"Can\'t reach Monad"', 'Used only when the RPC fails.', 'Retry. Data is dimmed and timestamped.'),
    ph('settingsNet', 'Network rows check the RPC directly', 'Two rows, each checked from the phone: Monad RPC and the Mirror server.', 'Check now. Notifications toggle off until the user turns it on.'),
    ph('welcomeFix', 'Welcome shows the latest real copy', 'The card is a real team-run copy, labelled. If none is available it is labelled "Example".', 'Tx link opens the copy. Create account as today.'),
    ph('downloadWeb', 'Download page with real numbers', 'Version, size and SHA-256 filled from the release.', 'Download APK; copy hash.'),
  ] },
  { id: 'laptop', n: '11', t: 'Laptop layouts (web app)', d: 'At 1440×900 the app fills the screen: sidebar navigation, tables where phones have lists, detail panels instead of sheets. Phones keep the phone layout.', states: [
    lp('home', 'Home / portfolio', 'Equity, deposit split, leaders table with budgets and loss stops, recent copies.', 'Rows open the leader; Add leader, Edit budgets.'),
    lp('leaders', 'Leaders: table and profile panel', 'Sortable table; the selected leader\'s profile on the right.', 'Click a row to open the panel; Follow opens the follow modal.'),
    lp('feed', 'Feed with copy detail panel', 'Every copy with deviation and timing columns; detail on the right.', 'Click a row for its proof; tx links open MonadVision.'),
    lp('follow', 'Follow flow as a modal', 'Limits on the left, live what-if on the right.', 'Changing a limit updates the simulation. Review follow then passkey.'),
    lp('positions', 'Positions', 'Positions table with SL/TP, PnL by leader, selected position panel.', 'Edit levels, share, close, stop following.'),
  ] },
];

// =====================================================================================
// Render
// =====================================================================================
const TH = ['light', 'dark'];
const frameOf = (s, theme) => {
  const lab = `<figcaption class="dev-l">${theme === 'light' ? 'Light' : 'Dark'}</figcaption>`;
  if (s.kind === 'phone') return `<figure class="dev">${lab}<div class="phone t-${theme}" data-shot="phone-${s.k}-${theme}">${S[s.k]()}</div></figure>`;
  if (s.kind === 'lap') return `<figure class="dev lapdev">${lab}<div class="lapw"><div class="t-${theme} lapt" data-shot="laptop-${s.k}-${theme}">${LAPS[s.k]()}</div></div></figure>`;
  return `<figure class="dev carddev">${lab}<div class="cardw ${s.size}"><div class="t-${theme} cardt" data-shot="card-${s.k}-${theme}">${CARDS[s.k]()}</div></div></figure>`;
};
const sectionsHtml = SECTIONS.map((s) => `<section class="sec ${s.states.some((x) => x.kind !== 'phone') ? 'wide' : ''}" id="${s.id}">
  <header class="sec-h"><span class="sec-n">${s.n}</span><h2>${s.t}</h2><p>${s.d}</p>${s.states.length > 1 ? `<ol class="sec-st">${s.states.map((x) => `<li>${x.t}</li>`).join('')}</ol>` : ''}</header>
  <div class="sec-b">${s.states.map((st, i) => `<div class="pair k-${st.kind}" id="${s.id}-${st.k}"><div class="pair-h"><span class="pid">${s.n}${String.fromCharCode(97 + i)}</span><h3>${st.t}</h3>${st.tall ? '<span class="tall-t">Full-length capture</span>' : ''}${st.kind === 'lap' ? '<span class="tall-t">1440 × 900</span>' : ''}</div><div class="frames">${TH.map((th) => frameOf(st, th)).join('')}</div><dl class="cap"><dt>Purpose</dt><dd>${st.p}</dd><dt>Interactions</dt><dd>${st.i}</dd></dl></div>`).join('')}</div>
</section>`).join('');
const pairCount = SECTIONS.reduce((a, s) => a + s.states.length, 0);

const NEW = [
  ['Watch mode', 'a 0.00 AUSD account sees real copies on the team-run demo follower, can run a demo or blocked trade, and is one tap from depositing. Slow and offline states replace the lone spinner.'],
  ['Proof on every copy', 'deviation in bps, blocks and ms from Proposed to copy, entry-filter bound, both transactions. New "Copy quality" section on /stats.'],
  ['Follow sheet', 'entry filter, SL/TP defaults, loss stops anyone can execute, budget per leader, and a labelled "What if I had followed" step.'],
  ['Several leaders, one deposit', 'Home with per-leader budget, margin, PnL and loss-stop status; Budgets screen; stopped-leader detail.'],
  ['Positions', 'onchain SL/TP levels, "keep my positions" vs "stop and close", shared read-only link with suggested levels the owner accepts by passkey.'],
  ['Share cards', '1200×630 and 1080×1080 with QR to the onchain proof; team-run and simulation labelled.'],
  ['Perpl analytics', 'protocol overview and any-account drill-down (laptop and phone).'],
  ['Laptop web app', 'Home, Leaders, Feed, Follow, Positions, Analytics and Stats at 1440×900.'],
  ['First-run fixes', 'alerts asked after the first follow; "Can\'t reach Mirror" vs "Can\'t reach Monad"; RPC checked directly; real latest copy on Welcome; real version, size and SHA-256 on Download.'],
];
const QS = [
  'Watch mode when the server is down: OK to read the demo account\'s copies straight from the Monad RPC (Run buttons disabled)?',
  'What-if range: use each follower\'s own measured slippage, or the protocol-wide median from /stats when they have no history?',
  'Account-wide loss stop: on by default at 20%, or off until the user sets it?',
  '"Executed by anyone": default on for every new follow? (Whoever executes a stop is paid nothing: no payment ever comes out of follower collateral.)',
  'Shared position links: do they expire, and can the owner revoke one? Proposed: revocable, closes with the position.',
  'Version mismatch today: the app reports 0.9.2, the download page 0.1.0-beta. Which one ships?',
  'Laptop web app: sign in with the same passkey on a laptop (passkey sync / QR from phone). Is the web app in scope for the beta?',
  'Perpl analytics: host at ' + DOMAIN + '/perpl inside Mirror, or as a separate site for the bounty?',
];

const extraCss = ['01-mobile.css', '02-laptop.css', '03-cards.css', '04-analytics.css'].map((f) => { try { return readFileSync(join(HERE, 'css', f), 'utf8'); } catch { return ''; } }).join('\n');
const css = readFileSync(join(HERE, 'styles.css'), 'utf8') + '\n' + extraCss;
const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Mirror Proposal Two</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Geist+Mono:wght@400;500;600&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
<style>${css}</style></head><body>
<div class="page">
<header class="top">
  <div class="top-brand">${brandMark(36)}<div><div class="eyebrow">Design proposal 2 · for approval before any screen code</div><h1>${BRAND}: new and changed screens</h1></div></div>
  <p class="lede">Builds on the approved proposal and today's app. ${pairCount} states, each drawn in light and dark: phones at 390 px, the laptop web app at 1440×900, share cards at their export size. Example data: a beta account with 24.00 AUSD split across three leaders.</p>
  <div class="top-grid">
    <div class="tg-c"><h3>What is new or changed</h3><ul>${NEW.map(([a, b]) => `<li><b>${a}:</b> ${b}</li>`).join('')}</ul></div>
    <div class="tg-c"><h3>Open questions for the owner</h3><ol class="qs">${QS.map((q) => `<li>${q}</li>`).join('')}</ol></div>
  </div>
  <nav class="toc" aria-label="Sections">${SECTIONS.map((s) => `<a href="#${s.id}"><span>${s.n}</span>${s.t}</a>`).join('')}</nav>
</header>
${sectionsHtml}
<footer class="foot">Example data throughout. Leader addresses, Perpl account ids other than the demo leader (#5416), protocol totals and transaction hashes are illustrative; QR codes are placeholder patterns. Real facts used: Monad blocks about 300 ms, finality about 550 ms after Proposed, 25 AUSD beta deposit cap, the eleven Perpl markets. ${BRAND} is a working name.</footer>
</div></body></html>`;
writeFileSync(join(HERE, 'index.html'), html);
console.log('ok', (html.length / 1024).toFixed(0) + 'KB', 'states', pairCount);
