import * as Clipboard from "expo-clipboard";
import { router, useLocalSearchParams } from "expo-router";
import React, { useMemo, useState } from "react";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { LeaderWindow } from "../../lib/api";
import { MINUS, comma, dateShort, leverage, lots, pctSigned, price, shortAddr, usdCompact } from "../../lib/format";
import { useConfig, useLeader, useMarkets, useTotals } from "../../state/data";
import { useOwnerAction } from "../../state/ownerAction";
import { AppBar, BalanceChip } from "../../ui/chrome";
import { Columns, LineChart } from "../../ui/charts";
import { Icon } from "../../ui/icons";
import { Button, Card, ChipS, ErrorBanner, IconButton, Identicon, Lbl, LoadingBlock, MarketBadge, NansenLabel, Row, Screen, Scroll, Seg, Side, T } from "../../ui/kit";
import { useColors } from "../../ui/theme";
import { AdversarialFlag } from "../../ui/adversarial";
import { useLayout } from "../../ui/layout";
import { Redirect } from "expo-router";

function Stat({ k, v, sub, color }: { k: string; v: string; sub?: string; color?: string }) {
  return (
    <View style={{ width: "33.33%", paddingRight: 10, marginBottom: 14, gap: 1 }}>
      <T size={12} color="mu">
        {k}
      </T>
      <T size={17} w={500} mono color={color}>
        {v}
      </T>
      {sub ? (
        <T size={12} color="mu">
          {sub}
        </T>
      ) : null}
    </View>
  );
}

export default function LeaderRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  // Laptop: the profile is the side panel next to the leaderboard table.
  if (useLayout() === "laptop") return <Redirect href={{ pathname: "/leaders", params: { leader: String(id) } }} />;
  return <LeaderProfile />;
}

