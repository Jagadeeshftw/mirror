// Position levels: the price-level chart (take-profit, entry, mark, stop-loss on one price axis) and the
// levels card (each level with its distance and AUSD result, read from the account contract).
import * as Linking from "expo-linking";
import React, { useState } from "react";
import { View } from "react-native";
import Svg, { Circle, Line, Rect, Text as SvgText } from "react-native-svg";
import { txUrl } from "../lib/chain";
import { ausdSigned, pctSigned, price as fmtPrice, toBig } from "../lib/format";
import { movePct, pnlAtCNS } from "../lib/levels";
import type { AppConfig, FeedEvent, MarketConfig, Position, PositionLevel } from "../lib/types";
import { Icon } from "./icons";
import { Row, T, TxLink } from "./kit";
import { fonts, useColors } from "./theme";

/** 141456.0 -> "141.5k"; 0.04180 -> "0.0418". */
export function compactPrice(pns: bigint, dec: number): string {
  const n = Number(pns) / 10 ** dec;
  if (n >= 10_000) return `${(n / 1000).toFixed(1)}k`;
  return String(Number(n.toPrecision(4)));
}

export function LevelChart({ p, lv, m, height = 150, testID }: { p: Position; lv: PositionLevel | null; m: MarketConfig | undefined; height?: number; testID?: string }) {
  const c = useColors();
  const [w, setW] = useState(0);
  const dec = m?.priceDecimals ?? 0;
  const entry = toBig(p.entryPNS);
  const mark = toBig(p.markPNS);
  const sl = toBig(lv?.stopLossPNS ?? "0");
  const tp = toBig(lv?.takeProfitPNS ?? "0");
  const pts = [entry, mark, sl, tp].filter((x) => x > 0n).map(Number);
  const lo = Math.min(...pts);
  const hi = Math.max(...pts);
  const pad = (hi - lo || hi * 0.02 || 1) * 0.12;
  const top = hi + pad;
  const bot = lo - pad;
  const Y = (v: bigint) => 10 + ((top - Number(v)) / (top - bot || 1)) * (height - 20);
  const tagW = 74;
  const line = (v: bigint, color: string, label: string, dashed: boolean, key: string) => (
    <React.Fragment key={key}>
      <Line x1={0} x2={w - tagW - 4} y1={Y(v)} y2={Y(v)} stroke={color} strokeWidth={dashed ? 1.25 : 1} strokeDasharray={dashed ? "4 4" : undefined} />
      <Rect x={w - tagW} y={Y(v) - 8} width={tagW} height={16} rx={4} fill={color} fillOpacity={dashed ? 0.14 : 0.1} />
      <SvgText x={w - tagW / 2} y={Y(v) + 3.5} textAnchor="middle" fontSize={10} fontFamily={fonts.monoSemi} fill={color}>
        {label}
      </SvgText>
    </React.Fragment>
  );
  return (
    <View testID={testID} style={{ height }} onLayout={(e) => setW(e.nativeEvent.layout.width)} accessibilityLabel="Price levels: take-profit, entry, mark and stop-loss">
      {w > 0 ? (
        <Svg width={w} height={height}>
          {tp > 0n ? line(tp, c.pos, `${compactPrice(tp, dec)} TP`, true, "tp") : null}
          {line(entry, c.mu, `${compactPrice(entry, dec)} entry`, false, "entry")}
          {sl > 0n ? line(sl, c.neg, `${compactPrice(sl, dec)} SL`, true, "sl") : null}
          <Line x1={0} x2={w - tagW - 4} y1={Y(mark)} y2={Y(mark)} stroke={c.tx} strokeWidth={2} />
          <Circle cx={w - tagW - 4} cy={Y(mark)} r={4} fill={c.tx} stroke={c.sf} strokeWidth={2} />
          <SvgText x={4} y={Y(mark) - 5} fontSize={10} fontFamily={fonts.mono} fill={c.mu}>
            {`mark ${fmtPrice(mark, dec)}`}
          </SvgText>
        </Svg>
      ) : null}
    </View>
  );
}

function LevelRow({ kind, p, lv, m, testID }: { kind: "sl" | "tp"; p: Position; lv: PositionLevel | null; m: MarketConfig | undefined; testID: string }) {
  const c = useColors();
  const dec = m?.priceDecimals ?? 0;
  const v = toBig(kind === "sl" ? lv?.stopLossPNS : lv?.takeProfitPNS);
  const entry = toBig(p.entryPNS);
  const mark = toBig(p.markPNS);
  const pnl = v > 0n && m ? pnlAtCNS(toBig(p.lotLNS), entry, v, p.side, m.lotDecimals, m.priceDecimals) : null;
  const sub =
    v > 0n
      ? [`${pctSigned(movePct(entry, v, p.side))} from entry`, kind === "sl" ? `${pctSigned(movePct(mark, v, p.side))} from mark` : null, pnl !== null ? `about ${ausdSigned(pnl)} AUSD` : null].filter(Boolean).join(" · ")
      : "Not set";
  const neg = kind === "sl";
  return (
    <Row gap={12} style={{ paddingVertical: 12 }} testID={testID}>
      <View style={{ width: 34, height: 34, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: neg ? c.negS : c.posS }}>
        <Icon name="flag" size={16} color={neg ? c.neg : c.pos} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <T size={14}>{neg ? "Stop-loss" : "Take-profit"}</T>
        <T size={12} mono color="mu" lh={17} testID={`${testID}.sub`}>
          {sub}
        </T>
      </View>
      <T size={15} w={600} mono testID={`${testID}.value`} color={v > 0n ? "tx" : "mu"}>
        {v > 0n ? fmtPrice(v, dec) : "—"}
      </T>
    </Row>
  );
}

/** Stop-loss and take-profit rows, and where they live: "Onchain · anyone can execute when hit · signed by you". */
export function LevelsCard({ p, lv, m, cfg, setEvent, testID = "position.levels" }: { p: Position; lv: PositionLevel | null; m: MarketConfig | undefined; cfg: AppConfig | undefined; setEvent?: FeedEvent | null; testID?: string }) {
  const c = useColors();
  return (
    <View testID={testID} style={{ backgroundColor: c.sf, borderRadius: 16, borderWidth: 1, borderColor: c.bd, paddingHorizontal: 14 }}>
      <LevelRow kind="sl" p={p} lv={lv} m={m} testID={`${testID}.sl`} />
      <View style={{ height: 1, backgroundColor: c.bd }} />
      <LevelRow kind="tp" p={p} lv={lv} m={m} testID={`${testID}.tp`} />
      <View style={{ height: 1, backgroundColor: c.bd }} />
      <Row gap={8} style={{ paddingVertical: 12 }}>
        <Icon name="shield" size={14} color={c.ac} />
        <T size={12} color="mu" style={{ flex: 1 }} testID={`${testID}.onchain`}>
          {lv ? `Onchain · anyone can execute when hit · signed by you${lv.slippageBps ? ` · slippage ${lv.slippageBps / 100}%` : ""}` : "No levels yet. Levels are stored in your account contract and anyone can execute them when hit."}
        </T>
        {setEvent?.txHash ? <TxLink hash={setEvent.txHash} onPress={() => Linking.openURL(txUrl(cfg, setEvent.txHash!))} testID={`${testID}.tx`} /> : null}
      </Row>
    </View>
  );
}
