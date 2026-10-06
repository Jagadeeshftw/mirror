import * as Device from "expo-device";
import { router } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { ausd, ausdSigned, dateLong, pctSigned, shortAddr, toBig } from "../lib/format";
import { describeError, restoreAccount, type StoredAccount } from "../lib/wallet";
import { useFeedAll, useTotals } from "../state/data";
import { useSession } from "../state/session";
import { Icon } from "../ui/icons";
import { AppBar } from "../ui/chrome";
import { Button, Card, Checklist, Identicon, LatencyPill, Lbl, NansenLabel, Note, Row, Screen, Scroll, T, Meter } from "../ui/kit";
import { useColors } from "../ui/theme";

export default function Restore() {
  const c = useColors();
  const { setAccount, account } = useSession();
  const [phase, setPhase] = useState<"asking" | "found" | "error">("asking");
  const [found, setFound] = useState<StoredAccount | null>(account);
  const [error, setError] = useState<{ title: string; detail: string } | null>(null);
  const [done, setDone] = useState(false);
  const started = useRef(false);
  const { totals, isLoading, isError, refetch } = useTotals();
  const feed = useFeedAll();

  const run = async () => {
    setPhase("asking");
    setError(null);
    try {
      const a = await restoreAccount(Device.modelName ?? undefined);
      setFound(a);
      setAccount(a);
      setPhase("found");
    } catch (e) {
      const d = describeError(e);
      setError(d);
      setPhase("error");
    }
  };
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (account) setPhase("found");
    else void run();
  }, []);

  const accountsLoaded = phase === "found" && !!totals;
  // Keep asking until the accounts load (the service may be waking up or briefly unreachable).
  useEffect(() => {
    if (phase !== "found" || totals) return;
    const t = setInterval(() => refetch(), 3000);
    return () => clearInterval(t);
  }, [phase, !!totals]);
  useEffect(() => {
    if (accountsLoaded && !feed.isLoading) {
      const t = setTimeout(() => setDone(true), 400);
      return () => clearTimeout(t);
    }
  }, [accountsLoaded, feed.isLoading]);

  if (phase === "found" && done && totals && found) {
    const last = feed.events.find((e) => e.kind === "Mirrored");
    return (
      <Screen>
        <Scroll contentStyle={{ paddingHorizontal: 20, paddingTop: 16, gap: 18, flexGrow: 1 }}>
          <View style={{ width: 64, height: 64, borderRadius: 999, backgroundColor: c.posS, alignItems: "center", justifyContent: "center", alignSelf: "center", marginTop: 28 }}>
            <Icon name="check" size={28} color={c.posI} />
          </View>
          <T size={26} w={700} center testID="restore.welcome.back">
            Welcome back
          </T>
          <T size={13} color="mu" center>
            Everything is where you left it. Your follows kept running onchain while you switched phones.
          </T>
          <Card style={{ padding: 18, gap: 12 }}>
            <Lbl>Equity</Lbl>
            <Row align="flex-end" gap={6}>
              <T size={38} w={500} mono style={{ letterSpacing: -1.3 }}>
                {ausd(totals.equity)}
              </T>
              <T size={15} w={500} color="mu" style={{ marginBottom: 6 }}>
                AUSD
              </T>
            </Row>
            <Row>
              {[
                ["AUSD balance", ausd(totals.balance)],
                ["Leaders followed", String(totals.accounts.length)],
                ["Open positions", String(totals.openPositions)],
              ].map(([k, v]) => (
                <View key={k} style={{ flex: 1, gap: 2 }}>
                  <T size={12} color="mu">
                    {k}
                  </T>
                  <T size={16} w={500} mono>
                    {v}
                  </T>
                </View>
              ))}
            </Row>
          </Card>
          <Card list>
            {totals.accounts.map((a) => {
              const pnl = toBig(a.equityCNS) - toBig(a.netDepositsCNS);
              return (
                <Row key={a.account} gap={12} style={{ paddingVertical: 12, paddingHorizontal: 14 }}>
                  <Identicon seed={a.leader?.address ?? a.account} size={40} />
                  <View style={{ flex: 1 }}>
                    <Row gap={6}>
                      <T size={14} w={500} mono>
                        {shortAddr(a.leader?.address)}
                      </T>
                      {a.leader?.labels[0] ? <NansenLabel label={a.leader.labels[0]} /> : null}
                    </Row>
                    <T size={12} color="mu" mono>
                      {ausd(a.netDepositsCNS)} AUSD allocated
                    </T>
                  </View>
                  <View style={{ alignItems: "flex-end" }}>
                    <T size={14} w={600} mono color={pnl >= 0n ? "posI" : "neg"}>
                      {ausdSigned(pnl)}
                    </T>
                    <T size={12} mono color="mu">
                      {pctSigned((Number(pnl) / Math.max(1, Number(toBig(a.netDepositsCNS)))) * 100)}
                    </T>
                  </View>
                </Row>
              );
            })}
          </Card>
          {last ? (
            <Row gap={8}>
              <LatencyPill ms={last.latencyMs} label="Last copy in" />
            </Row>
          ) : null}
          <Note icon="phone">Lost the old phone? Sign it out in Settings.</Note>
          <View style={{ flex: 1 }} />
          <Button title="Go to Home" onPress={() => router.replace("/home")} testID="restore.go.home" />
        </Scroll>
      </Screen>
    );
  }

  const steps = [
    { key: "passkey", title: "Passkey verified", sub: phase === "found" ? `${Device.modelName ?? "This phone"} · screen lock` : "Choose your Mirror passkey", state: phase === "found" ? "done" : phase === "error" ? "failed" : "now" },
    { key: "located", title: "Account located onchain", sub: found ? `Owner ${shortAddr(found.address)}` : "Looking up your account on Monad", state: accountsLoaded ? "done" : phase === "found" ? "now" : "pending" },
    { key: "rules", title: "Follow rules loaded", sub: totals ? `${totals.accounts.length} follow${totals.accounts.length === 1 ? "" : "s"} · one MirrorAccount each` : "Reading your MirrorAccounts", state: accountsLoaded ? "done" : "pending" },
    { key: "balances", title: "Restoring balances and positions", sub: "Reading Perpl and your accounts", state: done ? "done" : accountsLoaded ? "now" : "pending" },
  ] as const;
  const frac = steps.filter((s) => s.state === "done").length / steps.length;
  return (
    <Screen>
      <AppBar showBack noBal noAv />
      <Scroll contentStyle={{ paddingHorizontal: 20, gap: 18, flexGrow: 1 }}>
        <View style={{ alignItems: "center", gap: 6, paddingTop: 16, paddingBottom: 4 }}>
          <View style={{ marginBottom: 8 }}>
            <Identicon seed={found?.address ?? "restore"} size={64} />
          </View>
          <T size={26} w={700} testID="restore.title">
            {phase === "error" ? "Couldn't restore" : found ? "Account found" : "Restore your account"}
          </T>
          {found ? (
            <T size={17} w={500} mono>
              {shortAddr(found.address)}
            </T>
          ) : null}
          <T size={12} color="mu">
            {found ? `Restored ${dateLong(Date.now())} · Monad` : "Your passkey syncs through Google Password Manager"}
          </T>
        </View>
        <Checklist items={steps as any} />
        <Meter parts={[{ frac, color: c.ac }]} height={6} />
        {phase === "found" && isError && !totals ? (
          <Note tone="warn" icon="wifioff" testID="restore.offline">
            Can't reach Mirror right now. Your passkey worked; retrying every few seconds.
          </Note>
        ) : null}
        {error ? (
          <Note tone="neg" icon="warn" testID="restore.error">
            <T size={13} w={600}>
              {error.title}
            </T>
            <T size={12} color="mu">
              {error.detail}
            </T>
          </Note>
        ) : (
          <Note icon="info">There is nothing to import. Your account lives on Monad, so your passkey is all you need on a new phone.</Note>
        )}
        <View style={{ flex: 1 }} />
        {phase === "error" ? (
          <View style={{ gap: 8 }}>
            <Button title="Try again" icon="fp" onPress={run} testID="restore.retry" />
            <Button title="Create a new account instead" kind="txt" onPress={() => router.replace("/welcome")} />
          </View>
        ) : (
          <Button title={phase === "asking" ? "Waiting for your passkey" : "Restoring"} disabled testID="restore.progress" />
        )}
        {isLoading ? null : null}
      </Scroll>
    </Screen>
  );
}
