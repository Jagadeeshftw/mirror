// Leader profile as a laptop side panel: PnL and chart, key stats, risk and adversarial flags, a
// 30-day what-if with default limits, alerts and Follow.
import { router } from "expo-router";
import React, { useMemo, useState } from "react";
import { View } from "react-native";
import { MINUS, dateShort, pctSigned, shortAddr } from "../../lib/format";
import { buildPolicy, defaultForm } from "../../lib/policy";
import { useConfig, useFeedAll, useLeader, useTotals } from "../../state/data";
import { findFollow, findUnfollowed } from "../../lib/budgets";
import { DetachedNote, LeaderStoppedCard, UnfollowedNote } from "../leaderStopped";
import { AdversarialFlag } from "../adversarial";
import { LineChart } from "../charts";
import { Icon } from "../icons";
import { Button, IconButton, Identicon, NansenLabel, Note, Row, T } from "../kit";
import { useColors } from "../theme";
import { WhatIfMini } from "../whatif";
import { ShareSheet } from "../shareSheet";
import { StopFollowSheet } from "../stopFollow";
import { useOwnerAction } from "../../state/ownerAction";

export function LeaderPanel({ id, onClose }: { id: number; onClose: () => void }) {
  const c = useColors();
  const cfg = useConfig().data;
  const q = useLeader(id, "30d");
  const { totals } = useTotals();
  const [alerts, setAlerts] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [stopping, setStopping] = useState(false);
  const act = useOwnerAction();
  const l = q.data;
  const follow = findFollow(totals?.accounts, id);
  const following = follow?.account;
  const unfollowed = follow ? null : findUnfollowed(totals?.accounts, id);
  const feed = useFeedAll();
  const policy = useMemo(() => (cfg && l ? buildPolicy({ ...defaultForm(), markets: l.markets.filter((m) => cfg.markets.some((x) => x.symbol === m)) }, id, cfg.markets) : null), [cfg, l, id]);
  if (!l) return <T size={13} color="mu">{q.isError ? "Can't load this leader." : "Loading the profile"}</T>;
  const data = l.equityCurve.map((p) => p.v);
  const t0 = l.equityCurve[0]?.t;
  const t1 = l.equityCurve[l.equityCurve.length - 1]?.t;
  const idx = (t: number) => Math.max(0, l.equityCurve.findIndex((p) => p.t >= t));
  return (
    <View style={{ gap: 14, flex: 1 }} testID="leader.screen">
      <Row gap={12}>
        <Identicon seed={l.address} size={48} />
        <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
          <T size={17} w={500} mono>{shortAddr(l.address)}</T>
          <Row gap={6} style={{ flexWrap: "wrap" }}>{l.nansen.labels.map((x) => <NansenLabel key={x} label={x} />)}</Row>
        </View>
        <IconButton name="share" onPress={() => setSharing(true)} testID="leader.share" />
        <IconButton name="close" onPress={onClose} testID="leaders.panel.close" />
      </Row>
      <ShareSheet visible={sharing} onClose={() => setSharing(false)} targets={[{ key: String(l.accountId), label: shortAddr(l.address), target: { kind: "leader", leaderId: l.accountId, teamRun: l.teamRun } }]} />
      {follow?.book.status === "stopped" ? null : (
        <>
      <Row align="flex-end">
        <View style={{ flex: 1 }}>
          <T size={12} w={500} color="mu" upper>PnL · 30 days</T>
          <T testID="leader.pnl.pct" size={30} w={500} mono lh={34} color={l.pnlPct >= 0 ? "posI" : "neg"}>{pctSigned(l.pnlPct)}</T>
        </View>
        <T size={12} color="mu">{l.followers} followers · score {l.score}</T>
      </Row>
      {data.length > 1 ? (
        <LineChart data={data} height={160} padT={18} padB={18} padR={36} color={c.pos} testID="leader.chart" band={l.drawdown ? { from: idx(l.drawdown.fromT), to: idx(l.drawdown.toT), label: `Max DD ${MINUS}${l.drawdown.pct.toFixed(1)}%` } : null} xTicks={t0 && t1 ? [[0, dateShort(t0), "start"], [data.length - 1, dateShort(t1), "end"]] : []} />
      ) : null}
      <Row align="flex-start">
        {[
          ["Max drawdown", `${MINUS}${l.maxDrawdownPct.toFixed(1)}%`, l.drawdown ? `${l.drawdown.days} days` : "", c.neg],
          ["Win rate", `${l.winRate}%`, `${l.trades} trades`, c.tx],
          ["Avg leverage", `${l.avgLeverage.toFixed(1)}x`, `peak ${l.stats.peakLeverage}x`, l.avgLeverage >= 6 ? c.wrnI : c.tx],
        ].map(([k, v, sub, col]) => (
          <View key={k} style={{ flex: 1, gap: 1 }}>
            <T size={12} color="mu">{k}</T>
            <T size={17} w={500} mono color={col}>{v}</T>
            <T size={12} color="mu">{sub}</T>
          </View>
        ))}
      </Row>
      <AdversarialFlag a={l.adversarial} />
      <View style={{ gap: 10 }} testID="leader.risk.flags">
        {l.riskFlags.filter((f) => f.kind !== "ok").slice(0, l.adversarial?.flagged ? 1 : 2).map((f) => (
          <Row key={f.title} gap={10} align="flex-start">
            <Icon name={f.kind === "info" ? "info" : "warn"} size={18} color={f.kind === "info" ? c.mu : c.wrn} />
            <View style={{ flex: 1 }}>
              <T size={13} w={600}>{f.title}</T>
              <T size={12} color="mu">{f.detail}</T>
            </View>
          </Row>
        ))}
      </View>
        </>
      )}
      {follow?.book.detached ? <DetachedNote book={follow.book} /> : follow?.book.status === "stopped" ? <LeaderStoppedCard account={follow.account} book={follow.book} events={feed.events} cfg={cfg} act={act} /> : unfollowed ? <UnfollowedNote book={unfollowed.book} /> : policy ? <WhatIfMini leaderId={id} policy={policy} depositCNS={12_000_000n} /> : null}
      <View style={{ flex: 1 }} />
      <Row gap={10}>
        <Button icon="bell" kind={alerts ? "ton" : "out"} onPress={() => setAlerts(!alerts)} testID="leader.alerts" style={{ width: 52, paddingHorizontal: 0 }} />
        {following ? (
          <>
            <Button title="Stop following…" kind="out" flex testID="leader.stopFollow" onPress={() => setStopping(true)} />
            {follow?.book.detached ? (
              <Button title={act.busy === "followAgain" ? "Waiting" : "Follow again"} icon="fp" flex testID="leader.followAgain" disabled={!!act.busy} onPress={() => act.followAgain(following, id)} />
            ) : (
              <Button title="Edit limits" icon="edit" flex testID="leader.rules" onPress={() => router.push({ pathname: "/follow/[id]", params: { id: String(id), account: following.account } })} />
            )}
          </>
        ) : (
          <Button title={`Follow ${shortAddr(l.address)}`} flex testID="leader.follow" onPress={() => router.push({ pathname: "/follow/[id]", params: { id: String(id) } })} />
        )}
      </Row>
      {act.error && !stopping ? <Note tone="neg" icon="warn" testID="leader.error">{act.error}</Note> : null}
      <StopFollowSheet visible={stopping} onClose={() => setStopping(false)} account={following} leaderId={id} leaderAddress={l.address} cfg={cfg} act={act} />
    </View>
  );
}
