// Copy detail: phone bottom sheet and laptop side panel around ProofBody.
import { useQuery } from "@tanstack/react-query";
import * as Linking from "expo-linking";
import React from "react";
import { ScrollView, View } from "react-native";
import { api } from "../lib/api";
import { txUrl } from "../lib/chain";
import type { QualityCopy } from "../lib/engineTypes";
import { ago, ausd, leverage, lots as fmtLots, orderAction, orderSide } from "../lib/format";
import type { AppConfig, FeedEvent, Policy } from "../lib/types";
import { leaderName } from "./feed";
import { Button, IconButton, Identicon, MarketBadge, Row, Sheet, Side, T } from "./kit";
import { ProofBody } from "./proof";

/** This copy's row in the leader's copy-quality list (leader ref, blocks), when the feed item lacks them. */
export function useQualityFor(e: FeedEvent | null): QualityCopy | null {
  const need = !!e && e.kind === "Mirrored" && !!e.leaderAccountId && (!e.latencyBlocks || !e.leaderRef);
  const q = useQuery({
    queryKey: ["leaderQuality", e?.leaderAccountId, "30d"],
    queryFn: () => api.leaderCopyQuality(e!.leaderAccountId!, "30d"),
    enabled: need,
    staleTime: 60_000,
  });
  if (!e || !q.data) return null;
  const all = [...q.data.copies, ...(q.data.teamRun?.copies ?? [])];
  return all.find((x) => x.txHash?.toLowerCase() === e.txHash?.toLowerCase()) ?? null;
}

function Header({ e, cfg, onClose }: { e: FeedEvent; cfg: AppConfig | undefined; onClose: () => void }) {
  const m = cfg?.markets.find((x) => x.perpId === e.perpId);
  const ot = e.orderType ?? 0;
  return (
    <View style={{ gap: 10 }}>
      <Row gap={12}>
        <MarketBadge symbol={m?.symbol ?? "?"} size={40} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <T size={12} w={500} color="mu" upper>
            {`Copied · ${orderAction(ot)}${ot <= 1 && e.leverageHdths ? ` · ${leverage(e.leverageHdths)}` : ""} · ${ago(e.timestamp)} ago`}
          </T>
          <Row gap={6}>
            <T size={19} w={600}>
              {m?.symbol}
            </T>
            <Side side={orderSide(ot)} />
            <T size={17} w={600} mono>
              {m ? `${fmtLots(e.lotLNS ?? "0", m.lotDecimals)} ${m.symbol}` : ""}
            </T>
          </Row>
        </View>
        <IconButton name="close" onPress={onClose} testID="copy.detail.close" />
      </Row>
      <Row gap={6}>
        <Identicon seed={e.leaderAddress ?? String(e.leaderAccountId ?? "")} size={20} />
        <T size={12} color="mu">
          From{" "}
          <T size={12} mono>
            {leaderName(e)}
          </T>{" "}
          · {ausd(e.notionalCNS ?? "0")} AUSD notional
        </T>
      </Row>
    </View>
  );
}

function Verify({ e, cfg }: { e: FeedEvent; cfg: AppConfig | undefined }) {
  return (
    <View style={{ gap: 8 }}>
      <Button title="Verify on MonadVision" icon="ext" kind="out" onPress={() => e.txHash && Linking.openURL(txUrl(cfg, e.txHash))} testID="copy.verify" />
      <T size={12} color="mu" center>
        Every number above is in the Mirrored event of your transaction.
      </T>
    </View>
  );
}

export function CopyDetailSheet({ e, cfg, policy, onClose }: { e: FeedEvent | null; cfg: AppConfig | undefined; policy?: Policy | null; onClose: () => void }) {
  const q = useQualityFor(e);
  if (!e) return <Sheet visible={false} onClose={onClose}>{null}</Sheet>;
  return (
    <Sheet visible onClose={onClose} testID="copy.detail" tall>
      <View style={{ gap: 14, flexShrink: 1 }}>
        <Header e={e} cfg={cfg} onClose={onClose} />
        <SheetScroll>
          <ProofBody e={e} cfg={cfg} policy={policy} q={q} />
          <Verify e={e} cfg={cfg} />
        </SheetScroll>
      </View>
    </Sheet>
  );
}

function SheetScroll({ children }: { children: React.ReactNode }) {
  return (
    <ScrollView style={{ flexShrink: 1 }} contentContainerStyle={{ gap: 14, paddingBottom: 8 }} showsVerticalScrollIndicator={false} overScrollMode="never" testID="copy.detail.scroll">
      {children}
    </ScrollView>
  );
}

export function CopyDetailPanel({ e, cfg, policy, onClose }: { e: FeedEvent; cfg: AppConfig | undefined; policy?: Policy | null; onClose: () => void }) {
  const q = useQualityFor(e);
  return (
    <View testID="copy.detail" style={{ gap: 14 }}>
      <Header e={e} cfg={cfg} onClose={onClose} />
      <ProofBody e={e} cfg={cfg} policy={policy} q={q} />
      <Verify e={e} cfg={cfg} />
    </View>
  );
}
