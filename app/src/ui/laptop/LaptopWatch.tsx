// Laptop Home without a deposit (watch mode) and the first-load states. Same grid as the laptop Home with a deposit:
// two columns of cards that fill the window's width and height. Left: your account, the team-run demo follower, and
// a "Demo runs" card that holds the Run buttons and the runs (it stretches to the bottom; with no run it shows the
// quiet or service-down state centred in it). Right: "Copies landing now" in compact rows, as many as fit, with the
// deposit prompt at its foot. Phones keep their own layout (watchHome.tsx).
import { router } from "expo-router";
import React, { useState } from "react";
import { useWindowDimensions, View } from "react-native";
import { failTitle, mirrorDownBody, noCopiesLine } from "../../lib/conn";
import { ago, ausd } from "../../lib/format";
import type { AppConfig, DemoCycle, FeedEvent } from "../../lib/types";
import type { useHomeState } from "../../state/home";
import { useDemoStream, useRunDemo, useWatch } from "../../state/watch";
import { CopyDetailSheet } from "../copyDetail";
import { BlockedSheet, openTx, RecentRow } from "../feed";
import { Icon, type IconName } from "../icons";
import { Button, ChipS, ErrorBanner, Lbl, Link, Row, T, TxLink } from "../kit";
import { LiveDot, SecHead, Skel } from "../kit2";
import { CycleCard, DemoCard, DepositNudge, RunButtons } from "../watch";
import { balanceLine, HomeSkeleton, SlowCard } from "../watchHome";
import { LCard, LaptopPage } from "./Top";
import { useColors } from "../theme";

/** Height of one compact copy row (RecentRow: 11 px padding, two lines) plus its separator. */
const ROW_H = 62;
/** First guess at one demo-run timeline (CycleCard, four steps) until the first one is measured. */
const CYCLE_H = 320;
/** One earlier demo run as a single line (in the Demo runs card, under the latest run's full timeline). */
const EARLIER_H = 46;
/** LaptopTop (72 px + its border) and LaptopPage's vertical padding (20 + 20). */
const CHROME_H = 73 + 40;

export function LaptopWatch({ s }: { s: ReturnType<typeof useHomeState> }) {
  if (s.mode === "skeleton" || s.mode === "slow") {
    return (
      <LaptopPage testID="home.screen" title="Home" sub="Connecting to Mirror">
        <View style={{ flexDirection: "row", gap: 16, flex: 1 }}>
          <View style={{ flex: 1.45, minWidth: 0 }}>{s.mode === "skeleton" ? <HomeSkeleton walletCNS={s.walletCNS} waitedMs={s.waitedMs} /> : <SlowCard walletCNS={s.walletCNS} waitedMs={s.waitedMs} onWatch={s.watch} onRetry={s.retry} />}</View>
          <LCard style={{ flex: 1 }} testID="watch.feed.skeleton">
            <T size={15} w={600}>Copies landing now</T>
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <Skel key={i} h={ROW_H - 14} />
            ))}
          </LCard>
        </View>
      </LaptopPage>
    );
  }
  return <WatchColumns s={s} down={s.mode === "watchDown"} />;
}

/** An empty state centred in the space it is given (no filler: one icon, one line, one sentence). */
function Centered({ icon, title, body, testID, children }: { icon: IconName; title: string; body: string; testID: string; children?: React.ReactNode }) {
  const c = useColors();
  return (
    <View testID={testID} style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 24, paddingHorizontal: 16 }}>
      <View style={{ width: 44, height: 44, borderRadius: 999, backgroundColor: c.sf2, alignItems: "center", justifyContent: "center" }}>
        <Icon name={icon} size={22} color={c.mu} />
      </View>
      <T size={17} w={600} center>{title}</T>
      <T size={13} color="mu" center lh={19} style={{ maxWidth: 440 }}>{body}</T>
      {children}
    </View>
  );
}

function EarlierRun({ cy, cfg, testID }: { cy: DemoCycle; cfg: AppConfig | undefined; testID: string }) {
  const c = useColors();
  const copy = cy.steps.find((st) => st.key.includes("copy") && st.txHash) ?? cy.steps.find((st) => st.txHash);
  const lat = cy.steps.find((st) => st.latencyMs)?.latencyMs;
  const blocked = cy.kind === "blocked";
  return (
    <Row gap={10} testID={testID} style={{ height: EARLIER_H, borderTopWidth: 1, borderTopColor: c.bd }}>
      <Icon name={blocked ? "ban" : "feed"} size={16} color={blocked ? c.neg : c.ac} />
      <T size={13} w={600}>{blocked ? "Blocked trade" : "Demo trade"}</T>
      <T size={12} color="mu" mono>{cy.id}</T>
      <ChipS label={cy.status === "done" ? (blocked ? "Blocked" : "Done") : cy.status === "failed" ? "Failed" : "Running"} tone={cy.status === "failed" ? "neg" : blocked ? "neg" : "ok"} />
      <View style={{ flex: 1 }} />
      {lat ? <T size={12} mono>{`${(lat / 1000).toFixed(2)} s`}</T> : null}
      <T size={12} color="mu">{ago(cy.startedAt)} ago</T>
      {copy?.txHash ? <TxLink hash={copy.txHash} onPress={() => openTx(cfg, copy.txHash)} /> : null}
    </Row>
  );
}

