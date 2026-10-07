/**
 * Static SVG charts for the Perpl analytics view. No motion. Single series each (the panel title names it),
 * recessive grid, a native tooltip (<title>) on every mark, and a text summary for screen readers.
 */
import React from "react";
import { compact } from "@/lib/perpl/format";

type Pt = { t: number; v: number; label: string };

const W = 600;

function ticks(max: number, n = 3): number[] {
  if (!(max > 0)) return [0];
  const step = Math.pow(10, Math.floor(Math.log10(max / n)));
  const nice = [1, 2, 2.5, 5, 10].map((k) => k * step).find((s) => max / s <= n) ?? step * 10;
  const out: number[] = [];
  for (let v = 0; v <= max + 1e-9; v += nice) out.push(v);
  return out;
}

const dayLabel = (t: number) => new Date(t * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

export const BarChart = ({ points, h = 150, summary, fmt = compact }: { points: Pt[]; h?: number; summary: string; fmt?: (n: number) => string }) => {
  const max = Math.max(0, ...points.map((p) => p.v));
  const ys = ticks(max);
  const top = ys[ys.length - 1] || 1;
  const padL = 40;
  const padB = 18;
  const iw = W - padL;
  const ih = h - padB - 6;
  const bw = iw / Math.max(1, points.length);
  return (
    <figure className="m-0">
      <svg viewBox={`0 0 ${W} ${h}`} className="h-auto w-full" role="img" aria-label={summary}>
        {ys.map((y) => {
          const yy = 6 + ih - (y / top) * ih;
          return (
            <g key={y}>
              <line x1={padL} x2={W} y1={yy} y2={yy} className="stroke-border" strokeWidth={1} />
              <text x={padL - 6} y={yy + 3} textAnchor="end" className="fill-muted-foreground font-mono text-[10px]">
                {fmt(y)}
              </text>
            </g>
          );
        })}
        {points.map((p, i) => {
          const bh = (p.v / top) * ih;
          const last = i === points.length - 1;
          return (
            <g key={p.t}>
              <rect x={padL + i * bw} y={6} width={bw} height={ih} fill="transparent">
                <title>{p.label}</title>
              </rect>
              <rect
                x={padL + i * bw + 1}
                y={6 + ih - bh}
                width={Math.max(1, bw - 2)}
                height={Math.max(0, bh)}
                rx={Math.min(3, bw / 4)}
                className={last ? "fill-brand/50" : "fill-brand"}
                pointerEvents="none"
              />
            </g>
          );
        })}
        {points.length > 0 && (
          <>
            <text x={padL} y={h - 4} className="fill-muted-foreground font-mono text-[10px]">
              {dayLabel(points[0].t)}
            </text>
            <text x={W} y={h - 4} textAnchor="end" className="fill-muted-foreground font-mono text-[10px]">
              {dayLabel(points[points.length - 1].t)}
            </text>
          </>
        )}
      </svg>
    </figure>
  );
};

/** Line chart with an optional zero line (for signed series such as funding or PnL). */
export const LineChart = ({
  points,
  h = 150,
  summary,
  fmt = compact,
  zero = false,
  timeFmt = dayLabel,
}: {
  points: Pt[];
  h?: number;
  summary: string;
  fmt?: (n: number) => string;
  zero?: boolean;
  timeFmt?: (t: number) => string;
}) => {
  if (points.length === 0) return null;
  const vs = points.map((p) => p.v);
  let lo = Math.min(...vs);
  let hi = Math.max(...vs);
  if (zero) {
    lo = Math.min(lo, 0);
    hi = Math.max(hi, 0);
  }
  if (hi === lo) {
    hi += Math.abs(hi) || 1;
    lo -= zero ? 0 : Math.abs(lo) || 1;
  }
  const padL = 48;
  const padB = 18;
  const ih = h - padB - 8;
  const t0 = points[0].t;
  const t1 = points[points.length - 1].t;
  const x = (t: number) => padL + (t1 === t0 ? (W - padL) / 2 : ((t - t0) / (t1 - t0)) * (W - padL - 6));
  const y = (v: number) => 8 + ih - ((v - lo) / (hi - lo)) * ih;
  const d = points.map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join("");
  const last = points[points.length - 1];
  return (
    <figure className="m-0">
      <svg viewBox={`0 0 ${W} ${h}`} className="h-auto w-full" role="img" aria-label={summary}>
        {[hi, (hi + lo) / 2, lo].map((v, i) => (
          <g key={i}>
            <line x1={padL} x2={W} y1={y(v)} y2={y(v)} className="stroke-border" strokeWidth={1} />
            <text x={padL - 6} y={y(v) + 3} textAnchor="end" className="fill-muted-foreground font-mono text-[10px]">
              {fmt(v)}
            </text>
          </g>
        ))}
        {zero && lo < 0 && hi > 0 && <line x1={padL} x2={W} y1={y(0)} y2={y(0)} className="stroke-muted-foreground" strokeDasharray="3 3" strokeWidth={1} />}
        <path d={d} fill="none" className="stroke-brand" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {points.map((p) => (
          <circle key={p.t} cx={x(p.t)} cy={y(p.v)} r={6} fill="transparent">
            <title>{p.label}</title>
          </circle>
        ))}
        <circle cx={x(last.t)} cy={y(last.v)} r={4} className="fill-brand stroke-card" strokeWidth={2} pointerEvents="none" />
        <text x={padL} y={h - 4} className="fill-muted-foreground font-mono text-[10px]">
          {timeFmt(t0)}
        </text>
        <text x={W} y={h - 4} textAnchor="end" className="fill-muted-foreground font-mono text-[10px]">
          {timeFmt(t1)}
        </text>
      </svg>
    </figure>
  );
};

/** Vertical histogram with value labels above each bar (few categories). */
export const Histogram = ({ bins, summary }: { bins: { label: string; count: number; title: string }[]; summary: string }) => {
  const h = 150;
  const max = Math.max(1, ...bins.map((b) => b.count));
  const bw = W / Math.max(1, bins.length);
  const ih = h - 40;
  return (
    <svg viewBox={`0 0 ${W} ${h}`} className="h-auto w-full" role="img" aria-label={summary}>
      {bins.map((b, i) => {
        const bh = (b.count / max) * ih;
        return (
          <g key={b.label}>
            <title>{b.title}</title>
            <rect x={i * bw + 3} y={18 + ih - bh} width={bw - 6} height={Math.max(1, bh)} rx={4} className="fill-brand" />
            <text x={i * bw + bw / 2} y={14 + ih - bh} textAnchor="middle" className="fill-foreground font-mono text-[12px]">
              {b.count.toLocaleString("en-US")}
            </text>
            <text x={i * bw + bw / 2} y={h - 6} textAnchor="middle" className="fill-muted-foreground font-mono text-[12px]">
              {b.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
};
