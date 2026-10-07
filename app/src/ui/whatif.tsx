// "What if I had followed": the engine replays the leader's history through these exact limits
// (POST /v1/leaders/:id/backtest). Always labelled a simulation, with the engine's assumptions.
import { useQuery } from "@tanstack/react-query";
import React, { useEffect, useState } from "react";
import { View } from "react-native";
import { api } from "../lib/api";
import { BACKTEST_PERIODS, backtestFailure, backtestKey, backtestRequest, blockedRows, equitySeries, slippageSourceLabel } from "../lib/backtest";
import type { BacktestPeriod } from "../lib/engineTypes";
import { ausd, ausdSigned, bps, dateShort, leverage, MINUS, pctSigned, toBig } from "../lib/format";
import { bpsText } from "../lib/proof";
import type { Policy } from "../lib/types";
import { useLeader } from "../state/data";
import { Icon } from "./icons";
import { Button, Card, IconButton, Meter, Row, Seg, T } from "./kit";
import { SimPill, Skel } from "./kit2";
import { useColors } from "./theme";
import { ShareSheet } from "./shareSheet";
import { WhatIfChart } from "./whatifChart";

function useDebounced<T>(v: T, ms: number): T {
  const [d, setD] = useState(v);
  useEffect(() => {
    const t = setTimeout(() => setD(v), ms);
    return () => clearTimeout(t);
  }, [JSON.stringify(v), ms]);
  return d;
}

export function limitsLine(p: Policy, depositCNS: bigint): string {
  const l = p.leaders[0];
  const parts = [`${bps(l?.ratioBps ?? 0)} sizing`, leverage(p.maxLeverageHdths)];
  if (p.markets[0]) parts.push(`${ausd(p.markets[0].maxNotionalCNS)}/market`);
  if (p.maxEntryDeviationBps) parts.push(`within ${bps(p.maxEntryDeviationBps)}`);
  parts.push(`${ausd(l?.budgetCNS ?? depositCNS)} budget`);
  if (p.drawdownBps) parts.push(`loss stop ${bps(p.drawdownBps)}`);
  return parts.join(" · ");
}

