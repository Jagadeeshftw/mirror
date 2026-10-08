// Judge path: the TEAM-RUN demo follower. Run a demo trade (copied) or a blocked trade
// (rejected onchain by the max leverage rule). Progress streams over /v1/stream?account=demo.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import React, { useEffect, useState } from "react";
import { View } from "react-native";
import { api, ApiError, streamUrl } from "../lib/api";
import { ausd, ausdSigned, leverage, lots, shortAddr, toBig } from "../lib/format";
import { openSse } from "../lib/sse";
import type { DemoCycle, DemoState, FeedEvent, FeedPage } from "../lib/types";
import { useConfig, useDemo, useMarkets } from "../state/data";
import { applyCommit, applyFeedEvent } from "../state/live";
import { AppBar } from "../ui/chrome";
import { BlockedSheet, FeedItem, openTx } from "../ui/feed";
import { Icon } from "../ui/icons";
import { Button, Card, ChipS, CommitTrack, ErrorBanner, Identicon, Lbl, LatencyPill, LoadingBlock, MarketBadge, Note, Row, Screen, Scroll, Side, T, TeamRunBadge, TxLink } from "../ui/kit";
import { useColors } from "../ui/theme";
import { CopyDetailSheet } from "../ui/copyDetail";
import { WatchHome } from "../ui/watchHome";

function CycleCard({ cy, cfg }: { cy: DemoCycle; cfg: ReturnType<typeof useConfig>["data"] }) {
  const c = useColors();
  return (
    <Card style={{ padding: 14, gap: 4 }} testID={`demo.cycle.${cy.id}`}>
      <Row>
        <T size={14} w={600} style={{ flex: 1 }}>
          {cy.kind === "trade" ? "Demo trade" : "Blocked trade"} · {cy.id}
        </T>
        <ChipS testID="demo.cycle.status" label={cy.status === "running" ? "Running" : cy.status === "done" ? "Done" : "Failed"} tone={cy.status === "running" ? "ac" : cy.status === "done" ? "ok" : "neg"} />
      </Row>
      {cy.steps.map((s, i) => (
        <View key={s.key} testID={`demo.step.${s.key}.${s.status}`} style={{ flexDirection: "row", gap: 10, paddingVertical: 8, borderTopWidth: i ? 1 : 0, borderTopColor: c.bd }}>
          <View
            style={{
              width: 22,
              height: 22,
              borderRadius: 999,
              marginTop: 1,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: s.status === "done" ? c.posS : s.status === "blocked" || s.status === "failed" ? c.negS : "transparent",
              borderWidth: s.status === "pending" || s.status === "running" ? 2 : 0,
              borderColor: s.status === "running" ? c.ac : c.bd,
            }}
          >
            {s.status === "done" ? <Icon name="check" size={14} color={c.posI} /> : null}
            {s.status === "blocked" ? <Icon name="ban" size={14} color={c.neg} /> : null}
            {s.status === "running" ? <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: c.ac }} /> : null}
          </View>
          <View style={{ flex: 1, gap: 4 }}>
            <T size={13} w={s.status === "pending" ? 400 : 600} color={s.status === "pending" ? "mu" : s.status === "blocked" ? "neg" : "tx"}>
              {s.label}
            </T>
            {s.detail ? (
              <T size={12} color="mu">
                {s.detail}
              </T>
            ) : null}
            {s.txHash || s.latencyMs ? (
              <Row gap={8} style={{ flexWrap: "wrap" }}>
                {s.latencyMs ? <LatencyPill ms={s.latencyMs} label={s.status === "blocked" ? "Checked in" : "Copied in"} testID={`demo.latency.${s.key}`} /> : null}
                {s.commitState ? <CommitTrack state={s.commitState} /> : null}
                {s.txHash ? <TxLink hash={s.txHash} onPress={() => openTx(cfg, s.txHash!)} testID={`demo.tx.${s.key}`} /> : null}
              </Row>
            ) : null}
          </View>
        </View>
      ))}
    </Card>
  );
}

