// Engine-side feed items (thin-book guard): the engine shrank or skipped a copy before sending it.
// Not onchain and no transaction, so they look unlike a Blocked card: grey surface, an "Engine"
// label where the tx link would be, and the depth numbers.
import React from "react";
import { View } from "react-native";
import { ago, orderSide } from "../lib/format";
import type { AppConfig, FeedEvent } from "../lib/types";
import { Icon } from "./icons";
import { Identicon, MarketBadge, Row, Side, T } from "./kit";
import { TeamBadge } from "./kit2";
import { useColors } from "./theme";

export function engineSentence(e: FeedEvent, lotDec = 0): string {
  const d = (e.data ?? {}) as Record<string, any>;
  // Perpl lots are whole units of the market's lot size (requested / final / depth are lot counts).
  void lotDec;
  const L = (v: unknown) => (v === undefined || v === null ? "?" : String(v));
  if (e.reason === "BookUnavailable" || d.reason === "book_unavailable") return "Perpl's order book couldn't be read, so the engine didn't send this copy. Nothing was traded.";
  const depth = d.depthLots ?? e.actual;
  const req = d.requiredLots ?? e.limit;
  if (e.kind === "EngineShrunk") return `Book depth ${L(depth)} lots at your price, ${d.multiple ?? 2}× needed. Sent ${L(d.finalLots ?? e.lotLNS)} lots instead of ${L(d.requestedLots)}.`;
  return `Book depth ${L(depth)} lots at your price, ${L(req)} needed. Not sent, so it couldn't fill against the leader's own orders.`;
}

export function EngineItem({ e, cfg, testID, name }: { e: FeedEvent; cfg: AppConfig | undefined; testID?: string; name: string }) {
  const c = useColors();
  const m = cfg?.markets.find((x) => x.perpId === e.perpId);
  const label = e.label ?? (e.kind === "EngineShrunk" ? "Shrunk: thin book" : "Skipped: thin book");
  return (
    <View testID={testID ?? `activity.engine.${e.id}`} style={{ backgroundColor: c.sf2, borderRadius: 16, paddingVertical: 12, paddingHorizontal: 14, gap: 10 }}>
      <Row gap={8}>
        {name ? <Identicon seed={e.leaderAddress ?? name} size={28} /> : null}
        <T size={13} w={500} mono>
          {name}
        </T>
        {e.teamRun ? <TeamBadge /> : null}
        <T size={12} mono color="mu">
          {ago(e.timestamp)} ago
        </T>
        <View style={{ flex: 1 }} />
        <T size={11} w={600} color="mu" upper testID={testID ? `${testID}.type` : undefined}>
          {e.kind === "EngineShrunk" ? "Shrunk" : "Skipped"}
        </T>
        <View testID={testID ? `${testID}.engine` : "feed.engine.label"} style={{ flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 999, borderWidth: 1, borderColor: c.bd }}>
          <Icon name="server" size={12} color={c.mu} />
          <T size={11} w={600} color="mu">
            Engine
          </T>
        </View>
      </Row>
      <Row gap={10}>
        <MarketBadge symbol={m?.symbol ?? "?"} />
        <View style={{ flex: 1, gap: 2 }}>
          <Row gap={6}>
            <T size={15} w={600}>
              {m?.symbol}
            </T>
            <Side side={orderSide(e.orderType ?? 0)} />
            <T size={13} color="mu">
              Leader {(e.orderType ?? 0) <= 1 ? "open" : "close"}
            </T>
          </Row>
          <T size={13} w={600} testID={testID ? `${testID}.label` : undefined}>
            {label}
          </T>
        </View>
      </Row>
      <Row gap={6} align="flex-start" style={{ paddingTop: 10, borderTopWidth: 1, borderTopColor: c.bd }}>
        <View style={{ marginTop: 1 }}>
          <Icon name="layers" size={15} color={c.mu} />
        </View>
        <T size={12} color="mu" style={{ flex: 1 }} lh={17}>
          {engineSentence(e, m?.lotDecimals ?? 0)} Checked by the Mirror engine before sending: not onchain, no transaction.
        </T>
      </Row>
    </View>
  );
}
