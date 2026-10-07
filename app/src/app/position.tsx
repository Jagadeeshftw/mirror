// Position detail (phone): /position?account=0x…&perp=1&side=long. On the laptop layout the same position
// opens in the Positions side panel.
import { Redirect, router, useLocalSearchParams } from "expo-router";
import React from "react";
import { View } from "react-native";
import { closedBy } from "../lib/stopEvents";
import { haltedPerps } from "../lib/levels";
import type { FeedEvent } from "../lib/types";
import { useConfig, useFeedAll, useTotals } from "../state/data";
import { useOwnerAction } from "../state/ownerAction";
import { AppBar } from "../ui/chrome";
import { Button, Card, LoadingBlock, Screen, Scroll, T } from "../ui/kit";
import { HaltNotice } from "../ui/levelEdit";
import { useLayout } from "../ui/layout";
import { PositionBody } from "../ui/positionPanel";
import { ClosedByBlock } from "../ui/stopFeed";

export default function PositionRoute() {
  const params = useLocalSearchParams<{ account?: string; perp?: string; side?: string }>();
  if (useLayout() === "laptop") return <Redirect href={{ pathname: "/positions", params: { account: params.account ?? "", perp: params.perp ?? "" } }} />;
  return <PositionScreen account={params.account ?? ""} perp={Number(params.perp)} side={params.side} />;
}

function PositionScreen({ account, perp, side }: { account: string; perp: number; side?: string }) {
  const cfg = useConfig().data;
  const { totals } = useTotals();
  const feed = useFeedAll();
  const act = useOwnerAction();
  const a = totals?.accounts.find((x) => x.account.toLowerCase() === account.toLowerCase());
  const p = a?.positions.find((x) => x.perpId === perp && (!side || x.side === side));
  const m = cfg?.markets.find((x) => x.perpId === perp);
  const title = `${m?.symbol ?? "Position"}${p ? ` ${p.side}` : side ? ` ${side}` : ""}`;
  // A closed position: what closed it (a fired level, Close position, Close all), from the feed.
  const lastOpen = feed.events.find((e) => e.account.toLowerCase() === account.toLowerCase() && e.kind === "Mirrored" && e.perpId === perp && (e.orderType ?? 0) <= 1);
  const mine = (e: FeedEvent) => e.account.toLowerCase() === account.toLowerCase() && e.perpId === perp && (e.kind === "StopTriggered" || e.kind === "MarketClosed");
  const ended: FeedEvent | null = p ? null : ((lastOpen ? closedBy(feed.events, lastOpen) : null) ?? feed.events.find((e) => mine(e) && (!lastOpen || e.timestamp >= lastOpen.timestamp)) ?? null);
  const halted = a && haltedPerps(a).includes(perp);
  return (
    <Screen testID="position.screen">
      <AppBar title={title} showBack />
      <Scroll contentStyle={{ paddingHorizontal: 20, paddingTop: 4, gap: 14, paddingBottom: 24 }} testID="position.scroll">
        {!totals ? (
          <LoadingBlock label="Reading your position" />
        ) : a && p ? (
          <PositionBody account={a} p={p} cfg={cfg} />
        ) : (
          <View style={{ gap: 14 }} testID="position.closed">
            <Card style={{ padding: 18, gap: 6 }}>
              <T size={16} w={600}>This position is closed</T>
              <T size={13} color="mu">{ended ? "Closed onchain. Your realised result is in Positions." : "There is no open position in this market now."}</T>
            </Card>
            {ended ? <ClosedByBlock e={ended} cfg={cfg} /> : null}
            {a && halted ? <HaltNotice symbols={[m?.symbol ?? `#${perp}`]} busy={act.busy === "resume"} onResume={() => act.resumeMarkets(a)} testID="position.halted" /> : null}
            {act.error ? <T size={12} color="neg" testID="position.error">{act.error}</T> : null}
            <Button title="All positions" kind="out" onPress={() => router.replace("/positions")} testID="position.toPositions" />
          </View>
        )}
      </Scroll>
    </Screen>
  );
}
