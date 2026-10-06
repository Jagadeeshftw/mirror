import { router } from "expo-router";
import React, { useMemo, useState } from "react";
import { View } from "react-native";
import Svg, { Circle, Line, Path } from "react-native-svg";
import { ausd, ausdSigned, dateShort, pctSigned, shortAddr, toBig, leverage } from "../../lib/format";
import { MIN_FOLLOW_CNS } from "../../lib/policy";
import type { FeedEvent, MirrorAccount } from "../../lib/types";
import { useConfig, useFeedAll, useLeaders, useTotals } from "../../state/data";
import { AppBar } from "../../ui/chrome";
import { useSession } from "../../state/session";
import { LineChart } from "../../ui/charts";
import { BlockedSheet, RecentRow } from "../../ui/feed";
import { Icon } from "../../ui/icons";
import { Button, Card, ChipS, ErrorBanner, Identicon, Lbl, Link, LoadingBlock, NansenLabel, Press, Row, Screen, Scroll, T } from "../../ui/kit";
import { useColors } from "../../ui/theme";

function sumHistory(accounts: MirrorAccount[], wallet: bigint): number[] {
  const n = Math.max(0, ...accounts.map((a) => a.equityHistory?.length ?? 0));
  if (n < 2) return [];
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    let v = Number(wallet) / 1e6;
    for (const a of accounts) {
      const h = a.equityHistory ?? [];
      const j = h.length - n + i;
      v += (j >= 0 ? h[j].v : (h[0]?.v ?? 0)) / 1e6;
    }
    out.push(v);
  }
  return out;
}

export function FollowRow({ a, onPress }: { a: MirrorAccount; onPress?: () => void }) {
  const pnl = toBig(a.equityCNS) - toBig(a.netDepositsCNS);
  const dep = toBig(a.netDepositsCNS);
  const stopped = a.stops?.dailyLossHit || a.stops?.drawdownHit;
  return (
    <Press testID={`follow.row.${a.account}`} onPress={onPress} style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12, paddingHorizontal: 14 }}>
      <Identicon seed={a.leader?.address ?? a.account} size={40} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Row gap={6} style={{ flexWrap: "wrap" }}>
          <T size={14} w={500} mono>
            {shortAddr(a.leader?.address ?? a.account)}
          </T>
          {a.leader?.labels[0] ? <NansenLabel label={a.leader.labels[0]} /> : null}
        </Row>
        <T size={12} color="mu" mono lines={1}>
          {ausd(dep)} AUSD allocated
          {a.policy ? ` · max ${leverage(a.policy.maxLeverageHdths)}` : ""}
          {a.paused ? " · Paused" : stopped ? " · Stop hit" : ""}
        </T>
      </View>
      <View style={{ alignItems: "flex-end" }}>
        <T size={14} w={600} mono color={pnl >= 0n ? "posI" : "neg"}>
          {ausdSigned(pnl)}
        </T>
        <T size={12} mono color="mu">
          {pctSigned(dep > 0n ? (Number(pnl) / Number(dep)) * 100 : 0)}
        </T>
      </View>
    </Press>
  );
}

function EmptyArt() {
  const c = useColors();
  return (
    <Svg width={120} height={72} viewBox="0 0 120 72">
      <Path d="M8 56 L28 40 L42 46 L58 22" fill="none" stroke={c.mu} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M62 22 L78 46 L92 40 L112 56" fill="none" stroke={c.ac} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" strokeDasharray="4 5" />
      <Line x1={60} y1={8} x2={60} y2={66} stroke={c.bd} strokeWidth={1} />
      <Circle cx={58} cy={22} r={4} fill={c.mu} />
      <Circle cx={62} cy={22} r={4} fill={c.ac} />
    </Svg>
  );
}

