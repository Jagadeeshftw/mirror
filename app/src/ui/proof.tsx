// Copy proof body, shared by the phone copy-detail sheet and the laptop feed panel: leader fill vs
// your fill, deviation, the entry-filter bound, Proposed → copy timing in ms and blocks, the rules
// the contract checked, and both transactions.
import React from "react";
import { View } from "react-native";
import type { QualityCopy } from "../lib/engineTypes";
import { ausd, bps, leverage, lots as fmtLots, price as fmtPrice, toBig } from "../lib/format";
import { bpsText, entryBoundPNS, entryUsed, fillDeviationBps, isBuy, worseByPNS } from "../lib/proof";
import type { AppConfig, FeedEvent, Policy } from "../lib/types";
import { openTx } from "./feed";
import { BUILDER_ID, FEE_PCT, copyFeeCNS, feeText } from "../lib/fees";
import { Card, ChipS, CommitTrack, KV, LatencyPill, Row, T, TxLink } from "./kit";
import { useColors } from "./theme";

const pad = (n: number, w = 2) => String(n).padStart(w, "0");
export function clock(ts: number): string {
  const d = new Date(ts);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

export function ProofBody({ e, cfg, policy, q, testIDPrefix = "copy.proof" }: { e: FeedEvent; cfg: AppConfig | undefined; policy?: Policy | null; q?: QualityCopy | null; testIDPrefix?: string }) {
  const c = useColors();
  const m = cfg?.markets.find((x) => x.perpId === e.perpId);
  const pd = m?.priceDecimals ?? 0;
  const p = e.proof;
  const ot = e.orderType ?? 0;
  const P = (v: string | bigint | null | undefined) => (v === null || v === undefined || toBig(v) === 0n ? "—" : fmtPrice(v, pd));
  const leaderFill = p?.leaderFillPNS ?? q?.leaderFillPNS ?? null;
  const fill = p?.fillPNS ?? q?.followerFillPNS ?? e.pricePNS ?? null;
  const dev = p ? fillDeviationBps(p, ot) : (q?.deviationBps ?? null);
  const worse = p ? worseByPNS(p, ot) : null;
  const maxDev = policy?.maxEntryDeviationBps ?? 0;
  const open = ot <= 1;
  const bound = p && maxDev && open ? entryBoundPNS(p.leaderEntryPNS, maxDev, isBuy(ot)) : null;
  const used = p && maxDev ? entryUsed(p, maxDev) : null;
  const blocks = e.latencyBlocks ?? q?.latencyBlocks ?? null;
  const ms = e.latencyMs ?? q?.latencyMs ?? undefined;
  const leaderBlock = e.leaderBlock ?? (blocks ? e.block - blocks : null);
  const leaderRef = e.leaderRef ?? q?.leaderRef ?? null;
  const notional = toBig(e.notionalCNS ?? "0");
  const cap = policy?.markets.find((x) => x.perpId === e.perpId)?.maxNotionalCNS;
  const id = (k: string) => `${testIDPrefix}.${k}`;

  const rules: string[] = [];
  if (policy && open) {
    if (e.leverageHdths) rules.push(`Leverage ${leverage(e.leverageHdths)} ≤ ${leverage(policy.maxLeverageHdths)}`);
    if (cap) rules.push(`Notional ${ausd(notional)} ≤ ${ausd(cap)}`);
    if (m) rules.push(`Market ${m.symbol}`);
    if (p && maxDev) rules.push(`Entry ${bps(Math.max(0, p.entryDeviationBps))} ≤ ${bps(maxDev)}`);
    rules.push("Budget", "Loss stops");
  }

  return (
    <View style={{ gap: 12 }}>
      <Card style={{ padding: 14, gap: 12 }}>
        <Row align="flex-start" gap={8}>
          {[
            ["Leader fill", P(leaderFill), null, id("leaderFill")],
            ["Your fill", P(fill), null, id("yourFill")],
            ["Deviation", `${bpsText(dev)} bps`, worse !== null && m ? `${fmtPrice(worse < 0n ? -worse : worse, pd)} ${worse > 0n ? "worse" : worse < 0n ? "better" : "same"}` : null, id("deviation")],
          ].map(([k, v, sub, tid]) => (
            <View key={k as string} style={{ flex: 1, gap: 1 }}>
              <T size={12} color="mu">
                {k}
              </T>
              <T testID={tid as string} size={16} w={500} mono>
                {v}
              </T>
              {sub ? (
                <T size={12} mono color="mu">
                  {sub}
                </T>
              ) : null}
            </View>
          ))}
        </Row>
        {open && p ? (
          <View testID={id("entryFilter")} style={{ gap: 6, paddingTop: 12, borderTopWidth: 1, borderTopColor: c.bd }}>
            <Row>
              <T size={12} color="mu" style={{ flex: 1 }}>
                Entry filter
              </T>
              <T size={12} mono>
                {maxDev ? `within ${bps(maxDev)} of leader entry` : "off"}
              </T>
            </Row>
            <View style={{ height: 10, borderRadius: 5, backgroundColor: c.acs }}>
              {used !== null ? <View style={{ position: "absolute", top: -4, left: `${Math.min(1, used) * 100}%`, width: 4, height: 18, marginLeft: -2, borderRadius: 2, backgroundColor: used > 1 ? c.neg : c.ac }} /> : null}
            </View>
            <Row>
              <T size={12} mono style={{ flex: 1 }}>
                {P(p.leaderEntryPNS)}{" "}
                <T size={12} color="mu">
                  leader entry
                </T>
              </T>
              {bound ? (
                <T size={12} mono testID={id("bound")}>
                  <T size={12} color="mu">
                    bound{" "}
                  </T>
                  {fmtPrice(bound, pd)}
                </T>
              ) : null}
            </Row>
            <T size={12} color="mu">
              {maxDev ? `Used ${bps(Math.max(0, p.entryDeviationBps))} of your ${bps(maxDev)} allowance.` : `${bpsText(p.entryDeviationBps)} bps from the leader's entry. Turn on the entry filter to cap it.`}
            </T>
          </View>
        ) : null}
      </Card>

      <Card style={{ paddingHorizontal: 14, paddingVertical: 4 }}>
        <TimelineRow dot="open" title="Leader's fill Proposed" sub={`${leaderBlock ? `block ${leaderBlock.toLocaleString("en-US")} · ` : ""}${ms !== undefined ? clock(e.timestamp - ms) : ""}`} />
        <TimelineRow dot="cur" title="Your copy Proposed" sub={`block ${e.block.toLocaleString("en-US")} · ${clock(e.timestamp)}`} right={<LatencyPill ms={ms} label="" blocks={blocks} testID={id("latencyMs")} />} />
        <TimelineRow dot={e.commitState === "finalized" ? "ok" : "open"} title={e.commitState === "finalized" ? "Your copy Finalized" : "Waiting for finality"} sub="Finality usually follows about 0.55 s after Proposed" right={<View testID={id("commit")}><CommitTrack state={e.commitState} /></View>} last />
      </Card>

      {rules.length ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }} testID={id("rules")}>
          {rules.map((r) => (
            <ChipS key={r} label={r} tone="ok" icon="check" />
          ))}
        </View>
      ) : null}

      <Card style={{ paddingHorizontal: 14 }}>
        {m && e.leaderLotLNS ? <KV k="Size" v={`Leader ${fmtLots(e.leaderLotLNS, m.lotDecimals)} ${m.symbol} · you ${fmtLots(e.lotLNS ?? "0", m.lotDecimals)} ${m.symbol}`} /> : m ? <KV k="Size" v={`${fmtLots(e.lotLNS ?? "0", m.lotDecimals)} ${m.symbol} · ${ausd(notional)} AUSD`} /> : null}
        <KV
          k={`Mirror fee (builder ${BUILDER_ID})`}
          testID={id("fee")}
          v={(() => {
            const f = copyFeeCNS(e);
            return `${f === null ? "—" : `${feeText(f)} AUSD`} · ${FEE_PCT} of opening size, 0 on closes`;
          })()}
        />
        <KV k="Leader's transaction" v={leaderRef ? <TxLink hash={leaderRef} onPress={() => openTx(cfg, leaderRef)} testID={id("leaderTx")} /> : "—"} />
        <KV k="Your transaction" v={<TxLink hash={e.txHash} onPress={() => openTx(cfg, e.txHash)} testID={id("yourTx")} />} last />
      </Card>
    </View>
  );
}

function TimelineRow({ dot, title, sub, right, last }: { dot: "open" | "cur" | "ok"; title: string; sub: string; right?: React.ReactNode; last?: boolean }) {
  const c = useColors();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10, borderBottomWidth: last ? 0 : 1, borderBottomColor: c.bd }}>
      <View style={{ width: 10, height: 10, borderRadius: 999, borderWidth: 2, borderColor: dot === "open" ? c.mu : dot === "cur" ? c.ac : c.pos, backgroundColor: dot === "open" ? "transparent" : dot === "cur" ? c.ac : c.pos }} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <T size={13} w={600}>
          {title}
        </T>
        <T size={12} mono color="mu">
          {sub}
        </T>
      </View>
      {right}
    </View>
  );
}
