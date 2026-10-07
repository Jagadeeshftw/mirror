/**
 * CardModel → JSX for next/og (Satori). Layout follows design/proposal-2 (css/03-cards.css, build.mjs CARDS.*):
 * og = 1200x630 with the proof column on the right, sq = 1080x1080 stacked. Satori needs display:flex on every
 * element with more than one child, so text with bold numbers is laid out word by word.
 */
import type { ReactNode } from "react";
import { qrPath } from "./qr";
import type { CardFormat, CardModel, CardTheme, Seg, Stat, Tone } from "./types";

const TOKENS = {
  light: { bg: "#F6F6F3", sf: "#FFFFFF", sf2: "#EFEFEA", tx: "#0E0F12", mu: "#5B606B", bd: "#E3E3DE", ac: "#4B3BFF", acs: "#ECEAFF", pos: "#0F7F43", posS: "#E4F3EA", neg: "#D93A40", negS: "#FBE8E8", wrn: "#B7791F", wrnI: "#8C5B14", wrnS: "#F8EEDC" },
  dark: { bg: "#0A0B0E", sf: "#14161B", sf2: "#1B1E24", tx: "#F2F3F5", mu: "#9097A3", bd: "#262A31", ac: "#8B7DFF", acs: "#221F3D", pos: "#3DD68C", posS: "#11261B", neg: "#FF6369", negS: "#2E1517", wrn: "#FFB224", wrnI: "#FFB224", wrnS: "#2B2110" },
};
type Tk = (typeof TOKENS)["light"];
const MONO = "Mono";
const toneColor = (t: Tk, tone: Tone | undefined) => (tone === "pos" ? t.pos : tone === "neg" ? t.neg : tone === "mu" ? t.mu : t.tx);

