// One position with its onchain levels: header, price-level chart, levels card, Edit levels / Share,
// copy proof and leader rows, Close position / Stop following. Phone detail screen and laptop side panel.
import { leaderAddressOf } from "../lib/engineShape";
import { router } from "expo-router";
import React, { useMemo, useState } from "react";
import { View } from "react-native";
import { ausd, ausdSigned, leverage, lots, pctSigned, price as fmtPrice, shortAddr, toBig } from "../lib/format";
import { haltedPerps, levelFor } from "../lib/levels";
import type { AppConfig, FeedEvent, MarketConfig, MirrorAccount, Position } from "../lib/types";
import { useFeedAll } from "../state/data";
import { useOwnerAction } from "../state/ownerAction";
import { CopyDetailSheet } from "./copyDetail";
import { Icon, type IconName } from "./icons";
import { Button, MarketBadge, Press, Row, Side, T } from "./kit";
import { LevelChart, LevelsCard } from "./levelCard";
import { ClosePositionDialog, EditLevelsSheet, HaltNotice } from "./levelEdit";
import { followerChoices, ShareSheet } from "./shareSheet";
import { StopFollowSheet } from "./stopFollow";
import { useColors } from "./theme";

function NavRow({ icon, title, sub, onPress, testID, last }: { icon: IconName; title: string; sub: string; onPress?: () => void; testID: string; last?: boolean }) {
  const c = useColors();
  return (
    <Press testID={testID} onPress={onPress} style={{ flexDirection: "row", alignItems: "center", gap: 14, paddingVertical: 13, paddingHorizontal: 14, borderBottomWidth: last ? 0 : 1, borderBottomColor: c.bd }}>
      <Icon name={icon} size={20} color={c.mu} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <T size={14}>{title}</T>
        <T size={12} color="mu" lines={1}>{sub}</T>
      </View>
      <Icon name="chev" size={18} color={c.mu} />
    </Press>
  );
}

export function PositionHeader({ p, m, leaderAddr, big = true }: { p: Position; m: MarketConfig | undefined; leaderAddr?: string; big?: boolean }) {
  const pnl = toBig(p.upnlCNS);
  const margin = toBig(p.marginCNS);
  const roe = margin > 0n ? (Number(pnl) / Number(margin)) * 100 : 0;
  return (
    <Row gap={12} testID="position.header">
      <MarketBadge symbol={m?.symbol ?? "?"} size={40} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Row gap={6}>
          <T size={big ? 16 : 15} w={600}>{m?.symbol}</T>
          <Side side={p.side} />
          <T size={13} mono color="mu">{leverage(p.leverageHdths)}</T>
        </Row>
        <T size={12} mono color="mu" lines={2}>
          {m ? `${lots(p.lotLNS, m.lotDecimals)} ${m.symbol}` : p.lotLNS} · {ausd(p.notionalCNS)} AUSD{leaderAddr ? ` · from ${shortAddr(leaderAddr)}` : ""}
        </T>
      </View>
      <View style={{ alignItems: "flex-end" }}>
        <T size={15} w={600} mono color={pnl >= 0n ? "posI" : "neg"} testID="position.pnl">{ausdSigned(pnl)}</T>
        <T size={12} mono color="mu">{pctSigned(roe)} ROE</T>
      </View>
    </Row>
  );
}

