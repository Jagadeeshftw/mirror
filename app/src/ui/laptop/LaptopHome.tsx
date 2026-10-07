// Laptop Home: equity chart with KPIs, the follows as a table with budget, margin and loss stops,
// the deposit split and recent copies in the right column. Watch-mode states use LaptopWatch.
import { router } from "expo-router";
import React, { useMemo, useState } from "react";
import { View } from "react-native";
import { ausd, ausdSigned, bps, dateShort, pctSigned, shortAddr, toBig } from "../../lib/format";
import type { FeedEvent, MirrorAccount } from "../../lib/types";
import { useConfig, useFeedAll, type Totals } from "../../state/data";
import { useHomeState } from "../../state/home";
import { LineChart } from "../charts";
import { CopyDetailSheet } from "../copyDetail";
import { BlockedSheet, RecentRow } from "../feed";
import { followerChoices, ShareSheet } from "../shareSheet";
import { Icon } from "../icons";
import { Button, ChipS, ErrorBanner, Identicon, KV, Link, Meter, Row, T } from "../kit";
import { useColors } from "../theme";
import { LaptopWatch } from "./LaptopWatch";
import { LCard, LaptopPage } from "./Top";
import { Table, type Col } from "./Table";
import { isMultiLeader, leaderBooks, splitTotals, type LeaderBook } from "../../lib/budgets";
import { useOwnerAction } from "../../state/ownerAction";
import { lossStopText, statusChip, useLeaderNames } from "../budgets";

interface HomeRow {
  key: string;
  a: MirrorAccount;
  leaderId: number;
  address?: string;
  book?: LeaderBook;
  status: React.ReactNode;
  budget: bigint;
  margin: bigint;
  pnl: bigint;
  loss: string;
  open: number;
}

const COLORS = (c: ReturnType<typeof useColors>) => [c.ac, c.dark ? "#B4ABFF" : "#9C92FF", c.mu, c.wrn];

function series(accounts: MirrorAccount[], wallet: bigint): number[] {
  const n = Math.max(0, ...accounts.map((a) => a.equityHistory?.length ?? 0));
  if (n < 2) return [];
  return Array.from({ length: n }, (_, i) => accounts.reduce((v, a) => {
    const h = a.equityHistory ?? [];
    const j = h.length - n + i;
    return v + (j >= 0 ? h[j].v : (h[0]?.v ?? 0)) / 1e6;
  }, Number(wallet) / 1e6));
}

export function LaptopHome() {
  const s = useHomeState();
  if (s.mode !== "funded" || !s.totals) return <LaptopWatch s={s} />;
  return <FundedLaptop totals={s.totals} mirrorDown={s.phase === "down"} monadDown={s.rpc.isError} onRetry={s.retry} block={s.rpc.data ? Number(s.rpc.data.block) : null} />;
}

