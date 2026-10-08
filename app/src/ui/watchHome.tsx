// Home for an account with no deposit (watch mode), and the first-load states: skeleton for the
// first 3 s, "Still connecting" after that, and from 8 s (or at once on a refused connection) "Can't reach
// Mirror's service" with the balance, follow-account equity and watch mode read straight from Monad.
import { router } from "expo-router";
import React, { useState } from "react";
import { View } from "react-native";
import { balanceLine, failTitle, mirrorDownBody, noCopiesLine } from "../lib/conn";
export { balanceLine };
import { ago, ausd, shortAddr } from "../lib/format";
import type { AppConfig, FeedEvent } from "../lib/types";
import { useRpcHealth } from "../state/conn";
import { useSession } from "../state/session";
import { useDemoStream, useRunDemo, useWatch } from "../state/watch";
import { CopyDetailSheet } from "./copyDetail";
import { BlockedSheet, FeedItem, openTx } from "./feed";
import { Icon } from "./icons";
import { Button, Card, ErrorBanner, Lbl, Link, Note, Row, T, TxLink } from "./kit";
import { CheckRow, LiveDot, SecHead, Skel } from "./kit2";
import { useColors } from "./theme";
import { CycleCard, DemoCard, DepositNudge, RunButtons } from "./watch";

const QUIET_MS = 2 * 3600e3;

export function WatchHome({ cfg, walletCNS, followsCNS = null, walletLoading, walletError, down, onRetry }: { cfg: AppConfig | undefined; walletCNS: bigint | null; followsCNS?: bigint | null; walletLoading?: boolean; walletError?: boolean; down?: boolean; onRetry?: () => void }) {
  const c = useColors();
  const w = useWatch({ backendDown: down });
  const live = useDemoStream(!down);
  const { run, busy, error } = useRunDemo();
  const [blocked, setBlocked] = useState<FeedEvent | null>(null);
  const [copy, setCopy] = useState<FeedEvent | null>(null);
  const lastCopy = w.events[0];
  const quiet = !w.isLoading && !w.busy && (!lastCopy || Date.now() - lastCopy.timestamp > QUIET_MS);
  const running = w.cycles.filter((cy) => cy.status === "running");
  const shownCycles = running.length ? [...running, ...w.cycles.filter((cy) => cy.status !== "running").slice(0, 1)] : [];
  const runs = <RunButtons w={w} onRun={run} busy={busy} error={error} down={down} />;
  return (
    <View style={{ gap: 16 }} testID="home.watch">
      {down ? <ErrorBanner testID="home.offline" title={failTitle("mirror")} body={mirrorDownBody("account")} onRetry={onRetry} /> : null}
      {(
        <View style={{ paddingHorizontal: 20, gap: 6 }} testID="home.account">
          <Lbl>Your account</Lbl>
          <Row align="flex-end" gap={6}>
            <T testID="home.equity" size={44} w={500} mono lh={48} style={{ letterSpacing: -1.5 }}>
              {walletCNS === null ? "—" : ausd(walletCNS + (down && followsCNS ? followsCNS : 0n))}
            </T>
            <T size={15} w={500} color="mu" style={{ marginBottom: 7 }}>
              AUSD
            </T>
          </Row>
          <T size={13} color="mu" testID="home.balance.source">
            {balanceLine({ walletCNS, followsCNS, down, walletLoading, walletError })}
          </T>
          <Row gap={10} style={{ marginTop: 8 }}>
            <Button title="Add funds" icon="arrdown" size="md" flex onPress={() => router.push("/funds")} testID="watch.addFunds" />
            <Button title="Browse leaders" icon="leaders" kind="out" size="md" flex style={{ paddingHorizontal: 12 }} onPress={() => router.push("/leaders")} testID="watch.browseLeaders" />
          </Row>
        </View>
      )}
      <View style={{ paddingHorizontal: 20, gap: 10 }}>
        <SecHead title="Watch mode" right={down ? "read from Monad" : running.length ? <LiveDot on={live} /> : "real copies, team money"} />
        <DemoCard w={w} cfg={cfg} live={live} />
        {shownCycles.map((cy) => (
          <CycleCard key={cy.id} cy={cy} cfg={cfg} />
        ))}
        {quiet && !down ? (
          <Card style={{ padding: 20, gap: 10, alignItems: "center" }} testID="watch.quiet">
            <View style={{ width: 44, height: 44, borderRadius: 999, backgroundColor: c.sf2, alignItems: "center", justifyContent: "center" }}>
              <Icon name="clock" size={22} color={c.mu} />
            </View>
            <T size={19} w={600} center>
              No demo copies in the last 2 hours
            </T>
            <T size={13} color="mu" center>
              The demo leader only trades when someone runs a demo. Start one: the copy lands in about a second.
            </T>
            <View style={{ alignSelf: "stretch" }}>{runs}</View>
          </Card>
        ) : (
          runs
        )}
      </View>
      {quiet && lastCopy && !down ? (
        <Card style={{ marginHorizontal: 20, paddingVertical: 12, paddingHorizontal: 14 }} testID="watch.lastCopy">
          <Row gap={8}>
            <T size={13} style={{ flex: 1 }}>
              Last copy: {lastCopy.kind === "Blocked" ? "blocked" : `${cfg?.markets.find((m) => m.perpId === lastCopy.perpId)?.symbol ?? ""} ${(lastCopy.orderType ?? 0) <= 1 ? "opened" : "closed"}`}
            </T>
            <T size={12} color="mu">
              {ago(lastCopy.timestamp)} ago
            </T>
            <TxLink hash={lastCopy.txHash} onPress={() => openTx(cfg, lastCopy.txHash)} />
          </Row>
        </Card>
      ) : null}
      {!quiet || down ? (
        <View style={{ paddingHorizontal: 16, gap: 10 }}>
          <SecHead style={{ paddingHorizontal: 4 }} title="Copies landing now" right={down ? undefined : <Link title="Feed" onPress={() => router.push("/demo")} testID="watch.feed.link" />} />
          {w.events.length === 0 ? (
            <T size={13} color="mu" style={{ paddingHorizontal: 4 }} testID="watch.empty">
              {w.isLoading ? "Reading the demo account from Monad" : down && !w.account ? "The demo account's address isn't known for this network yet." : w.rpcError ? "Can't reach Monad to read the demo account. Retrying." : `${noCopiesLine(w.scannedMinutes)} on the demo account (read from Monad).`}
            </T>
          ) : null}
          {w.events.slice(0, down ? 3 : 4).map((e, i) => (
            <FeedItem key={e.id} e={e} cfg={cfg} testID={`watch.feed.${i}`} onBlockedPress={setBlocked} onCopyPress={setCopy} />
          ))}
        </View>
      ) : null}
      {!down ? (
        <View style={{ paddingHorizontal: 20 }}>
          <DepositNudge />
        </View>
      ) : null}
      <BlockedSheet e={blocked} cfg={cfg} account={w.follower ?? undefined} demo onClose={() => setBlocked(null)} />
      <CopyDetailSheet e={copy} cfg={cfg} policy={w.follower?.policy} onClose={() => setCopy(null)} />
    </View>
  );
}