const ICON = {
  users: '<circle cx="9" cy="8.5" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 5.2a3.5 3.5 0 0 1 0 6.6M18 14.2a6.5 6.5 0 0 1 3.5 5.8"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.2M12 7.8v.1"/>',
  ban: '<circle cx="12" cy="12" r="8.5"/><path d="M6 6l12 12"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
};
function Icon({ name, size, color }: { name: keyof typeof ICON; size: number; color: string }) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${ICON[name]}</svg>`;
  // eslint-disable-next-line @next/next/no-img-element
  return <img alt="" width={size} height={size} src={`data:image/svg+xml;utf8,${encodeURIComponent(svg)}`} />;
}

function Brand({ t, size = 40 }: { t: Tk; size?: number }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
      <svg width={size} height={size} viewBox="0 0 32 32">
        <rect width="32" height="32" rx="9" fill="#4B3BFF" />
        <path d="M15 7.5 6.5 24.5H15z" fill="#FFFFFF" />
        <path d="M17 7.5l8.5 17H17z" fill="#FFFFFF" fillOpacity={0.45} />
      </svg>
      <div style={{ fontSize: 26, fontWeight: 600, color: t.tx }}>Mirror</div>
    </div>
  );
}

function hash32(s: string) {
  let h = 2166136261;
  for (const ch of s.toLowerCase()) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
/** Same identicon as the app (app/src/ui/kit.tsx). */
function Identicon({ seed, size, t }: { seed: string; size: number; t: Tk }) {
  const h = hash32(seed || "0x");
  const rects: ReactNode[] = [];
  for (let r = 0; r < 5; r++)
    for (let c = 0; c < 3; c++)
      if ((h >> (r * 3 + c)) & 1) {
        rects.push(<rect key={`${r}-${c}`} x={c} y={r} width={1.02} height={1.02} fill={t.ac} />);
        if (c < 2) rects.push(<rect key={`${r}-${c}m`} x={4 - c} y={r} width={1.02} height={1.02} fill={t.ac} />);
      }
  return (
    <div style={{ display: "flex", width: size, height: size, borderRadius: size * 0.3, background: t.acs, alignItems: "center", justifyContent: "center" }}>
      <svg viewBox="-1 -1 7 7" width={size * 0.72} height={size * 0.72}>{rects}</svg>
    </div>
  );
}

function Badge({ kind, label, t }: { kind: "team" | "sim"; label: string; t: Tk }) {
  const team = kind === "team";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 14px", borderRadius: 999, fontSize: 18, fontWeight: 600, color: t.wrnI, background: team ? t.wrnS : "transparent", border: team ? "1px solid transparent" : `1.5px dashed ${t.wrn}` }}>
      <Icon name={team ? "users" : "info"} size={18} color={t.wrnI} />
      {label}
    </div>
  );
}

/** Words wrap as flex items; a word may mix bold and plain parts ("203.45;") so punctuation stays attached. */
function Words({ segs, size, t }: { segs: Seg[]; size: number; t: Tk }) {
  const words: Seg[][] = [[]];
  for (const s of segs)
    for (const tok of s.t.split(/(\s+)/)) {
      if (!tok) continue;
      if (/^\s+$/.test(tok)) words.push([]);
      else words[words.length - 1].push({ t: tok, b: s.b });
    }
  return (
    <div style={{ display: "flex", flexWrap: "wrap", columnGap: size * 0.26, rowGap: size * 0.12, fontSize: size, lineHeight: 1.2, color: t.tx }}>
      {words.filter((w) => w.length).map((w, i) => (
        <div key={i} style={{ display: "flex" }}>
          {w.map((p, j) => (
            <span key={j} style={p.b ? { fontFamily: MONO, fontWeight: 500 } : {}}>{p.t}</span>
          ))}
        </div>
      ))}
    </div>
  );
}

function Chart({ m, w, h, t }: { m: NonNullable<CardModel["chart"]>; w: number; h: number; t: Tk }) {
  const vals = m.baseline !== undefined ? [...m.points, m.baseline] : m.points;
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  const span = hi - lo || Math.abs(hi) || 1;
  const pad = 8;
  const x = (i: number) => (i / (m.points.length - 1)) * (w - pad * 2) + pad;
  const y = (v: number) => pad + (1 - (v - lo) / span) * (h - pad * 2);
  const line = m.points.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join("");
  const color = m.tone === "tx" ? t.ac : toneColor(t, m.tone);
  const last = m.points.length - 1;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
        {m.baseline !== undefined ? <path d={`M${pad} ${y(m.baseline)}H${w - pad}`} stroke={t.bd} strokeWidth={2} strokeDasharray="6 6" /> : null}
        <path d={`${line}L${x(last)} ${h}L${x(0)} ${h}Z`} fill={color} fillOpacity={0.12} />
        <path d={line} fill="none" stroke={color} strokeWidth={3} strokeLinejoin="round" />
        <circle cx={x(last)} cy={y(m.points[last])} r={5} fill={color} />
      </svg>
      {m.from || m.to ? (
        <div style={{ display: "flex", justifyContent: "space-between", fontFamily: MONO, fontSize: 15, color: t.mu, width: w }}>
          <span>{m.from ?? ""}</span>
          <span>{m.to ?? ""}</span>
        </div>
      ) : null}
    </div>
  );
}

function Stats({ stats, t, size = 28 }: { stats: Stat[]; t: Tk; size?: number }) {
  return (
    <div style={{ display: "flex", gap: 16, width: "100%" }}>
      {stats.map((s) => (
        <div key={s.k} style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 16, color: t.mu }}>{s.k}</div>
          <div style={{ fontFamily: MONO, fontSize: s.v.length > 12 ? size * 0.72 : size, fontWeight: 500, color: toneColor(t, s.tone) }}>{s.v}</div>
        </div>
      ))}
    </div>
  );
}

function Proof({ m, t, row }: { m: CardModel; t: Tk; row: boolean }) {
  const q = qrPath(m.proof.url);
  const px = 145;
  return (
    <div style={{ display: "flex", flexDirection: row ? "row" : "column", alignItems: row ? "center" : "flex-start", gap: 20 }}>
      <div style={{ display: "flex", background: "#FFFFFF", padding: 8, borderRadius: 14, border: `1px solid ${t.bd}` }}>
        <svg width={px} height={px} viewBox={`-2 -2 ${q.size + 4} ${q.size + 4}`} shapeRendering="crispEdges">
          <rect x={-2} y={-2} width={q.size + 4} height={q.size + 4} fill="#FFFFFF" />
          <path d={q.d} fill="#0E0F12" />
        </svg>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4, maxWidth: row ? 640 : 260 }}>
        <div style={{ fontSize: 18, fontWeight: 500, color: t.mu }}>Onchain proof</div>
        <div style={{ fontFamily: MONO, fontSize: 20, fontWeight: 500, color: t.ac, wordBreak: "break-all" }}>{m.proof.display}</div>
        <div style={{ fontSize: 16, color: t.mu }}>{m.proof.caption}</div>
      </div>
    </div>
  );
}

function Fine({ m, t }: { m: CardModel; t: Tk }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 15, color: t.mu }}>
      {m.fine.map((f) => (
        <div key={f}>{f}</div>
      ))}
    </div>
  );
}

function Top({ m, t, og }: { m: CardModel; t: Tk; og: boolean }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
      <Brand t={t} />
      {og || (!m.teamRun && !m.simulation) ? <div style={{ fontSize: 18, fontWeight: 500, color: t.mu, marginLeft: og ? 0 : "auto" }}>{m.tag}</div> : null}
      {m.simulation || m.teamRun ? (
        <div style={{ display: "flex", gap: 10, marginLeft: "auto" }}>
          {m.simulation ? <Badge kind="sim" label={m.simulation} t={t} /> : null}
          {m.teamRun ? <Badge kind="team" label={og ? "Team-run" : m.teamRun} t={t} /> : null}
        </div>
      ) : null}
    </div>
  );
}

/** Everything except the proof and fine print, stacked. */
function Body({ m, t, og, w }: { m: CardModel; t: Tk; og: boolean; w: number }) {
  const bigSize = m.big && m.big.text.length > 9 ? (og ? 76 : 72) : og ? 96 : 80;
  if (!m.ok)
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 18, marginTop: og ? 24 : 80 }}>
        <div style={{ fontSize: og ? 56 : 64, fontWeight: 600, color: t.tx, letterSpacing: -1.5 }}>Not available</div>
        <div style={{ fontSize: og ? 26 : 30, color: t.mu, maxWidth: w }}>{m.message}</div>
      </div>
    );
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: og ? 16 : 26 }}>
      {m.blocked ? (
        <div style={{ display: "flex", alignItems: "center", gap: 22 }}>
          <div style={{ display: "flex", width: og ? 72 : 96, height: og ? 72 : 96, borderRadius: og ? 22 : 28, background: t.negS, alignItems: "center", justifyContent: "center" }}>
            <Icon name="ban" size={og ? 34 : 44} color={t.neg} />
          </div>
          <div style={{ fontSize: og ? 42 : 56, fontWeight: 600, letterSpacing: -1.2, color: t.tx }}>{m.blocked.title}</div>
        </div>
      ) : null}
      {m.blocked ? <Words segs={m.blocked.sentence} size={og ? 26 : 34} t={t} /> : null}
      {m.blocked && m.blocked.cmp.length ? (
        <div style={{ display: "flex", gap: 16, padding: og ? 18 : 24, borderRadius: 20, background: t.sf, border: `1px solid ${t.bd}` }}>
          {m.blocked.cmp.map((s) => (
            <div key={s.k} style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1 }}>
              <div style={{ fontSize: 18, fontWeight: 500, color: t.mu }}>{s.k}</div>
              <div style={{ fontFamily: MONO, fontSize: og ? 28 : 34, fontWeight: 500, color: t.tx }}>{s.v}</div>
            </div>
          ))}
        </div>
      ) : null}
      {m.who && !m.blocked ? (
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <Identicon seed={m.who.seed} size={64} t={t} />
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ fontFamily: MONO, fontSize: 30, fontWeight: 500, color: t.tx }}>{m.who.addr}</div>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              {m.who.label ? <div style={{ fontSize: 17, padding: "3px 12px", borderRadius: 999, border: `1px solid ${t.bd}`, color: t.tx }}>{m.who.label}</div> : null}
              {m.who.sub ? <div style={{ fontSize: 16, color: t.mu }}>{m.who.sub}</div> : null}
            </div>
          </div>
        </div>
      ) : null}
      {m.kicker ? <div style={{ fontSize: 18, fontWeight: 500, color: t.mu }}>{m.kicker}</div> : null}
      {m.big ? (
        <div style={{ display: "flex", alignItems: "baseline", gap: 24 }}>
          <div style={{ fontFamily: MONO, fontSize: bigSize, fontWeight: 500, letterSpacing: -bigSize * 0.04, lineHeight: 1, color: toneColor(t, m.big.tone) }}>{m.big.text}</div>
          {m.big.unit ? <div style={{ fontSize: 30, color: t.mu }}>{m.big.unit}</div> : null}
        </div>
      ) : null}
      {m.sub ? <div style={{ fontFamily: MONO, fontSize: 22, color: t.mu }}>{m.sub}</div> : null}
      {m.chart ? <Chart m={m.chart} w={w} h={og ? (m.stats?.length ? 160 : 200) : m.kind === "sim" ? 300 : 260} t={t} /> : null}
      {m.blocked && m.who ? (
        <div style={{ display: "flex", alignItems: "center", gap: 16, paddingTop: 12, borderTop: `1px solid ${t.bd}` }}>
          <Identicon seed={m.who.seed} size={48} t={t} />
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <div style={{ fontFamily: MONO, fontSize: 24, fontWeight: 500, color: t.tx }}>{m.who.addr}</div>
            <div style={{ fontSize: 16, color: t.mu }}>{m.who.sub}</div>
          </div>
        </div>
      ) : null}
      {m.blocked ? (
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {m.blocked.chips.map((c) => (
            <div key={c.label} style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 14px", borderRadius: 999, fontSize: 18, background: c.ok ? t.posS : t.negS, color: c.ok ? t.pos : t.neg }}>
              <Icon name={c.ok ? "check" : "close"} size={18} color={c.ok ? t.pos : t.neg} />
              {c.label}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function renderCard(m: CardModel, format: CardFormat, theme: CardTheme) {
  const t = TOKENS[theme];
  const root = { display: "flex", background: t.bg, color: t.tx, fontFamily: "Inter", fontSize: 16 } as const;
  if (format === "og")
    return (
      <div style={{ ...root, width: 1200, height: 630 }}>
        <div style={{ display: "flex", flexDirection: "column", flex: 1, gap: 18, padding: "52px 40px 44px 64px", minWidth: 0 }}>
          <Top m={m} t={t} og />
          <Body m={m} t={t} og w={756} />
          {m.stats?.length ? <div style={{ display: "flex", marginTop: "auto" }}><Stats stats={m.stats} t={t} size={m.stats.length > 4 ? 24 : 28} /></div> : null}
        </div>
        <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", width: 340, padding: "52px 40px 44px", background: t.sf, borderLeft: `1px solid ${t.bd}` }}>
          <Proof m={m} t={t} row={false} />
          <Fine m={m} t={t} />
        </div>
      </div>
    );
  return (
    <div style={{ ...root, width: 1080, height: 1080, flexDirection: "column", gap: 28, padding: 64 }}>
      <Top m={m} t={t} og={false} />
      <Body m={m} t={t} og={false} w={952} />
      {m.stats?.length ? <Stats stats={m.stats} t={t} size={m.stats.length > 4 ? 24 : 28} /> : null}
      <Proof m={m} t={t} row />
      <div style={{ display: "flex", marginTop: "auto" }}>
        <Fine m={m} t={t} />
      </div>
    </div>
  );
}