function FundedLaptop({ totals, mirrorDown, monadDown, onRetry, block }: { totals: Totals; mirrorDown: boolean; monadDown: boolean; onRetry: () => void; block: number | null }) {
  const c = useColors();
  const feed = useFeedAll();
  const cfg = useConfig().data;
  const [blocked, setBlocked] = useState<FeedEvent | null>(null);
  const [copy, setCopy] = useState<FeedEvent | null>(null);
  const [sharing, setSharing] = useState(false);
  const data = useMemo(() => series(totals.accounts, totals.wallet), [totals]);
  const first = totals.accounts[0]?.equityHistory?.[0]?.t;
  const base = totals.equity - totals.today;
  const palette = COLORS(c);
  const sumDep = totals.accounts.reduce((s, a) => s + toBig(a.netDepositsCNS), 0n) || 1n;
  const recent = feed.events.filter((e) => e.kind === "Mirrored" || e.kind === "Blocked").slice(0, 6);
  const dd = totals.accounts.map((a) => a.policy?.drawdownBps ?? 0);
  const sameDd = dd.every((x) => x === dd[0]) ? dd[0] : null;
  const names = useLeaderNames(totals.accounts);
  const act = useOwnerAction();
  const multi = totals.accounts.some(isMultiLeader);
  // One row per leader: a multi-leader account shows each leader's book (leaderBook); a single-leader follow
  // keeps its account numbers (deposit as budget, account loss stop).
  const rows: HomeRow[] = totals.accounts.flatMap((a): HomeRow[] => {
    if (!isMultiLeader(a)) {
      const p = toBig(a.equityCNS) - toBig(a.netDepositsCNS);
      const d = a.policy?.drawdownBps ?? 0;
      const at = (toBig(a.netDepositsCNS) * BigInt(10_000 - d)) / 10_000n;
      const status = a.stops?.drawdownHit || a.stops?.dailyLossHit ? <ChipS label="Stopped by loss stop" tone="neg" icon="pause" /> : a.paused ? <ChipS label="Paused" tone="wrn" icon="pause" /> : <ChipS label="Copying" tone="ok" />;
      return [{ key: a.account, a, leaderId: a.leader?.accountId ?? 0, address: a.leader?.address ?? a.account, status, budget: toBig(a.netDepositsCNS), margin: toBig(a.marginCNS), pnl: p, loss: d ? `${ausd(at)} · ${ausd(toBig(a.equityCNS) - at)} away` : "Off", open: a.positions.length }];
    }
    return leaderBooks(a).map((b) => ({ key: `${a.account}:${b.leaderId}`, a, leaderId: b.leaderId, address: names.address(b.leaderId), book: b, status: statusChip(b), budget: b.budgetCNS, margin: b.marginCNS, pnl: b.pnlCNS, loss: lossStopText(b).replace("Loss stop at ", "").replace("Loss stop ", ""), open: b.positions.length }));
  });
  const cols: Col<HomeRow>[] = [
    { key: "leader", label: "Leader", flex: 2, render: (r) => <Row gap={8}><Identicon seed={r.address ?? String(r.leaderId)} size={28} /><T size={13} mono lines={1}>{r.book ? names.name(r.leaderId) : shortAddr(r.address)}</T></Row> },
    { key: "status", label: "Status", flex: 1.9, render: (r) => r.status },
    { key: "budget", label: "Budget", flex: 0.8, align: "right", render: (r) => <T size={13} mono>{ausd(r.budget)}</T> },
    { key: "margin", label: "Margin used", flex: 1.6, render: (r) => (r.book?.stopped ? <T size={12} color="mu">Positions closed</T> : <Row gap={8} style={{ alignSelf: "stretch" }}><View style={{ flex: 1 }}><Meter height={6} parts={[{ frac: Number(r.margin) / Math.max(1, Number(r.budget)), color: c.ac }]} /></View><T size={12} mono>{ausd(r.margin)}</T></Row>) },
    { key: "pnl", label: "PnL", flex: 0.8, align: "right", render: (r) => <T size={13} mono color={r.pnl >= 0n ? "posI" : "neg"}>{ausdSigned(r.pnl)}</T> },
    { key: "stop", label: "Loss stop", flex: 2, align: "right", render: (r) => (r.book?.status === "stopped" ? <Row gap={8}><T size={12} mono>{r.loss}</T><Link title={act.busy === "rearm" ? "Waiting" : "Re-arm"} onPress={() => act.rearm(r.a, r.leaderId)} testID={`home.leaders.rearm.${r.leaderId}`} /></Row> : <T size={12} mono color={r.loss === "Off" ? "mu" : "tx"}>{r.loss}</T>) },
    { key: "open", label: "Open", flex: 0.5, align: "right", render: (r) => <T size={13} mono>{r.open}</T> },
  ];
  // Deposit split: every leader's budget (multi-leader accounts) or each follow's deposit, then what is not assigned.
  const segs = totals.accounts.flatMap((a) => (isMultiLeader(a) ? leaderBooks(a).filter((b) => b.inPolicy).map((b) => ({ key: `${a.account}:${b.leaderId}`, label: names.name(b.leaderId), v: b.budgetCNS, stopped: b.stopped })) : [{ key: a.account, label: shortAddr(a.leader?.address ?? a.account), v: toBig(a.netDepositsCNS), stopped: false }]));
  const unassigned = totals.accounts.filter(isMultiLeader).reduce((s, a) => { const u = splitTotals(toBig(a.netDepositsCNS), leaderBooks(a).filter((b) => b.inPolicy)).unassigned; return s + (u > 0n ? u : 0n); }, 0n);
  const capRoom = totals.accounts.reduce((s, a) => s + (toBig(a.depositCapCNS) > toBig(a.netDepositsCNS) ? toBig(a.depositCapCNS) - toBig(a.netDepositsCNS) : 0n), 0n);
  const multiAccount = totals.accounts.find(isMultiLeader);
  return (
    <LaptopPage testID="home.screen" title="Home" sub={`All numbers read from Monad${block ? ` · block ${block.toLocaleString("en-US")}` : ""}`}>
      {mirrorDown ? <ErrorBanner testID="home.offline" title="Can't reach Mirror" body="Our server isn't answering. Balances are the last read; your follows keep running onchain." onRetry={onRetry} /> : null}
      {monadDown ? <ErrorBanner testID="home.monadDown" title="Can't reach Monad" body="The Monad RPC isn't answering from this browser. Mirror's server is fine and copying continues." onRetry={onRetry} /> : null}
      <View style={{ flexDirection: "row", gap: 16, flex: 1 }}>
        <View style={{ flex: 1, gap: 16, minWidth: 0 }}>
          <LCard testID="home.laptop.equity">
            <Row align="flex-start" gap={24}>
              <View>
                <T size={12} w={500} color="mu" upper>Equity</T>
                <Row align="flex-end" gap={6}>
                  <T testID="home.equity" size={40} w={500} mono lh={44} style={{ letterSpacing: -1.4 }}>{ausd(totals.equity)}</T>
                  <T size={14} w={500} color="mu" style={{ marginBottom: 6 }}>AUSD</T>
                </Row>
                <Row gap={6}><T size={13} w={600} mono color={totals.today >= 0n ? "posI" : "neg"}>{`${ausdSigned(totals.today)} (${pctSigned(base > 0n ? (Number(totals.today) / Number(base)) * 100 : 0, 2)})`}</T><T size={13} color="mu">today</T></Row>
              </View>
              <Row gap={24} style={{ flex: 1, justifyContent: "flex-end" }}>
                {[["AUSD balance", ausd(totals.balance), "tx", "home.kv.balance"], ["Unrealised", ausdSigned(totals.upnl), totals.upnl >= 0n ? "posI" : "neg", "home.kv.upnl"], ["Realised", ausdSigned(totals.realised), totals.realised >= 0n ? "posI" : "neg", "home.kv.rpnl"], ["Margin in use", ausd(totals.margin), "tx", "home.kv.margin"]].map(([k, v, col, id]) => (
                  <View key={k} style={{ gap: 2 }}><T size={12} color="mu">{k}</T><T testID={id} size={18} w={500} mono color={col}>{v}</T></View>
                ))}
              </Row>
            </Row>
            {data.length > 1 ? <LineChart data={data} height={240} padT={14} padB={18} padR={44} color={data[data.length - 1] >= data[0] ? c.pos : c.neg} xTicks={first ? [[0, dateShort(first), "start"], [data.length - 1, "Today", "end"]] : []} testID="home.chart" /> : null}
          </LCard>
          <LCard style={{ flex: 1 }} testID="home.laptop.leaders">
            <Row gap={16}><T size={15} w={600} style={{ flex: 1 }}>Leaders</T><T size={12} color="mu">budget · margin used · PnL · loss stop</T><Link title="Share" icon="share" onPress={() => setSharing(true)} testID="home.share" /></Row>
            <Table testIDPrefix="home.leaders" cols={cols} rows={rows} rowKey={(r) => r.key} rowStyle={(r) => (r.book?.status === "stopped" ? { backgroundColor: c.negS } : undefined)} onRow={(r) => r.leaderId && router.push({ pathname: "/leaders", params: { leader: String(r.leaderId) } })} />
            <View style={{ flex: 1 }} />
            <Row gap={12} style={{ padding: 14, borderRadius: 12, backgroundColor: c.acs }} testID="home.accountStop">
              <Icon name="shield" size={18} color={c.ac} />
              <View style={{ flex: 1 }}>
                <T size={13} w={600}>{sameDd ? `Account loss stop ${bps(sameDd)}` : "Account loss stops"}</T>
                <T size={12} mono color="mu">{sameDd ? `Each follow stops at ${bps(sameDd)} below its peak · executable by anyone` : "Set per follow; see each leader's row"}</T>
              </View>
            </Row>
          </LCard>
        </View>
        <View style={{ width: 360, gap: 16 }}>
          <LCard testID="home.laptop.split">
            <Row><T size={15} w={600} style={{ flex: 1 }}>Deposit split</T><T size={13} mono>{ausd(totals.deposited)} AUSD</T></Row>
            <Meter height={12} parts={segs.map((x, i) => ({ frac: Number(x.v) / Number(sumDep), color: x.stopped ? c.mu : palette[i % palette.length] }))} />
            {segs.map((x, i) => (
              <Row key={x.key} gap={8} testID={`home.split.row.${i}`}><View style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: x.stopped ? c.mu : palette[i % palette.length] }} /><T size={13} mono style={{ flex: 1 }}>{x.label}{x.stopped ? " · stopped" : ""}</T><T size={13} mono>{ausd(x.v)}</T></Row>
            ))}
            <View>
              {multi ? <KV k="Not assigned" v={ausd(unassigned)} testID="home.split.unassigned" /> : <KV k="In your wallet" v={`${ausd(totals.wallet)} AUSD`} />}
              <KV k="Withdrawable now" v={`${ausd(totals.withdrawable)} AUSD`} />
              <KV k="Beta cap room" v={`${ausd(capRoom)} AUSD`} last />
            </View>
            <Row gap={10}>
              <Button title="Add leader" icon="plus" kind="ton" size="md" flex onPress={() => router.push("/leaders")} testID="home.addLeader" />
              {multiAccount ? (
                <Button title="Edit budgets" icon="split" kind="out" size="md" flex onPress={() => router.push({ pathname: "/budgets", params: { account: multiAccount.account } })} testID="home.editBudgets" />
              ) : (
                <Button title="Withdraw" icon="arrup" kind="out" size="md" flex onPress={() => router.push("/withdraw")} testID="home.withdraw" />
              )}
            </Row>
            {act.error ? <T size={12} color="neg" testID="home.leader.error">{act.error}</T> : null}
          </LCard>
          <LCard style={{ flex: 1 }} testID="home.laptop.recent">
            <Row><T size={15} w={600} style={{ flex: 1 }}>Recent copies</T><Link title="Feed" onPress={() => router.navigate("/feed")} testID="home.feed.link" /></Row>
            <View style={{ marginHorizontal: -14 }}>
              {recent.map((e) => <RecentRow key={e.id} e={e} cfg={cfg} onPress={() => (e.kind === "Blocked" ? setBlocked(e) : setCopy(e))} />)}
            </View>
          </LCard>
        </View>
      </View>
      <ShareSheet visible={sharing} onClose={() => setSharing(false)} targets={followerChoices(totals.accounts)} />
      <BlockedSheet e={blocked} cfg={cfg} account={totals.accounts.find((a) => a.account === blocked?.account)} onClose={() => setBlocked(null)} />
      <CopyDetailSheet e={copy} cfg={cfg} policy={totals.accounts.find((a) => a.account === copy?.account)?.policy} onClose={() => setCopy(null)} />
    </LaptopPage>
  );
}
