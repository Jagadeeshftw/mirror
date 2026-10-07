// Laptop Home without a deposit (watch mode) and the first-load states, in two columns: the demo
// follower with its Run buttons on the left, its copies landing on the right.
import { router } from "expo-router";
import React, { useState } from "react";
import { View } from "react-native";
import { ausd } from "../../lib/format";
import type { FeedEvent } from "../../lib/types";
import type { useHomeState } from "../../state/home";
import { useDemoStream, useRunDemo, useWatch } from "../../state/watch";
import { CopyDetailSheet } from "../copyDetail";
import { BlockedSheet, FeedItem } from "../feed";
import { Button, ErrorBanner, Link, Row, T } from "../kit";
import { LiveDot, SecHead } from "../kit2";
import { CycleCard, DemoCard, DepositNudge, RunButtons } from "../watch";
import { HomeSkeleton, SlowCard } from "../watchHome";
import { LCard, LaptopPage } from "./Top";
import { useColors } from "../theme";

export function LaptopWatch({ s }: { s: ReturnType<typeof useHomeState> }) {
  if (s.mode === "skeleton" || s.mode === "slow") {
    return (
      <LaptopPage testID="home.screen" title="Home" sub="Connecting to Mirror">
        <View style={{ flexDirection: "row", gap: 16 }}>
          <View style={{ flex: 1 }}>{s.mode === "skeleton" ? <HomeSkeleton walletCNS={s.walletCNS} waitedMs={s.waitedMs} /> : <SlowCard walletCNS={s.walletCNS} waitedMs={s.waitedMs} onWatch={s.watch} onRetry={s.retry} />}</View>
          <View style={{ width: 440 }} />
        </View>
      </LaptopPage>
    );
  }
  return <WatchColumns s={s} down={s.mode === "watchDown"} />;
}

function WatchColumns({ s, down }: { s: ReturnType<typeof useHomeState>; down: boolean }) {
  const c = useColors();
  const w = useWatch({ backendDown: down });
  const live = useDemoStream(!down);
  const { run, busy, error } = useRunDemo();
  const [blocked, setBlocked] = useState<FeedEvent | null>(null);
  const [copy, setCopy] = useState<FeedEvent | null>(null);
  const running = w.cycles.filter((cy) => cy.status === "running");
  const shown = running.length ? running : w.cycles.slice(0, 1);
  const last = w.events[0];
  const quiet = !down && !w.isLoading && !w.busy && (!last || Date.now() - last.timestamp > 2 * 3600e3);
  return (
    <LaptopPage testID="home.screen" title="Home" sub={down ? "Watch mode, read straight from Monad" : "Watch real copies land on the team-run demo account"}>
      {down ? <ErrorBanner testID="home.offline" title="Can't reach Mirror" body="Our server isn't answering. Your account lives on Monad, so your balance and limits are fine." onRetry={s.retry} /> : null}
      <View style={{ flexDirection: "row", gap: 16, flex: 1 }} testID="home.watch">
        <View style={{ flex: 1, gap: 16, minWidth: 0 }}>
          <LCard>
            <Row align="flex-end" gap={24}>
              <View style={{ flex: 1 }}>
                <T size={12} w={500} color="mu" upper>Your account</T>
                <Row align="flex-end" gap={6}>
                  <T testID="home.equity" size={40} w={500} mono lh={44} style={{ letterSpacing: -1.4 }}>{s.walletCNS === null ? "—" : ausd(s.walletCNS)}</T>
                  <T size={14} w={500} color="mu" style={{ marginBottom: 6 }}>AUSD</T>
                </Row>
                <T size={13} color="mu">Nothing deposited yet. Watch real copies land on the right.</T>
              </View>
              <Button title="Add funds" icon="arrdown" size="md" onPress={() => router.push("/funds")} testID="watch.addFunds" />
              <Button title="Browse leaders" icon="leaders" kind="out" size="md" onPress={() => router.navigate("/leaders")} testID="watch.browseLeaders" />
            </Row>
          </LCard>
          <View style={{ flexDirection: "row", gap: 16 }}>
            <View style={{ flex: 1, gap: 10, minWidth: 0 }}>
              <SecHead title="Watch mode" right={down ? "read from Monad" : running.length ? <LiveDot on={live} /> : "real copies, team money"} />
              <DemoCard w={w} cfg={s.cfg} live={live} />
              <RunButtons w={w} onRun={run} busy={busy} error={error} down={down} />
            </View>
            <View style={{ flex: 1, gap: 10, minWidth: 0 }}>
              <SecHead title="Demo runs" right={down ? "need the Mirror server" : undefined} />
              {quiet ? (
                <View testID="watch.quiet" style={{ padding: 16, borderRadius: 16, borderWidth: 1, borderStyle: "dashed", borderColor: c.bd, gap: 6 }}>
                  <T size={15} w={600}>No demo copies in the last 2 hours</T>
                  <T size={13} color="mu">The demo leader only trades when someone runs a demo. Start one: the copy lands in about a second.</T>
                </View>
              ) : null}
              {shown.length ? shown.map((cy) => <CycleCard key={cy.id} cy={cy} cfg={s.cfg} />) : <T size={13} color="mu">{down ? "Starting and following a demo run needs the Mirror server." : "No runs yet today. Run one: the copy lands in about a second."}</T>}
              {!down ? <DepositNudge /> : null}
            </View>
          </View>
        </View>
        <LCard style={{ width: 440 }} testID="watch.feed">
          <SecHead title="Copies landing now" right={down ? "from Monad" : <Link title="Feed" onPress={() => router.push("/demo")} testID="watch.feed.link" />} />
          {w.events.length === 0 ? <T size={13} color="mu">{w.isLoading ? "Reading the demo account" : "No demo copies in the last 2 hours. Run a demo trade to see one land."}</T> : null}
          {w.events.slice(0, 5).map((e, i) => (
            <FeedItem key={e.id} e={e} cfg={s.cfg} testID={`watch.feed.${i}`} onBlockedPress={setBlocked} onCopyPress={setCopy} />
          ))}
        </LCard>
      </View>
      <BlockedSheet e={blocked} cfg={s.cfg} account={w.follower ?? undefined} demo onClose={() => setBlocked(null)} />
      <CopyDetailSheet e={copy} cfg={s.cfg} policy={w.follower?.policy} onClose={() => setCopy(null)} />
    </LaptopPage>
  );
}
