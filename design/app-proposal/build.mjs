// Generator for the Mirror Android design proposal. Run: node build.mjs  -> index.html
// Every screen is written once (theme-agnostic markup) and rendered into a light and a dark frame.
import { writeFileSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = dirname(fileURLToPath(import.meta.url));

const BRAND = 'Mirror'; // single replaceable product-name token

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

// ---------- screens ----------
const S = {};

const welcomeBase = () => `${SB()}<main class="main wl">
  <div class="wl-top">${brandMark(32)}<b>${BRAND}</b><span class="pill-beta">Beta</span></div>
  <div class="wl-demo" aria-label="Example copy">
    <div class="wd-card"><div class="wd-row">${identicon(L.a.addr, 28)}<span class="addr">${L.a.addr}</span>${label('Smart Trader')}</div><div class="sm mu">Opened <b class="tx">BTC</b> ${side('Long')} <span class="n">2.10 BTC · 4x</span></div></div>
    <div class="wd-link"><span class="lat n">${I('feed', 14)}copied in 0.61 s</span></div>
    <div class="wd-card me"><div class="wd-row">${brandMark(28)}<b>Your copy</b><span class="st-ok n">${I('check', 14)}Finalized</span></div><div class="sm n">0.00010 BTC · 11.84 AUSD · 4x</div><div class="wd-rule xs">${I('shield', 14)}<span>Checked onchain: under your 5x and 12.00 AUSD limits</span></div></div>
  </div>
  <h1 class="wl-h">Copy top Perpl traders. Your limits, enforced onchain.</h1>
  <p class="wl-p">A smart contract checks every copied order against your rules. ${BRAND} can trade for you but can never withdraw.</p>
  <div class="grow"></div>
  <div class="stack8"><span class="btn pri">${I('fp', 20)}Create account</span><span class="btn txt">I already have an account</span></div>
  <p class="wl-foot xs mu">One passkey. No seed phrase, no extension.<br>Passkeys by Mera · Built on Monad · Trades on Perpl</p>
</main>${GEST}`;

S.welcome = () => `<div class="scr">${welcomeBase()}</div>`;

S.passkey = () => `<div class="scr">${welcomeBase()}<div class="ov"><div class="sys">
  <div class="handle"></div>
  <div class="sys-ic">${I('key', 22)}</div>
  <h2 class="sys-h">Create a passkey for ${BRAND}?</h2>
  <p class="sys-p">You'll sign in and approve trades with your fingerprint, face or screen lock.</p>
  <div class="sys-acct">${brandMark(36)}<div><b>${BRAND} account</b><div class="xs sys-mu">New passkey on this device</div></div></div>
  <div class="sys-save xs sys-mu">${I('lock', 14)}Saved to Google Password Manager</div>
  <div class="sys-fp"><span class="sys-fpc">${I('fp', 34)}</span><span class="sm">Touch the fingerprint sensor</span></div>
  <div class="sys-btns"><span class="sys-b">Cancel</span><span class="sys-b">Other ways</span><span class="sys-b pri">Create</span></div>
  ${GEST}</div></div></div>`;

S.restorePick = () => `<div class="scr">${welcomeBase()}<div class="ov"><div class="sys">
  <div class="handle"></div>
  <div class="sys-ic">${I('key', 22)}</div>
  <h2 class="sys-h">Use your saved passkey for ${BRAND}?</h2>
  <p class="sys-p">Choose the account to sign in to on this phone.</p>
  <div class="sys-list">
    <div class="sys-opt on"><span class="rad on"></span>${identicon(ME.full, 36)}<div class="grow"><b class="n">${ME.short}</b><div class="xs sys-mu">Created Sep 14 on Pixel 8</div></div></div>
  </div>
  <div class="sys-save xs sys-mu">${I('lock', 14)}From Google Password Manager</div>
  <div class="sys-btns"><span class="sys-b">Sign in another way</span><span class="sys-b pri">Continue</span></div>
  ${GEST}</div></div></div>`;

const step = (state, t, sub) => `<li class="ck ${state}"><span class="ck-i">${state === 'done' ? I('check', 16) : ''}</span><div><b>${t}</b><div class="xs mu">${sub}</div></div></li>`;
S.restoreFound = () => `<div class="scr">${SB()}<header class="ab"><span class="ib">${I('back')}</span></header><main class="main pad rs">
  <div class="rs-id">${identicon(ME.full, 64)}<h1 class="t-xl">Account found</h1><div class="addr lg">${ME.short}</div><div class="xs mu">Created Sep 14, 2026 · Monad</div></div>
  <ol class="cks">
    ${step('done', 'Passkey verified', 'Pixel 9 · fingerprint')}
    ${step('done', 'Account located onchain', `Smart account ${ME.short}`)}
    ${step('done', 'Follow rules loaded', '3 follows · policy contract 0x91c4…e6b0')}
    ${step('now', 'Restoring balances and positions', 'Reading Perpl and the Mirror vault')}
  </ol>
  <div class="prog"><i style="width:78%"></i></div>
  <p class="note sm">${I('info', 16)}<span>There is nothing to import. Your account lives on Monad, so your passkey is all you need on a new phone.</span></p>
  <div class="grow"></div>
  <span class="btn pri dis">Restoring…</span>
</main>${GEST}</div>`;

S.restored = () => `<div class="scr">${SB()}<main class="main pad rs">
  <div class="rs-ok">${I('check', 28)}</div>
  <h1 class="t-xl center">Welcome back</h1>
  <p class="center mu sm">Everything is where you left it. Your follows kept running onchain while you switched phones.</p>
  <div class="card eq">
    <div class="lbl">Equity</div><div class="big n">${ACCT.equity.toFixed(2)}<span class="u">AUSD</span></div>
    <div class="kv3"><div><span class="xs mu">AUSD balance</span><b class="n">${ACCT.balance.toFixed(2)}</b></div><div><span class="xs mu">Leaders followed</span><b class="n">3</b></div><div><span class="xs mu">Open positions</span><b class="n">4</b></div></div>
  </div>
  <div class="card list">${followRow('a', 8, 1.03)}${followRow('b', 6, 0.19)}${followRow('c', 4, 0.15)}</div>
  <div class="row-c"><span class="lat n">${I('feed', 14)}Last copy 4s ago</span><span class="xs mu">MON short closed, ${sgn(0.11)} AUSD</span></div>
  <p class="note sm">${I('phone', 16)}<span>Lost the old phone? Sign it out in Settings.</span></p>
  <div class="grow"></div>
  <span class="btn pri">Go to Home</span>
</main>${GEST}</div>`;

const followRow = (k, alloc, pnl, extra = '') => { const l = L[k]; return `<div class="lr">${identicon(l.addr, 40)}<div class="grow mn0"><div class="lr-t"><span class="addr">${l.addr}</span>${l.labels[0] ? label(l.labels[0]) : ''}</div><div class="xs mu n">${alloc.toFixed(2)} AUSD allocated${extra}</div></div><div class="right"><div class="n pos-i b6">${sgn(pnl)}</div><div class="xs mu n">${pct((pnl / alloc) * 100)}</div></div></div>`; };

S.home = () => `<div class="scr">${SB()}${AB('', { brand: true })}<main class="main">
  <section class="hero">
    <div class="lbl">Equity</div>
    <div class="big n">${ACCT.equity.toFixed(2)}<span class="u">AUSD</span></div>
    <div class="delta"><span class="n pos-i b6">${sgn(ACCT.today)} (${pct((ACCT.today / (ACCT.equity - ACCT.today)) * 100, 2)})</span><span class="mu sm">today</span></div>
    <div class="hero-ch">${chart({ data: homeSeries, w: 350, h: 84, padT: 8, padB: 6, padR: 6, yTicks: [[20.5, ''], [21.0, '']] })}<div class="ch-x xs mu n"><span>Sep 28</span><span>Oct 1</span><span>Today</span></div></div>
    <div class="kv3 hero-kv"><div><span class="xs mu">AUSD balance</span><b class="n">${ACCT.balance.toFixed(2)}</b></div><div><span class="xs mu">Unrealised</span><b class="n pos-i">${sgn(ACCT.upnl)}</b></div><div><span class="xs mu">Realised</span><b class="n pos-i">${sgn(ACCT.rpnl)}</b></div></div>
    <div class="acts"><span class="btn ton sm-b">${I('arrdown', 18)}Add funds</span><span class="btn out sm-b">${I('arrup', 18)}Withdraw</span></div>
  </section>
  <div class="beta xs">${I('shield', 14)}<span class="grow">Beta deposit limit</span><span class="n nw">20.00 / 25.00 AUSD</span></div>
  <section class="sec-l"><div class="sh"><h2>Following <span class="mu n">3</span></h2><span class="lnk sm">Manage</span></div>
    <div class="card list">${followRow('a', 8, 1.03)}${followRow('b', 6, 0.19)}${followRow('c', 4, 0.15, ' · max 5x')}</div></section>
  <section class="sec-l"><div class="sh"><h2>Recent copies</h2><span class="lnk sm">Feed</span></div>
    <div class="card list">${FEED.slice(0, 3).map((f) => { const l = L[f.L]; return `<div class="rc">${mk(f.mkt, 32)}<div class="grow mn0"><div class="sm"><b>${f.mkt}</b> ${side(f.side)} <span class="mu">${f.act}</span></div><div class="xs mu"><span class="n">${l.addr}</span> · ${f.ago} ago</div></div>${f.blocked ? `<span class="chip-s neg">${I('ban', 13)}Blocked</span>` : `<div class="right"><div class="xs n">${f.lat} s</div><div class="xs mu">${f.st}</div></div>`}</div>`; }).join('')}</div></section>
</main>${NAV('home')}</div>`;

S.receive = () => `<div class="scr">${SB()}${AB('Add funds', { back: true, noAv: true })}<main class="main pad">
  <div class="steps2"><span class="on"><i class="n">1</i>Receive AUSD</span><span><i class="n">2</i>Deposit to ${BRAND}</span></div>
  <div class="card qr-c">
    <div class="qr-w">${qr(29, 6)}</div>
    <div class="row-c gap6"><span class="chip-s">${coin}AUSD</span><span class="chip-s">${I('globe', 13)}Monad</span></div>
    <div class="lbl center">Your wallet address</div>
    <div class="addr-full n">${ME.full.slice(2).match(/.{1,4}/g).map((g, i) => (i === 0 ? '0x' : '') + g).join(' ')}</div>
    <div class="acts"><span class="btn ton sm-b">${I('copy', 18)}Copy address</span><span class="btn out sm-b">${I('share', 18)}Share</span></div>
  </div>
  <p class="note warnn sm">${I('warn', 16)}<span>Send only AUSD on Monad. Tokens sent on other networks won't arrive.</span></p>
  <div class="card row-c recv">${coin}<div class="grow"><b class="n">3.10 AUSD received</b><div class="xs mu">In your wallet · 2 min ago</div></div><span class="btn pri xs-b">Deposit</span></div>
</main>${GEST}</div>`;

S.deposit = () => `<div class="scr">${SB()}${AB('Add funds', { back: true, noAv: true })}<main class="main pad">
  <div class="steps2"><span class="done"><i>${I('check', 12)}</i>Receive AUSD</span><span class="on"><i class="n">2</i>Deposit to ${BRAND}</span></div>
  <div class="amt"><div class="lbl center">Amount</div><div class="amt-v n">3.10<span class="u">AUSD</span></div><div class="row-c gap6 jc"><span class="chip on">Max · wallet 3.10</span><span class="chip">Cap room 5.00</span></div></div>
  <div class="card flow">
    <div class="fl-r">${I('wallet', 20)}<div class="grow"><div class="sm">From your wallet</div><div class="xs mu n">${ME.short}</div></div><span class="n sm">3.10 → 0.00</span></div>
    <div class="fl-r">${brandMark(20)}<div class="grow"><div class="sm">To your ${BRAND} account</div><div class="xs mu">AUSD balance</div></div><span class="n sm">20.45 → 23.55</span></div>
  </div>
  <div class="card capc">
    <div class="row-c"><b class="sm">Beta deposit limit</b><span class="n sm right grow">23.10 / 25.00 AUSD</span></div>
    <div class="meter"><i style="width:80%"></i><i class="add" style="width:12.4%"></i></div>
    <div class="row-c xs mu"><span class="lg-dot ac"></span>Deposited 20.00<span class="lg-dot ac2"></span>This deposit 3.10</div>
    <p class="xs mu">The contracts are unaudited, so each account can hold at most 25 AUSD during beta.</p>
  </div>
  <div class="kvl">
    <div><span class="mu sm">Signature</span><span class="sm">One passkey permit</span></div>
    <div><span class="mu sm">Approval transaction</span><span class="sm">Not needed</span></div>
    <div><span class="mu sm">Network fee</span><span class="sm"><b class="pos-i">Free</b> · sponsored</span></div>
  </div>
  <div class="grow"></div>
  <span class="btn pri">${I('fp', 20)}Deposit with passkey</span>
</main>${GEST}</div>`;

const ldRow = (k, rank, s) => { const l = L[k]; return `<div class="ld">
  <span class="rk n">${rank}</span>${identicon(l.addr, 40)}
  <div class="grow mn0"><div class="addr">${l.addr}</div><div class="ld-lb">${l.labels.length ? label(l.labels[0]) : '<span class="xs mu">No label</span>'}</div></div>
  <div class="ld-r">${sparkSvg(l.r30, s)}<div class="right"><div class="n pos-i b6">${pct(l.r30)}</div><div class="xs mu">Score <b class="tx n">${l.score}</b></div></div></div>
  <div class="ld-m xs n"><span><i class="mu">Max DD</i> <b class="${l.dd > 15 ? 'neg' : ''}">${M}${l.dd.toFixed(1)}%</b></span><span><i class="mu">Win</i> ${l.win}%</span><span><i class="mu">Lev</i> ${l.lev.toFixed(1)}x</span><span class="mu mks">${l.mk.slice(0, 2).join(' ')}${l.mk.length > 2 ? ` +${l.mk.length - 2}` : ''}</span></div>
</div>`; };

S.leaders = () => `<div class="scr">${SB()}${AB('Leaders')}<main class="main">
  <div class="filt">
    <div class="seg"><span>7D</span><span class="on">30D</span><span>90D</span></div>
    <div class="chips"><span class="chip on">${I('check', 14)}Max DD ≤ 25%</span><span class="chip">Markets: All${I('down', 14)}</span><span class="chip">Nansen labeled</span><span class="chip">Sort: Score${I('down', 14)}</span></div>
  </div>
  <p class="xs mu ld-note">Ranked by Mirror score from onchain Perpl fills: PnL, drawdown, win rate and consistency. Labels by Nansen.</p>
  <div class="card list ldl">${['a', 'b', 'e', 'c', 'd', 'f'].map((k, i) => ldRow(k, i + 1, i)).join('')}</div>
</main>${NAV('leaders')}</div>`;

// Profile chart ticks
const profChart = () => {
  const lo = 85000, hi = 150000;
  return chart({ data: cSeries, w: 316, h: 176, padT: 18, padB: 18, padR: 32, min: lo, max: hi, yTicks: [[90000, '90k'], [110000, '110k'], [130000, '130k'], [150000, '150k']], xTicks: [[0, 'Sep 5', 'start'], [40, 'Sep 15'], [80, 'Sep 25'], [120, 'Oct 5', 'end']], band: { from: ddPeakI, to: ddTroughI, label: `Max DD ${M}${cDD.toFixed(1)}%` } });
};
seed = 5; const dailyTrades = Array.from({ length: 30 }, (_, i) => Math.max(2, Math.round(9.4 + (rnd() - 0.5) * 10 + (i > 10 && i < 16 ? 6 : 0))));
const cols = (arr) => { const w = 316, h = 64, n = arr.length, bw = 7, gap = (w - n * bw) / (n - 1), mx = 24; return `<svg class="chart" viewBox="0 0 ${w} ${h + 14}" role="img" aria-label="Trades per day, last 30 days"><line x1="0" x2="${w}" y1="${h}" y2="${h}" class="gl"/>${arr.map((v, i) => { const bh = (v / mx) * h; const x = i * (bw + gap); return `<path d="M${x} ${h}V${(h - bh + 3).toFixed(1)}q0-3 3-3h1q3 0 3 3V${h}z" fill="var(--ac)" fill-opacity="${i >= 11 && i <= 15 ? 1 : 0.55}"/>`; }).join('')}<text x="0" y="${h + 12}" class="ct">Sep 5</text><text x="${w}" y="${h + 12}" text-anchor="end" class="ct">Oct 5</text><text x="${11 * (bw + gap)}" y="${h + 12}" class="ct">Drawdown week: 15/day</text></svg>`; };
const bars = (rows) => rows.map(([k, v]) => `<div class="hb"><span class="hb-k sm">${k}</span><span class="hb-t"><i style="width:${v}%"></i></span><span class="n sm hb-v">${v}%</span></div>`).join('');
const flag = (kind, t, sub) => `<div class="flag ${kind}">${I(kind === 'ok' ? 'check' : kind === 'info' ? 'info' : 'warn', 18)}<div><b class="sm">${t}</b><div class="xs mu">${sub}</div></div></div>`;
const statC = (k, v, sub, cls = '') => `<div class="st"><span class="xs mu">${k}</span><b class="n ${cls}">${v}</b>${sub ? `<span class="xs mu">${sub}</span>` : ''}</div>`;

S.profile = () => `<div class="scr">${SB()}<header class="ab"><span class="ib">${I('back')}</span><h1 class="ab-t addr-t">${L.c.addr}<span class="ib s">${I('copy', 16)}</span></h1>${BAL()}</header><main class="main pad prof">
  <div class="pf-id">${identicon(L.c.addr, 56)}<div class="mn0"><div class="pf-lb">${labels(L.c.labels)}</div><div class="xs mu">On Perpl since Jul 2026 · 97 followers · Score <b class="tx n">81</b></div></div></div>
  <div class="card pf-perf">
    <div class="row-c"><div><div class="lbl">PnL · 30 days</div><div class="big2 n pos-i">${pct(cRet)}</div><div class="sm mu n">${sgn(cPnl, 0).replace(/(\d)(?=(\d{3})+$)/g, '$1,')} AUSD</div></div><div class="seg sm-seg grow-0"><span>7D</span><span class="on">30D</span><span>90D</span></div></div>
    <div class="pf-ch">${profChart()}</div>
    <div class="xs mu">Equity in AUSD. Shaded: max drawdown, ${ddFrom} to ${ddTo}.</div>
  </div>
  <h2 class="h2">Due diligence</h2>
  <div class="card dd">
    <div class="stg">
      ${statC('Max drawdown', `${M}${cDD.toFixed(1)}%`, `over ${ddDays} days`, 'neg')}
      ${statC('Win rate', '48%', '212 trades')}
      ${statC('Avg leverage', '9.6x', 'peak 20x', 'wrn-i')}
      ${statC('Trade frequency', '9.4/day', 'avg hold 3h 40m')}
      ${statC('Profit factor', '1.62', 'gross win / loss')}
      ${statC('Largest loss', `${M}6.8k`, 'AUSD, one trade')}
    </div>
    <div class="dd-sec"><div class="sm b6">Markets traded</div>${bars([['HYPE', 41], ['SOL', 27], ['MON', 18], ['BTC', 14]])}</div>
    <div class="dd-sec"><div class="sm b6">Trades per day</div>${cols(dailyTrades)}</div>
  </div>
  <h2 class="h2">Wallet intelligence <span class="xs mu b4">by Nansen</span></h2>
  <div class="card dd">
    <div class="nl-d"><div>${label('Smart Trader')}<span class="xs mu">Top PnL cohort across tracked perps venues</span></div><div>${label('Whale')}<span class="xs mu">Holds over $1M across linked wallets</span></div></div>
    <table class="tb"><thead><tr><th>Venue</th><th>Active since</th><th class="r">Realised PnL</th></tr></thead><tbody>
      <tr><td>Hyperliquid</td><td class="n">Mar 2024</td><td class="r n pos-i">+$212.4k</td></tr>
      <tr><td>dYdX</td><td class="n">Nov 2023</td><td class="r n pos-i">+$18.9k</td></tr>
      <tr><td>GMX</td><td class="n">Feb 2023</td><td class="r n neg">${M}$7.2k</td></tr>
      <tr><td>Perpl</td><td class="n">Jul 2026</td><td class="r n pos-i">+$61.0k</td></tr>
    </tbody></table>
  </div>
  <h2 class="h2">Risk flags <span class="chip-s wrn n">2</span></h2>
  <div class="card dd flags">
    ${flag('warn', 'High leverage', 'Averages 9.6x and reached 20x twice in 30 days. Your max leverage rule will block those trades.')}
    ${flag('warn', 'Deep drawdown', `Lost ${cDD.toFixed(1)}% from peak in ${ddDays} days (${ddFrom} to ${ddTo}).`)}
    ${flag('info', 'Concentrated', '41% of volume in HYPE.')}
    ${flag('ok', 'Established wallet', 'Active 2.6 years across 4 venues.')}
  </div>
  <p class="xs mu src">Sources: Perpl fills on Monad, Nansen. Updated 2 min ago. Past results don't predict future returns.</p>
</main><div class="sticky"><span class="btn out sq">${I('bell', 20)}</span><span class="btn pri grow">Follow ${L.c.addr}</span></div>${GEST}</div>`;

// Follow sheet (full height)
const fsSec = (t, sub, body, ico) => `<section class="fs"><div class="fs-h">${I(ico, 18)}<div class="grow"><b>${t}</b>${sub ? `<div class="xs mu">${sub}</div>` : ''}</div></div>${body}</section>`;
S.follow = () => `<div class="scr fullsheet"><div class="dimtop">${SB()}<header class="ab"><span class="ib">${I('back')}</span><h1 class="ab-t addr-t">${L.c.addr}</h1>${BAL()}</header></div>
<div class="sheet tall"><div class="handle"></div>
  <div class="sh-hd">${identicon(L.c.addr, 40)}<div class="grow"><div class="lbl">Follow</div><b class="addr">${L.c.addr}</b></div><span class="ib">${I('close')}</span></div>
  <div class="sh-steps xs"><span class="on">1 Set limits</span><span>2 Review</span></div>
  ${fsSec('Allocation', 'The most this follow can use. Available to allocate: 6.45 AUSD', `<div class="field big-f"><span class="n">4.00</span><span class="u">AUSD</span></div><div class="chips"><span class="chip">2</span><span class="chip on">4</span><span class="chip">5</span><span class="chip">Max 6.45</span></div>`, 'wallet')}
  ${fsSec('Sizing', 'How big each copied order is', `<div class="seg"><span>% of leader size</span><span class="on">Fixed fraction</span></div><div class="row-c"><span class="sm">Margin per copy</span><span class="n sm b6 right grow">25% of allocation · 1.00 AUSD</span></div>${slider(20 / 95, [['5%', 0], ['25%', 20 / 95], ['50%', 45 / 95], ['75%', 70 / 95], ['100%', 1]])}<p class="hint xs">Leader opens 2.0 HYPE at 4x. You open 1.00 AUSD margin at 4x: 4.00 AUSD notional, under your 6.00 per-market cap.</p>`, 'layers')}
  ${fsSec('Max leverage', 'Orders above this are blocked onchain', `<div class="row-c"><span class="n big-v">5x</span><span class="xs mu right grow">Leader avg 9.6x · peak 20x</span></div>${slider(4 / 19, [['1x', 0], ['5x', 4 / 19], ['10x', 9 / 19], ['15x', 14 / 19], ['20x', 1]])}<p class="hint wrnh xs">${I('warn', 14)}This leader often trades above 5x. Expect some trades to be blocked.</p>`, 'tune')}
  ${fsSec('Max notional per market', 'Largest position you can hold in any one market', `<div class="field"><span class="n">6.00</span><span class="u">AUSD</span><span class="xs mu right grow">per market</span></div>`, 'layers')}
  ${fsSec('Allowed markets', 'Copies in other markets are blocked. Dot = leader traded it in the last 30 days', `<div class="mkg">${MARKETS.map((m) => { const on = ['HYPE', 'SOL', 'MON', 'BTC', 'ETH'].includes(m); const lt = L.c.mk.includes(m); return `<span class="chip mkc ${on ? 'on' : ''}">${on ? I('check', 14) : ''}${m}${lt ? '<i class="dot"></i>' : ''}</span>`; }).join('')}</div>`, 'globe')}
  ${fsSec('Daily loss stop', 'Pause this follow for the day if losses reach', `<div class="row-c"><span class="n big-v">10%</span><span class="sm mu right grow n">= 0.40 AUSD of 4.00</span></div>${slider(0.2, [['0', 0], ['10%', 0.2], ['25%', 0.5], ['50%', 1]])}`, 'pause')}
  ${fsSec('High-water-mark stop', 'Close and stop if this follow falls this far below its peak', `<div class="row-c"><span class="n big-v">15%</span><span class="sm mu right grow n">peak 4.00 → stops at 3.40</span></div>${slider(0.3, [['0', 0], ['15%', 0.3], ['25%', 0.5], ['50%', 1]])}`, 'shield')}
  ${fsSec('Expiry', 'The follow ends and stops copying on this date', `<div class="chips"><span class="chip">7 days</span><span class="chip">30 days</span><span class="chip on">90 days</span><span class="chip">${I('cal', 14)}Custom</span></div><div class="field"><span class="sm">Ends Jan 3, 2027</span><span class="xs mu right grow">positions stay open</span></div>`, 'cal')}
  <div class="sh-cta"><span class="btn pri">Review follow</span></div>
${GEST}</div></div>`;

const rv = (k, v) => `<div><span class="mu sm">${k}</span><span class="sm n">${v}</span></div>`;
S.review = () => `<div class="clip">${S.profile()}</div><div class="ov"><div class="sheet">
  <div class="handle"></div>
  <div class="sh-hd"><span class="ib">${I('back')}</span><div class="grow"><div class="lbl">Review</div><b>Follow <span class="addr">${L.c.addr}</span></b></div></div>
  <div class="kvl rvl">
    ${rv('Allocation', '4.00 AUSD')}${rv('Sizing', 'Fixed 25% · 1.00 AUSD margin')}${rv('Max leverage', '5x')}${rv('Max notional per market', '6.00 AUSD')}${rv('Allowed markets', 'HYPE, SOL, MON, BTC, ETH')}${rv('Daily loss stop', '10% · 0.40 AUSD')}${rv('High-water-mark stop', '15% · at 3.40 AUSD')}${rv('Expiry', 'Jan 3, 2027')}
  </div>
  <div class="note acn sm">${I('shield', 18)}<span>These limits are written to the policy contract <span class="n">0x91c4…e6b0</span> and checked on every copied order. ${BRAND} can trade within them but can never withdraw.</span></div>
  <div class="row-c xs mu"><span>Network fee</span><span class="right grow"><b class="pos-i">Free</b> · sponsored, no MON needed</span></div>
  <span class="btn pri">${I('fp', 20)}Approve with passkey</span>
  ${GEST}</div></div>`;

S.feed = () => `<div class="scr">${SB()}${AB('Feed')}<main class="main">
  <div class="filt"><div class="chips"><span class="chip on">All</span><span class="chip">Copied</span><span class="chip">Blocked <span class="n">3</span></span><span class="chip">Closes</span></div><span class="live xs"><i></i>Live</span></div>
  <div class="feed">${FEED.map((f) => feedItem(f)).join('')}</div>
</main>${NAV('feed')}</div>`;

seed = 777;
const BLK = [
  FEED[2],
  { L: 'a', ago: '52m', mkt: 'PUMP', side: 'Long', act: 'Open', blocked: true, size: '41,000 PUMP', lev: '3x', px: '0.004812', rule: 'PUMP is not in your allowed markets', tx: tx() },
  { L: 'b', ago: '5h', mkt: 'ETH', side: 'Long', act: 'Open', blocked: true, size: '3.20 ETH', lev: '2x', px: '4,298.50', rule: 'Copy would be 7.20 AUSD. Max per market 6.00', tx: tx() },
];
S.blockedList = () => `<div class="scr">${SB()}${AB('Feed')}<main class="main"><div class="filt"><div class="chips"><span class="chip">All</span><span class="chip">Copied</span><span class="chip on">${I('check', 14)}Blocked <span class="n">3</span></span><span class="chip">Closes</span></div></div>
  <div class="feed">${BLK.map((f, i) => feedItem(f, { hl: i === 0 })).join('')}</div>
  <div class="card row-c sumc"><span class="sm grow">Blocked this week</span><span class="n sm b6">7</span><span class="xs mu">of 61 leader trades</span></div>
</main>${NAV('feed')}</div>`;
S.blocked = () => { const f = FEED[2]; return `<div class="scr">${SB()}${AB('Feed')}<main class="main"><div class="filt"><div class="chips"><span class="chip on">All</span><span class="chip">Copied</span><span class="chip">Blocked <span class="n">3</span></span><span class="chip">Closes</span></div></div><div class="feed">${feedItem(FEED[1])}${feedItem(f, { hl: true })}${feedItem(FEED[3])}</div></main>${NAV('feed')}
<div class="ov"><div class="sheet">
  <div class="handle"></div>
  <div class="bl-hd"><span class="bl-i">${I('ban', 22)}</span><div><div class="lbl neg">Not copied</div><h2 class="t-l">Blocked by your max leverage rule</h2></div></div>
  <p class="bl-p">Leader opened <b class="n">20x</b> BTC long. Your max leverage is <b class="n">5x</b>. Not copied.</p>
  <div class="card cmp">
    <div class="cmp-r"><span class="sm">Leader's order</span><span class="cmp-t"><i class="over" style="width:100%"></i><span class="cmp-cap" style="left:21%"></span></span><b class="n">20x</b></div>
    <div class="cmp-r"><span class="sm">Your limit</span><span class="cmp-t"><i style="width:21%"></i></span><b class="n">5x</b></div>
    
  </div>
  <div class="kvl">
    ${rv('Leader', `${L.c.addr}`)}${rv('Order', '1.50 BTC long @ 118,390.0')}${rv('Rejected by', 'Policy contract · block 18,204,331')}
  </div>
  <div class="rules"><span class="chip-s okc">${I('check', 13)}Market</span><span class="chip-s okc">${I('check', 13)}Notional</span><span class="chip-s okc">${I('check', 13)}Stops</span><span class="chip-s neg">${I('close', 13)}Leverage</span></div>
  <div class="row-c xs"><span class="mu">Your funds were not touched.</span><span class="txl n right grow">${f.tx.short}${I('ext', 13)}</span></div>
  <div class="acts"><span class="btn out">Done</span><span class="btn pri">${I('edit', 18)}Edit rule</span></div>
  ${GEST}</div></div></div>`; };

const POS = [
  { m: 'BTC', s: 'Long', size: '0.00010 BTC', ntl: 11.84, lev: '4x', entry: '117,880.0', mark: '118,420.5', liq: '90,610', pnl: 0.05, roe: 1.8, L: 'a' },
  { m: 'SOL', s: 'Long', size: '0.0467 SOL', ntl: 9.92, lev: '3x', entry: '198.10', mark: '212.44', liq: '135.20', pnl: 0.67, roe: 20.2, L: 'a' },
  { m: 'ETH', s: 'Short', size: '0.00139 ETH', ntl: 6.0, lev: '3x', entry: '4,350.00', mark: '4,312.80', liq: '5,720.00', pnl: 0.05, roe: 2.6, L: 'b' },
  { m: 'HYPE', s: 'Long', size: '0.1000 HYPE', ntl: 4.69, lev: '5x', entry: '45.42', mark: '46.92', liq: '36.80', pnl: 0.15, roe: 16.5, L: 'c' },
];
const posRow = (p) => `<div class="po"><div class="po-h">${mk(p.m, 36)}<div class="grow"><div><b>${p.m}</b> ${side(p.s)} <span class="mu sm n">${p.lev}</span></div><div class="xs mu n">${p.size} · ${p.ntl.toFixed(2)} AUSD</div></div><div class="right"><div class="n b6 ${p.pnl >= 0 ? 'pos-i' : 'neg'}">${sgn(p.pnl)}</div><div class="xs mu n">${pct(p.roe)} ROE</div></div></div>
  <div class="po-g xs n"><div><span class="mu">Entry</span>${p.entry}</div><div><span class="mu">Mark</span>${p.mark}</div><div><span class="mu">Liq.</span>${p.liq}</div><div><span class="mu">Leader</span>${L[p.L].addr.slice(0, 6)}</div></div></div>`;
const attr = [['a', 0.72, 0.31], ['b', 0.05, 0.14], ['c', 0.15, 0]];
S.positions = () => `<div class="scr">${SB()}${AB('Positions')}<main class="main">
  <section class="hero pos-sum">
    <div class="lbl">Total PnL</div><div class="big n pos-i">${sgn(ACCT.upnl + ACCT.rpnl)}<span class="u">AUSD</span></div>
    <div class="kv3"><div><span class="xs mu">Unrealised</span><b class="n pos-i">${sgn(ACCT.upnl)}</b></div><div><span class="xs mu">Realised</span><b class="n pos-i">${sgn(ACCT.rpnl)}</b></div><div><span class="xs mu">Margin in use</span><b class="n">${ACCT.margin.toFixed(2)}</b></div></div>
  </section>
  <section class="sec-l"><div class="sh"><h2>PnL by leader</h2><span class="xs mu">since follow</span></div>
    <div class="card attr">${attr.map(([k, u, r]) => { const t = u + r; return `<div class="at">${identicon(L[k].addr, 28)}<div class="grow mn0"><div class="row-c"><span class="addr sm">${L[k].addr}</span><b class="n pos-i sm right grow">${sgn(t)}</b></div><div class="at-b"><i class="u1" style="width:${(u / 1.03) * 100}%"></i><i class="r1" style="width:${(r / 1.03) * 100}%"></i></div><div class="xs mu n">Unrealised ${sgn(u)} · Realised ${sgn(r)}</div></div></div>`; }).join('')}
    <div class="row-c xs mu"><span class="lg-dot pos"></span>Unrealised<span class="lg-dot pos2"></span>Realised</div></div></section>
  <section class="sec-l"><div class="sh"><h2>Open positions <span class="mu n">4</span></h2><div class="seg sm-seg"><span class="on">Market</span><span>Leader</span></div></div>
    <div class="card list">${POS.map(posRow).join('')}</div></section>
</main>${NAV('positions')}</div>`;

const acctBase = (paused) => `${SB()}${AB('Account', { back: true, noAv: true })}<main class="main pad">
  <div class="card eq">
    <div class="row-c">${identicon(ME.full, 36)}<div class="grow"><b class="n">${ME.short}</b><div class="xs mu">Passkey account · Pixel 9</div></div><span class="ib s">${I('copy', 16)}</span></div>
    <div class="kv2"><div><span class="xs mu">Equity</span><b class="n">${ACCT.equity.toFixed(2)}</b></div><div><span class="xs mu">Withdrawable</span><b class="n">${ACCT.withdrawable.toFixed(2)}</b></div></div>
    <div class="acts"><span class="btn ton sm-b">${I('arrdown', 18)}Add funds</span><span class="btn out sm-b">${I('arrup', 18)}Withdraw</span></div>
  </div>
  <div class="card ctl">
    <div class="ctl-r"><div class="grow"><b>Pause all following</b><div class="xs mu">${paused ? 'Paused 9:41. New leader trades are not copied.' : 'Stop copying new trades. Open positions stay open.'}</div></div>${sw(paused)}</div>
    ${['a', 'b', 'c'].map((k) => `<div class="ctl-r sub">${identicon(L[k].addr, 28)}<span class="addr sm grow">${L[k].addr}</span><span class="xs mu">${paused ? 'Paused' : 'Copying'}</span>${sw(!paused)}</div>`).join('')}
  </div>
  <div class="card ctl"><div class="ctl-r"><div class="grow"><b class="neg">Close all positions</b><div class="xs mu n">4 open · unrealised ${sgn(ACCT.upnl)} AUSD</div></div><span class="btn dng-o xs-b">Close all</span></div></div>
  <div class="card list flat">${setRow('bell', 'Notifications', '')}${setRow('gear', 'Settings', '')}</div>
  <p class="note sm">${I('shield', 16)}<span>${BRAND} can trade within your rules but can never withdraw. Only your passkey can move funds out.</span></p>
</main>${GEST}`;
S.account = () => `<div class="scr">${acctBase(false)}</div>`;
S.closeAll = () => `<div class="scr">${acctBase(true)}<div class="ov ctr"><div class="dlg">
  <span class="dlg-i neg">${I('warn', 24)}</span>
  <h2 class="t-l center">Close all 4 positions?</h2>
  <div class="dlg-l">${POS.map((p) => `<div class="row-c sm">${mk(p.m, 24)}<b>${p.m}</b>${side(p.s)}<span class="n pos-i right grow">${sgn(p.pnl)}</span></div>`).join('')}</div>
  <p class="sm mu">Closes at market on Perpl and realises about <b class="tx n">${sgn(ACCT.upnl)} AUSD</b>. Following stays paused, so nothing reopens.</p>
  <div class="dlg-b"><span class="btn txt">Cancel</span><span class="btn dng">${I('fp', 18)}Close all</span></div>
</div></div></div>`;

const kp = `<div class="kp n">${['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', 'x'].map((k) => `<span>${k === 'x' ? I('bksp', 22) : k}</span>`).join('')}</div>`;
const wdBase = () => `${SB()}${AB('Withdraw', { back: true, noAv: true })}<main class="main pad">
  <div class="amt"><div class="lbl center">Amount</div><div class="amt-v n">5.00<span class="u">AUSD</span></div><div class="row-c gap6 jc"><span class="chip">25%</span><span class="chip">50%</span><span class="chip">Max ${ACCT.withdrawable.toFixed(2)}</span></div></div>
  <div class="card flow">
    <div class="fl-r">${brandMark(20)}<div class="grow"><div class="sm">From ${BRAND} account</div><div class="xs mu n">Withdrawable ${ACCT.withdrawable.toFixed(2)} AUSD</div></div></div>
    <div class="fl-r">${I('wallet', 20)}<div class="grow"><div class="sm">To your wallet</div><div class="xs mu n">${ME.short}</div></div><span class="xs mu">Only option</span></div>
  </div>
  <p class="xs mu">Withdrawable is your AUSD balance minus margin held by open positions (${ACCT.margin.toFixed(2)}).</p>
  <div class="grow"></div>
  ${kp}
  <span class="btn pri">Continue</span>
</main>${GEST}`;
S.withdraw = () => `<div class="scr">${wdBase()}</div>`;
S.wdConfirm = () => `<div class="scr">${wdBase()}<div class="ov"><div class="sheet">
  <div class="handle"></div>
  <div class="lbl center">Withdraw</div>
  <div class="amt-v n center">5.00<span class="u">AUSD</span></div>
  <div class="kvl">${rv('To', `Your wallet ${ME.short}`)}${rv('Network fee', '<b class="pos-i">0.00 MON</b> · sponsored')}${rv('You receive', '5.00 AUSD')}${rv('AUSD balance after', '15.45 AUSD')}</div>
  <div class="note acn sm">${I('fp', 18)}<span>Gasless: you sign with your passkey and ${BRAND} pays the network fee. You never need MON.</span></div>
  <span class="btn pri">${I('fp', 20)}Confirm with passkey</span>
  ${GEST}</div></div></div>`;
seed = 300; const wdTx = tx();
S.wdDone = () => `<div class="scr">${SB()}<header class="ab"><span class="ib">${I('close')}</span></header><main class="main pad rs">
  <div class="rs-ok">${I('check', 28)}</div>
  <h1 class="t-xl center"><span class="n">5.00</span> AUSD sent</h1>
  <p class="center mu sm">It's in your wallet <span class="n">${ME.short}</span> now.</p>
  <div class="card"><div class="kvl">${rv('Status', commit('Finalized'))}${rv('Confirmed in', '0.82 s')}${rv('Network fee', '0.00 MON · sponsored')}${rv('Transaction', `<span class="txl">${wdTx.short}${I('ext', 13)}</span>`)}</div></div>
  <div class="card row-c"><span class="sm">AUSD balance</span><span class="n right grow b6">15.45 AUSD</span></div>
  <div class="grow"></div>
  <span class="btn pri">Done</span>
</main>${GEST}</div>`;

const push = (title, body, time, ico = '') => `<div class="psh"><div class="psh-h xs">${brandMark(18)}<span>${BRAND}</span><span class="psh-dot">·</span><span>${time}</span></div><b class="sm">${title}</b><div class="sm psh-b">${body}</div></div>`;
S.push = () => `<div class="scr lock">${SB('on-wall')}<main class="main pad lk">
  <div class="lk-time n">9:41</div><div class="lk-date">Monday, October 5</div>
  <div class="psh-stack">
    ${push('Blocked by your rule', `${L.c.addr} opened 20x BTC long. Your max leverage is 5x. Not copied.`, '1m')}
    ${push('Copied HYPE long', `From ${L.c.addr} · 4.69 AUSD at 5x · copied in 0.61 s`, '38m')}
    ${push('Follow ends in 3 days', `Your follow of ${L.b.addr} expires Oct 8. Extend it or let it end.`, '2h')}
    ${push('Withdrawal complete', '5.00 AUSD is in your wallet. Fee paid by Mirror.', 'Sat')}
  </div>
  <div class="grow"></div>
  <div class="lk-fp">${I('fp', 30)}</div>
</main>${GEST}</div>`;

const nt = (ico, cls, t, b, time, unread) => `<div class="nt ${unread ? 'un' : ''}"><span class="nt-i ${cls}">${I(ico, 18)}</span><div class="grow mn0"><div class="row-c"><b class="sm">${t}</b><span class="xs mu right grow n">${time}</span></div><div class="sm mu">${b}</div></div></div>`;
S.notifs = () => `<div class="scr">${SB()}<header class="ab"><span class="ib">${I('back')}</span><h1 class="ab-t">Notifications</h1>${BAL()}</header><main class="main">
  <div class="filt"><div class="chips"><span class="chip on">All</span><span class="chip">Copies</span><span class="chip">Blocked</span><span class="chip">Account</span></div></div>
  <div class="nt-g lbl">Today</div>
  <div class="card list flat">
    ${nt('check', 'ac', 'Closed MON short', `${L.a.addr} · realised +0.11 AUSD`, '9:41', true)}
    ${nt('ban', 'ng', 'Blocked by your rule', `20x BTC long from ${L.c.addr}. Max is 5x.`, '9:40', true)}
    ${nt('feed', 'ac', 'Copied HYPE long', `${L.c.addr} · 4.69 AUSD · 0.61 s`, '9:03')}
    ${nt('cal', 'wr', 'Follow ends in 3 days', `${L.b.addr} expires Oct 8`, '7:12')}
  </div>
  <div class="nt-g lbl">Earlier</div>
  <div class="card list flat">
    ${nt('arrup', 'nu', 'Withdrawal complete', '5.00 AUSD to your wallet', 'Sat')}
    ${nt('arrdown', 'nu', 'Deposit received', '3.10 AUSD added to your account', 'Fri')}
    ${nt('pause', 'nu', 'Daily loss stop reached', `${L.c.addr} paused until 00:00 UTC, then resumed`, 'Thu')}
  </div>
  <p class="xs mu center pad-x">Push settings: copies, blocked trades, stops, account. Change in Settings.</p>
</main>${GEST}</div>`;

const setRow = (ico, t, sub, right = I('chev', 18)) => `<div class="sr">${I(ico, 20)}<div class="grow mn0"><div class="sm">${t}</div>${sub ? `<div class="xs mu">${sub}</div>` : ''}</div>${right}</div>`;
S.settings = () => `<div class="scr">${SB()}<header class="ab"><span class="ib">${I('back')}</span><h1 class="ab-t">Settings</h1>${BAL()}</header><main class="main pad set">
  <div class="lbl">Security</div>
  <div class="card list flat">
    ${setRow('fp', 'Passkey', 'Synced by Google Password Manager · created Sep 14')}
    ${setRow('phone', 'Pixel 8', 'Signed in · last active Oct 1', '<span class="lnk sm">Sign out</span>')}
    ${setRow('key', 'Linked trading key', `Can trade within your rules, can't withdraw · expires Jan 3, 2027`, '<span class="lnk sm">Revoke</span>')}
  </div>
  <div class="lbl">Appearance</div>
  <div class="card pad12"><div class="seg"><span class="on">${I('phone', 16)}System</span><span>${I('sun', 16)}Light</span><span>${I('moon', 16)}Dark</span></div></div>
  <div class="lbl">Network</div>
  <div class="card list flat">
    ${setRow('globe', 'Monad mainnet', 'RPC healthy · 42 ms · block 18,204,402', '<span class="live xs"><i></i>Online</span>')}
    ${setRow('bell', 'Notifications', 'Copies, blocked trades, stops, account')}
  </div>
  <div class="lbl">About</div>
  <div class="card list flat">
    ${setRow('doc', 'Policy contract', '<span class="n">0x91c4…e6b0</span>', I('ext', 16))}
    ${setRow('wallet', 'Vault contract', '<span class="n">0x3d07…a41f</span>', I('ext', 16))}
    ${setRow('warn', 'Unaudited beta', 'Deposits capped at 25 AUSD per account', '')}
    ${setRow('info', `${BRAND} 0.9.2 (beta)`, 'Balance in AUSD by Agora · Passkeys by Mera · Labels by Nansen', '')}
  </div>
</main>${GEST}</div>`;

// empty / error states
S.emptyHome = () => `<div class="scr">${SB()}${AB('', { brand: true, bal: 20.0 })}<main class="main">
  <section class="hero"><div class="lbl">Equity</div><div class="big n">20.00<span class="u">AUSD</span></div><div class="delta"><span class="mu sm">No PnL yet</span></div></section>
  <div class="empty card">
    <svg width="120" height="72" viewBox="0 0 120 72" aria-hidden="true"><path d="M8 56 L28 40 L42 46 L58 22" fill="none" stroke="var(--mu)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M62 22 L78 46 L92 40 L112 56" fill="none" stroke="var(--ac)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="4 5"/><line x1="60" y1="8" x2="60" y2="66" stroke="var(--bd)" stroke-width="1"/><circle cx="58" cy="22" r="4" fill="var(--mu)"/><circle cx="62" cy="22" r="4" fill="var(--ac)"/></svg>
    <h2 class="t-l center">You're not following anyone yet</h2>
    <p class="sm mu center">Pick a leader and set your limits. The contract checks every copy against them.</p>
    <span class="btn pri">Browse leaders</span>
  </div>
  <section class="sec-l"><div class="sh"><h2>Good places to start</h2><span class="xs mu">low drawdown</span></div>
    <div class="card list">${['e', 'b'].map((k) => { const l = L[k]; return `<div class="lr">${identicon(l.addr, 40)}<div class="grow mn0"><div class="lr-t"><span class="addr">${l.addr}</span>${l.labels[0] ? label(l.labels[0]) : ''}</div><div class="xs mu n">Max DD ${M}${l.dd}% · Lev ${l.lev}x</div></div><div class="right"><div class="n pos-i b6">${pct(l.r30)}</div><div class="xs mu">30d</div></div></div>`; }).join('')}</div></section>
</main>${NAV('home')}</div>`;

S.offline = () => `<div class="scr">${SB()}${AB('Feed')}<main class="main">
  <div class="banner">${I('wifioff', 20)}<div class="grow"><b class="sm">Can't reach Monad</b><div class="xs">Showing data from 9:38. Your follows keep running onchain and your limits still apply.</div></div><span class="btn ton xs-b">${I('refresh', 16)}Retry</span></div>
  <div class="feed stale">${FEED.slice(3).map((f) => feedItem(f)).join('')}</div>
</main>${NAV('feed')}</div>`;

S.pending = () => `<div class="scr">${SB()}<header class="ab"><span class="ib">${I('close')}</span></header><main class="main pad rs">
  <div class="rs-ok wait">${I('hourglass', 28)}</div>
  <h1 class="t-xl center">Withdrawal pending</h1>
  <p class="center mu sm">5.00 AUSD is on its way to <span class="n">${ME.short}</span>. This usually takes under a second. It's taking longer than usual.</p>
  <div class="card">
    <ol class="cks tight">
      ${step('done', 'Proposed', 'Included in block 18,204,519 · 9:41:02')}
      ${step('done', 'Voted', 'Validators voted · 9:41:03')}
      ${step('now', 'Finalized', 'Waiting for finality')}
    </ol>
  </div>
  <p class="note sm">${I('info', 16)}<span>You can leave this screen. We'll notify you when it's final. Funds stay in your account until then.</span></p>
  <div class="grow"></div>
  <span class="btn out">${I('ext', 18)}View on MonadVision</span>
  <span class="btn txt">Back to Home</span>
</main>${GEST}</div>`;

// ---------- page sections ----------
const SECTIONS = [
  { id: 'welcome', n: '01', t: 'Welcome and create account', d: 'One screen, one decision. The example copy card shows the product before any explanation does.', states: [
    { k: 'welcome', t: 'Welcome', p: 'First launch. Says what the app does and the custody promise in two lines.', i: 'Create account starts passkey creation. I already have an account opens restore. No email, seed phrase or wallet extension.' },
    { k: 'passkey', t: 'Android passkey sheet', p: 'The system Credential Manager sheet, styled as Android draws it, not in our colours, so it reads as the OS.', i: 'Create saves the passkey and asks for a fingerprint. Cancel returns to Welcome with nothing created. The account is ready when the sheet closes.' },
  ] },
  { id: 'restore', n: '02', t: 'Restore on a new phone', d: 'The account lives on Monad. The passkey syncs through Google Password Manager. Nothing to import.', states: [
    { k: 'restorePick', t: 'Passkey picker', p: 'The system lists the synced passkey for this app.', i: 'Continue triggers the fingerprint prompt. Sign in another way shows a QR code for a passkey kept on another device.' },
    { k: 'restoreFound', t: 'Account found', p: 'Shows each restore step and its result, so the wait is explained.', i: 'Read-only progress. Back cancels. Steps cover passkey, smart account, follow rules, then balances.' },
    { k: 'restored', t: 'Balances restored', p: 'Confirms equity, follows and positions, and that copying never stopped.', i: 'Go to Home. The old-device note links to the device list in Settings.' },
  ] },
  { id: 'home', n: '03', t: 'Home', d: 'Equity is the hero number. The AUSD balance chip sits top right on every main screen.', states: [
    { k: 'home', t: 'Home', p: 'Answers how am I doing and is it working: equity, today\'s PnL, active follows, latest copies.', i: 'Balance chip opens the account breakdown. Add funds and Withdraw open their flows. Rows open the leader or the feed item. Avatar opens Account controls.' },
  ] },
  { id: 'funds', n: '04', t: 'Add funds', d: 'Two steps: receive AUSD on Monad, then deposit into the account with one signed permit.', states: [
    { k: 'receive', t: 'Receive AUSD', p: 'Address and QR for receiving AUSD from an exchange or another wallet.', i: 'Copy and Share the address. The address is grouped in fours so it can be checked by eye. Deposit appears once AUSD arrives.' },
    { k: 'deposit', t: 'Deposit with permit', p: 'Moves AUSD from the wallet into the trading account, inside the beta cap.', i: 'Max fills the lesser of wallet balance and cap room. The cap meter shows what this deposit uses. One passkey signature, no approval transaction, no gas.' },
  ] },
  { id: 'leaders', n: '05', t: 'Leaderboard', d: 'Ranked by a risk-adjusted score, not raw PnL, so the top of the list is the safest good trader.', states: [
    { k: 'leaders', t: 'Leaderboard', p: 'Find traders worth following. Each row shows return, drawdown, win rate, leverage, score, markets and Nansen labels.', i: 'Period toggle 7D/30D/90D. Filter chips for max drawdown, markets and labeled wallets. Sort menu. Tapping a row opens the profile.' },
  ] },
  { id: 'profile', n: '06', t: 'Leader profile', d: 'Full-length capture. A due-diligence page that states the risks as plainly as the returns.', states: [
    { k: 'profile', t: 'Profile and due diligence', p: 'Decide whether to follow. Shows the equity curve with the drawdown marked, key stats, markets, trade frequency, Nansen labels, cross-venue history and risk flags.', i: 'Period toggle. Copy address. Bell sets alerts without following. Follow opens the follow sheet with limits pre-set from this leader\'s risk.' },
  ] },
  { id: 'follow', n: '07', t: 'Follow sheet', d: 'Every policy control in one sheet, each with plain consequences shown next to the number.', states: [
    { k: 'follow', t: 'Set limits (full length)', p: 'All eight controls: allocation, sizing, max leverage, max notional per market, allowed markets, daily loss stop, high-water-mark stop, expiry.', i: 'Steppers, sliders and chips. Each control previews its effect in AUSD. A warning appears when the leader regularly exceeds a limit. Review follow goes to step 2.' },
    { k: 'review', t: 'Review and approve', p: 'A last read of the exact rules the contract will enforce.', i: 'Back edits. Approve with passkey signs once. Gas is sponsored. The follow is live on the next leader trade.' },
  ] },
  { id: 'feed', n: '08', t: 'Live copy feed', d: 'Proof that it works, one order at a time: latency, commit state and a transaction link on every copy.', states: [
    { k: 'feed', t: 'Live feed', p: 'Every leader trade and what happened to your copy.', i: 'Filter by copied, blocked or closes. The three-dot track shows Proposed, Voted, Finalized. The hash opens monadvision.com/tx. A blocked item opens its detail sheet.' },
  ] },
  { id: 'blocked', n: '09', t: 'Blocked by your rule', d: 'A blocked copy is the product working as intended. It gets a clear explanation, not an error.', states: [
    { k: 'blockedList', t: 'Blocked items in the feed', p: 'The Blocked filter of the feed. Each item names the rule in one line: leverage, market, notional.', i: 'Tap Details to open the explanation sheet. The transaction link shows the onchain rejection.', tall: false },
    { k: 'blocked', t: 'Detail sheet', p: 'Explains which rule blocked the copy, with both numbers, every rule that was checked, and the onchain rejection.', i: 'Edit rule opens the follow sheet at Max leverage. Done closes. Your funds were not touched.' },
  ] },
  { id: 'positions', n: '10', t: 'Positions and PnL', d: 'Every position traces back to the leader who opened it.', states: [
    { k: 'positions', t: 'Positions', p: 'Total, unrealised and realised PnL, attribution per leader, open positions with entry, mark and liquidation price.', i: 'Group by market or leader. Tap a position for its fills and the leader trade it copied. Close-all lives in Account controls.' },
  ] },
  { id: 'account', n: '11', t: 'Account controls', d: 'The user is always in charge: pause, close everything, withdraw. Withdrawals are gasless.', states: [
    { k: 'account', t: 'Controls', p: 'One place for the emergency levers and per-follow pauses.', i: 'Pause all, or pause one follow. Close all opens a confirmation. Withdraw opens the amount screen.' },
    { k: 'closeAll', t: 'Close all confirmation', p: 'Following is already paused. The dialog lists what will close and the estimated result.', i: 'Close all asks for the passkey and closes at market. Cancel leaves everything as is.' },
    { k: 'withdraw', t: 'Withdraw amount', p: 'Withdraws to the user\'s own wallet, the only destination allowed.', i: 'Keypad entry, 25%, 50% and Max chips. Withdrawable excludes margin held by open positions.' },
    { k: 'wdConfirm', t: 'Gasless confirmation', p: 'Shows the fee as 0.00 MON and why.', i: 'Confirm with passkey signs. The app sponsors gas.' },
    { k: 'wdDone', t: 'Withdrawal sent', p: 'Confirms the amount, finality and the new balance.', i: 'Transaction link. Done returns to Account.' },
  ] },
  { id: 'notify', n: '12', t: 'Notifications and Settings', d: 'Push carries the same facts as the feed: what was copied, what was blocked, what stopped.', states: [
    { k: 'push', t: 'Android push', p: 'Lock-screen notifications for copies, blocks, stops and withdrawals.', i: 'Tap opens the matching feed item or sheet. Notifications are grouped under the app.' },
    { k: 'notifs', t: 'In-app notifications', p: 'History of everything the app told you, by day.', i: 'Filter by type. Unread items are marked with a dot. Tap to open.' },
    { k: 'settings', t: 'Settings', p: 'Passkeys, the linked trading key, theme, network and the contracts behind the app.', i: 'Sign out an old phone. Revoke the trading key, which stops all copying. Theme: System, Light or Dark. Contract links open MonadVision.' },
  ] },
  { id: 'states', n: '13', t: 'Empty and error states', d: 'Each one says what is happening and what to do next.', states: [
    { k: 'emptyHome', t: 'No follows yet', p: 'Funded but idle. Points to the next step.', i: 'Browse leaders opens the leaderboard. Two low-drawdown suggestions open profiles.' },
    { k: 'offline', t: 'Network error', p: 'The app can\'t reach Monad. The banner says that copying continues onchain.', i: 'Retry. The cached feed is dimmed and timestamped.' },
    { k: 'pending', t: 'Withdrawal pending', p: 'Finality is slower than usual. Shows how far the transaction got.', i: 'Leave safely, a push follows. View on MonadVision.' },
  ] },
];

const TALL = ['home', 'leaders', 'profile', 'follow', 'feed', 'positions', 'settings'];
const frame = (theme, key) => `<figure class="dev"><figcaption class="dev-l">${theme === 'light' ? 'Light' : 'Dark'}</figcaption><div class="phone t-${theme}">${S[key]()}</div></figure>`;
let idx = 0;
const sectionsHtml = SECTIONS.map((s) => `<section class="sec" id="${s.id}">
  <header class="sec-h"><span class="sec-n">${s.n}</span><h2>${s.t}</h2><p>${s.d}</p>${s.states.length > 1 ? `<ol class="sec-st">${s.states.map((x) => `<li>${x.t}</li>`).join('')}</ol>` : ''}</header>
  <div class="sec-b">${s.states.map((st, i) => `<div class="pair"><div class="pair-h"><span class="pid">${s.n}${s.states.length > 1 ? String.fromCharCode(97 + i) : ''}</span><h3>${st.t}</h3>${TALL.includes(st.k) ? '<span class="tall-t">Full-length capture</span>' : ''}</div><div class="frames">${frame('light', st.k)}${frame('dark', st.k)}</div><dl class="cap"><dt>Purpose</dt><dd>${st.p}</dd><dt>Interactions</dt><dd>${st.i}</dd></dl></div>`).join('')}</div>
</section>`).join('');
const pairCount = SECTIONS.reduce((a, s) => a + s.states.length, 0);

const css = readFileSync(join(HERE, 'styles.css'), 'utf8');
const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Mirror Android Screens</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Geist+Mono:wght@400;500;600&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
<style>${css}</style></head><body>
<div class="page">
<header class="top">
  <div class="top-brand"><span class="t-light-inline">${brandMark(36)}</span><div><div class="eyebrow">Design proposal · Android · v1</div><h1>${BRAND} app screens</h1></div></div>
  <p class="lede">Copy the best traders on Perpl from an Android phone, with limits a smart contract enforces on every copied order. Below: ${SECTIONS.length - 1} screens plus 3 empty and error states, ${pairCount} states in all, each drawn in light and dark at 390 px.</p>
  <div class="top-grid">
    <div class="tg-c"><h3>Principles</h3><ul>
      <li>Numbers lead. Mono, tabular figures for every amount, address and hash.</li>
      <li>Green and red mean PnL, side or state. Never decoration.</li>
      <li>AUSD balance is visible top right on every main screen.</li>
      <li>No motion anywhere in the app. State changes are drawn, not animated.</li>
      <li>Android patterns: bottom navigation, bottom sheets, system back, system passkey sheets.</li>
    </ul></div>
    <div class="tg-c"><h3>Tokens</h3>
      <div class="sw-row"><span class="sw-l">Light</span>${['#F6F6F3', '#FFFFFF', '#EFEFEA', '#0E0F12', '#5B606B', '#E3E3DE', '#4B3BFF', '#ECEAFF', '#11914B', '#D93A40', '#B7791F'].map((c) => `<i style="background:${c}" title="${c}"></i>`).join('')}</div>
      <div class="sw-row"><span class="sw-l">Dark</span>${['#0A0B0E', '#14161B', '#1B1E24', '#F2F3F5', '#9097A3', '#262A31', '#8B7DFF', '#221F3D', '#3DD68C', '#FF6369', '#FFB224'].map((c) => `<i style="background:${c}" title="${c}"></i>`).join('')}</div>
      <p class="xs-p">bg · surface · surface-2 · text · muted · border · accent · accent-soft · positive · negative · warning. Inter for UI, Geist Mono for numbers.</p>
    </div>
  </div>
  <nav class="toc" aria-label="Screens">${SECTIONS.map((s) => `<a href="#${s.id}"><span>${s.n}</span>${s.t}</a>`).join('')}</nav>
</header>
${sectionsHtml}
<footer class="foot">Example data throughout: a beta account with 21.37 AUSD equity following three leaders. Leader addresses, labels and transaction hashes are illustrative. The QR code is a placeholder pattern. ${BRAND} is a working name.</footer>
</div></body></html>`;
writeFileSync(join(HERE, 'index.html'), html);
console.log('ok', (html.length / 1024).toFixed(0) + 'KB', 'pairs', pairCount, 'cRet', cRet.toFixed(2), 'cDD', cDD.toFixed(2), 'peak', ddPeakI, 'trough', ddTroughI, 'pnl', cPnl.toFixed(0));