function WatchColumns({ s, down }: { s: ReturnType<typeof useHomeState>; down: boolean }) {
  const c = useColors();
  const w = useWatch({ backendDown: down });
  const live = useDemoStream(!down);
  const { run, busy, error } = useRunDemo();
  const [blocked, setBlocked] = useState<FeedEvent | null>(null);
  const [copy, setCopy] = useState<FeedEvent | null>(null);
  const [listH, setListH] = useState(0);
  const [runsH, setRunsH] = useState(0);
  const [cycleH, setCycleH] = useState(CYCLE_H);
  const [bannerH, setBannerH] = useState(0);
  // A definite height for the grid (the window, less the top bar, the padding and the service banner), so the two
  // columns fill the window exactly and their lists show what fits instead of growing the page. Short windows
  // scroll from 600 px.
  const { height: winH } = useWindowDimensions();
  const gridH = Math.max(600, winH - CHROME_H - (down ? bannerH + 16 : 0));
  const running = w.cycles.filter((cy) => cy.status === "running");
  // The run in progress, else the latest finished runs: as many as the card has room for (at least one), so the
  // page fills the window without scrolling.
  const cycleCap = runsH ? Math.max(1, Math.floor((runsH + 10) / (cycleH + 10))) : 1;
  const shown = (running.length ? running : w.cycles).slice(0, cycleCap);
  // Earlier runs as one-line rows in the room left under the full timelines.
  const roomLeft = runsH - shown.length * (cycleH + 10) - 24;
  const earlier = runsH ? w.cycles.filter((cy) => !shown.includes(cy) && cy.status !== "running").slice(0, Math.max(0, Math.floor(roomLeft / EARLIER_H))) : [];
  const last = w.events[0];
  const quiet = !down && !w.isLoading && !w.busy && (!last || Date.now() - last.timestamp > 2 * 3600e3);
  const capacity = listH ? Math.max(3, Math.floor(listH / ROW_H)) : 6;
  const rows = w.events.slice(0, capacity);
  const openRow = (e: FeedEvent) => (e.kind === "Blocked" ? setBlocked(e) : e.kind === "Mirrored" ? setCopy(e) : undefined);
  return (
    <LaptopPage testID="home.screen" title="Home" sub={down ? "Watch mode, read straight from Monad" : "Watch real copies land on the team-run demo account"}>
      {down ? (
        <View onLayout={(e) => setBannerH(e.nativeEvent.layout.height)}>
          <ErrorBanner testID="home.offline" title={failTitle("mirror")} body={mirrorDownBody("account")} onRetry={s.retry} />
        </View>
      ) : null}
      <View style={{ flexDirection: "row", gap: 16, height: gridH }} testID="home.watch">
        <View style={{ flex: 1.45, gap: 16, minWidth: 0, minHeight: 0 }}>
          <LCard testID="home.account">
            <Row align="flex-end" gap={24}>
              <View style={{ flex: 1 }}>
                <T size={12} w={500} color="mu" upper>Your account</T>
                <Row align="flex-end" gap={6}>
                  <T testID="home.equity" size={40} w={500} mono lh={44} style={{ letterSpacing: -1.4 }}>{s.walletCNS === null ? "—" : ausd(s.walletCNS + (down && s.followsCNS ? s.followsCNS : 0n))}</T>
                  <T size={14} w={500} color="mu" style={{ marginBottom: 6 }}>AUSD</T>
                </Row>
                <T size={13} color="mu" testID="home.balance.source">{balanceLine({ walletCNS: s.walletCNS, followsCNS: s.followsCNS, down, walletLoading: s.walletLoading, walletError: s.walletError }).replace("land below", "land on the right")}</T>
              </View>
              <Button title="Add funds" icon="arrdown" size="md" onPress={() => router.push("/funds")} testID="watch.addFunds" />
              <Button title="Browse leaders" icon="leaders" kind="out" size="md" onPress={() => router.navigate("/leaders")} testID="watch.browseLeaders" />
            </Row>
          </LCard>
          <View style={{ gap: 10 }}>
            <SecHead title="Watch mode" right={down ? "read from Monad" : running.length ? <LiveDot on={live} /> : "real copies, team money"} />
            <DemoCard w={w} cfg={s.cfg} live={live} />
          </View>
          <LCard style={{ flex: 1, minHeight: 0 }} testID="watch.runs">
            <Row gap={12}>
              <T size={15} w={600} style={{ flex: 1 }}>Demo runs</T>
              <T size={12} color="mu">{down ? "need Mirror's service" : "the team's money on Perpl, never yours"}</T>
            </Row>
            <RunButtons w={w} onRun={run} busy={busy} error={error} down={down} row />
            {shown.length ? (
              <View style={{ flex: 1, minHeight: 0, overflow: "hidden", gap: 10 }} onLayout={(e) => setRunsH(e.nativeEvent.layout.height)}>
                {shown.map((cy, i) => (
                  <View key={cy.id} onLayout={i === 0 ? (e) => setCycleH(Math.max(120, Math.round(e.nativeEvent.layout.height))) : undefined}>
                    <CycleCard cy={cy} cfg={s.cfg} />
                  </View>
                ))}
                {earlier.length ? (
                  <View testID="watch.runs.earlier">
                    <Lbl style={{ paddingBottom: 6 }}>Earlier runs</Lbl>
                    {earlier.map((cy, i) => (
                      <EarlierRun key={cy.id} cy={cy} cfg={s.cfg} testID={`watch.runs.earlier.${i}`} />
                    ))}
                  </View>
                ) : null}
              </View>
            ) : down ? (
              <Centered icon="server" testID="watch.runs.down" title="Demo runs need Mirror's service" body="Starting a run and following it step by step needs Mirror's service. The demo account's copies on the right are read straight from Monad and stay current." />
            ) : quiet ? (
              <Centered icon="clock" testID="watch.quiet" title="No demo copies in the last 2 hours" body="The demo leader only trades when someone runs a demo. Start one: the copy lands in about a second, with every step shown here." />
            ) : (
              <Centered icon="feed" testID="watch.runs.empty" title="No runs yet today" body="Run a demo trade to watch the leader's trade and its copy land, step by step, with both transactions." />
            )}
          </LCard>
        </View>
        <View style={{ flex: 1, gap: 16, minWidth: 0, minHeight: 0 }}>
          <LCard style={{ flex: 1, minHeight: 0, paddingHorizontal: 0, paddingBottom: 8 }} testID="watch.feed">
            <View style={{ paddingHorizontal: 18 }}>
              <SecHead title="Copies landing now" right={down ? (w.history === "indexer" ? "from Mirror's indexer and Monad" : "from Monad") : <Link title="Feed" onPress={() => router.push("/demo")} testID="watch.feed.link" />} />
            </View>
            <View style={{ flex: 1, minHeight: 0, overflow: "hidden" }} onLayout={(e) => setListH(e.nativeEvent.layout.height)}>
              {rows.length ? (
                rows.map((e, i) => (
                  <View key={e.id} style={{ borderTopWidth: i ? 1 : 0, borderTopColor: c.bd, marginHorizontal: 4 }}>
                    <RecentRow e={e} cfg={s.cfg} withTx testID={`watch.feed.${i}`} onPress={() => openRow(e)} />
                  </View>
                ))
              ) : (
                <Centered
                  icon={down && w.rpcError ? "warn" : "clock"}
                  testID="watch.empty"
                  title={w.isLoading ? "Reading the demo account" : down || w.via === "rpc" ? noCopiesLine(w.scannedMinutes) : "No demo copies yet"}
                  body={
                    w.isLoading
                      ? down ? "Reading its latest copies straight from Monad." : "Loading its latest copies."
                      : down || w.via === "rpc"
                        ? !w.account ? "The demo account's address isn't known for this network yet." : w.rpcError ? "Can't reach Monad to read the demo account. Retrying." : `${noCopiesLine(w.scannedMinutes)} on the demo account (read from Monad).`
                        : "Run a demo trade on the left: the leader trades on Perpl and the copy lands here about a second later."
                  }
                />
              )}
            </View>
          </LCard>
          {!down ? <DepositNudge /> : null}
        </View>
      </View>
      <BlockedSheet e={blocked} cfg={s.cfg} account={w.follower ?? undefined} demo onClose={() => setBlocked(null)} />
      <CopyDetailSheet e={copy} cfg={s.cfg} policy={w.follower?.policy} onClose={() => setCopy(null)} />
    </LaptopPage>
  );
}
