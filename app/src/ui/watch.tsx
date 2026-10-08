// Watch mode pieces: the team-run demo follower card, Run buttons, demo cycle cards and the deposit nudge.
import { router } from "expo-router";
import React from "react";
import { View } from "react-native";
import { ausd, bps, leverage, shortAddr } from "../lib/format";
import { runNote } from "../lib/conn";
import { followLimits } from "../lib/policy";
import { useConfig } from "../state/data";
import type { AppConfig, DemoCycle } from "../lib/types";
import type { RunError, WatchData } from "../state/watch";
import { openTx } from "./feed";
import { Icon } from "./icons";
import { Button, Card, ChipS, CommitTrack, Identicon, LatencyPill, Note, Row, T, TxLink } from "./kit";
import { CheckRow, LiveDot, TeamBadge } from "./kit2";
import { useColors } from "./theme";

const DAY = 86_400_000;

export function rulesLine(w: WatchData, cfg: AppConfig | undefined): string {
  const p = w.follower?.policy;
  if (!p) return "Its rules are written in its own account contract and checked on every copy. Not counted in Mirror's public numbers.";
  const syms = p.markets.map((m) => cfg?.markets.find((x) => x.perpId === m.perpId)?.symbol).filter(Boolean) as string[];
  const ratio = p.leaders[0]?.ratioBps ?? 0;
  const parts = [`max ${leverage(p.maxLeverageHdths)}`, syms.length === 1 ? `${syms[0]} only` : syms.join(", "), `${bps(ratio)} of leader size`];
  if (p.maxEntryDeviationBps) parts.push(`within ${bps(p.maxEntryDeviationBps)} of the leader's entry`);
  return `Its rules: ${parts.join(" · ")}. Not counted in Mirror's public numbers.`;
}

export function DemoCard({ w, cfg, live }: { w: WatchData; cfg: AppConfig | undefined; live: boolean }) {
  const c = useColors();
  const pos = w.follower?.positions ?? [];
  const open = w.follower ? (pos.length ? pos.map((p) => `${cfg?.markets.find((m) => m.perpId === p.perpId)?.symbol ?? "?"} ${p.side}`).join(", ") : "Flat") : "—";
  const today = w.events.filter((e) => e.kind === "Mirrored" && e.timestamp > Date.now() - DAY).length;
  return (
    <Card style={{ padding: 14, gap: 12 }} testID="watch.demoCard">
      <Row gap={12}>
        <Identicon seed={w.account ?? "demo"} size={36} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Row gap={6}>
            <T size={13} w={600} lines={1}>
              Demo follower
            </T>
            <TeamBadge testID="watch.teamRun" />
          </Row>
          <T size={12} mono color="mu" lines={1}>
            {shortAddr(w.account)}
            {w.leaderAccountId ? ` · copies Perpl #${w.leaderAccountId}` : ""}
          </T>
        </View>
        {w.via === "rpc" ? (
          <T size={12} color="mu" testID="watch.source">
            Read from Monad
          </T>
        ) : (
          <LiveDot on={live} label={live ? "Live" : "Connecting"} testID="watch.source" />
        )}
      </Row>
      <Row>
        {[
          ["Balance", w.equityCNS ? ausd(w.equityCNS) : w.isLoading ? "Reading" : "—", "watch.balance"],
          ["Open", open, "watch.open"],
          ["Copies today", String(today), "watch.today"],
        ].map(([k, v, id]) => (
          <View key={k} style={{ flex: 1, gap: 2 }}>
            <T size={12} color="mu">
              {k}
            </T>
            <T size={16} w={500} mono lines={1} testID={id}>
              {v}
            </T>
          </View>
        ))}
      </Row>
      <Row gap={6} align="flex-start" style={{ paddingTop: 10, borderTopWidth: 1, borderTopColor: c.bd }}>
        <View style={{ marginTop: 1 }}>
          <Icon name="shield" size={14} color={c.ac} />
        </View>
        <T size={12} color="mu" style={{ flex: 1 }} lh={17}>
          {rulesLine(w, cfg)}
        </T>
      </Row>
    </Card>
  );
}

