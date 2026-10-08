import { router, useLocalSearchParams } from "expo-router";
import React, { useMemo, useState } from "react";
import { ScrollView, View } from "react-native";
import { timeHM } from "../../lib/format";
import type { FeedEvent } from "../../lib/types";
import { useConfig, useFeedView, useTotals } from "../../state/data";
import { FeedBanners, FeedRpcState } from "../../ui/serviceDown";
import { useLive } from "../../state/live";
import { AppBar } from "../../ui/chrome";
import { BlockedSheet, FeedItem } from "../../ui/feed";
import { Button, Card, Chip, ErrorBanner, LoadingBlock, Row, Screen, Scroll, T } from "../../ui/kit";
import { useColors } from "../../ui/theme";
import { useRpcHealth } from "../../state/conn";
import { CopyDetailSheet } from "../../ui/copyDetail";
import { LaptopFeed } from "../../ui/laptop/LaptopFeed";
import { useLayout } from "../../ui/layout";
import { matchesFilter, type Filter } from "../../lib/feedFilter";

export default function Feed() {
  return useLayout() === "laptop" ? <LaptopFeed /> : <PhoneFeed />;
}

function PhoneFeed() {
  const c = useColors();
  const params = useLocalSearchParams<{ filter?: Filter }>();
  const cfg = useConfig().data;
  const feed = useFeedView();
  const { totals } = useTotals();
  const live = useLive();
  const [filter, setFilter] = useState<Filter>(params.filter ?? "all");
  const [blocked, setBlocked] = useState<FeedEvent | null>(null);
  const [copy, setCopy] = useState<FeedEvent | null>(null);
  const rpc = useRpcHealth();
  const counts = useMemo(() => ({ blocked: feed.events.filter((e) => e.kind === "Blocked").length }), [feed.events]);
  const list = feed.events.filter((e) => matchesFilter(e, filter));
  const stale = feed.isError && feed.via === "api" && feed.events.length > 0;
  const weekAgo = Date.now() - 7 * 86400e3;
  const weekBlocked = feed.events.filter((e) => e.kind === "Blocked" && e.timestamp > weekAgo).length;
  const weekTotal = feed.events.filter((e) => (e.kind === "Blocked" || e.kind === "Mirrored") && e.timestamp > weekAgo).length;

  return (
    <Screen testID="activity.screen">
      <AppBar title="Feed" />
      <Scroll testID="feed.scroll">
        <Row gap={10} style={{ paddingHorizontal: 20 }}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} overScrollMode="never" style={{ flex: 1 }} contentContainerStyle={{ gap: 8 }}>
            <Chip label="All" on={filter === "all"} onPress={() => setFilter("all")} testID="feed.filter.all" />
            <Chip label="Copied" on={filter === "copied"} onPress={() => setFilter("copied")} testID="feed.filter.copied" />
            <Chip label={`Blocked ${counts.blocked}`} on={filter === "blocked"} icon={filter === "blocked" ? "check" : undefined} onPress={() => setFilter("blocked")} testID="feed.filter.blocked" />
            <Chip label="Closes" on={filter === "closes"} onPress={() => setFilter("closes")} testID="feed.filter.closes" />
          </ScrollView>
          <Row gap={6} testID={live.connected ? "feed.live" : "feed.offline.indicator"}>
            <View style={{ width: 14, height: 14, borderRadius: 999, backgroundColor: live.connected ? c.posS : c.sf2, alignItems: "center", justifyContent: "center" }}>
              <View style={{ width: 8, height: 8, borderRadius: 999, backgroundColor: live.connected ? c.pos : c.mu }} />
            </View>
            <T size={12} w={600} color={live.connected ? "posI" : "mu"}>
              {live.connected ? "Live" : "Offline"}
            </T>
          </Row>
        </Row>
        <FeedBanners feed={feed} rpc={rpc} />
        <FeedRpcState feed={feed} />
        {feed.isLoading && !feed.events.length && feed.via === "api" ? <LoadingBlock label="Loading copies" /> : null}
        {!feed.isLoading && totals && totals.accounts.length === 0 ? (
          <Card style={{ marginHorizontal: 16, padding: 20, alignItems: "center", gap: 8 }} testID="feed.empty">
            <T size={17} w={600} center>
              Nothing copied yet
            </T>
            <T size={13} color="mu" center>
              Follow a leader and every trade they make shows up here with its latency, commit state and transaction.
            </T>
            <Button title="Browse leaders" onPress={() => router.push("/leaders")} style={{ alignSelf: "stretch", marginTop: 6 }} />
            <Button title="Watch the demo" kind="txt" onPress={() => router.push("/demo")} />
          </Card>
        ) : null}
        <View style={{ gap: 10, paddingHorizontal: 16, opacity: stale || rpc.isError ? 0.55 : 1 }}>
          {list.map((e, i) => (
            <FeedItem key={e.id} e={e} cfg={cfg} onBlockedPress={setBlocked} onCopyPress={setCopy} highlight={filter === "blocked" && i === 0} testID={`activity.item.${i}`} />
          ))}
        </View>
        {filter === "blocked" && weekTotal > 0 ? (
          <Card style={{ marginHorizontal: 16, paddingVertical: 12, paddingHorizontal: 14 }}>
            <Row gap={8}>
              <T size={13} style={{ flex: 1 }}>
                Blocked this week
              </T>
              <T size={13} w={600} mono>
                {weekBlocked}
              </T>
              <T size={12} color="mu">
                of {weekTotal} leader trades
              </T>
            </Row>
          </Card>
        ) : null}
      </Scroll>
      <BlockedSheet e={blocked} cfg={cfg} account={totals?.accounts.find((a) => a.account === blocked?.account)} onClose={() => setBlocked(null)} />
      <CopyDetailSheet e={copy} cfg={cfg} policy={totals?.accounts.find((a) => a.account === copy?.account)?.policy} onClose={() => setCopy(null)} />
    </Screen>
  );
}
