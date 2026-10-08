// Welcome card: the latest real copy on the team-run demo follower, read with a 5 s budget. When none
// is available (or Mirror is slow) the card says "Example" so it is never mistaken for a real copy.
import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import React from "react";
import { View } from "react-native";
import { api } from "../lib/api";
import { serviceDownLine } from "../lib/network";
import { ago, ausd, leverage, lots as fmtLots } from "../lib/format";
import { bpsText, fillDeviationBps } from "../lib/proof";
import type { FeedEvent } from "../lib/types";
import { useConfig } from "../state/data";
import { openTx } from "./feed";
import { Icon } from "./icons";
import { BrandMark, Identicon, Link, Row, Side, T, TxLink } from "./kit";
import { LiveDot, TeamBadge } from "./kit2";
import { useColors } from "./theme";

export const WELCOME_TIMEOUT_MS = 5_000;

export function useLatestDemoCopy() {
  return useQuery({
    queryKey: ["welcomeCopy"],
    queryFn: async (): Promise<{ e: FeedEvent; maxLev: number | null } | null> => {
      const d = await api.demo(WELCOME_TIMEOUT_MS);
      const page = await api.feed(d.follower.account, null, WELCOME_TIMEOUT_MS);
      const e = page.events.find((x) => x.kind === "Mirrored" && (x.orderType ?? 0) <= 1);
      return e ? { e, maxLev: d.follower.policy?.maxLeverageHdths ?? null } : null;
    },
    retry: 0,
    staleTime: 60_000,
  });
}

export function WelcomeCopy() {
  const c = useColors();
  const cfg = useConfig().data;
  const q = useLatestDemoCopy();
  const real = q.data?.e;
  const m = real ? cfg?.markets.find((x) => x.perpId === real.perpId) : undefined;
  const sym = m?.symbol ?? "BTC";
  const size = real && m ? `${fmtLots(real.lotLNS ?? "0", m.lotDecimals)} ${sym}` : "0.0001 BTC";
  const lev = real?.leverageHdths ? leverage(real.leverageHdths) : "2x";
  const dev = real?.proof ? `${bpsText(fillDeviationBps(real.proof, real.orderType ?? 0))} bps` : "+1.0 bps";
  const card = { backgroundColor: c.sf, borderWidth: 1, borderColor: c.bd, borderRadius: 16, padding: 14, gap: 6 } as const;
  return (
    <View accessibilityLabel={real ? "Latest real copy" : "Example copy"} testID={real ? "onboarding.latestCopy" : "onboarding.exampleCopy"} style={{ marginTop: 4 }}>
      <Row gap={8} style={{ marginBottom: 8 }}>
        {real ? <LiveDot label="Latest real copy" /> : <T size={12} w={600} color="mu" testID="onboarding.example.label">Example</T>}
        {real ? <TeamBadge /> : null}
        <View style={{ flex: 1 }} />
        <T size={12} mono color="mu">{real ? `${ago(real.timestamp)} ago` : q.isLoading ? "Loading the latest copy" : ""}</T>
      </Row>
      <View style={card}>
        <Row gap={8}>
          <Identicon seed={real ? String(real.leaderAccountId) : "example"} size={28} />
          <T size={14} w={500} mono>{real ? `Perpl #${real.leaderAccountId}` : "0x7a3f…c91e"}</T>
        </Row>
        <Row gap={6}>
          <T size={13} color="mu">Opened</T>
          <T size={13} w={600}>{sym}</T>
          <Side side={(real?.orderType ?? 0) === 1 ? "Short" : "Long"} />
          <T size={13} mono color="mu">{`${size} · ${lev}`}</T>
        </Row>
      </View>
      <View style={{ alignItems: "center", paddingVertical: 8 }}>
        <View style={{ position: "absolute", top: 0, bottom: 0, left: "50%", borderLeftWidth: 1, borderLeftColor: c.bd }} />
        <View style={{ flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: c.sf2, paddingLeft: 7, paddingRight: 9, paddingVertical: 3, borderRadius: 999 }}>
          <Icon name="feed" size={14} color={c.ac} />
          <T size={12} w={500} mono>{`copied in ${real?.latencyMs ? (real.latencyMs / 1000).toFixed(2) : "0.61"} s${real?.latencyBlocks ? ` · ${real.latencyBlocks} blocks` : real ? "" : " · 2 blocks"}`}</T>
        </View>
      </View>
      <View style={{ ...card, borderColor: c.ac }}>
        <Row gap={8}>
          {real ? <Identicon seed={real.account} size={28} /> : <BrandMark size={28} />}
          <T size={14} w={600}>{real ? "Demo follower" : "Your copy"}</T>
          <View style={{ flex: 1 }} />
          <Icon name="check" size={14} color={c.posI} />
          <T size={12} w={600} color="posI">Finalized</T>
        </Row>
        <T size={13} mono>{`${size} · ${real ? ausd(real.notionalCNS ?? "0") : "11.84"} AUSD · ${dev}`}</T>
        <Row gap={6} style={{ paddingTop: 6, borderTopWidth: 1, borderTopColor: c.bd }}>
          <Icon name="shield" size={14} color={c.ac} />
          <T size={12} color="mu" style={{ flex: 1 }}>{real && q.data?.maxLev ? `Checked onchain: under its ${leverage(q.data.maxLev)} limit` : "Checked onchain: under your 5x limit"}</T>
          {real ? <TxLink hash={real.txHash} onPress={() => openTx(cfg, real.txHash)} testID="onboarding.latestCopy.tx" /> : null}
        </Row>
      </View>
      {!real && !q.isLoading ? (
        <Row gap={6} style={{ marginTop: 10, justifyContent: "center" }}>
          <T size={12} color="mu">{q.isError ? `${serviceDownLine()}.` : "No recent demo copy."}</T>
          <Link title="Watch real copies" onPress={() => router.push("/demo")} testID="onboarding.watch" />
        </Row>
      ) : null}
    </View>
  );
}
