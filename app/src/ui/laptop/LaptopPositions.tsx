// Laptop Positions: KPIs, open positions as a table traced to their leader, PnL by leader, recent
// closes, and the selected position in the panel on the right.
import { useLocalSearchParams } from "expo-router";
import React, { useMemo, useState } from "react";
import { ScrollView, View } from "react-native";
import { ago, ausd, ausdSigned, leverage, price, shortAddr, toBig } from "../../lib/format";
import type { MirrorAccount, Position } from "../../lib/types";
import { useConfig, useFeedAll, useMarkets, useTotals } from "../../state/data";
import { useOwnerAction } from "../../state/ownerAction";
import { CloseAllDialog } from "../closeAll";
import { Button, ErrorBanner, Identicon, MarketBadge, Meter, Row, Seg, Side, T } from "../kit";
import { haltedPerps, levelFor } from "../../lib/levels";
import { isLevelStop, stopName } from "../../lib/stopEvents";
import { HaltNotice } from "../levelEdit";
import { PositionBody } from "../positionPanel";
import { useColors } from "../theme";
import { LCard, LaptopPage } from "./Top";
import { Table, type Col } from "./Table";

type Row_ = { p: Position; a: MirrorAccount; key: string };

export function LaptopPositions() {
  const c = useColors();
  const cfg = useConfig().data;
  const { byPerp } = useMarkets(cfg);
  const { totals, isError, refetch } = useTotals();
  const feed = useFeedAll();
  const act = useOwnerAction();
  const [group, setGroup] = useState<"market" | "leader">("market");
  const params = useLocalSearchParams<{ account?: string; perp?: string }>();
  const [sel, setSel] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const rows: Row_[] = useMemo(() => {
    const all = (totals?.accounts ?? []).flatMap((a) => a.positions.map((p, i) => ({ p, a, key: `${a.account}-${p.perpId}-${i}` })));
    return group === "market" ? all.sort((x, y) => (byPerp.get(x.p.perpId)?.symbol ?? "").localeCompare(byPerp.get(y.p.perpId)?.symbol ?? "")) : all;
  }, [totals, group, byPerp]);
  const closes = feed.events.filter((e) => ((e.kind === "Mirrored" && (e.orderType ?? 0) >= 2 && e.realisedPnlCNS !== undefined) || (e.kind === "StopTriggered" && isLevelStop(e)) || e.kind === "MarketClosed") && e.timestamp > Date.now() - 7 * 86400e3).slice(0, 6);
  const fromLink = params.account ? rows.find((r) => r.a.account.toLowerCase() === params.account!.toLowerCase() && String(r.p.perpId) === params.perp) : undefined;
  const current = rows.find((r) => r.key === sel) ?? fromLink ?? rows[0];
  const lvl = (r: Row_, k: "stopLossPNS" | "takeProfitPNS") => {
    const v = levelFor(r.a.levels, r.p)?.[k];
    return v && v !== "0" ? P(r.p.perpId, v) : "—";
  };
  const m = (perpId: number) => byPerp.get(perpId);
  const P = (perpId: number, v: string) => (m(perpId) ? price(v, m(perpId)!.priceDecimals) : v);
  const cols: Col<Row_>[] = [
    { key: "mkt", label: "Market", flex: 2, render: ({ p }) => <Row gap={6}><MarketBadge symbol={m(p.perpId)?.symbol ?? "?"} size={26} /><T size={13} w={600}>{m(p.perpId)?.symbol}</T><Side side={p.side} /><T size={12} mono color="mu">{leverage(p.leverageHdths)}</T></Row> },
    { key: "leader", label: "Leader", flex: 0.7, render: ({ a }) => <Identicon seed={a.leader?.address ?? a.account} size={24} /> },
        { key: "entry", label: "Entry", align: "right", render: ({ p }) => <T size={13} mono>{P(p.perpId, p.entryPNS)}</T> },
    { key: "mark", label: "Mark", align: "right", render: ({ p }) => <T size={13} mono>{P(p.perpId, p.markPNS)}</T> },
    { key: "sl", label: "Stop-loss", align: "right", flex: 1.1, render: (r) => <T size={13} mono color={lvl(r, "stopLossPNS") === "—" ? "mu" : "tx"} testID={`positions.sl.${r.p.perpId}`}>{lvl(r, "stopLossPNS")}</T> },
    { key: "tp", label: "Take-profit", align: "right", flex: 1.2, render: (r) => <T size={13} mono color={lvl(r, "takeProfitPNS") === "—" ? "mu" : "tx"} testID={`positions.tp.${r.p.perpId}`}>{lvl(r, "takeProfitPNS")}</T> },
    { key: "pnl", label: "PnL", align: "right", render: ({ p }) => <T size={13} mono color={toBig(p.upnlCNS) >= 0n ? "posI" : "neg"}>{ausdSigned(p.upnlCNS)}</T> },
  ];
  if (!totals) {
    return (
      <LaptopPage testID="portfolio.screen" title="Positions">
        {isError ? <ErrorBanner title="Can't reach Mirror" body="Your positions are safe onchain." onRetry={refetch} /> : <T size={13} color="mu">Reading your positions</T>}
      </LaptopPage>
    );
  }
  const total = totals.upnl + totals.realised;
  const byLeader = totals.accounts.map((a) => ({ a, t: a.pnl.byLeader.reduce((s, x) => s + toBig(x.unrealisedCNS) + toBig(x.realisedCNS), 0n) }));
  const maxAbs = byLeader.reduce((mx, x) => (x.t < 0n ? -x.t : x.t) > mx ? (x.t < 0n ? -x.t : x.t) : mx, 1n);
  const cp = current?.p;
  return (
    <LaptopPage testID="portfolio.screen" title="Positions" sub="Every position traces back to the leader whose copy opened it">
      <View style={{ flexDirection: "row", gap: 16, flex: 1 }}>
        <View style={{ flex: 1, gap: 16, minWidth: 0 }}>
          <Row gap={16} align="stretch">
            {[
              ["Total PnL", ausdSigned(total), "AUSD since first deposit", total >= 0n ? "posI" : "neg", "positions.total.pnl"],
              ["Unrealised", ausdSigned(totals.upnl), `${totals.openPositions} open positions`, totals.upnl >= 0n ? "posI" : "neg", "positions.kpi.upnl"],
              ["Realised", ausdSigned(totals.realised), "closed copies", totals.realised >= 0n ? "posI" : "neg", "positions.kpi.rpnl"],
              ["Margin in use", ausd(totals.margin), `of ${ausd(totals.deposited)} deposited`, "tx", "positions.kpi.margin"],
            ].map(([k, v, sub, col, id]) => (
              <LCard key={k} style={{ flex: 1, gap: 4 }}>
                <T size={12} color="mu">{k}</T>
                <T testID={id} size={22} w={500} mono color={col}>{v}</T>
                <T size={12} mono color="mu">{sub}</T>
              </LCard>
            ))}
          </Row>
          <LCard testID="positions.table.card">
            <Row><T size={15} w={600} style={{ flex: 1 }}>Open positions <T size={15} w={600} mono color="mu" testID="portfolio.positions.count">{rows.length}</T></T><Seg small testIDPrefix="positions.group" value={group} onChange={setGroup} options={[{ key: "market", label: "Market" }, { key: "leader", label: "Leader" }]} /></Row>
            {rows.length ? <Table testIDPrefix="positions.table" cols={cols} rows={rows} rowKey={(r) => r.key} selected={current?.key ?? null} onRow={(r) => setSel(r.key)} /> : <T size={13} color="mu" testID="positions.empty">No open positions. Your leaders are flat right now.</T>}
            {rows.length ? <Row justify="flex-end"><Button title="Close all positions" icon="close" kind="dngO" size="sm" onPress={() => setConfirm(true)} testID="portfolio.closeAll" /></Row> : null}
          </LCard>
          {totals.accounts.filter((a) => haltedPerps(a).length).map((a) => (
            <HaltNotice key={a.account} symbols={haltedPerps(a).map((id) => m(id)?.symbol ?? `#${id}`)} busy={act.busy === "resume"} onResume={() => act.resumeMarkets(a)} />
          ))}
          <Row gap={16} align="stretch">
            <LCard style={{ flex: 1 }} testID="positions.attribution">
              <Row><T size={15} w={600} style={{ flex: 1 }}>PnL by leader</T><T size={12} color="mu">since follow</T></Row>
              {byLeader.map(({ a, t }) => (
                <Row key={a.account} gap={10}>
                  <Identicon seed={a.leader?.address ?? a.account} size={26} />
                  <T size={13} mono style={{ width: 110 }}>{shortAddr(a.leader?.address ?? a.account)}</T>
                  <View style={{ flex: 1 }}><Meter height={8} parts={[{ frac: Number(t < 0n ? -t : t) / Number(maxAbs), color: t >= 0n ? c.pos : c.neg }]} /></View>
                  <T size={13} mono color={t >= 0n ? "posI" : "neg"}>{ausdSigned(t)}</T>
                </Row>
              ))}
            </LCard>
            <LCard style={{ flex: 1 }} testID="positions.closed">
              <Row><T size={15} w={600} style={{ flex: 1 }}>Closed</T><T size={12} color="mu">last 7 days</T></Row>
              {closes.length ? closes.map((e) => (
                <Row key={e.id} gap={8} testID={`positions.closed.${e.kind}`}>
                  <MarketBadge symbol={m(e.perpId ?? 0)?.symbol ?? "?"} size={24} />
                  <T size={13} w={600}>{m(e.perpId ?? 0)?.symbol}</T>
                  {e.kind === "Mirrored" ? <Side side={e.orderType === 2 ? "long" : "short"} /> : null}
                  <T size={12} color="mu" style={{ flex: 1 }} lines={1}>
                    {e.kind === "StopTriggered" ? `${stopName(e)} hit · executed by ${shortAddr(e.keeper)}` : e.kind === "MarketClosed" ? "Closed by you" : "Leader closed"} · {ago(e.timestamp)} ago
                  </T>
                  {e.realisedPnlCNS !== undefined ? <T size={13} mono color={toBig(e.realisedPnlCNS) >= 0n ? "posI" : "neg"}>{ausdSigned(e.realisedPnlCNS)}</T> : null}
                </Row>
              )) : <T size={13} color="mu">No closes in the last 7 days.</T>}
            </LCard>
          </Row>
        </View>
        <LCard style={{ width: 440 }} testID="positions.panel">
          {cp && current ? (
            <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 4 }} showsVerticalScrollIndicator={false}>
              <PositionBody key={current.key} account={current.a} p={cp} cfg={cfg} laptop />
            </ScrollView>
          ) : (
            <T size={13} color="mu">Select a position to see it here.</T>
          )}
        </LCard>
      </View>
      <CloseAllDialog visible={confirm} accounts={totals.accounts} cfg={cfg} busy={act.busy === "closeAll"} error={act.error} onCancel={() => { setConfirm(false); act.clearError(); }} onConfirm={async () => { if (await act.closeAll(totals.accounts)) setConfirm(false); }} />
    </LaptopPage>
  );
}
