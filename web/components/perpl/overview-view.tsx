/** Perpl protocol overview (server component). Every number names its source; missing sources say so. */
import React from "react";
import type { Overview } from "@/lib/perpl/overview";
import { compact, day, int, money, pct, rate, utc } from "@/lib/perpl/format";
import { AccountSearch } from "./account-search";
import { BarChart, Histogram, LineChart } from "./charts";
import { NotAvailable, Panel, SourceLine, Tile } from "./parts";
import { LiquidationsPanel, MarketsTable, RiskPanel, TopAccounts } from "./overview-tables";

export const OverviewView = ({ data }: { data: Overview }) => {
  const markets = data.markets.ok ? data.markets.value : [];
  const vol24 = markets.length ? markets.reduce((s, m) => s + (m.volume24h ?? 0), 0) : null;
  const vol7 = data.volume.ok ? Object.values(data.volume.value.week).reduce((s, v) => s + v, 0) : null;
  const oiTotal = markets.length ? markets.reduce((s, m) => s + (m.oiNotional ?? 0), 0) : null;
  const longN = data.oi.ok ? data.oi.value.reduce((s, x) => s + x.longNotional, 0) : null;
  const wFund = markets.filter((m) => m.fundingRate !== null && (m.oiNotional ?? 0) > 0);
  const wDen = wFund.reduce((s, m) => s + m.oiNotional!, 0);
  const fundW = wDen > 0 ? wFund.reduce((s, m) => s + m.fundingRate! * m.oiNotional!, 0) / wDen : null;
  const idx = data.indexer.ok ? data.indexer.value : null;
  const block = markets.reduce((b, m) => Math.max(b, m.block ?? 0), 0);
  const top = [...markets].sort((a, b) => (b.oiNotional ?? 0) - (a.oiNotional ?? 0))[0];
  const topFunding = top && data.funding.ok ? data.funding.value[top.perpId] : null;
  const risk = data.risk.ok ? data.risk.value : null;

  return (
    <div className="mx-auto max-w-[90rem] px-4 py-8 md:px-8 md:py-10">
      <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="mb-2 font-mono text-xs uppercase tracking-[0.12em] text-brand">Perpl analytics</p>
          <h1 className="text-3xl font-semibold tracking-[-0.03em] md:text-[2.25rem]">All of Perpl, read from Monad</h1>
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted-foreground">
            Every Perpl market and open position, read from Perpl&apos;s public API and the Exchange contract on Monad
            {block ? ` · block ${block.toLocaleString("en-US")}` : ""} · {utc(data.generatedAt)}. Liquidation figures are
            estimates and say so.
          </p>
        </div>
        <AccountSearch className="w-full lg:w-[26rem]" />
      </div>

      <section aria-label="Totals" className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Tile label="24h volume" value={compact(vol24)} note={vol7 !== null ? `AUSD · 7d ${compact(vol7)}` : "AUSD"} />
        <Tile
          label="Open interest"
          value={compact(oiTotal)}
          note={risk ? `AUSD · ${int(risk.positions)} positions` : longN !== null ? `AUSD · onchain ${compact(longN)}` : "AUSD"}
        />
        <Tile
          label="Active traders, 24h"
          value={idx ? int(idx.day.traders) : risk ? int(risk.traders) : "—"}
          note={idx ? (idx.day.partial ? `since ${utc(idx.coverage.fromTs)}` : "accounts that traded") : risk ? "accounts holding positions now" : "indexer not available"}
        />
        <Tile
          label="Liquidations, 24h"
          value={idx ? compact(idx.day.liqNotional) : "—"}
          tone={idx && idx.day.liqNotional > 0 ? "negative" : undefined}
          note={idx ? `${int(idx.day.liqCount)} liq · ${int(idx.day.delevCount)} delev${idx.day.partial ? " · partial" : ""}` : "indexer not available"}
        />
        <Tile
          label="Funding, OI-weighted"
          value={rate(fundW)}
          tone={fundW === null || fundW === 0 ? undefined : fundW > 0 ? "positive" : "negative"}
          note={fundW === null ? "per interval" : `per ${Math.round((markets[0]?.fundingIntervalSec ?? 0) / 60)} min · ${fundW > 0 ? "longs pay" : fundW < 0 ? "shorts pay" : "flat"}`}
        />
      </section>

      <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-3">
        <Panel title="Daily volume" meta="AUSD · 30 days · all markets" id="vol">
          {data.volume.ok && data.volume.value.daily.length ? (
            <BarChart
              summary={`Daily Perpl volume over ${data.volume.value.daily.length} days`}
              points={data.volume.value.daily.map((d) => ({ t: d.t, v: d.volume, label: `${day(d.t)}: ${money(d.volume, 0)} AUSD` }))}
            />
          ) : (
            <NotAvailable source={data.volume.source} reason={data.volume.ok ? "no candles" : data.volume.reason} />
          )}
          <SourceLine>Sum of daily candles of every market (Perpl REST). Today so far in the lighter bar.</SourceLine>
        </Panel>
        <Panel title={top ? `Funding, ${top.symbol}` : "Funding"} meta="per interval · 7 days" id="fund">
          {topFunding && topFunding.series.length ? (
            <LineChart
              zero
              fmt={(v) => `${(v * 100).toFixed(3)}%`}
              summary={`${top.symbol} funding rate per interval over 7 days`}
              points={topFunding.series.map((e) => ({ t: e.t, v: e.rate, label: `${utc(e.t)}: ${rate(e.rate)}` }))}
            />
          ) : (
            <NotAvailable source={data.funding.source} reason={data.funding.ok ? "no funding events" : data.funding.reason} />
          )}
          <SourceLine>
            Largest market by open interest. 24h average {rate(topFunding?.avg24h)}, 7d average {rate(topFunding?.avg7d)}. Positive: longs pay shorts.
          </SourceLine>
        </Panel>
        <Panel title="Open positions by leverage" meta={risk ? `${int(risk.positions)} positions` : undefined} id="lev">
          {risk ? (
            <Histogram
              summary="Open positions per effective leverage bucket"
              bins={risk.buckets.map((b) => ({ label: b.label, count: b.count, title: `${b.label}: ${b.count} positions, ${money(b.notional, 0)} AUSD notional` }))}
            />
          ) : (
            <NotAvailable source={data.risk.source} reason={data.risk.ok ? undefined : data.risk.reason} />
          )}
          <SourceLine>Effective leverage = notional at mark / (deposit + unrealised PnL), every open position read onchain.</SourceLine>
        </Panel>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <MarketsTable data={data} />
        <RiskPanel data={data} />
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 xl:grid-cols-2">
        <TopAccounts data={data} />
        <LiquidationsPanel data={data} />
      </div>

      <p className="mt-6 text-xs leading-relaxed text-muted-foreground">
        Sources: Perpl REST <code className="font-mono">/v1/pub/context</code>, candles and funding (live); Exchange
        0x34B6…2a6F <code className="font-mono">getPerpetualInfoV2</code>, <code className="font-mono">getAccountById</code>,{" "}
        <code className="font-mono">getPositionV2</code> on Monad{risk ? ` (snapshot of ${int(risk.accounts)} accounts at block ${risk.block.toLocaleString("en-US")})` : ""};
        Mirror indexer for activity and liquidations{idx ? ` (indexed from ${utc(idx.coverage.fromTs)})` : " (not configured)"}. Concentration top-10 share{" "}
        {pct(risk?.top10Share ?? null)}. See <a href="/docs/perpl-analytics" className="text-brand underline underline-offset-2">what each number means</a>.
      </p>
    </div>
  );
};
