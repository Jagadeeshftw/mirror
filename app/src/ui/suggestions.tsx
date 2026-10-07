// Suggested levels on a shared position (design proposal-2 #share, 07c-07e): the Suggestions card on the position,
// the review sheet (now vs suggested, the result if hit, the friend's note), Accept = ACTION_SET_LEVELS with one
// passkey prompt, Decline = one signed message. No motion.
import { useQueryClient } from "@tanstack/react-query";
import React, { useState } from "react";
import { View } from "react-native";
import { api } from "../lib/api";
import { ausdSigned, price as fmtPrice, timeHM, toBig } from "../lib/format";
import { levelFor, pnlAtCNS } from "../lib/levels";
import { acceptPlan, type Suggestion } from "../lib/shareLink";
import type { MarketConfig, MirrorAccount, Position } from "../lib/types";
import type { useOwnerAction } from "../state/ownerAction";
import { useShareActions } from "../state/share";
import { Icon } from "./icons";
import { Button, Lbl, Press, Row, T } from "./kit";
import { Overlay } from "./levelEdit";
import { useColors } from "./theme";

type Act = ReturnType<typeof useOwnerAction>;
const sym = (m: MarketConfig | undefined, p: Pick<Position, "side">) => `${m?.symbol ?? "Position"} ${p.side}`;

export function suggestionSummary(s: Pick<Suggestion, "stopLossPNS" | "takeProfitPNS">, dec: number) {
  return [s.stopLossPNS ? `Stop-loss ${fmtPrice(s.stopLossPNS, dec)}` : null, s.takeProfitPNS ? `take-profit ${fmtPrice(s.takeProfitPNS, dec)}` : null].filter(Boolean).join(" · ").replace(/^t/, "T");
}

/** "Suggestions · 1 new" on the position, one row per pending suggestion. */
export function SuggestionsCard({ items, m, onReview }: { items: Suggestion[]; m: MarketConfig | undefined; onReview: (s: Suggestion) => void }) {
  const c = useColors();
  if (!items.length) return null;
  return (
    <View testID="position.suggestions" style={{ borderRadius: 16, borderWidth: 1, borderColor: c.ac, backgroundColor: c.sf }}>
      <Row gap={8} style={{ paddingHorizontal: 14, paddingTop: 12 }}>
        <Icon name="msg" size={16} color={c.ac} />
        <T size={13} w={600} style={{ flex: 1 }} testID="position.suggestions.title">{`Suggestions · ${items.length} new`}</T>
      </Row>
      {items.map((s, i) => (
        <Press key={s.id} testID={`position.suggestions.item.${s.id}`} onPress={() => onReview(s)} style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: i === items.length - 1 ? 0 : 1, borderBottomColor: c.bd }}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <T size={13} mono lines={1}>{suggestionSummary(s, m?.priceDecimals ?? 0)}</T>
            <T size={12} color="mu" lines={1}>{s.note ? `"${s.note}"` : "No note"} · {timeHM(s.createdMs)}</T>
          </View>
          <T size={13} w={600} color="ac">Review</T>
        </Press>
      ))}
    </View>
  );
}

function Cell({ v, b, color, testID }: { v: string; b?: boolean; color?: "neg" | "posI" | "mu"; testID?: string }) {
  return <T size={b ? 14 : 12} w={b ? 600 : 400} mono color={color ?? "tx"} style={{ width: 104, textAlign: "right" }} testID={testID}>{v}</T>;
}

