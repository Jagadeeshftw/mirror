/**
 * Read-only card of a shared position (design proposal-2 #share, 07a): who shared it (short address only), market,
 * side, leverage, size, the leader it copies, ROE, entry / mark / stop / target and the block it was read at.
 */
import { IconExternalLink } from "@tabler/icons-react";
import { fmtPrice, leverageText, pctText, roePct, type SharedCard } from "@/lib/share/levels";
import { cn } from "@/lib/utils";

const lotsText = (c: SharedCard) => (Number(c.lotLNS ?? 0) / 10 ** c.lotDecimals).toLocaleString("en-US", { maximumFractionDigits: c.lotDecimals });

export function Identicon({ seed, size = 20 }: { seed: string; size?: number }) {
  // A 5x5 mirrored grid from the short address: decoration only, no lookup of who it is.
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const cells: [number, number][] = [];
  for (let y = 0; y < 5; y++) for (let x = 0; x < 3; x++) if ((h >> (y * 3 + x)) & 1) cells.push([x, y], [4 - x, y]);
  return (
    <svg width={size} height={size} viewBox="0 0 5 5" aria-hidden className="shrink-0 rounded-[4px] bg-brand-soft text-brand">
      {cells.map(([x, y], i) => (
        <rect key={i} x={x} y={y} width={1} height={1} fill="currentColor" />
      ))}
    </svg>
  );
}

export function MarketBadge({ symbol, size = 40 }: { symbol: string; size?: number }) {
  return (
    <span className="grid shrink-0 place-items-center rounded-full border border-border bg-muted font-mono text-[11px] font-semibold" style={{ width: size, height: size }} aria-hidden>
      {symbol.slice(0, 4)}
    </span>
  );
}

export function SideChip({ side }: { side: "long" | "short" }) {
  return (
    <span className={cn("rounded-md px-1.5 py-0.5 text-xs font-semibold", side === "long" ? "bg-positive/15 text-positive" : "bg-negative/15 text-negative")}>
      {side === "long" ? "Long" : "Short"}
    </span>
  );
}

export function PositionCard({ c, verifyHref }: { c: SharedCard; verifyHref?: string | null }) {
  const lev = leverageText(c);
  const roe = roePct(c);
  const open = c.status === "open";
  const cell = (k: string, v: string, id: string) => (
    <div key={k} className="min-w-0">
      <div className="text-muted-foreground">{k}</div>
      <div className="truncate font-mono" data-testid={`share.card.${id}`}>{v}</div>
    </div>
  );
  return (
    <section className="grid gap-3.5 rounded-2xl border border-border bg-card p-4" data-testid="share.card" aria-label="Shared position">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Identicon seed={c.sharedBy} />
        <span>
          Shared by <span className="font-mono text-foreground" data-testid="share.card.sharedBy">{c.sharedBy}</span> · read-only
        </span>
      </div>
      <div className="flex items-center gap-3">
        <MarketBadge symbol={c.symbol} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <b className="font-semibold" data-testid="share.card.symbol">{c.symbol}</b>
            <SideChip side={c.side} />
            {open && lev ? <span className="font-mono text-sm text-muted-foreground">{lev}</span> : null}
          </div>
          {open ? (
            <div className="font-mono text-xs text-muted-foreground">
              {lotsText(c)} {c.symbol}
              {c.copiedFrom ? ` · copied from ${c.copiedFrom}` : ""}
            </div>
          ) : null}
        </div>
        {open && roe !== null ? (
          <div className="text-right">
            <div className={cn("font-mono font-semibold", roe >= 0 ? "text-positive" : "text-negative")} data-testid="share.card.roe">{pctText(roe)}</div>
            <div className="text-xs text-muted-foreground">ROE</div>
          </div>
        ) : null}
      </div>
      {open ? (
        <>
          <div className="grid grid-cols-4 gap-2 rounded-xl bg-muted px-2.5 py-2 text-xs">
            {cell("Entry", fmtPrice(c.entryPNS, c.priceDecimals), "entry")}
            {cell("Mark", fmtPrice(c.markPNS, c.priceDecimals), "mark")}
            {cell("Stop", c.stopLossPNS && c.stopLossPNS !== "0" ? fmtPrice(c.stopLossPNS, c.priceDecimals) : "—", "stop")}
            {cell("Target", c.takeProfitPNS && c.takeProfitPNS !== "0" ? fmtPrice(c.takeProfitPNS, c.priceDecimals) : "—", "target")}
          </div>
          <div className="flex items-center gap-2 text-xs">
            <span className="flex-1 text-muted-foreground" data-testid="share.card.block">
              Live from Monad · block {(c.block ?? 0).toLocaleString("en-US")}
            </span>
            {verifyHref ? (
              <a href={verifyHref} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex items-center gap-1 font-medium text-brand">
                Verify <IconExternalLink size={14} aria-hidden />
              </a>
            ) : null}
          </div>
        </>
      ) : (
        <p className="text-sm text-muted-foreground" data-testid="share.card.ended">
          {c.status === "revoked" ? "The owner stopped sharing this position. Nothing on it can be viewed or suggested any more." : "This position is closed, so the link no longer shows it or takes suggestions."}
        </p>
      )}
    </section>
  );
}
