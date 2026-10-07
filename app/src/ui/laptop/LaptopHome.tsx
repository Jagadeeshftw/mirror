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
  const cols: Col<MirrorAccount>[] = [
    { key: "leader", label: "Leader", flex: 1.6, render: (a) => <Row gap={8}><Identicon seed={a.leader?.address ?? a.account} size={28} /><T size={13} mono>{shortAddr(a.leader?.address ?? a.account)}</T></Row> },
    { key: "status", label: "Status", flex: 1.3, render: (a) => (a.stops?.drawdownHit || a.stops?.dailyLossHit ? <ChipS label="Stopped by loss stop" tone="neg" icon="pause" /> : a.paused ? <ChipS label="Paused" tone="wrn" icon="pause" /> : <ChipS label="Copying" tone="ok" />) },
    { key: "budget", label: "Budget", align: "right", render: (a) => <T size={13} mono>{ausd(a.netDepositsCNS)}</T> },
    { key: "margin", label: "Margin used", flex: 1.6, render: (a) => <Row gap={8} style={{ alignSelf: "stretch" }}><View style={{ flex: 1 }}><Meter height={6} parts={[{ frac: Number(a.marginCNS) / Math.max(1, Number(a.netDepositsCNS)), color: c.ac }]} /></View><T size={12} mono>{ausd(a.marginCNS)}</T></Row> },
    { key: "pnl", label: "PnL", align: "right", render: (a) => { const p = toBig(a.equityCNS) - toBig(a.netDepositsCNS); return <T size={13} mono color={p >= 0n ? "posI" : "neg"}>{ausdSigned(p)}</T>; } },
    { key: "stop", label: "Loss stop", flex: 2, align: "right", render: (a) => { const d = a.policy?.drawdownBps ?? 0; if (!d) return <T size={12} color="mu">Off</T>; const at = (toBig(a.netDepositsCNS) * BigInt(10_000 - d)) / 10_000n; return <T size={12} mono>{`${ausd(at)} · ${ausd(toBig(a.equityCNS) - at)} away`}</T>; } },
    { key: "open", label: "Open", flex: 0.5, align: "right", render: (a) => <T size={13} mono>{a.positions.length}</T> },
  ];
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
            <Table testIDPrefix="home.leaders" cols={cols} rows={totals.accounts} rowKey={(a) => a.account} onRow={(a) => a.leader && router.push({ pathname: "/leaders", params: { leader: String(a.leader.accountId) } })} />
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
            <Meter height={12} parts={totals.accounts.map((a, i) => ({ frac: Number(toBig(a.netDepositsCNS)) / Number(sumDep), color: palette[i % palette.length] }))} />
            {totals.accounts.map((a, i) => (
              <Row key={a.account} gap={8}><View style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: palette[i % palette.length] }} /><T size={13} mono style={{ flex: 1 }}>{shortAddr(a.leader?.address ?? a.account)}</T><T size={13} mono>{ausd(a.netDepositsCNS)}</T></Row>
            ))}
            <View>
              <KV k="In your wallet" v={`${ausd(totals.wallet)} AUSD`} />
              <KV k="Withdrawable now" v={`${ausd(totals.withdrawable)} AUSD`} />
              <KV k="Beta limit" v="25.00 AUSD per follow" last />
            </View>
            <Row gap={10}>
              <Button title="Add leader" icon="plus" kind="ton" size="md" flex onPress={() => router.push("/leaders")} testID="home.addLeader" />
              <Button title="Withdraw" icon="arrup" kind="out" size="md" flex onPress={() => router.push("/withdraw")} testID="home.withdraw" />
            </Row>
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
