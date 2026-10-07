// Laptop Feed: every leader trade with your fill, deviation and Proposed → copy timing in a table;
// the selected copy's proof (or the blocked detail) in the panel on the right.
import React, { useMemo, useState } from "react";
import { View } from "react-native";
import { ruleName, isEngineKind } from "../../lib/blockReasons";
import { matchesFilter, type Filter } from "../../lib/feedFilter";
import { ago, orderAction, orderSide, price as fmtPrice } from "../../lib/format";
import { bpsText, fillDeviationBps } from "../../lib/proof";
import { copyFeeCNS, feeText } from "../../lib/fees";
import type { FeedEvent } from "../../lib/types";
import { useRpcHealth } from "../../state/conn";
import { useConfig, useFeedAll, useTotals } from "../../state/data";
import { useLive } from "../../state/live";
import { CopyDetailPanel } from "../copyDetail";
import { BlockedBody, leaderName } from "../feed";
import { engineSentence } from "../feedEngine";
import { StopItem, stopCardText } from "../stopFeed";
import { Icon } from "../icons";
import { Chip, ChipS, CommitTrack, ErrorBanner, Identicon, MarketBadge, Row, Side, T } from "../kit";
import { LiveDot } from "../kit2";
import { useColors } from "../theme";
import { LCard, LaptopPage } from "./Top";
import { Table, type Col } from "./Table";

const isStop = (e: FeedEvent) => e.kind === "StopTriggered" || e.kind === "LevelSet" || e.kind === "MarketClosed" || e.kind === "LeaderStopped";

