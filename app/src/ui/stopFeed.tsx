// Feed cards for owner levels and stops (StopTriggered, LevelSet, MarketClosed), and the "How it closed"
// block in the copy detail of a position that a level, a market close or a close-all ended.
import * as Linking from "expo-linking";
import React from "react";
import { View } from "react-native";
import { txUrl } from "../lib/chain";
import { ago, shortAddr } from "../lib/format";
import { isLevelStop, levelSetTitle, marketClosedTitle, stopDetail, stopName, stopTitle } from "../lib/stopEvents";
import type { AppConfig, FeedEvent } from "../lib/types";
import { Icon, type IconName } from "./icons";
import { Card, CommitTrack, Row, T, TxLink } from "./kit";
import { useColors } from "./theme";

const mkt = (cfg: AppConfig | undefined, perpId?: number) => cfg?.markets.find((m) => m.perpId === perpId);
const open = (cfg: AppConfig | undefined, h: string | null | undefined) => h && Linking.openURL(txUrl(cfg, h));

export function stopCardText(e: FeedEvent, cfg: AppConfig | undefined): { icon: IconName; tone: "pos" | "neg" | "ac" | "nu"; title: string; sub: string; type: string } {
  const m = mkt(cfg, e.perpId);
  if (e.kind === "StopTriggered") {
    const tp = String(e.reason ?? e.data?.kind) === "TakeProfit";
    return { icon: "flag", tone: tp ? "pos" : "neg", title: stopTitle(e), sub: isLevelStop(e) ? `${stopDetail(e, m)} · anyone can execute your stops` : `${stopDetail(e, m)} · anyone can execute your loss stops`, type: stopName(e) };
  }
  if (e.kind === "LevelSet") return { icon: "flag", tone: "ac", title: levelSetTitle(e, m), sub: "Signed by you · stored in your account · anyone can execute it when hit", type: "Levels" };
  if (e.kind === "MarketClosed") return { icon: "close", tone: "nu", title: marketClosedTitle(e, m), sub: "Closed by you at market, reduce-only", type: "Close" };
  return { icon: "info", tone: "nu", title: e.kind, sub: "", type: e.kind };
}

export function StopItem({ e, cfg, testID }: { e: FeedEvent; cfg: AppConfig | undefined; testID?: string }) {
  const c = useColors();
  const x = stopCardText(e, cfg);
  const fg = { pos: c.pos, neg: c.neg, ac: c.ac, nu: c.mu }[x.tone];
  const bg = { pos: c.posS, neg: c.negS, ac: c.acs, nu: c.sf2 }[x.tone];
  return (
    <Card testID={testID ?? `activity.stop.${e.id}`} style={{ paddingVertical: 12, paddingHorizontal: 14, gap: 8 }}>
      <Row gap={10} align="flex-start">
        <View style={{ width: 32, height: 32, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: bg }}>
          <Icon name={x.icon} size={16} color={fg} />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <T size={14} w={600} testID={testID ? `${testID}.title` : undefined}>
            {x.title}
          </T>
          <T size={12} color="mu" lh={17} testID={testID ? `${testID}.sub` : undefined}>
            {x.sub}
          </T>
          <Row gap={6}>
            <T size={11} w={600} color="mu" upper testID={testID ? `${testID}.type` : undefined}>
              {x.type}
            </T>
            <T size={12} mono color="mu">
              {ago(e.timestamp)} ago · block {e.block.toLocaleString("en-US")}
            </T>
          </Row>
        </View>
        <TxLink hash={e.txHash} onPress={() => open(cfg, e.txHash)} testID={testID ? `${testID}.tx` : undefined} />
      </Row>
      <CommitTrack state={e.commitState} />
    </Card>
  );
}

/** Copy detail: the event that closed this copied position (a level fired, a market close, a close-all). */
export function ClosedByBlock({ e, cfg }: { e: FeedEvent; cfg: AppConfig | undefined }) {
  const c = useColors();
  const x = stopCardText(e, cfg);
  const title = e.kind === "ClosedAll" ? "Closed with Close all" : e.kind === "StopTriggered" ? stopTitle(e) : x.title;
  return (
    <View testID="copy.closedBy" style={{ gap: 6, padding: 12, borderRadius: 12, backgroundColor: c.sf2 }}>
      <Row gap={8}>
        <Icon name={x.icon} size={16} color={x.tone === "pos" ? c.pos : x.tone === "neg" ? c.neg : c.mu} />
        <T size={12} w={600} color="mu" upper style={{ flex: 1 }}>
          How this position closed
        </T>
        <TxLink hash={e.txHash} onPress={() => open(cfg, e.txHash)} testID="copy.closedBy.tx" />
      </Row>
      <T size={14} w={600} testID="copy.closedBy.title">
        {title}
      </T>
      <T size={12} color="mu" lh={17}>
        {e.kind === "StopTriggered" ? `${x.sub}. ${e.keeper ? `Executor ${shortAddr(e.keeper)} received nothing from your account.` : ""}` : `${x.sub}.`} {ago(e.timestamp)} ago.
      </T>
    </View>
  );
}