export function RunButtons({ w, onRun, busy, error, down }: { w: WatchData; onRun: (k: "trade" | "blocked") => void; busy: "trade" | "blocked" | null; error: RunError | null; down?: boolean }) {
  const disabled = down || w.busy || !!busy || w.source !== "api";
  const note = down || w.via === "rpc"
    ? runNote()
    : w.busy
      ? "One run at a time. The buttons come back when this one is final."
      : `Uses the team's money on Perpl, never yours.${w.limits ? ` ${w.limits.perIpPerHour} runs per hour per network · ${w.limits.dailyRemaining} left today.` : ""}`;
  return (
    <View style={{ gap: 8 }}>
      <Button title={w.busy ? "Demo trade running" : busy === "trade" ? "Starting" : "Run demo trade"} icon="feed" onPress={() => onRun("trade")} disabled={disabled} testID="watch.runDemo" />
      <Button title={busy === "blocked" ? "Starting" : "Run blocked trade"} icon="ban" kind="out" onPress={() => onRun("blocked")} disabled={disabled} testID="watch.runBlocked" />
      <T size={12} color="mu" center testID="watch.runNote">
        {note}
      </T>
      {error ? (
        <Note tone={error.until ? "warn" : "neg"} icon={error.until ? "clock" : "warn"} testID="watch.error">
          <T size={13} w={600}>
            {error.title}
          </T>
          <T size={12} color="mu">
            {error.body}
          </T>
        </Note>
      ) : null}
    </View>
  );
}

export function CycleCard({ cy, cfg }: { cy: DemoCycle; cfg: AppConfig | undefined }) {
  const map = { done: "done", running: "now", blocked: "blk", failed: "blk", pending: "pending" } as const;
  return (
    <Card style={{ paddingVertical: 10, paddingHorizontal: 14, gap: 2 }} testID={`watch.cycle.${cy.id}`}>
      <Row>
        <T size={13} w={600} style={{ flex: 1 }}>
          {cy.kind === "trade" ? "Demo trade" : "Blocked trade"} · {cy.id}
        </T>
        <ChipS label={cy.status === "running" ? "Running" : cy.status === "done" ? "Done" : "Failed"} tone={cy.status === "running" ? "ac" : cy.status === "done" ? "ok" : "neg"} icon={cy.status === "done" ? "check" : undefined} testID="watch.cycle.status" />
      </Row>
      {cy.steps.map((s, i) => (
        <CheckRow
          key={s.key}
          state={map[s.status]}
          title={s.label}
          sub={s.detail}
          last={i === cy.steps.length - 1}
          testID={`watch.step.${s.key}.${s.status}`}
          extra={
            s.txHash || s.latencyMs || s.commitState ? (
              <>
                {s.latencyMs ? <LatencyPill ms={s.latencyMs} label={s.status === "blocked" ? "Checked in" : ""} /> : null}
                {s.commitState && s.status !== "blocked" ? <CommitTrack state={s.commitState} /> : null}
                <TxLink hash={s.txHash} onPress={() => openTx(cfg, s.txHash)} />
              </>
            ) : undefined
          }
        />
      ))}
    </Card>
  );
}

export function DepositNudge({ testID = "watch.deposit" }: { testID?: string }) {
  const c = useColors();
  const cap = followLimits(useConfig().data).capCNS;
  return (
    <View style={{ padding: 14, gap: 12, borderRadius: 16, borderWidth: 1, borderColor: c.ac, backgroundColor: c.sf }}>
      <Row gap={10} align="flex-start">
        <Icon name="arrdown" size={20} color={c.ac} />
        <View style={{ flex: 1 }}>
          <T size={13} w={600}>
            Copy with your own limits
          </T>
          <T size={12} color="mu">
            {`Deposit up to ${ausd(cap)} AUSD during beta. One passkey signature, no gas.`}
          </T>
        </View>
      </Row>
      <Button title="Add funds" size="md" onPress={() => router.push("/funds")} testID={testID} />
    </View>
  );
}
