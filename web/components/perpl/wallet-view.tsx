/** Wallet drill-down for any Perpl account (server component). Positions live from chain, history from the indexer. */
import React from "react";
import Link from "next/link";
import type { Wallet } from "@/lib/perpl/wallet";
import { compact, day, int, lev, money, pct, shortHex, utc } from "@/lib/perpl/format";
import { EXPLORER_ADDRESS } from "@/lib/site";
import { AccountSearch } from "./account-search";
import { LineChart } from "./charts";
import { Estimate, NotAvailable, Panel, SourceLine, Tile } from "./parts";
import { FillsTable, PositionsTable } from "./wallet-tables";

export const WalletView = ({ data }: { data: Wallet }) => {
  const h = data.history.ok ? data.history.value : null;
  const ps = data.positions;
  const notional = ps.reduce((s, p) => s + p.notional, 0);
  const accLev = data.equity && data.equity > 0 && ps.length ? notional / data.equity : null;
  const closest = [...ps].filter((p) => p.liqDistance !== null).sort((a, b) => a.liqDistance! - b.liqDistance!)[0];
  const largest = [...ps].sort((a, b) => b.notional - a.notional)[0];
  const peak = h?.leverage.length ? h.leverage.reduce((m, x) => (x.leverage > m.leverage ? x : m)) : null;
  const copyable = data.found && !h?.isMirrorAccount && !h?.teamRun;

  return (
    <div className="mx-auto max-w-[90rem] px-4 py-8 md:px-8 md:py-10">
      <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <p className="mb-2 font-mono text-xs uppercase tracking-[0.12em] text-brand">
            <Link href="/perpl" className="hover:underline">Perpl analytics</Link> / account
          </p>
          <h1 className="text-3xl font-semibold tracking-[-0.03em] md:text-[2.25rem]">
            {data.accountId ? `Perpl account #${data.accountId}` : "Perpl account"}
          </h1>
          <p className="mt-2 truncate text-sm text-muted-foreground">
            {data.address ? (
              <a href={`${EXPLORER_ADDRESS}${data.address}`} target="_blank" rel="noopener noreferrer" className="font-mono hover:text-foreground">
                {shortHex(data.address, 8, 6)}
              </a>
            ) : (
              data.query
            )}
            {h?.createdAt ? ` · on Perpl since ${day(h.createdAt)}` : ""}
            {h?.isMirrorAccount ? " · Mirror follower account" : ""}
            {data.frozen ? " · frozen" : ""}
            {data.block ? ` · block ${data.block.toLocaleString("en-US")}` : ""}
          </p>
        </div>
        <AccountSearch initial={data.query} className="w-full lg:w-[26rem]" />
      </div>

      {data.chainError && <NotAvailable className="mt-6" source="Monad RPC" reason={data.chainError} />}
      {!data.found && !data.chainError && (
        <div className="mt-6 rounded-2xl border border-border bg-card p-6 text-sm">
          <p className="font-semibold">No Perpl account {/^\d+$/.test(data.query) ? `#${data.query}` : `for ${data.query}`}</p>
          <p className="mt-1 text-muted-foreground">The Exchange contract on Monad has no account with this id or address.</p>
        </div>
      )}

      {data.found && (
        <>
          <section aria-label="Account totals" className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-5">
            <Tile label="Equity" value={money(data.equity, 0)} note={`AUSD · free ${money(data.balance, 0)}`} />
            <Tile
              label="Unrealised"
              value={money(data.unrealised, 0, true)}
              tone={data.unrealised ? (data.unrealised > 0 ? "positive" : "negative") : undefined}
              note={`AUSD · ${ps.length} position${ps.length === 1 ? "" : "s"}`}
            />
            <Tile
              label="Realised, 30 days"
              value={h ? money(h.realized30d, 0, true) : "—"}
              tone={h && h.realized30d ? (h.realized30d > 0 ? "positive" : "negative") : undefined}
              note={h ? `AUSD net · ${int(h.trades30d)} trades` : "indexer not available"}
            />
            <Tile label="Leverage now" value={lev(accLev)} tone={accLev && accLev >= 10 ? "warning" : undefined} note={peak ? `peak ${lev(peak.leverage)} · ${utc(peak.t)}` : "notional / equity"} />
            <Tile
              label="Closest liquidation"
              value={closest ? pct(closest.liqDistance) : "—"}
              tone={closest && closest.liqDistance! < 0.1 ? "negative" : undefined}
              note={closest ? `${closest.symbol} ${closest.side} · est.` : ps.length ? "none by price" : "no open positions"}
            />
          </section>

          <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-3 lg:items-start">
            <Panel title="Realised PnL" meta={h && h.days.length >= 3 ? "cumulative net per day, AUSD" : "cumulative net per fill, AUSD"} id="pnl">
              {h && h.days.length >= 3 ? (
                <LineChart zero summary="Cumulative realised net PnL per day" points={h.days.map((d) => ({ t: d.t, v: d.cum, label: `${day(d.t)}: ${money(d.cum, 2, true)} (day ${money(d.net, 2, true)})` }))} />
              ) : h && h.pnlFills.length > 1 ? (
                <LineChart
                  zero
                  timeFmt={(t) => utc(t)}
                  summary="Cumulative realised net PnL over the indexed fills"
                  points={h.pnlFills.map((p, i) => ({ t: p.t + i * 1e-3, v: p.cum, label: `${utc(p.t)}: ${money(p.cum, 2, true)}` }))}
                />
              ) : (
                <NotAvailable source="Mirror indexer" reason={!data.history.ok ? data.history.reason : "no fills in the indexed range"} />
              )}
              <SourceLine>Realised price PnL + funding − opening fees, indexed range only (last {h ? int(h.fills.length) : "—"} fills).</SourceLine>
            </Panel>
            <Panel title="Leverage history" meta="highest position leverage per hour" id="levh">
              {h && h.leverage.length > 1 ? (
                <LineChart
                  fmt={(v) => `${v.toFixed(2)}x`}
                  timeFmt={(t) => utc(t)}
                  summary="Position leverage after each fill"
                  points={h.leverage.map((x) => ({ t: x.t, v: x.leverage, label: `${utc(x.t)} hour: ${lev(x.leverage)} (${x.symbol})` }))}
                />
              ) : (
                <NotAvailable source="Mirror indexer" reason={!data.history.ok ? data.history.reason : "fewer than two hours with sized fills in the indexed range"} />
              )}
              <SourceLine>For each fill: position size after x fill price / position deposit after; the highest per hour.</SourceLine>
            </Panel>
            <Panel title="Risk" meta={<Estimate />} id="wrisk">
              {ps.length === 0 ? (
                <p className="py-4 text-sm text-muted-foreground">No open positions, nothing to liquidate.</p>
              ) : (
                <ul className="space-y-2.5">
                  {[...ps].sort((a, b) => (a.liqDistance ?? 9) - (b.liqDistance ?? 9)).map((p) => (
                    <li key={p.perpId} className="grid grid-cols-[6rem_1fr_3.5rem] items-center gap-3 text-sm">
                      <span className="truncate">{p.symbol} {p.side}</span>
                      <span className="h-2 overflow-hidden rounded-full bg-muted" aria-hidden>
                        <span className={p.liqDistance !== null && p.liqDistance < 0.1 ? "block h-full bg-negative" : "block h-full bg-brand"} style={{ width: `${Math.min(100, ((p.liqDistance ?? 1) / 0.5) * 100)}%` }} />
                      </span>
                      <span className="text-right font-mono text-xs">{p.liqDistance === null ? "none" : pct(p.liqDistance)}</span>
                    </li>
                  ))}
                </ul>
              )}
              <dl className="mt-4 divide-y divide-border text-sm">
                {[
                  ["Largest position", largest && data.equity ? `${largest.symbol} · ${pct(largest.notional / data.equity, 0)} of equity` : "—"],
                  ["Open notional", `${compact(notional)} AUSD`],
                  ["Liquidations (indexed)", h?.stats ? int(h.stats.liquidations) : "—"],
                  ["Max drawdown (indexed)", h?.stats ? `${money(Number(h.stats.maxDrawdownCNS) / 1e6, 0)} AUSD` : "—"],
                ].map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-3 py-2">
                    <dt className="text-muted-foreground">{k}</dt>
                    <dd className="font-mono text-xs">{v}</dd>
                  </div>
                ))}
              </dl>
              {copyable && data.accountId && (
                <div className="mt-4 rounded-xl bg-brand-soft p-4">
                  <p className="text-sm">
                    {h?.stats?.followers ? `${int(h.stats.followers)} Mirror accounts copy this trader.` : "Copy this trader with your own limits, onchain."}
                  </p>
                  <a href={`/app/leader/${data.accountId}`} className="mt-3 flex h-10 items-center justify-center rounded-full bg-primary text-sm font-medium text-primary-foreground hover:bg-primary/90">
                    Copy this trader in Mirror
                  </a>
                </div>
              )}
            </Panel>
          </div>

          <div className="mt-3 grid grid-cols-1 gap-3">
            <PositionsTable data={data} />
            <FillsTable data={data} />
          </div>
        </>
      )}
    </div>
  );
};
