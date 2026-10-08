// Home for a funded account (one or more follows).
import { failTitle, mirrorDownBody } from "../lib/conn";
import { router } from "expo-router";
import React, { useMemo, useState } from "react";
import { View } from "react-native";
import { followLimits } from "../lib/policy";
import { ausd, ausdSigned, dateShort, pctSigned, shortAddr, toBig, leverage } from "../lib/format";
import type { FeedEvent, MirrorAccount } from "../lib/types";
import { useConfig, useFeedAll, type Totals } from "../state/data";
import { useSession } from "../state/session";
import { LineChart } from "./charts";
import { BlockedSheet, RecentRow } from "./feed";
import { Icon } from "./icons";
import { Button, Card, ChipS, ErrorBanner, Identicon, Lbl, Link, NansenLabel, Press, Row, T } from "./kit";
import { CopyDetailSheet } from "./copyDetail";
import { followerChoices, ShareSheet } from "./shareSheet";
import { useColors } from "./theme";
import { isMultiLeader, leaderBooks } from "../lib/budgets";
import { useOwnerAction } from "../state/ownerAction";
import { DepositSplitCard, LeaderBudgetRow, splitPalette, stoppedEvent, useLeaderNames } from "./budgets";

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

/** Single-leader follows as before; an account with several leaders shows its deposit split and a row per leader. */
function FollowList({ accounts, events }: { accounts: MirrorAccount[]; events: FeedEvent[] }) {
  const c = useColors();
  const names = useLeaderNames(accounts);
  const act = useOwnerAction();
  const pal = splitPalette(c);
  const single = accounts.filter((a) => !isMultiLeader(a));
  const multi = accounts.filter(isMultiLeader);
  return (
    <>
      {multi.map((a) => {
        const books = leaderBooks(a);
        return (
          <View key={a.account} style={{ gap: 10 }}>
            <DepositSplitCard a={a} books={books} name={names.name} testID={`home.split.${a.account}`} />
            <Card list testID={`home.leaders.${a.account}`}>
              {books.map((b, i) => (
                <LeaderBudgetRow
                  key={b.leaderId}
                  b={b}
                  name={names.name(b.leaderId)}
                  address={names.address(b.leaderId)}
                  color={pal[i % pal.length]}
                  stop={stoppedEvent(events, b)}
                  busy={act.busy === "rearm"}
                  onRearm={b.status === "stopped" ? () => act.rearm(a, b.leaderId) : undefined}
                  onPress={() => router.push({ pathname: "/leader/[id]", params: { id: String(b.leaderId) } })}
                  testID={`home.leader.${b.leaderId}`}
                />
              ))}
            </Card>
            {act.error ? <T size={12} color="neg" testID="home.leader.error">{act.error}</T> : null}
          </View>
        );
      })}
      {single.length ? (
        <Card list>
          {single.map((a) => (
            <FollowRow key={a.account} a={a} onPress={() => a.leader && router.push({ pathname: "/leader/[id]", params: { id: String(a.leader.accountId) } })} />
          ))}
        </Card>
      ) : null}
    </>
  );
}

/** Home for an account with at least one follow. */
export function FundedHome({ totals, mirrorDown, monadDown, onRetry }: { totals: Totals; mirrorDown: boolean; monadDown: boolean; onRetry: () => void }) {
  const c = useColors();
  const cfg = useConfig().data;
  const feed = useFeedAll();
  const { account: me } = useSession();
  const [blocked, setBlocked] = useState<FeedEvent | null>(null);
  const [copy, setCopy] = useState<FeedEvent | null>(null);
  const [sharing, setSharing] = useState(false);
  const series = useMemo(() => sumHistory(totals.accounts, totals.wallet), [totals]);
  const hasFollows = totals.accounts.length > 0;
  const base = totals.equity - totals.today;
  const recent = feed.events.filter((e) => e.kind === "Mirrored" || e.kind === "Blocked").slice(0, 3);
  const n = series.length;
  const first = totals.accounts[0]?.equityHistory?.[0]?.t;

  return (
    <>
        {mirrorDown ? <ErrorBanner testID="home.offline" title={failTitle("mirror")} body={mirrorDownBody("funded")} onRetry={onRetry} /> : null}
        {monadDown ? <ErrorBanner testID="home.monadDown" title="Can't reach Monad" body="The Monad RPC isn't answering from this device. Mirror's server is fine and copying continues." onRetry={onRetry} /> : null}
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
            {hasFollows ? `${ausd(totals.deposited)} AUSD · ${ausd(followLimits(cfg).capCNS)} per follow` : `${ausd(followLimits(cfg).capCNS)} AUSD per follow`}
          </T>
        </View>

        {hasFollows ? (
          <>
            <View style={{ paddingHorizontal: 20, gap: 10 }}>
              <Row justify="space-between">
                <Row gap={6}>
                  <T size={16} w={600}>
                    {totals.accounts.some(isMultiLeader) ? "Leaders" : "Following"}
                  </T>
                  <T size={16} w={600} mono color="mu" testID="home.following.count">
                    {totals.accounts.reduce((n, a) => n + (isMultiLeader(a) ? leaderBooks(a).length : 1), 0)}
                  </T>
                </Row>
                <Row gap={16}>
                  <Link title="Share" icon="share" onPress={() => setSharing(true)} testID="home.share" />
                  {totals.accounts.some(isMultiLeader) ? <Link title="Budgets" onPress={() => router.push("/budgets")} testID="home.budgets" /> : null}
                  <Link title="Manage" onPress={() => router.push("/account")} testID="home.manage" />
                </Row>
              </Row>
              <FollowList accounts={totals.accounts} events={feed.events} />
            </View>
            <View style={{ paddingHorizontal: 20, gap: 10 }}>
              <Row justify="space-between">
                <T size={16} w={600}>
                  Recent copies
                </T>
                <Link title="Feed" onPress={() => router.push("/feed")} testID="home.feed.link" />
              </Row>
              <Card list>
                {recent.length ? recent.map((e) => <RecentRow key={e.id} e={e} cfg={cfg} onPress={() => (e.kind === "Blocked" ? setBlocked(e) : e.kind === "Mirrored" ? setCopy(e) : router.push("/feed"))} />) : (
                  <View style={{ padding: 14 }}>
                    <T size={13} color="mu">
                      No copies yet. They appear here the moment your leader trades.
                    </T>
                  </View>
                )}
              </Card>
            </View>
          </>
        ) : null}

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
      <BlockedSheet e={blocked} cfg={cfg} account={totals.accounts.find((a) => a.account === blocked?.account)} onClose={() => setBlocked(null)} />
      <ShareSheet visible={sharing} onClose={() => setSharing(false)} targets={followerChoices(totals.accounts)} />
      <CopyDetailSheet e={copy} cfg={cfg} policy={totals.accounts.find((a) => a.account === copy?.account)?.policy} onClose={() => setCopy(null)} />
    </>
  );
}