export function WhatIfBody({ leaderId, policy, depositCNS, onEdit, title = "What if I had followed", compact }: { leaderId: number; policy: Policy; depositCNS: bigint; onEdit?: () => void; title?: string; compact?: boolean }) {
  const c = useColors();
  const [period, setPeriod] = useState<BacktestPeriod>(30);
  const [sharing, setSharing] = useState(false);
  const body = useDebounced(backtestRequest(policy, depositCNS, period, leaderId), 500);
  const q = useQuery({ queryKey: ["backtest", backtestKey(leaderId, body)], queryFn: () => api.backtest(leaderId, body), staleTime: 5 * 60_000, retry: 0 });
  const leader = useLeader(leaderId, `${period}d` as "7d" | "30d" | "90d").data;
  const r = q.data;
  const fail = q.error ? backtestFailure(q.error) : null;
  const series = r ? equitySeries(r) : [];
  const dep = Number(depositCNS) / 1e6;
  const stop = policy.drawdownBps ? dep * (1 - policy.drawdownBps / 10_000) : null;
  const rows = r ? blockedRows(r, policy) : [];
  const total = r ? r.tradesCopied + r.tradesBlockedTotal : 0;
  const pnl = r ? toBig(r.pnlCNS) : 0n;
  return (
    <View style={{ gap: 12 }} testID="follow.whatif">
      <Row gap={8}>
        <T size={16} w={600} style={{ flex: 1 }}>
          {title}
        </T>
        <SimPill testID="follow.whatif.sim" />
        {r ? <IconButton name="share" small onPress={() => setSharing(true)} testID="follow.whatif.share" /> : null}
      </Row>
      <ShareSheet visible={sharing} onClose={() => setSharing(false)} targets={[{ key: "sim", label: "Simulation", target: { kind: "sim", leaderId, request: body, teamRun: leader?.teamRun } }]} />
      <Seg testIDPrefix="follow.whatif.period" value={String(period) as "7" | "30" | "90"} onChange={(k) => setPeriod(Number(k) as BacktestPeriod)} options={BACKTEST_PERIODS.map((d) => ({ key: String(d) as "7" | "30" | "90", label: `${d} days` }))} />
      <View style={{ paddingVertical: 8, paddingHorizontal: 10, borderRadius: 10, backgroundColor: c.sf2 }}>
        <T size={12} lh={19} mono testID="follow.whatif.limits">
          <T size={12} color="mu">
            With your limits:{" "}
          </T>
          {limitsLine(policy, depositCNS)}
          {onEdit ? (
            <T size={12} w={600} color="ac" onPress={onEdit} testID="follow.whatif.edit">
              {"  "}Edit
            </T>
          ) : null}
        </T>
      </View>
      {fail?.kind === "unavailable" ? (
        <Card style={{ padding: 16, gap: 8 }} testID="follow.whatif.unavailable">
          <Row gap={8}>
            <Icon name="clock" size={18} color={c.mu} />
            <T size={14} w={600}>
              History isn't available right now
            </T>
          </Row>
          <T size={13} color="mu">
            The look-back needs the leader's full trade history from our indexer, and it isn't answering. Your limits and the follow itself don't depend on it.
          </T>
          <T size={11} mono color="mu">
            {fail.message}
          </T>
          <Button title="Try again" kind="out" size="sm" icon="refresh" onPress={() => q.refetch()} testID="follow.whatif.retry" style={{ alignSelf: "flex-start" }} />
        </Card>
      ) : fail ? (
        <Card style={{ padding: 16, gap: 8 }} testID="follow.whatif.error">
          <T size={14} w={600}>
            {fail.kind === "rate" ? "Too many look-backs in a minute" : fail.kind === "network" ? "Can't reach Mirror" : "The look-back didn't run"}
          </T>
          <T size={12} color="mu">
            {fail.message}
          </T>
          <Button title="Try again" kind="out" size="sm" icon="refresh" onPress={() => q.refetch()} testID="follow.whatif.retry" style={{ alignSelf: "flex-start" }} />
        </Card>
      ) : !r ? (
        <View style={{ gap: 10 }} testID="follow.whatif.loading">
          <Skel card h={compact ? 200 : 240} />
          <Skel card h={110} />
        </View>
      ) : (
        <>
          <Card style={{ padding: 16, gap: 6 }}>
            <T size={12} w={500} color="mu" upper>
              Final PnL · {period} days
            </T>
            <Row align="flex-end" gap={6}>
              <T size={30} w={500} mono lh={34} color={pnl >= 0n ? "posI" : "neg"} testID="follow.whatif.pnl">
                {ausdSigned(pnl)}
              </T>
              <T size={13} w={500} color="mu" style={{ marginBottom: 4 }}>
                AUSD
              </T>
            </Row>
            <T size={12} mono color="mu">
              {pctSigned(r.pnlPct, 1)} of {ausd(r.depositCNS)}
              {leader ? ` · leader on full size ${pctSigned(leader.pnlPct)}` : ""}
            </T>
            <View style={{ marginTop: 6 }}>
              <WhatIfChart data={series} stop={stop} height={compact ? 150 : 160} labels={[dateShort(r.from * 1000), dateShort(((r.from + r.to) / 2) * 1000), dateShort(r.to * 1000)]} testID="follow.whatif.chart" />
            </View>
          </Card>
          <Card style={{ padding: 16, gap: 10 }} testID="follow.whatif.trades">
            <Row>
              <T size={13} w={600} style={{ flex: 1 }}>
                {total} leader trades
              </T>
              <T size={13} mono>
                <T size={13} mono color="posI" testID="follow.whatif.copied">{`${r.tradesCopied} copied`}</T>
                {" · "}
                <T size={13} mono color="neg" testID="follow.whatif.blockedTotal">{`${r.tradesBlockedTotal} blocked`}</T>
              </T>
            </Row>
            <Meter height={10} parts={[{ frac: total ? r.tradesCopied / total : 0, color: c.pos }, { frac: total ? r.tradesBlockedTotal / total : 0, color: c.neg }]} />
            {rows.map((x) => (
              <Row key={x.reason} gap={10} testID={`follow.whatif.blocked.${x.reason}`}>
                <T size={13} style={{ width: 150 }} lines={1}>
                  {x.label}
                </T>
                <View style={{ flex: 1, height: 8 }}>
                  <View style={{ width: `${(x.n / Math.max(...rows.map((y) => y.n))) * 100}%`, height: 8, backgroundColor: c.neg, borderTopRightRadius: 4, borderBottomRightRadius: 4 }} />
                </View>
                <T size={13} mono style={{ width: 30, textAlign: "right" }}>
                  {x.n}
                </T>
              </Row>
            ))}
          </Card>
          <Card style={{ padding: 14, flexDirection: "row", flexWrap: "wrap", rowGap: 14 }}>
            {[
              ["Worst drawdown", `${MINUS}${ausd(r.maxDrawdownCNS)}`, `${MINUS}${bps(r.maxDrawdownBps)}`, "neg", "follow.whatif.drawdown"],
              ["Loss stops hit", `${r.stops.length} time${r.stops.length === 1 ? "" : "s"}`, r.stops.length ? r.stops.map((s) => s.kind).slice(0, 2).join(", ") : "none fired", "tx", "follow.whatif.stops"],
              ["Fees", `${MINUS}${ausd(r.feesCNS)}`, `taker ${r.takerFeeBps} bps`, "tx", "follow.whatif.fees"],
              ["Slippage used", `${bpsText(r.slippage.bps)} bps`, slippageSourceLabel(r), "tx", "follow.whatif.slippage"],
            ].map(([k, v, sub, col, id]) => (
              <View key={k} style={{ width: "50%", gap: 1, paddingRight: 8 }}>
                <T size={12} color="mu">
                  {k}
                </T>
                <T size={17} w={500} mono color={col} testID={id}>
                  {v}
                </T>
                <T size={12} color="mu">
                  {sub}
                </T>
              </View>
            ))}
          </Card>
          <Card style={{ padding: 14, gap: 6 }} testID="follow.whatif.assumptions">
            <T size={13} w={600}>
              Assumptions
            </T>
            {r.assumptions.map((a, i) => (
              <Row key={i} gap={8} align="flex-start">
                <T size={12} color="mu">
                  •
                </T>
                <T size={12} color="mu" style={{ flex: 1 }} lh={17}>
                  {a}
                </T>
              </Row>
            ))}
          </Card>
        </>
      )}
    </View>
  );
}