export function LaptopFeed() {
  const c = useColors();
  const cfg = useConfig().data;
  const feed = useFeedAll();
  const { totals } = useTotals();
  const live = useLive();
  const rpc = useRpcHealth();
  const [filter, setFilter] = useState<Filter>("all");
  const [sel, setSel] = useState<string | null>(null);
  const rows = useMemo(() => feed.events.filter((e) => e.kind === "Mirrored" || e.kind === "Blocked" || isEngineKind(e.kind) || isStop(e)).filter((e) => matchesFilter(e, filter)), [feed.events, filter]);
  const blockedN = feed.events.filter((e) => e.kind === "Blocked").length;
  const current = rows.find((e) => e.id === sel) ?? rows.find((e) => e.kind === "Mirrored") ?? rows[0];
  const mk = (e: FeedEvent) => cfg?.markets.find((m) => m.perpId === e.perpId);
  const cols: Col<FeedEvent>[] = [
    { key: "t", label: "Time", flex: 0.6, render: (e) => <T size={12} mono color="mu" lines={1}>{ago(e.timestamp)}</T> },
    { key: "leader", label: "Leader", flex: 0.7, render: (e) => <Identicon seed={e.leaderAddress ?? String(e.leaderAccountId)} size={24} /> },
    {
      key: "trade",
      label: "Trade",
      flex: 2.4,
      render: (e) => (
        <Row gap={6}>
          <MarketBadge symbol={mk(e)?.symbol ?? "?"} size={24} />
          <T size={13} w={600}>{mk(e)?.symbol}</T>
          <Side side={orderSide(e.orderType ?? 0)} />
          <T size={12} color="mu" lines={1}>{orderAction(e.orderType ?? 0)}{e.leverageHdths && (e.orderType ?? 0) <= 1 ? ` · ${e.leverageHdths / 100}x` : ""}</T>
        </Row>
      ),
    },
    { key: "fill", label: "Your fill", flex: 1.2, align: "right", render: (e) => <T size={13} mono lines={1}>{e.pricePNS && mk(e) ? fmtPrice(e.proof?.fillPNS ?? e.pricePNS, mk(e)!.priceDecimals) : "—"}</T> },
    { key: "dev", label: "Deviation", flex: 1.1, align: "right", render: (e) => <T size={13} mono lines={1}>{e.proof ? `${bpsText(fillDeviationBps(e.proof, e.orderType ?? 0))} bps` : "—"}</T> },
    { key: "fee", label: "Fee", flex: 0.8, align: "right", render: (e) => <T size={12} mono color="mu" lines={1} testID={`feed.fee.${e.id}`}>{copyFeeCNS(e) === null ? "—" : copyFeeCNS(e) === 0n ? "0" : feeText(copyFeeCNS(e)!)}</T> },
    { key: "lat", label: "Proposed → copy", flex: 1.7, align: "right", render: (e) => <T size={13} mono lines={1}>{e.latencyMs !== undefined ? `${(e.latencyMs / 1000).toFixed(2)} s${e.latencyBlocks ? ` · ${e.latencyBlocks} blocks` : ""}` : "—"}</T> },
    { key: "state", label: "State", flex: 1.3, render: (e) => <CommitTrack state={e.commitState} /> },
  ];
  return (
    <LaptopPage testID="activity.screen" title="Feed" sub="Every leader trade and what happened to your copy">
      {feed.isError ? <ErrorBanner testID="feed.offline" title="Can't reach Mirror" body="Our server isn't answering. Your follows keep running onchain and your limits still apply." onRetry={feed.refetch} /> : null}
      {rpc.isError && !feed.isError ? <ErrorBanner testID="feed.monadDown" title="Can't reach Monad" body="The Monad RPC isn't answering from this browser. Mirror's server is fine and copying continues." onRetry={() => rpc.refetch()} /> : null}
      <View style={{ flexDirection: "row", gap: 16, flex: 1 }}>
        <LCard style={{ flex: 1 }} testID="feed.scroll">
          <Row gap={8}>
            {(["all", "copied", "blocked", "closes"] as Filter[]).map((f) => (
              <Chip key={f} label={f === "all" ? "All" : f === "copied" ? "Copied" : f === "blocked" ? `Blocked ${blockedN}` : "Closes"} on={filter === f} onPress={() => setFilter(f)} testID={`feed.filter.${f}`} />
            ))}
            <View style={{ flex: 1 }} />
            <LiveDot on={live.connected} testID={live.connected ? "feed.live" : "feed.offline.indicator"} />
          </Row>
          <Table
            testIDPrefix="feed.table"
            cols={cols}
            rows={rows}
            rowKey={(e) => e.id}
            selected={current?.id ?? null}
            onRow={(e) => setSel(e.id)}
            rowStyle={(e) => (e.kind === "Blocked" ? { backgroundColor: c.negS } : isEngineKind(e.kind) ? { backgroundColor: c.sf2 } : undefined)}
            span={(e) =>
              e.kind === "Blocked"
                ? { from: 3, to: 7, node: <Row gap={6}><Icon name="ban" size={14} color={c.neg} /><T size={13} color={c.neg} style={{ flex: 1 }} lines={2}>{`Not copied. ${e.blocked?.rule ?? ruleName(e.blocked?.reason ?? "")}`}</T><ChipS label="Blocked" tone="neg" /></Row> }
                : isStop(e)
                  ? { from: 1, to: 7, node: <Row gap={6}><Icon name={stopCardText(e, cfg).icon} size={14} color={stopCardText(e, cfg).tone === "neg" ? c.neg : stopCardText(e, cfg).tone === "pos" ? c.pos : c.ac} /><T size={13} style={{ flex: 1 }} lines={1}>{stopCardText(e, cfg).title}</T><ChipS label={stopCardText(e, cfg).type} tone={stopCardText(e, cfg).tone === "neg" ? "neg" : stopCardText(e, cfg).tone === "pos" ? "ok" : "ac"} /></Row> }
                : isEngineKind(e.kind)
                  ? { from: 3, to: 7, node: <Row gap={6}><Icon name="server" size={14} color={c.mu} /><T size={12} color="mu" style={{ flex: 1 }} lines={2}>{`${e.label ?? e.kind}. ${engineSentence(e, mk(e)?.lotDecimals ?? 0)}`}</T><ChipS label="Engine · no tx" /></Row> }
                  : null
            }
          />
          {rows.length === 0 ? <T size={13} color="mu" testID="feed.empty">{totals?.accounts.length ? "No copies match this filter." : "Follow a leader and every trade they make shows up here."}</T> : null}
        </LCard>
        <LCard style={{ width: 440 }} testID="feed.panel">
          {!current ? (
            <T size={13} color="mu">Select a row to see its proof.</T>
          ) : current.kind === "Mirrored" ? (
            <CopyDetailPanel e={current} cfg={cfg} policy={totals?.accounts.find((a) => a.account === current.account)?.policy} onClose={() => setSel(null)} />
          ) : isStop(current) ? (
            <View style={{ gap: 10 }} testID="feed.stop.detail">
              <StopItem e={current} cfg={cfg} testID="feed.stop.item" />
              <T size={12} color="mu" lh={17}>Levels and loss stops live in your account contract. Once the price reaches a level, anyone can call it onchain: the close is reduce-only, bounded by your slippage, and the caller is paid nothing.</T>
            </View>
          ) : current.kind === "Blocked" ? (
            <BlockedBody e={current} cfg={cfg} account={totals?.accounts.find((a) => a.account === current.account)} onClose={() => setSel(null)} />
          ) : (
            <View style={{ gap: 8 }} testID="feed.engine.detail">
              <T size={12} w={500} color="mu" upper>Engine · not onchain · {leaderName(current)}</T>
              <T size={19} w={600}>{current.label ?? current.kind}</T>
              <T size={13} lh={19}>{engineSentence(current, mk(current)?.lotDecimals ?? 0)}</T>
              <T size={12} color="mu">The Mirror engine measures Perpl's order book before each opening copy. If the book is too thin, copies could fill against the leader's own resting orders, so the engine shrinks or skips them. No transaction is sent.</T>
            </View>
          )}
        </LCard>
      </View>
    </LaptopPage>
  );
}