/** First 5 seconds: the layout, with the balance already read from Monad. Never a lone spinner. */
export function HomeSkeleton({ walletCNS, waitedMs }: { walletCNS: bigint | null; waitedMs: number }) {
  return (
    <View style={{ gap: 16 }} testID="home.skeleton">
      <View style={{ paddingHorizontal: 20, gap: 6 }}>
        <Lbl>Your account</Lbl>
        <Row align="flex-end" gap={6}>
          <T size={44} w={500} mono lh={48} style={{ letterSpacing: -1.5 }} testID="home.equity">
            {walletCNS === null ? "—" : ausd(walletCNS)}
          </T>
          <T size={15} w={500} color="mu" style={{ marginBottom: 7 }}>
            AUSD
          </T>
        </Row>
        <T size={13} color="mu">
          {walletCNS === null ? "Reading from Monad" : `Read from Monad · ${new Date().toLocaleTimeString("en-GB")}`}
        </T>
      </View>
      <View style={{ paddingHorizontal: 20, gap: 14 }}>
        <Skel w="40%" />
        <Skel card h={120} />
        <Skel w="60%" />
        <Skel card h={62} />
        <Skel card h={62} />
      </View>
      <T size={12} color="mu" center testID="home.connecting">
        Connecting to Mirror · {Math.max(1, Math.round(waitedMs / 1000))} s
      </T>
    </View>
  );
}

/** After 5 s without an answer: what has loaded, what hasn't, and watch mode meanwhile. */
export function SlowCard({ walletCNS, waitedMs, onWatch, onRetry }: { walletCNS: bigint | null; waitedMs: number; onWatch: () => void; onRetry: () => void }) {
  const { account } = useSession();
  const rpc = useRpcHealth(10_000);
  return (
    <View style={{ paddingHorizontal: 16, gap: 14 }} testID="home.slow">
      <Card style={{ padding: 16, gap: 4 }}>
        <Row gap={12} style={{ paddingBottom: 6 }}>
          <View style={{ width: 36, height: 36, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: useColors().wrnS }}>
            <Icon name="clock" size={20} color={useColors().wrnI} />
          </View>
          <View style={{ flex: 1 }}>
            <T size={15} w={600}>
              Still connecting to Mirror
            </T>
            <T size={12} mono color="mu">
              {Math.round(waitedMs / 1000)} s so far. Here is what has loaded.
            </T>
          </View>
        </Row>
        <CheckRow state="done" title="Signed in with your passkey" sub={account?.device ?? "This device"} />
        <CheckRow
          state={rpc.data ? "done" : rpc.isError ? "blk" : "now"}
          title={rpc.isError ? "Can't reach Monad" : "Monad reachable"}
          sub={rpc.data ? `Checked from this device · ${rpc.data.host} · ${rpc.data.ms} ms · block ${Number(rpc.data.block).toLocaleString("en-US")}` : rpc.isError ? "The Monad RPC isn't answering from this device." : "Checking the RPC"}
          testID="home.slow.monad"
        />
        <CheckRow state={walletCNS !== null ? "done" : "now"} title="Your account, read from Monad" sub={account ? `${shortAddr(account.address)} · ${walletCNS !== null ? `${ausd(walletCNS)} AUSD` : "reading"}` : ""} />
        <CheckRow state="now" title="Mirror server" sub="No answer yet. Leaders, the feed and history come from here." last testID="home.slow.mirror" />
      </Card>
      <Note>The balance at the top comes straight from Monad, so it is correct while we wait.</Note>
      <Button title="Watch the demo meanwhile" icon="eye" onPress={onWatch} testID="home.slow.watch" />
      <Button title="Retry now" icon="refresh" kind="out" onPress={onRetry} testID="home.slow.retry" />
      <T size={12} color="mu" center>
        Still nothing after 8 s? We show "Can't reach Mirror's service", read what we can from Monad and keep retrying.
      </T>
    </View>
  );
}
