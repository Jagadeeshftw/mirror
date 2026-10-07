/**
 * Static building blocks of the Copy quality section: histogram, horizontal bars, stat cell,
 * recent copies (table on laptop, list on phone). No motion.
 */
import React from "react";
import { fmtPrice, type MarketMeta, type QualityCopy } from "@/lib/copy-quality";
import { shortHex } from "@/lib/stats";
import { EXPLORER_ADDRESS, EXPLORER_TX } from "@/lib/site";
import { cn } from "@/lib/utils";

export const DASH = "—";
export const fmtSec = (ms: number | null) => (ms === null ? DASH : `${(ms / 1000).toFixed(2)} s`);
export const fmtBlocks = (b: number | null) => (b === null ? null : `${b} ${b === 1 ? "block" : "blocks"}`);
export const fmtBps = (d: number | null) => {
  if (d === null) return DASH;
  return `${d > 0 ? "+" : d < 0 ? "−" : ""}${Math.abs(d).toFixed(1)} bps`;
};
export const fmtN = (n: number | null) => (n === null ? DASH : n.toLocaleString("en-US"));
const fmtClock = (s: number | null) =>
  s === null
    ? DASH
    : new Date(s * 1000).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false, timeZone: "UTC" });

export const Card = ({ className, children }: { className?: string; children: React.ReactNode }) => (
  <div className={cn("rounded-2xl border border-border bg-card p-4 md:p-5", className)}>{children}</div>
);

export const CardHead = ({ title, aside }: { title: React.ReactNode; aside?: React.ReactNode }) => (
  <div className="flex items-baseline justify-between gap-3">
    <h3 className="text-sm font-semibold text-foreground">{title}</h3>
    {aside && <span className="text-right text-xs text-muted-foreground">{aside}</span>}
  </div>
);

export const Stat = ({ label, value, sub, big }: { label: string; value: string; sub?: string | null; big?: boolean }) => (
  <div>
    <p className="text-xs text-muted-foreground">{label}</p>
    <p className={cn("mt-1 font-mono font-semibold tracking-tight text-foreground", big ? "text-2xl md:text-3xl" : "text-xl")}>{value}</p>
    {sub && <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>}
  </div>
);

export const Empty = ({ children }: { children: React.ReactNode }) => (
  <p className="py-8 text-center text-sm text-muted-foreground">{children}</p>
);

/** Vertical bars; the tallest bucket is drawn solid, the others soft. */
export const Histogram = ({ buckets, label }: { buckets: { label: string; count: number }[]; label: string }) => {
  const max = Math.max(1, ...buckets.map((b) => b.count));
  const top = buckets.reduce((m, b, i) => (b.count > buckets[m].count ? i : m), 0);
  return (
    <figure className="mt-4" aria-label={label}>
      <div className="flex h-40 items-end gap-1.5 md:gap-2">
        {buckets.map((b, i) => (
          <div key={b.label} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1" title={`${b.label} bps: ${b.count}`}>
            <span className="font-mono text-[10px] text-muted-foreground">{b.count}</span>
            <div
              className={cn("w-full rounded-t-[3px]", i === top && b.count > 0 ? "bg-brand" : "bg-brand/45")}
              style={{ height: `${b.count === 0 ? 0 : Math.max(3, (b.count / max) * 100)}%` }}
            />
          </div>
        ))}
      </div>
      <div className="mt-1.5 flex gap-1.5 border-t border-border pt-1.5 md:gap-2">
        {buckets.map((b) => (
          <span key={b.label} className="min-w-0 flex-1 truncate text-center font-mono text-[10px] text-muted-foreground">
            {b.label}
          </span>
        ))}
      </div>
      <figcaption className="sr-only">
        {buckets.map((b) => `${b.label} bps: ${b.count}`).join("; ")}
      </figcaption>
    </figure>
  );
};

/** Horizontal bars. `pct` shows each value as a share of the total. */
export const HBars = ({ rows, pct }: { rows: { label: string; count: number }[]; pct?: boolean }) => {
  const max = Math.max(1, ...rows.map((r) => r.count));
  const total = rows.reduce((s, r) => s + r.count, 0);
  return (
    <ul className="mt-3 flex flex-col gap-2.5">
      {rows.map((r) => (
        <li key={r.label} className="grid grid-cols-[minmax(0,9rem)_1fr_3rem] items-center gap-3 text-sm">
          <span className="truncate text-foreground">{r.label}</span>
          <span className="h-2 rounded-full bg-muted">
            <span className="block h-2 rounded-full bg-brand" style={{ width: `${r.count === 0 ? 0 : Math.max(2, (r.count / max) * 100)}%` }} />
          </span>
          <span className="text-right font-mono text-muted-foreground">
            {pct ? (total ? `${Math.round((r.count / total) * 100)}%` : DASH) : r.count.toLocaleString("en-US")}
          </span>
        </li>
      ))}
    </ul>
  );
};

