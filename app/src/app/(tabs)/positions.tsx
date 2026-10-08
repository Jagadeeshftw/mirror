import { router } from "expo-router";
import { failTitle, mirrorDownBody } from "../../lib/conn";
import { leaderAddressOf } from "../../lib/engineShape";
import React, { useMemo, useState } from "react";
import { View } from "react-native";
import { ausd, ausdSigned, leverage, lots, pctSigned, price, shortAddr, toBig } from "../../lib/format";
import type { MirrorAccount, Position } from "../../lib/types";
import { useConfig, useMarkets, useTotals } from "../../state/data";
import { AppBar } from "../../ui/chrome";
import { CloseAllDialog } from "../../ui/closeAll";
import { useOwnerAction } from "../../state/ownerAction";
import { Button, Card, ErrorBanner, Identicon, Lbl, LoadingBlock, MarketBadge, Press, Row, Screen, Scroll, Seg, Side, T } from "../../ui/kit";
import { Icon } from "../../ui/icons";
import { haltedPerps, levelFor } from "../../lib/levels";
import { HaltNotice } from "../../ui/levelEdit";
import { useColors } from "../../ui/theme";
import { LaptopPositions } from "../../ui/laptop/LaptopPositions";
import { useLayout } from "../../ui/layout";

function PosRow({ p, a, leaderAddr, sym, lotDec, priceDec }: { p: Position; a: MirrorAccount; leaderAddr?: string; sym: string; lotDec: number; priceDec: number }) {
  const c = useColors();
  const pnl = toBig(p.upnlCNS);
  const margin = toBig(p.marginCNS);
  const lv = levelFor(a.levels, p);
  const lvText = lv ? [lv.stopLossPNS !== "0" ? `SL ${price(lv.stopLossPNS, priceDec)}` : null, lv.takeProfitPNS !== "0" ? `TP ${price(lv.takeProfitPNS, priceDec)}` : null].filter(Boolean).join(" · ") : "No stop-loss or take-profit";
  return (
    <Press testID={`position.${sym}.${p.side}`} onPress={() => router.push({ pathname: "/position", params: { account: a.account, perp: String(p.perpId), side: p.side } })} style={{ paddingVertical: 12, paddingHorizontal: 14, gap: 10 }}>
      <Row gap={12}>
        <MarketBadge symbol={sym} size={36} />
        <View style={{ flex: 1 }}>
          <Row gap={6}>
            <T size={14} w={600}>
              {sym}
            </T>
            <Side side={p.side} />
            <T size={13} mono color="mu">
              {leverage(p.leverageHdths)}
            </T>
          </Row>
          <T size={12} mono color="mu">
            {lots(p.lotLNS, lotDec)} {sym} · {ausd(p.notionalCNS)} AUSD
          </T>
        </View>
        <View style={{ alignItems: "flex-end" }}>
          <T size={14} w={600} mono color={pnl >= 0n ? "posI" : "neg"}>
            {ausdSigned(pnl)}
          </T>
          <T size={12} mono color="mu">
            {pctSigned(margin > 0n ? (Number(pnl) / Number(margin)) * 100 : 0)} ROE
          </T>
        </View>
      </Row>
      <View style={{ flexDirection: "row", gap: 6, paddingVertical: 8, paddingHorizontal: 10, borderRadius: 10, backgroundColor: c.sf2 }}>
        {[
          ["Entry", price(p.entryPNS, priceDec)],
          ["Mark", price(p.markPNS, priceDec)],
          ["Liq.", p.liqPNS !== "0" ? price(p.liqPNS, priceDec) : "—"],
          ["Leader", shortAddr(leaderAddr, 4, 0).replace("…", "")],
        ].map(([k, v]) => (
          <View key={k} style={{ flex: 1 }}>
            <T size={11} color="mu">
              {k}
            </T>
            <T size={12} mono lines={1}>
              {v}
            </T>
          </View>
        ))}
      </View>
      <Row gap={6}>
        <Icon name="flag" size={13} color={lv ? c.ac : c.mu} />
        <T size={12} mono color="mu" style={{ flex: 1 }} lines={1} testID={`position.${sym}.${p.side}.levels`}>
          {lvText}
        </T>
        <Icon name="chev" size={16} color={c.mu} />
      </Row>
    </Press>
  );
}