export default function Home() {
  const c = useColors();
  const cfg = useConfig().data;
  const { totals, isLoading, isError, refetch } = useTotals();
  const feed = useFeedAll();
  const suggestions = useLeaders("30d", "drawdown");
  const { account: me } = useSession();
  const [blocked, setBlocked] = useState<FeedEvent | null>(null);
  const series = useMemo(() => (totals ? sumHistory(totals.accounts, totals.wallet) : []), [totals]);

  if (!totals) {
    return (
      <Screen testID="home.screen">
        <AppBar brand />
        {isError ? <ErrorBanner title="Can't reach Mirror" body="Your follows keep running onchain and your limits still apply." onRetry={refetch} testID="home.offline" /> : <LoadingBlock label={isLoading ? "Loading your account" : ""} />}
      </Screen>
    );
  }
  const hasFollows = totals.accounts.length > 0;
  const base = totals.equity - totals.today;
  const recent = feed.events.filter((e) => e.kind === "Mirrored" || e.kind === "Blocked").slice(0, 3);
  const n = series.length;
  const first = totals.accounts[0]?.equityHistory?.[0]?.t;

  return (
    <Screen testID="home.screen">
      <AppBar brand />
      <Scroll testID="home.scroll">
        {isError ? <ErrorBanner title="Can't reach Mirror" body="Showing the last data. Your follows keep running onchain." onRetry={refetch} /> : null}
        <View style={{ paddingHorizontal: 20, paddingTop: 4, gap: 6 }}>
          <Row justify="space-between">
            <Lbl>Equity</Lbl>
            <T testID="home.account.address" size={12} mono color="mu">
              {me ? shortAddr(me.address) : ""}
            </T>
          </Row>
          <Row align="flex-end" gap={6}>
            <T testID="home.equity" size={44} w={500} mono lh={48} style={{ letterSpacing: -1.5 }}>
              {ausd(totals.equity)}
            </T>
            <T size={15} w={500} color="mu" style={{ marginBottom: 7 }}>
              AUSD
            </T>
          </Row>
          <Row gap={8}>
            {hasFollows ? (
              <>
                <T size={14} w={600} mono color={totals.today >= 0n ? "posI" : "neg"}>
                  {ausdSigned(totals.today)} ({pctSigned(base > 0n ? (Number(totals.today) / Number(base)) * 100 : 0, 2)})
                </T>
                <T size={13} color="mu">
                  today
                </T>
              </>
            ) : (
              <T size={13} color="mu">
                No PnL yet
              </T>
            )}
          </Row>
          {hasFollows && n > 1 ? (
            <View style={{ marginTop: 6, marginBottom: 2 }}>
              <LineChart data={series} height={84} padT={8} padB={6} padR={6} color={series[n - 1] >= series[0] ? c.pos : c.neg} />
              <Row justify="space-between" style={{ marginTop: 2 }}>
                <T size={12} mono color="mu">
                  {first ? dateShort(first) : ""}
                </T>
                <T size={12} mono color="mu">
                  {first ? dateShort(first + (Date.now() - first) / 2) : ""}
                </T>
                <T size={12} color="mu">
                  Today
                </T>
              </Row>
            </View>
          ) : null}
          {hasFollows ? (
            <Row style={{ paddingTop: 12, paddingBottom: 4, borderTopWidth: 1, borderTopColor: c.bd, marginTop: 4 }}>
              {[
                ["AUSD balance", ausd(totals.balance), "tx", "home.kv.balance"],
                ["Unrealised", ausdSigned(totals.upnl), totals.upnl >= 0n ? "posI" : "neg", "home.kv.upnl"],
                ["Realised", ausdSigned(totals.realised), totals.realised >= 0n ? "posI" : "neg", "home.kv.rpnl"],
              ].map(([k, v, col, id]) => (
                <View key={k} style={{ flex: 1, gap: 2 }}>
                  <T size={12} color="mu">
                    {k}
                  </T>
                  <T testID={id} size={16} w={500} mono color={col}>
                    {v}
                  </T>
                </View>
              ))}
            </Row>
          ) : null}
          <Row gap={10} style={{ marginTop: 8 }}>
            <Button title="Add funds" icon="arrdown" kind="ton" size="md" flex onPress={() => router.push("/funds")} testID="home.addFunds" />
            <Button title="Withdraw" icon="arrup" kind="out" size="md" flex onPress={() => router.push("/withdraw")} testID="home.withdraw" disabled={!hasFollows && totals.wallet === 0n} />
          </Row>
        </View>

        <View style={{ marginHorizontal: 20, flexDirection: "row", gap: 8, alignItems: "center", paddingVertical: 10, paddingHorizontal: 12, borderRadius: 12, backgroundColor: c.sf2 }}>
          <Icon name="shield" size={14} color={c.mu} />
          <T size={12} style={{ flex: 1 }}>
            Beta deposit limit
          </T>
          <T size={12} mono testID="home.beta.cap">
            {hasFollows ? `${ausd(totals.deposited)} AUSD · 25.00 per follow` : "25.00 AUSD per follow"}
          </T>
        </View>

        {hasFollows ? (
          <>
            <View style={{ paddingHorizontal: 20, gap: 10 }}>
              <Row justify="space-between">
                <Row gap={6}>
                  <T size={16} w={600}>
                    Following
                  </T>
                  <T size={16} w={600} mono color="mu">
                    {totals.accounts.length}
                  </T>
                </Row>
                <Link title="Manage" onPress={() => router.push("/account")} testID="home.manage" />
              </Row>
              <Card list>
                {totals.accounts.map((a) => (
                  <FollowRow key={a.account} a={a} onPress={() => a.leader && router.push({ pathname: "/leader/[id]", params: { id: String(a.leader.accountId) } })} />
                ))}
              </Card>
            </View>
            <View style={{ paddingHorizontal: 20, gap: 10 }}>
              <Row justify="space-between">
                <T size={16} w={600}>
                  Recent copies
                </T>
                <Link title="Feed" onPress={() => router.push("/feed")} testID="home.feed.link" />
              </Row>
              <Card list>
                {recent.length ? recent.map((e) => <RecentRow key={e.id} e={e} cfg={cfg} onPress={() => (e.kind === "Blocked" ? setBlocked(e) : router.push("/feed"))} />) : (
                  <View style={{ padding: 14 }}>
                    <T size={13} color="mu">
                      No copies yet. They appear here the moment your leader trades.
                    </T>
                  </View>
                )}
              </Card>
            </View>
          </>
        ) : (
          <>
            <Card style={{ marginHorizontal: 20, paddingVertical: 24, paddingHorizontal: 20, alignItems: "center", gap: 10 }} testID="home.empty">
              <EmptyArt />
              <T size={19} w={600} center>
                {totals.wallet >= MIN_FOLLOW_CNS ? "You're not following anyone yet" : "Add AUSD to start following"}
              </T>
              <T size={13} color="mu" center>
                {totals.wallet >= MIN_FOLLOW_CNS
                  ? "Pick a leader and set your limits. The contract checks every copy against them."
                  : "Each follow needs at least 10 AUSD (Perpl's account minimum), up to 25 AUSD during beta."}
              </T>
              {totals.wallet >= MIN_FOLLOW_CNS ? (
                <Button title="Browse leaders" onPress={() => router.push("/leaders")} style={{ alignSelf: "stretch", marginTop: 6 }} testID="home.browseLeaders" />
              ) : (
                <Button title="Add funds" icon="arrdown" onPress={() => router.push("/funds")} style={{ alignSelf: "stretch", marginTop: 6 }} testID="home.empty.addFunds" />
              )}
            </Card>
            <View style={{ paddingHorizontal: 20, gap: 10 }}>
              <Row justify="space-between">
                <T size={16} w={600}>
                  Good places to start
                </T>
                <T size={12} color="mu">
                  low drawdown
                </T>
              </Row>
              <Card list>
                {(suggestions.data ?? []).slice(0, 2).map((l) => (
                  <Press key={l.accountId} testID={`suggest.${l.accountId}`} onPress={() => router.push({ pathname: "/leader/[id]", params: { id: String(l.accountId) } })} style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12, paddingHorizontal: 14 }}>
                    <Identicon seed={l.address} size={40} />
                    <View style={{ flex: 1 }}>
                      <Row gap={6}>
                        <T size={14} w={500} mono>
                          {shortAddr(l.address)}
                        </T>
                        {l.nansen.labels[0] ? <NansenLabel label={l.nansen.labels[0]} /> : null}
                      </Row>
                      <T size={12} color="mu" mono>
                        Max DD {"−"}
                        {l.maxDrawdownPct}% · Lev {l.avgLeverage}x
                      </T>
                    </View>
                    <View style={{ alignItems: "flex-end" }}>
                      <T size={14} w={600} mono color="posI">
                        {pctSigned(l.pnlPct)}
                      </T>
                      <T size={12} color="mu">
                        30d
                      </T>
                    </View>
                  </Press>
                ))}
              </Card>
            </View>
          </>
        )}

        <Card style={{ marginHorizontal: 20, padding: 14 }} onPress={() => router.push("/demo")} testID="home.demo">
          <Row gap={12}>
            <View style={{ width: 36, height: 36, borderRadius: 12, backgroundColor: c.acs, alignItems: "center", justifyContent: "center" }}>
              <Icon name="feed" size={18} color={c.ac} />
            </View>
            <View style={{ flex: 1 }}>
              <T size={14} w={600}>
                Watch a live copy
              </T>
              <T size={12} color="mu">
                Run a trade on the team-run demo account
              </T>
            </View>
            <ChipS label="Demo" tone="ac" />
            <Icon name="chev" size={18} color={c.mu} />
          </Row>
        </Card>
      </Scroll>
      <BlockedSheet e={blocked} cfg={cfg} account={totals.accounts.find((a) => a.account === blocked?.account)} onClose={() => setBlocked(null)} />
    </Screen>
  );
}