export function PositionBody({ account, p, cfg, laptop }: { account: MirrorAccount; p: Position; cfg: AppConfig | undefined; laptop?: boolean }) {
  const c = useColors();
  const act = useOwnerAction();
  const feed = useFeedAll();
  const [edit, setEdit] = useState(false);
  const [closing, setClosing] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [proof, setProof] = useState<FeedEvent | null>(null);
  const m = cfg?.markets.find((x) => x.perpId === p.perpId);
  const lv = levelFor(account.levels, p);
  const leaderId = p.leaderAccountId || account.leader?.accountId || 0;
  const leaderAddr = account.leader?.accountId === leaderId ? account.leader?.address : leaderAddressOf(leaderId);
  const mine = useMemo(() => feed.events.filter((e) => e.account.toLowerCase() === account.account.toLowerCase() && e.perpId === p.perpId), [feed.events, account.account, p.perpId]);
  const setEvent = mine.find((e) => e.kind === "LevelSet") ?? null;
  const lastCopy = mine.find((e) => e.kind === "Mirrored" && (e.orderType ?? 0) <= 1) ?? null;
  const halted = haltedPerps(account).includes(p.perpId);
  const budget = account.policy?.leaders.find((l) => l.accountId === leaderId)?.budgetCNS;
  const grid = (
    <View style={{ flexDirection: "row", gap: 6, paddingVertical: 8, paddingHorizontal: 10, borderRadius: 10, backgroundColor: c.sf2 }}>
      {[["Entry", fmtPrice(p.entryPNS, m?.priceDecimals ?? 0)], ["Mark", fmtPrice(p.markPNS, m?.priceDecimals ?? 0)], ["Liq.", p.liqPNS !== "0" ? fmtPrice(p.liqPNS, m?.priceDecimals ?? 0) : "—"], ["Margin", ausd(p.marginCNS)]].map(([k, v]) => (
        <View key={k} style={{ flex: 1 }}>
          <T size={11} color="mu">{k}</T>
          <T size={12} mono lines={1}>{v}</T>
        </View>
      ))}
    </View>
  );
  return (
    <View style={{ gap: 14 }} testID="position.detail">
      <PositionHeader p={p} m={m} leaderAddr={leaderAddr} />
      <View style={{ gap: 10, padding: laptop ? 0 : 14, borderRadius: 16, borderWidth: laptop ? 0 : 1, borderColor: c.bd, backgroundColor: laptop ? "transparent" : c.sf }}>
        <LevelChart p={p} lv={lv} m={m} height={laptop ? 190 : 140} testID="position.chart" />
        {grid}
      </View>
      {halted ? <HaltNotice symbols={[m?.symbol ?? `#${p.perpId}`]} busy={act.busy === "resume"} onResume={() => act.resumeMarkets(account)} testID="position.halted" /> : null}
      <LevelsCard p={p} lv={lv} m={m} cfg={cfg} setEvent={setEvent} />
      <Row gap={10}>
        <Button title="Edit levels" icon="edit" kind="ton" size="md" flex onPress={() => setEdit(true)} testID="position.editLevels" />
        <Button title="Share" icon="share" kind="out" size="md" flex onPress={() => setSharing(true)} testID="position.share" />
      </Row>
      {laptop ? (
        <Row gap={10}>
          <Button title="Close position" kind="dngO" size="md" flex onPress={() => setClosing(true)} testID="position.close" />
          <Button title="Stop following…" kind="out" size="md" flex onPress={() => setStopping(true)} testID="position.stopFollow" />
        </Row>
      ) : null}
      <View style={{ borderRadius: 16, borderWidth: 1, borderColor: c.bd, backgroundColor: c.sf }}>
        <NavRow icon="activity" title="Copy proof" sub={lastCopy ? `Opened ${lastCopy.latencyMs !== undefined ? `in ${(lastCopy.latencyMs / 1000).toFixed(2)} s` : ""}${lastCopy.latencyBlocks ? ` · ${lastCopy.latencyBlocks} block${lastCopy.latencyBlocks === 1 ? "" : "s"}` : ""} · ${lastCopy.commitState}` : "The copy that opened this position"} onPress={lastCopy ? () => setProof(lastCopy) : undefined} testID="position.proof" />
        <NavRow icon="users" title={`Leader ${shortAddr(leaderAddr) || `#${leaderId}`}`} sub={`${budget ? `Budget ${ausd(budget)} · ` : ""}${account.detached ? "stopped, not mirrored" : account.paused ? "paused" : "copying"}`} onPress={() => (laptop ? router.push({ pathname: "/leaders", params: { leader: String(leaderId) } }) : router.push({ pathname: "/leader/[id]", params: { id: String(leaderId) } }))} testID="position.leader" last />
      </View>
      {laptop ? null : (
        <Row gap={10}>
          <Button title="Close position" kind="dngO" size="md" flex onPress={() => setClosing(true)} testID="position.close" />
          <Button title="Stop following…" kind="out" size="md" flex onPress={() => setStopping(true)} testID="position.stopFollow" />
        </Row>
      )}
      <EditLevelsSheet visible={edit} onClose={() => setEdit(false)} account={account} p={p} lv={lv} m={m} act={act} />
      <ClosePositionDialog visible={closing} onClose={() => setClosing(false)} account={account} p={p} m={m} act={act} />
      <StopFollowSheet visible={stopping} onClose={() => setStopping(false)} account={account} leaderId={leaderId} leaderAddress={leaderAddr} cfg={cfg} act={act} />
      <ShareSheet visible={sharing} onClose={() => setSharing(false)} targets={followerChoices([account])} />
      <CopyDetailSheet e={proof} cfg={cfg} policy={account.policy} onClose={() => setProof(null)} />
    </View>
  );
}
