import React from "react";
import type { Overview } from "@/lib/perpl/overview";
import { ago, compact, int, lev, money, pct, price, rate, size, shortHex } from "@/lib/perpl/format";
import { AccountLink, Estimate, NotAvailable, Panel, SideBadge, SourceLine, Td, Th, TxLink } from "./parts";
import { cn } from "@/lib/utils";

const hideSm = "hidden md:table-cell";

export const MarketsTable = ({ data }: { data: Overview }) => {
  if (!data.markets.ok) return <Panel title="Markets"><NotAvailable source={data.markets.source} reason={data.markets.reason} /></Panel>;
  const ms = [...data.markets.value].sort((a, b) => (b.volume24h ?? 0) - (a.volume24h ?? 0));
  const oi = data.oi.ok ? data.oi.value : [];
  const fh = data.funding.ok ? data.funding.value : {};
  const wk = data.volume.ok ? data.volume.value.week : null;
  return (
    <Panel title="Markets" meta={`${ms.length} markets · sorted by 24h volume`} id="markets">
      <div className="-mx-2 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr>
              <Th>Market</Th>
              <Th right>Mark</Th>
              <Th right className={hideSm}>vs oracle</Th>
              <Th right>24h vol</Th>
              <Th right className={hideSm}>7d vol</Th>
              <Th right className={hideSm}>Open interest</Th>
              <Th className={hideSm}>Positions L / S</Th>
              <Th right>Funding</Th>
              <Th right className={hideSm}>7d avg</Th>
            </tr>
          </thead>
          <tbody>
            {ms.map((m) => {
              const o = oi.find((x) => x.perpId === m.perpId);
              const sd = data.risk.ok ? data.risk.value.sides[m.perpId] : undefined;
              const tot = sd ? sd.long + sd.short : 0;
              const lp = tot > 0 ? sd!.long / tot : null;
              const div = m.divergence;
              return (
                <tr key={m.perpId}>
                  <Td className="font-medium">
                    {m.symbol}
                    {!m.isOpen && <span className="ml-1.5 text-[11px] text-muted-foreground">closed</span>}
                  </Td>
                  <Td right>{price(m.mark, m.priceDecimals)}</Td>
                  <Td right className={cn(hideSm, div !== null && Math.abs(div) >= 0.005 && "text-warning")}>{pct(div, 3, true)}</Td>
                  <Td right>{compact(m.volume24h, 2)}</Td>
                  <Td right className={hideSm}>{wk ? compact(wk[m.perpId] ?? null, 2) : "—"}</Td>
                  <Td right className={hideSm}>
                    <span title={`${size(m.oiBase, m.sizeDecimals)} ${m.symbol}`}>{compact(m.oiNotional, 2)}</span>
                  </Td>
                  <Td className={hideSm}>
                    {lp === null ? (
                      <span className="text-muted-foreground">—</span>
                    ) : (
                      <span className="flex items-center gap-2" title={`${sd!.long} long and ${sd!.short} short positions; open interest ${size(o?.long ?? m.oiBase, m.sizeDecimals)} ${m.symbol} each side`}>
                        <span className="flex h-1.5 w-14 overflow-hidden rounded-full bg-muted" aria-hidden>
                          <span className="bg-positive" style={{ width: `${lp * 100}%` }} />
                          <span className="ml-[2px] flex-1 bg-negative" />
                        </span>
                        <span className="font-mono text-xs">
                          {sd!.long}/{sd!.short}
                        </span>
                      </span>
                    )}
                  </Td>
                  <Td right className={cn(m.fundingRate ? (m.fundingRate > 0 ? "text-positive" : "text-negative") : "")}>{rate(m.fundingRate)}</Td>
                  <Td right className={cn(hideSm, "text-muted-foreground")}>{rate(fh[m.perpId]?.avg7d ?? null)}</Td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <SourceLine>
        Mark, oracle, 24h volume, open interest (one side, valued at mark) and funding per {Math.round((ms[0]?.fundingIntervalSec ?? 0) / 60)}-minute
        interval from Perpl REST; open interest checked against the Exchange contract (long = short, matched); positions long / short counted from the onchain snapshot; 7d volume from hourly candles. Mark more than 0.5% from oracle is
        highlighted.
      </SourceLine>
    </Panel>
  );
};

export const RiskPanel = ({ data }: { data: Overview }) => {
  if (!data.risk.ok) return <Panel title="Risk"><NotAvailable source={data.risk.source} reason={data.risk.reason} /></Panel>;
  const r = data.risk.value;
  return (
    <Panel title="Risk" meta={<Estimate>liquidation figures are estimates</Estimate>} id="risk">
      <dl className="grid grid-cols-2 gap-3">
        {[
          ["Top-10 share of OI", pct(r.top10Share)],
          ["Concentration (HHI)", r.hhi === null ? "—" : r.hhi.toFixed(3)],
          ["Within 5% of liq.", int(r.within5)],
          ["Within 10% of liq.", int(r.within10)],
        ].map(([k, v]) => (
          <div key={k} className="rounded-xl bg-muted/60 px-3 py-2.5">
            <dt className="text-xs text-muted-foreground">{k}</dt>
            <dd className="mt-0.5 font-mono text-lg font-semibold">{v}</dd>
          </div>
        ))}
      </dl>
      <h3 className="mb-1 mt-5 flex items-baseline justify-between text-sm font-semibold">
        Closest to liquidation <span className="text-xs font-normal text-muted-foreground">margin used · distance</span>
      </h3>
      <ul>
        {r.closest.map((p) => (
          <li key={`${p.accountId}-${p.perpId}`} className="flex items-center justify-between gap-3 border-t border-border py-2.5 text-sm">
            <span className="min-w-0 truncate">
              <AccountLink id={p.accountId} /> <span className="ml-1">{p.symbol} {p.side} · {lev(p.leverage)}</span>
              <span className="ml-1 font-mono text-xs text-muted-foreground">{compact(p.notional)}</span>
            </span>
            <span className="shrink-0 font-mono text-xs">
              <span className="text-negative">{pct(p.marginUsed === Infinity ? null : p.marginUsed, 0)}</span>
              <span className="ml-2 text-muted-foreground">{pct(p.liqDistance, 1)}</span>
            </span>
          </li>
        ))}
      </ul>
      <SourceLine>
        Every open position read onchain at block {r.block.toLocaleString("en-US")}. Estimated liquidation: equity (deposit + unrealised PnL incl.
        funding) at maintenance margin plus the taker fee, own deposit only. Real liquidation can come a little later; treat these as early warnings.
        {r.skipped ? ` ${r.skipped} positions in markets without config skipped.` : ""}
      </SourceLine>
    </Panel>
  );
};

export const TopAccounts = ({ data }: { data: Overview }) => {
  if (!data.risk.ok) return <Panel title="Top accounts by open interest"><NotAvailable source={data.risk.source} reason={data.risk.reason} /></Panel>;
  const r = data.risk.value;
  return (
    <Panel title="Top accounts by open interest" meta={`${int(r.traders)} accounts hold ${int(r.positions)} positions`} id="top">
      <div className="-mx-2 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr>
              <Th>Account</Th>
              <Th className={hideSm}>Address</Th>
              <Th className={hideSm}>Markets</Th>
              <Th right>Notional</Th>
              <Th right>Share</Th>
            </tr>
          </thead>
          <tbody>
            {r.topAccounts.map((a) => (
              <tr key={a.accountId}>
                <Td><AccountLink id={a.accountId} /></Td>
                <Td className={cn(hideSm, "font-mono text-xs text-muted-foreground")}>{shortHex(a.address)}</Td>
                <Td className={cn(hideSm, "max-w-[10rem] truncate")}>{a.symbols.join(", ")}</Td>
                <Td right>{compact(a.notional, 2)}</Td>
                <Td right>{pct(a.share)}</Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <SourceLine>Notional at mark, summed over the account&apos;s open positions (both sides). Share of total open notional.</SourceLine>
    </Panel>
  );
};

export const LiquidationsPanel = ({ data }: { data: Overview }) => {
  const ix = data.indexer;
  if (!ix.ok)
    return (
      <Panel title="Liquidations and deleverages">
        <NotAvailable source="Mirror indexer" reason={ix.configured ? ix.reason : "NEXT_PUBLIC_INDEXER_URL is not set on this deployment"} />
      </Panel>
    );
  const { day, week, recent, coverage } = ix.value;
  const ms = data.markets.ok ? data.markets.value : [];
  return (
    <Panel title="Liquidations and deleverages" meta={week.partial ? `indexed since ${ago(coverage.fromTs)} ago` : "7 days"} id="liq">
      <dl className="grid grid-cols-2 gap-3 text-sm">
        {[
          ["24h", day],
          ["7d", week],
        ].map(([k, w]) => {
          const x = w as typeof day;
          return (
            <div key={k as string} className="rounded-xl bg-muted/60 px-3 py-2.5">
              <dt className="text-xs text-muted-foreground">{k as string}{x.partial ? " (partial)" : ""}</dt>
              <dd className="mt-0.5 font-mono">
                <span className="text-lg font-semibold text-negative">{compact(x.liqNotional)}</span>
                <span className="ml-2 text-xs text-muted-foreground">
                  {int(x.liqCount)} liq · {int(x.delevCount)} delev · {int(x.liqAccounts)} accts
                </span>
              </dd>
            </div>
          );
        })}
      </dl>
      {recent.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">No liquidations or deleverages in the indexed range.</p>
      ) : (
        <ul className="mt-3">
          {recent.map((e) => {
            const m = ms.find((x) => x.perpId === e.perpId);
            const sz = m ? Number(e.lotsClosedLNS) / 10 ** m.sizeDecimals : null;
            return (
              <li key={e.txHash + e.accountId + e.perpId} className="flex items-center justify-between gap-2 border-t border-border py-2 text-sm">
                <span className="flex min-w-0 items-center gap-2">
                  <SideBadge side={e.side === "SHORT" ? "short" : "long"} />
                  <AccountLink id={e.accountId} />
                  <span className="truncate font-mono text-xs text-muted-foreground">
                    {e.kind === "DELEVERAGE" ? "delev · " : ""}
                    {m ? `${size(sz, m.sizeDecimals)} ${m.symbol}` : `#${e.perpId}`}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-3 font-mono text-xs">
                  <span>{money(Number(e.notionalCNS) / 1e6, 0)}</span>
                  <span className="hidden w-8 text-right text-muted-foreground sm:inline">{ago(e.timestamp)}</span>
                  <TxLink hash={e.txHash} />
                </span>
              </li>
            );
          })}
        </ul>
      )}
      <SourceLine>
        PositionLiquidated and PositionDeleveraged events indexed from block {coverage.startBlock.toLocaleString("en-US")}; notional = closed size x
        liquidation price. Windows that start before the indexed range are marked partial.
      </SourceLine>
    </Panel>
  );
};