/** One-line summary for the laptop leader panel. */
export function WhatIfMini({ leaderId, policy, depositCNS }: { leaderId: number; policy: Policy; depositCNS: bigint }) {
  const c = useColors();
  const body = backtestRequest(policy, depositCNS, 30, leaderId);
  const q = useQuery({ queryKey: ["backtest", backtestKey(leaderId, body)], queryFn: () => api.backtest(leaderId, body), staleTime: 5 * 60_000, retry: 0 });
  const fail = q.error ? backtestFailure(q.error) : null;
  return (
    <View testID="leader.whatif" style={{ padding: 14, borderRadius: 16, backgroundColor: c.sf2, gap: 4 }}>
      <Row gap={8}>
        <T size={13} w={600} style={{ flex: 1 }}>
          What if I had followed · 30d
        </T>
        <SimPill label="Simulation" />
      </Row>
      <T size={15} w={600} mono color={q.data ? (toBig(q.data.pnlCNS) >= 0n ? "posI" : "neg") : "mu"} testID="leader.whatif.pnl">
        {q.data ? `${ausdSigned(q.data.pnlCNS)} AUSD` : fail ? (fail.kind === "unavailable" ? "History unavailable" : "Not available") : "Running"}
      </T>
      <T size={12} color="mu">
        on a {ausd(depositCNS)} budget with your default limits{q.data ? ` · ${q.data.tradesCopied} copied, ${q.data.tradesBlockedTotal} blocked` : ""}
      </T>
    </View>
  );
}