/** Review sheet (07c): Decline / Accept (passkey). `onAccepted` gets the "Levels updated" text. */
export function SuggestionReviewSheet({ s, account, p, m, act, onClose, onAccepted }: { s: Suggestion | null; account: MirrorAccount; p: Position; m: MarketConfig | undefined; act: Act; onClose: () => void; onAccepted: (text: string, txHash: string) => void }) {
  const c = useColors();
  const qc = useQueryClient();
  const share = useShareActions();
  const [err, setErr] = useState<string | null>(null);
  const [accepting, setAccepting] = useState(false);
  if (!s) return null;
  const dec = m?.priceDecimals ?? 0;
  const cur = levelFor(account.levels, p);
  const plan = acceptPlan(s, p, account.levels);
  const nowSl = toBig(cur?.stopLossPNS ?? "0");
  const nowTp = toBig(cur?.takeProfitPNS ?? "0");
  const pnl = (v: bigint) => (v > 0n && m ? ausdSigned(pnlAtCNS(toBig(p.lotLNS), toBig(p.entryPNS), v, p.side, m.lotDecimals, m.priceDecimals)) : "—");
  const px = (v: bigint) => (v > 0n ? fmtPrice(v, dec) : "—");
  const tone = (v: bigint, kind: "sl" | "tp") => (v > 0n ? (kind === "sl" ? "neg" : "posI") : "mu") as "neg" | "posI" | "mu";
  const busy = accepting || share.busy === "decline";

  const accept = async () => {
    if (plan.error) return setErr(plan.error.message);
    setErr(null);
    setAccepting(true);
    try {
      const r = await act.setLevels(account, [plan.level]);
      const tx = r?.[0]?.txHash;
      if (!tx) return;
      // The transaction is the proof; the engine checks its LevelSet against the suggestion.
      await api.shareAccepted(s.id, tx).catch(async () => {
        await new Promise((ok) => setTimeout(ok, 1500));
        return api.shareAccepted(s.id, tx);
      });
      await qc.invalidateQueries({ queryKey: ["share", account.account] });
      const parts = [s.stopLossPNS ? `stop-loss ${px(nowSl)} → ${px(plan.stopLossPNS)}` : null, s.takeProfitPNS ? `take-profit ${px(nowTp)} → ${px(plan.takeProfitPNS)}` : null].filter(Boolean).join(" and ");
      onAccepted(`Levels updated. ${parts.charAt(0).toUpperCase()}${parts.slice(1)}.`, tx);
      onClose();
    } catch (e: any) {
      setErr(typeof e?.body?.error === "string" ? e.body.error : (e?.message ?? "Could not record the acceptance"));
    } finally {
      setAccepting(false);
    }
  };
  const decline = async () => {
    setErr(null);
    if (await share.decline(account, s.id)) onClose();
  };

  return (
    <Overlay visible onClose={onClose} testID="suggest.sheet">
      <Row gap={12} align="flex-start">
        <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: c.acs, alignItems: "center", justifyContent: "center" }}>
          <Icon name="msg" size={20} color={c.ac} />
        </View>
        <View style={{ flex: 1 }}>
          <Lbl>{`Suggestion · ${timeHM(s.createdMs)}`}</Lbl>
          <T size={18} w={600} testID="suggest.title">{`New levels for ${sym(m, p)}`}</T>
        </View>
      </Row>
      <T size={12} color="mu">From someone with your share link. Mirror doesn&apos;t know who; there is no account behind it.</T>
      <View testID="suggest.table">
        <Row style={{ paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: c.bd }}>
          <View style={{ flex: 1 }} />
          <T size={11} color="mu" upper style={{ width: 104, textAlign: "right" }}>Now</T>
          <T size={11} color="mu" upper style={{ width: 104, textAlign: "right" }}>Suggested</T>
        </Row>
        {(["sl", "tp"] as const).map((k) => {
          const now = k === "sl" ? nowSl : nowTp;
          const next = k === "sl" ? plan.stopLossPNS : plan.takeProfitPNS;
          const changed = (k === "sl" ? s.stopLossPNS : s.takeProfitPNS) !== null;
          return (
            <View key={k} style={{ borderBottomWidth: 1, borderBottomColor: c.bd }}>
              <Row style={{ paddingVertical: 8 }}>
                <T size={14} style={{ flex: 1 }}>{k === "sl" ? "Stop-loss" : "Take-profit"}</T>
                <Cell v={px(now)} testID={`suggest.${k}.now`} />
                <Cell v={changed ? px(next) : "unchanged"} b={changed} color={changed ? undefined : "mu"} testID={`suggest.${k}.new`} />
              </Row>
              <Row style={{ paddingBottom: 8 }}>
                <T size={12} color="mu" style={{ flex: 1 }}>if hit</T>
                <Cell v={pnl(now)} color={tone(now, k)} />
                <Cell v={pnl(next)} color={tone(next, k)} testID={`suggest.${k}.pnl`} />
              </Row>
            </View>
          );
        })}
      </View>
      {s.note ? (
        <View style={{ paddingVertical: 10, paddingHorizontal: 12, borderLeftWidth: 3, borderLeftColor: c.ac, backgroundColor: c.sf2, borderTopRightRadius: 10, borderBottomRightRadius: 10 }}>
          <T size={13} testID="suggest.note">{`"${s.note}"`}</T>
        </View>
      ) : null}
      <Row gap={8} align="flex-start">
        <Icon name="shield" size={14} color={c.mu} />
        <T size={12} color="mu" style={{ flex: 1 }}>If you accept, both levels are written onchain and anyone can execute them when hit.</T>
      </Row>
      {err || plan.error || share.error || act.error ? <T size={12} color="neg" testID="suggest.error">{err ?? plan.error?.message ?? share.error ?? act.error}</T> : null}
      <Row gap={10}>
        <Button title={share.busy === "decline" ? "Declining…" : "Decline"} kind="out" flex disabled={busy} onPress={decline} testID="suggest.decline" />
        <Button title={accepting ? "Accepting…" : "Accept"} icon="fp" flex disabled={busy || !!plan.error} onPress={accept} testID="suggest.accept" />
      </Row>
    </Overlay>
  );
}