export default function Demo() {
  const c = useColors();
  const qc = useQueryClient();
  const cfg = useConfig().data;
  const { byPerp } = useMarkets(cfg);
  const demo = useDemo();
  const d = demo.data;
  const follower = d?.follower;
  const feed = useQuery({ queryKey: ["feed", follower?.account ?? "demo"], queryFn: () => api.feed(follower!.account), enabled: !!follower, refetchInterval: 20_000 });
  const [live, setLive] = useState(false);
  const [err, setErr] = useState<{ title: string; body: string; until?: number } | null>(null);
  const [busy, setBusy] = useState<"trade" | "blocked" | null>(null);
  const [blocked, setBlocked] = useState<FeedEvent | null>(null);
  const [copy, setCopy] = useState<FeedEvent | null>(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const h = openSse(streamUrl("demo"), {
      onOpen: () => setLive(true),
      onError: () => setLive(false),
      onMessage: (m) => {
        if (m.event === "demo") {
          const cy = JSON.parse(m.data) as DemoCycle;
          qc.setQueryData<DemoState>(["demo"], (old) => {
            if (!old) return old;
            const rest = old.cycles.filter((x) => x.id !== cy.id);
            return { ...old, busy: cy.status === "running", cycles: [cy, ...rest] };
          });
          if (cy.status !== "running") qc.invalidateQueries({ queryKey: ["demo"] });
        } else if (m.event === "feed") {
          const e = JSON.parse(m.data) as FeedEvent;
          applyFeedEvent(qc, e);
          qc.invalidateQueries({ queryKey: ["demo"] });
        } else if (m.event === "commit") {
          const u = JSON.parse(m.data);
          const acct = qc.getQueryData<DemoState>(["demo"])?.follower.account;
          if (acct) applyCommit(qc, acct, u);
        } else if (m.event === "hello") setLive(true);
      },
    });
    return () => h.close();
  }, [qc]);

  useEffect(() => {
    if (!err?.until) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [err?.until]);

  const run = async (kind: "trade" | "blocked") => {
    setErr(null);
    setBusy(kind);
    try {
      kind === "trade" ? await api.demoTrade() : await api.demoBlocked();
      qc.invalidateQueries({ queryKey: ["demo"] });
    } catch (e) {
      if (e instanceof ApiError) {
        const until = e.retryAfterSec ? Date.now() + e.retryAfterSec * 1000 : undefined;
        if (e.status === 429) setErr({ title: e.code === "daily_cap" ? "Today's demo budget is used up" : "Demo limit reached", body: e.message, until });
        else if (e.status === 409) setErr({ title: "A demo is already running", body: e.message, until });
        else if (e.isNetwork) setErr({ title: "Can't reach the demo service", body: "Check your connection and try again." });
        else setErr({ title: "Demo didn't start", body: e.message });
      } else setErr({ title: "Demo didn't start", body: String(e) });
    } finally {
      setBusy(null);
    }
  };

  const wait = err?.until ? Math.max(0, Math.ceil((err.until - now) / 1000)) : 0;
  const running = d?.busy || d?.cycles.some((x) => x.status === "running");
  const events = (feed.data as FeedPage | undefined)?.events ?? [];

  return (
    <Screen>
      <AppBar title="Demo" showBack noAv />
      <Scroll testID="demo.screen">
        {/* Mirror's service down: the demo account's real copies, read straight from Monad (Run buttons off). */}
        {demo.isError && !d ? <WatchHome cfg={cfg} walletCNS={null} down showAccount={false} onRetry={() => demo.refetch()} /> : null}
        {!d ? (
          demo.isLoading ? <LoadingBlock label="Loading the demo account" /> : null
        ) : (
          <>
            <View style={{ paddingHorizontal: 20, gap: 8 }}>
              <TeamRunBadge />
              <T size={13} color="mu" lh={19}>
                Run by the Mirror team so you can see a real copy land on Perpl without funding anything. It never counts toward user numbers.
              </T>
            </View>
            <Card style={{ marginHorizontal: 20, padding: 16, gap: 12 }} testID="demo.account">
              <Row gap={12}>
                <Identicon seed={follower!.account} size={36} />
                <View style={{ flex: 1 }}>
                  <T size={14} w={600}>
                    Team-run demo account
                  </T>
                  <T size={12} mono color="mu">
                    {shortAddr(follower!.account)} · copies {shortAddr(d.leader.address)}
                  </T>
                </View>
                <Row gap={6}>
                  <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: live ? c.pos : c.mu }} />
                  <T size={12} w={600} color={live ? "posI" : "mu"} testID="demo.live">
                    {live ? "Live" : "Connecting"}
                  </T>
                </Row>
              </Row>
              <Row>
                {[
                  ["Balance", ausd(follower!.balanceCNS), "demo.balance"],
                  ["Equity", ausd(follower!.equityCNS), "demo.equity"],
                  ["Realised", ausdSigned(follower!.pnl.realisedCNS), "demo.realised"],
                ].map(([k, v, id]) => (
                  <View key={k} style={{ flex: 1, gap: 2 }}>
                    <T size={12} color="mu">
                      {k}
                    </T>
                    <T size={16} w={500} mono testID={id}>
                      {v}
                    </T>
                  </View>
                ))}
              </Row>
              <View style={{ gap: 6, paddingTop: 10, borderTopWidth: 1, borderTopColor: c.bd }}>
                <Lbl>Positions</Lbl>
                {follower!.positions.length ? (
                  follower!.positions.map((p, i) => {
                    const m = byPerp.get(p.perpId);
                    return (
                      <Row key={i} gap={8} testID={`demo.position.${i}`}>
                        <MarketBadge symbol={m?.symbol ?? "?"} size={24} />
                        <T size={13} w={600}>
                          {m?.symbol}
                        </T>
                        <Side side={p.side} />
                        <T size={12} mono color="mu" style={{ flex: 1 }}>
                          {m ? lots(p.lotLNS, m.lotDecimals) : p.lotLNS} · {leverage(p.leverageHdths)}
                        </T>
                        <T size={12} mono color={toBig(p.upnlCNS) >= 0n ? "posI" : "neg"}>
                          {ausdSigned(p.upnlCNS, 4)}
                        </T>
                      </Row>
                    );
                  })
                ) : (
                  <T size={12} color="mu">
                    Flat. Run a demo trade to open one.
                  </T>
                )}
              </View>
              <T size={12} color="mu">
                Rules: max leverage {follower!.policy ? leverage(follower!.policy.maxLeverageHdths) : "5x"} · BTC only · 100% of leader size
              </T>
            </Card>
            <View style={{ paddingHorizontal: 20, gap: 10 }}>
              <Button title={busy === "trade" ? "Starting" : "Run demo trade"} icon="feed" onPress={() => run("trade")} disabled={!!busy || !!running || wait > 0} testID="demo.runTrade" />
              <Button title={busy === "blocked" ? "Starting" : "Run blocked trade"} icon="ban" kind="out" onPress={() => run("blocked")} disabled={!!busy || !!running || wait > 0} testID="demo.runBlocked" />
              <T size={12} color="mu" center>
                The leader opens 1 lot of BTC on Perpl; the copy follows within a second. A blocked trade uses 12x, above this account's 5x rule. {d.limits.perIpPerHour} runs per hour per network · {d.limits.dailyRemaining} left today.
              </T>
            </View>
            {err ? (
              <Note tone={err.until ? "warn" : "neg"} icon={err.until ? "clock" : "warn"} testID="demo.error">
                <T size={13} w={600}>
                  {err.title}
                </T>
                <T size={12} color="mu">
                  {err.body}
                  {wait > 0 ? ` Try again in ${wait >= 60 ? `${Math.ceil(wait / 60)} min` : `${wait} s`}.` : ""}
                </T>
              </Note>
            ) : null}
            {d.cycles.length ? (
              <View style={{ paddingHorizontal: 20, gap: 10 }}>
                <T size={16} w={600}>
                  Demo runs
                </T>
                {d.cycles.slice(0, 3).map((cy) => (
                  <CycleCard key={cy.id} cy={cy} cfg={cfg} />
                ))}
              </View>
            ) : null}
            <View style={{ paddingHorizontal: 16, gap: 10 }}>
              <T size={16} w={600} style={{ paddingHorizontal: 4 }}>
                Live copy feed
              </T>
              {events.slice(0, 8).map((e, i) => (
                <FeedItem key={e.id} e={e} cfg={cfg} onBlockedPress={setBlocked} onCopyPress={setCopy} testID={`demo.feed.${i}`} />
              ))}
            </View>
          </>
        )}
      </Scroll>
      <BlockedSheet e={blocked} cfg={cfg} account={follower} demo onClose={() => setBlocked(null)} />
      <CopyDetailSheet e={copy} cfg={cfg} policy={follower?.policy} onClose={() => setCopy(null)} />
    </Screen>
  );
}