function LeaderProfile() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [window, setWindow] = useState<LeaderWindow>("30d");
  const [alerts, setAlerts] = useState(false);
  const [copied, setCopied] = useState(false);
  const cfg = useConfig().data;
  const { bySymbol, byPerp } = useMarkets(cfg);
  const q = useLeader(Number(id), window);
  const { totals } = useTotals();
  const l = q.data;
  const following = totals?.accounts.find((a) => a.leader?.accountId === Number(id));
  const act = useOwnerAction();

  const chart = useMemo(() => {
    if (!l) return null;
    const data = l.equityCurve.map((p) => p.v);
    const lo = Math.min(...data);
    const hi = Math.max(...data);
    const step = Math.pow(10, Math.floor(Math.log10(Math.max(1, hi - lo))));
    const tickLo = Math.floor(lo / step) * step;
    const ticks: [number, string][] = [];
    for (let v = tickLo; v <= hi + step; v += step) if (v >= lo - step * 0.2) ticks.push([v, v >= 1000 ? `${Math.round(v / 1000)}k` : String(Math.round(v))]);
    const t0 = l.equityCurve[0].t;
    const t1 = l.equityCurve[l.equityCurve.length - 1].t;
    const idx = (t: number) => l.equityCurve.findIndex((p) => p.t >= t);
    const band = l.drawdown ? { from: Math.max(0, idx(l.drawdown.fromT)), to: Math.max(0, idx(l.drawdown.toT)), label: `Max DD ${MINUS}${l.drawdown.pct.toFixed(1)}%` } : null;
    const n = data.length - 1;
    return {
      data,
      min: ticks[0]?.[0] ?? lo,
      max: ticks[ticks.length - 1]?.[0] ?? hi,
      ticks: ticks.slice(0, 5),
      xTicks: [
        [0, dateShort(t0), "start"],
        [Math.round(n / 3), dateShort(t0 + (t1 - t0) / 3)],
        [Math.round((2 * n) / 3), dateShort(t0 + (2 * (t1 - t0)) / 3)],
        [n, dateShort(t1), "end"],
      ] as [number, string, ("start" | "middle" | "end")?][],
      band,
    };
  }, [l]);

  if (!l) {
    return (
      <Screen>
        <AppBar showBack title={id ? `Leader ${id}` : ""} />
        {q.isError ? <ErrorBanner title="Can't load this leader" body="Check your connection and try again." onRetry={() => q.refetch()} /> : <LoadingBlock label="Loading due diligence" />}
      </Screen>
    );
  }
  const ddHi = (l.tradesPerDay.findIndex((x) => l.drawdown && x.t >= l.drawdown.fromT) + 0) || 0;
  const ddHiEnd = l.drawdown ? l.tradesPerDay.findIndex((x) => x.t >= l.drawdown!.toT) : -1;
  const highlight: [number, number] | undefined = l.drawdown && ddHiEnd > ddHi ? [ddHi, ddHiEnd] : undefined;
  const hiAvg = highlight ? Math.round(l.tradesPerDay.slice(highlight[0], highlight[1] + 1).reduce((s, x) => s + x.n, 0) / (highlight[1] - highlight[0] + 1)) : 0;
  const warnCount = l.riskFlags.filter((f) => f.kind === "warn").length;

  return (
    <Screen testID="leader.screen">
      <View style={{ height: 60, flexDirection: "row", alignItems: "center", gap: 2, paddingLeft: 12, paddingRight: 16 }}>
        <IconButton name="back" onPress={() => (router.canGoBack() ? router.back() : router.replace("/leaders"))} testID="nav.back" />
        <T size={16} w={500} mono style={{ letterSpacing: -0.16 }}>
          {shortAddr(l.address)}
        </T>
        <IconButton
          name={copied ? "check" : "copy"}
          small
          testID="leader.copy.address"
          onPress={async () => {
            await Clipboard.setStringAsync(l.address);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
        />
        <View style={{ flex: 1 }} />
        <BalanceChip />
      </View>
      <Scroll testID="leader.scroll" contentStyle={{ paddingHorizontal: 20, paddingTop: 4, gap: 14, paddingBottom: 24 }}>
        <Row gap={12}>
          <Identicon seed={l.address} size={56} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Row gap={6} style={{ marginBottom: 4, flexWrap: "wrap" }}>
              {l.nansen.labels.map((x) => (
                <NansenLabel key={x} label={x} />
              ))}
              {!l.nansen.labels.length ? <T size={12} color="mu">No Nansen label</T> : null}
            </Row>
            <T size={12} color="mu">
              On Perpl since {l.since} · {l.followers} followers · Score{" "}
              <T size={12} w={600} mono>
                {l.score}
              </T>
            </T>
          </View>
        </Row>

        <AdversarialFlag a={l.adversarial} />
        <Card style={{ padding: 16, gap: 10 }}>
          <Row justify="space-between" align="flex-start">
            <View>
              <Lbl>PnL · {window === "7d" ? "7 days" : window === "90d" ? "90 days" : "30 days"}</Lbl>
              <T testID="leader.pnl.pct" size={32} w={500} mono lh={36} color={l.pnlPct >= 0 ? "posI" : "neg"} style={{ letterSpacing: -1 }}>
                {pctSigned(l.pnlPct)}
              </T>
              <T size={13} mono color="mu">
                {l.pnlUsd >= 0 ? "+" : MINUS}
                {comma(Math.abs(l.pnlUsd))} AUSD
              </T>
            </View>
            <Seg
              small
              testIDPrefix="leader.window"
              value={window}
              onChange={setWindow}
              options={[
                { key: "7d", label: "7D" },
                { key: "30d", label: "30D" },
                { key: "90d", label: "90D" },
              ]}
            />
          </Row>
          {chart ? (
            <LineChart data={chart.data} height={176} padT={18} padB={18} padR={32} min={chart.min} max={chart.max} yTicks={chart.ticks} xTicks={chart.xTicks} band={chart.band} color={c.pos} testID="leader.chart" />
          ) : null}
          <T size={12} color="mu">
            Equity in AUSD.{l.drawdown ? ` Shaded: max drawdown, ${dateShort(l.drawdown.fromT)} to ${dateShort(l.drawdown.toT)}.` : ""}
          </T>
        </Card>

        <T size={17} w={600} style={{ marginTop: 6, marginBottom: -6 }}>
          Due diligence
        </T>
        <Card style={{ padding: 16, gap: 16 }} testID="leader.due.diligence">
          <View style={{ flexDirection: "row", flexWrap: "wrap", marginBottom: -14 }}>
            <Stat k="Max drawdown" v={`${MINUS}${l.maxDrawdownPct.toFixed(1)}%`} sub={l.drawdown ? `over ${l.drawdown.days} days` : undefined} color={c.neg} />
            <Stat k="Win rate" v={`${l.winRate}%`} sub={`${l.trades} trades`} />
            <Stat k="Avg leverage" v={`${l.avgLeverage.toFixed(1)}x`} sub={`peak ${l.stats.peakLeverage}x`} color={l.avgLeverage >= 6 ? c.wrnI : undefined} />
            <Stat k="Trade frequency" v={`${l.stats.tradesPerDay}/day`} sub={`avg hold ${Math.floor(l.stats.avgHoldMinutes / 60)}h ${l.stats.avgHoldMinutes % 60}m`} />
            <Stat k="Profit factor" v={l.stats.profitFactor.toFixed(2)} sub="gross win / loss" />
            <Stat k="Largest loss" v={usdCompact(l.stats.largestLossUsd).replace("$", "")} sub="AUSD, one trade" />
          </View>
          <View style={{ gap: 8, paddingTop: 14, borderTopWidth: 1, borderTopColor: c.bd }}>
            <T size={13} w={600}>
              Markets traded
            </T>
            {l.marketShare.map((m) => (
              <Row key={m.symbol} gap={10}>
                <T size={13} w={500} mono style={{ width: 44 }}>
                  {m.symbol}
                </T>
                <View style={{ flex: 1, height: 8 }}>
                  <View style={{ width: `${m.pct}%`, height: 8, backgroundColor: c.ac, borderTopRightRadius: 4, borderBottomRightRadius: 4 }} />
                </View>
                <T size={13} mono style={{ width: 38, textAlign: "right" }}>
                  {m.pct}%
                </T>
              </Row>
            ))}
          </View>
          <View style={{ gap: 8, paddingTop: 14, borderTopWidth: 1, borderTopColor: c.bd }}>
            <T size={13} w={600}>
              Trades per day
            </T>
            <Columns
              values={l.tradesPerDay.map((x) => x.n)}
              highlight={highlight}
              labels={[dateShort(l.tradesPerDay[0].t), dateShort(l.tradesPerDay[l.tradesPerDay.length - 1].t), highlight ? `Drawdown week: ${hiAvg}/day` : undefined]}
            />
          </View>
          {l.positions.length ? (
            <View style={{ gap: 8, paddingTop: 14, borderTopWidth: 1, borderTopColor: c.bd }} testID="leader.open.positions">
              <T size={13} w={600}>
                Open now
              </T>
              {l.positions.map((p) => {
                const m = byPerp.get(p.perpId);
                return (
                  <Row key={`${p.perpId}${p.side}`} gap={8}>
                    <MarketBadge symbol={m?.symbol ?? "?"} size={24} />
                    <T size={13} w={600}>
                      {m?.symbol}
                    </T>
                    <Side side={p.side} />
                    <T size={12} mono color="mu" style={{ flex: 1 }} lines={1}>
                      {m ? `${lots(p.lotLNS, m.lotDecimals)} @ ${price(p.entryPNS, m.priceDecimals)} · ${leverage(p.leverageHdths)}` : ""}
                    </T>
                    <T size={12} mono color={p.pnlUsd >= 0 ? "posI" : "neg"}>
                      {usdCompact(p.pnlUsd, true)}
                    </T>
                  </Row>
                );
              })}
            </View>
          ) : null}
        </Card>

        <Row gap={8} style={{ marginTop: 6, marginBottom: -6 }}>
          <T size={17} w={600}>
            Wallet intelligence
          </T>
          <T size={12} color="mu">
            by Nansen
          </T>
        </Row>
        <Card style={{ padding: 16, gap: 16 }} testID="leader.nansen">
          {(l.nansen.notes ?? []).length ? (
            <View style={{ gap: 8 }}>
              {(l.nansen.notes ?? []).map((n) => (
                <Row key={n.label} gap={10}>
                  <View style={{ width: 120 }}>
                    <NansenLabel label={n.label} />
                  </View>
                  <T size={12} color="mu" style={{ flex: 1 }}>
                    {n.text}
                  </T>
                </Row>
              ))}
            </View>
          ) : null}
          {(l.nansen.venues ?? []).length ? (
            <View>
              <Row style={{ paddingBottom: 6 }}>
                <T size={11} w={500} color="mu" upper style={{ flex: 1.2 }}>
                  Venue
                </T>
                <T size={11} w={500} color="mu" upper style={{ flex: 1 }}>
                  Active since
                </T>
                <T size={11} w={500} color="mu" upper style={{ flex: 1, textAlign: "right" }}>
                  Realised PnL
                </T>
              </Row>
              {(l.nansen.venues ?? []).map((v) => (
                <Row key={v.venue} style={{ paddingVertical: 8, borderTopWidth: 1, borderTopColor: c.bd }}>
                  <T size={13} style={{ flex: 1.2 }}>
                    {v.venue}
                  </T>
                  <T size={13} mono style={{ flex: 1 }}>
                    {v.since}
                  </T>
                  <T size={13} mono color={v.realisedPnlUsd >= 0 ? "posI" : "neg"} style={{ flex: 1, textAlign: "right" }}>
                    {usdCompact(v.realisedPnlUsd, true)}
                  </T>
                </Row>
              ))}
            </View>
          ) : null}
        </Card>

        <Row gap={8} style={{ marginTop: 6, marginBottom: -6 }}>
          <T size={17} w={600}>
            Risk flags
          </T>
          {warnCount ? <ChipS label={String(warnCount)} tone="wrn" /> : null}
        </Row>
        <Card style={{ padding: 16, gap: 12 }} testID="leader.risk.flags">
          {l.riskFlags.map((f) => (
            <Row key={f.title} gap={10} align="flex-start">
              <View style={{ marginTop: 1 }}>
                <Icon name={f.kind === "ok" ? "check" : f.kind === "info" ? "info" : "warn"} size={18} color={f.kind === "ok" ? c.pos : f.kind === "info" ? c.mu : c.wrn} />
              </View>
              <View style={{ flex: 1 }}>
                <T size={13} w={600}>
                  {f.title}
                </T>
                <T size={12} color="mu">
                  {f.detail}
                </T>
              </View>
            </Row>
          ))}
        </Card>
        <T size={12} color="mu" style={{ paddingHorizontal: 2 }}>
          Sources: Perpl fills on Monad, Nansen. Updated {Math.max(1, Math.round((Date.now() - l.updatedAt) / 60000))} min ago. Past results don't predict future returns.
        </T>
      </Scroll>
      <View style={{ flexDirection: "row", gap: 10, paddingTop: 12, paddingHorizontal: 20, paddingBottom: Math.max(insets.bottom, 8) + 4, backgroundColor: c.sf, borderTopWidth: 1, borderTopColor: c.bd }}>
        <Button icon="bell" kind={alerts ? "ton" : "out"} onPress={() => setAlerts(!alerts)} testID="leader.alerts" style={{ width: 52, paddingHorizontal: 0 }} />
        {following ? (
          <>
            <View style={{ justifyContent: "center" }}>
              <T size={11} color="mu">
                Status
              </T>
              <T size={13} w={600} color={following.paused ? "wrnI" : "posI"} testID="follow.status">
                {following.paused ? "Paused" : "Following"}
              </T>
            </View>
            <Button
              icon={following.paused ? "feed" : "pause"}
              kind="out"
              testID="leader.pause"
              disabled={!!act.busy}
              onPress={() => act.setPaused([following], !following.paused)}
              style={{ width: 52, paddingHorizontal: 0 }}
            />
            <Button title="Edit limits" icon="edit" flex testID="leader.rules" onPress={() => router.push({ pathname: "/follow/[id]", params: { id: String(l.accountId), account: following.account } })} />
          </>
        ) : (
          <Button title={`Follow ${shortAddr(l.address)}`} flex testID="leader.follow" onPress={() => router.push({ pathname: "/follow/[id]", params: { id: String(l.accountId) } })} />
        )}
      </View>
    </Screen>
  );
}