const TxLink = ({ h }: { h: string }) => (
  <a href={`${EXPLORER_TX}${h}`} target="_blank" rel="noopener noreferrer" className="font-mono text-xs text-brand hover:underline">
    {shortHex(h, 6, 4)} ↗
  </a>
);
const Addr = ({ a }: { a: string | null }) =>
  a ? (
    <a href={`${EXPLORER_ADDRESS}${a}`} target="_blank" rel="noopener noreferrer" className="font-mono text-xs hover:text-brand hover:underline">
      {shortHex(a)}
    </a>
  ) : (
    <span>{DASH}</span>
  );

export const RecentCopies = ({ rows, markets, empty }: { rows: QualityCopy[]; markets: MarketMeta; empty: string }) => {
  if (rows.length === 0) return <Empty>{empty}</Empty>;
  const view = rows.map((r) => {
    const m = r.perpId !== null ? markets[r.perpId] : undefined;
    return {
      r,
      market: m?.symbol ?? (r.perpId !== null ? `#${r.perpId}` : DASH),
      leader: fmtPrice(r.leaderFillPNS, m?.priceDecimals) ?? DASH,
      follower: fmtPrice(r.followerFillPNS, m?.priceDecimals) ?? DASH,
    };
  });
  return (
    <>
      <div className="mt-3 hidden overflow-x-auto md:block" tabIndex={0} role="region" aria-label="Recent copies">
        <table className="w-full min-w-[52rem] text-sm">
          <thead>
            <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
              {["Time (UTC)", "Account", "Leader", "Market", "Leader fill", "Copy fill", "Deviation", "Blocks", "ms", "Tx"].map((h, i) => (
                <th key={h} scope="col" className={cn("whitespace-nowrap px-2 py-2 font-medium", i >= 4 && "text-right")}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {view.map(({ r, market, leader, follower }) => (
              <tr key={r.txHash} className="border-b border-border last:border-b-0">
                <td className="whitespace-nowrap px-2 py-2.5 font-mono text-xs text-muted-foreground">{fmtClock(r.timestamp)}</td>
                <td className="px-2 py-2.5"><Addr a={r.account} /></td>
                <td className="px-2 py-2.5 font-mono text-xs">{r.leaderAccountId ? `#${r.leaderAccountId}` : DASH}</td>
                <td className="px-2 py-2.5 font-medium">
                  {market}
                  {r.matchNow && <span className="ml-1.5 rounded-full bg-brand-soft px-1.5 py-0.5 text-[10px] font-medium text-brand">match now</span>}
                </td>
                <td className="px-2 py-2.5 text-right font-mono">{leader}</td>
                <td className="px-2 py-2.5 text-right font-mono">{follower}</td>
                <td className="whitespace-nowrap px-2 py-2.5 text-right font-mono">{fmtBps(r.deviationBps)}</td>
                <td className="px-2 py-2.5 text-right font-mono">{r.latencyBlocks ?? DASH}</td>
                <td className="px-2 py-2.5 text-right font-mono">{r.latencyMs ?? DASH}</td>
                <td className="px-2 py-2.5 text-right"><TxLink h={r.txHash} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="mt-3 flex flex-col divide-y divide-border md:hidden">
        {view.slice(0, 10).map(({ r, market, leader, follower }) => (
          <li key={r.txHash} className="py-3 first:pt-1">
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="font-medium">
                {market} <span className="font-mono text-xs font-normal text-muted-foreground">{fmtClock(r.timestamp)}</span>
              </span>
              <span className="font-mono">{fmtBps(r.deviationBps)}</span>
            </div>
            <div className="mt-1 flex items-baseline justify-between gap-3 font-mono text-xs text-muted-foreground">
              <span>
                {leader} → {follower}
              </span>
              <span>
                {fmtBlocks(r.latencyBlocks) ?? DASH} · {r.latencyMs ?? DASH} ms
              </span>
            </div>
            <div className="mt-1 flex items-baseline justify-between gap-3 text-xs text-muted-foreground">
              <span>
                Leader {r.leaderAccountId ? `#${r.leaderAccountId}` : DASH} · <Addr a={r.account} />
              </span>
              <TxLink h={r.txHash} />
            </div>
          </li>
        ))}
      </ul>
    </>
  );
};