export default function Positions() {
  return useLayout() === "laptop" ? <LaptopPositions /> : <PhonePositions />;
}

function PhonePositions() {
  const c = useColors();
  const cfg = useConfig().data;
  const { byPerp } = useMarkets(cfg);
  const { totals, isError, refetch, isLoading } = useTotals();
  const [group, setGroup] = useState<"market" | "leader">("market");
  const [confirm, setConfirm] = useState(false);
  const act = useOwnerAction();

  const leaderOf = (a: MirrorAccount, id: number) => (a.leader && a.leader.accountId === id ? a.leader.address : leaderAddressOf(id));
  // Several leaders share one account: each position is attributed to the leader whose copy opened it.
  const all = useMemo(
    () => (totals?.accounts ?? []).flatMap((a) => a.positions.map((p) => ({ p, a, addr: leaderOf(a, p.leaderAccountId) ?? (p.leaderAccountId ? undefined : a.leader?.address) }))),
    [totals],
  );
  const sorted = group === "market" ? [...all].sort((x, y) => (byPerp.get(x.p.perpId)?.symbol ?? "").localeCompare(byPerp.get(y.p.perpId)?.symbol ?? "")) : all;
  const attr = useMemo(() => {
    const rows = (totals?.accounts ?? []).map((a) => {
      const u = a.pnl.byLeader.reduce((s, x) => s + toBig(x.unrealisedCNS), 0n);
      const r = a.pnl.byLeader.reduce((s, x) => s + toBig(x.realisedCNS), 0n);
      return { a, u, r, t: u + r };
    });
    const max = rows.reduce((m, x) => (x.t > m ? x.t : m), 1n);
    return { rows, max };
  }, [totals]);

  if (!totals) {
    return (
      <Screen>
        <AppBar title="Positions" />
        {isError ? <ErrorBanner title={failTitle("mirror")} body={mirrorDownBody("positions")} onRetry={refetch} /> : <LoadingBlock label={isLoading ? "Loading positions" : ""} />}
      </Screen>
    );
  }
  const total = totals.upnl + totals.realised;
  return (
    <Screen testID="portfolio.screen">
      <AppBar title="Positions" />
      <Scroll testID="positions.scroll">
        <View style={{ paddingHorizontal: 20, paddingTop: 4, gap: 6 }}>
          <Lbl>Total PnL</Lbl>
          <Row align="flex-end" gap={6}>
            <T testID="positions.total.pnl" size={40} w={500} mono lh={44} color={total >= 0n ? "posI" : "neg"} style={{ letterSpacing: -1.4 }}>
              {ausdSigned(total)}
            </T>
            <T size={15} w={500} color="mu" style={{ marginBottom: 6 }}>
              AUSD
            </T>
          </Row>
          <Row style={{ marginTop: 4 }}>
            {[
              ["Unrealised", ausdSigned(totals.upnl), totals.upnl >= 0n ? "posI" : "neg"],
              ["Realised", ausdSigned(totals.realised), totals.realised >= 0n ? "posI" : "neg"],
              ["Margin in use", ausd(totals.margin), "tx"],
            ].map(([k, v, col]) => (
              <View key={k} style={{ flex: 1, gap: 2 }}>
                <T size={12} color="mu">
                  {k}
                </T>
                <T size={16} w={500} mono color={col}>
                  {v}
                </T>
              </View>
            ))}
          </Row>
        </View>

        {totals.accounts.length ? (
          <View style={{ paddingHorizontal: 20, gap: 10 }}>
            <Row justify="space-between">
              <T size={16} w={600}>
                PnL by leader
              </T>
              <T size={12} color="mu">
                since follow
              </T>
            </Row>
            <Card style={{ padding: 14, gap: 14 }} testID="positions.attribution">
              {attr.rows.map(({ a, u, r, t }) => (
                <Row key={a.account} gap={10} align="flex-start">
                  <Identicon seed={a.leader?.address ?? a.account} size={28} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Row>
                      <T size={13} w={500} mono style={{ flex: 1 }}>
                        {shortAddr(a.leader?.address ?? a.account)}
                      </T>
                      <T size={13} w={600} mono color={t >= 0n ? "posI" : "neg"}>
                        {ausdSigned(t)}
                      </T>
                    </Row>
                    <View style={{ flexDirection: "row", gap: 2, height: 8, marginTop: 6, marginBottom: 4 }}>
                      <View style={{ width: `${Math.max(0, Number(u > 0n ? u : 0n) / Number(attr.max)) * 100}%`, backgroundColor: c.pos, borderTopLeftRadius: 2, borderBottomLeftRadius: 2 }} />
                      <View style={{ width: `${Math.max(0, Number(r > 0n ? r : 0n) / Number(attr.max)) * 100}%`, backgroundColor: c.pos, opacity: 0.45, borderTopRightRadius: 4, borderBottomRightRadius: 4 }} />
                      {t < 0n ? <View style={{ width: `${Math.min(100, (Number(-t) / Number(attr.max)) * 100)}%`, backgroundColor: c.neg, borderRadius: 2 }} /> : null}
                    </View>
                    <T size={12} mono color="mu">
                      Unrealised {ausdSigned(u)} · Realised {ausdSigned(r)}
                    </T>
                  </View>
                </Row>
              ))}
              <Row gap={6}>
                <View style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: c.pos }} />
                <T size={12} color="mu">
                  Unrealised
                </T>
                <View style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: c.pos, opacity: 0.45, marginLeft: 6 }} />
                <T size={12} color="mu">
                  Realised
                </T>
              </Row>
            </Card>
          </View>
        ) : null}

        {totals.accounts.filter((a) => haltedPerps(a).length).map((a) => (
          <View key={a.account} style={{ paddingHorizontal: 20 }}>
            <HaltNotice symbols={haltedPerps(a).map((id) => byPerp.get(id)?.symbol ?? `#${id}`)} busy={act.busy === "resume"} onResume={() => act.resumeMarkets(a)} />
          </View>
        ))}
        {act.error && !confirm ? <T size={12} color="neg" style={{ paddingHorizontal: 20 }} testID="positions.error">{act.error}</T> : null}
        <View style={{ paddingHorizontal: 20, gap: 10 }}>
          <Row justify="space-between">
            <Row gap={6}>
              <T size={16} w={600}>
                Open positions
              </T>
              <T size={16} w={600} mono color="mu" testID="portfolio.positions.count">
                {all.length}
              </T>
            </Row>
            <Seg
              small
              testIDPrefix="positions.group"
              value={group}
              onChange={setGroup}
              options={[
                { key: "market", label: "Market" },
                { key: "leader", label: "Leader" },
              ]}
            />
          </Row>
          {all.length ? (
            <Card list>
              {sorted.map(({ p, a, addr }, i) => {
                const m = byPerp.get(p.perpId);
                return <PosRow key={`${p.perpId}-${p.side}-${i}`} p={p} a={a} leaderAddr={addr} sym={m?.symbol ?? `#${p.perpId}`} lotDec={m?.lotDecimals ?? 0} priceDec={m?.priceDecimals ?? 0} />;
              })}
            </Card>
          ) : null}
          {all.length ? (
            <Button title="Close all positions" kind="dngO" size="md" icon="close" onPress={() => setConfirm(true)} testID="portfolio.closeAll" />
          ) : (
            <Card style={{ padding: 20, alignItems: "center", gap: 6 }} testID="positions.empty">
              <T size={15} w={600}>
                No open positions
              </T>
              <T size={13} color="mu" center>
                {totals.accounts.length ? "Your leaders are flat right now. New copies appear here." : "Follow a leader to start copying."}
              </T>
              {totals.accounts.length ? null : <Button title="Browse leaders" onPress={() => router.push("/leaders")} style={{ alignSelf: "stretch", marginTop: 6 }} />}
            </Card>
          )}
        </View>
      </Scroll>
      <CloseAllDialog
        visible={confirm}
        accounts={totals.accounts}
        cfg={cfg}
        busy={act.busy === "closeAll"}
        error={act.error}
        onCancel={() => {
          setConfirm(false);
          act.clearError();
        }}
        onConfirm={async () => {
          const r = await act.closeAll(totals.accounts);
          if (r) setConfirm(false);
        }}
      />
    </Screen>
  );
}
