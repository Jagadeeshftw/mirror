// Edit levels (stop-loss / take-profit as a price or % from entry, signed with one passkey prompt via
// ACTION_SET_LEVELS), Close position (ACTION_CLOSE_MARKET) and the notice after a level fired.
import React, { useEffect, useState } from "react";
import { View } from "react-native";
import { ausdSigned, pctSigned, price as fmtPrice, toBig } from "../lib/format";
import { LEVEL_SLIPPAGE_BPS, buildLevel, checkLevels, clearLevel, levelText, movePct, parseLevelInput, pnlAtCNS, type LevelKind, type LevelMode } from "../lib/levels";
import type { MarketConfig, Position, PositionLevel } from "../lib/types";
import type { useOwnerAction } from "../state/ownerAction";
import type { MirrorAccount } from "../lib/types";
import { Button, Chip, Dialog, Field, NumInput, Note, Row, Seg, Sheet, Side, T } from "./kit";
import { useLayout } from "./layout";

type Act = ReturnType<typeof useOwnerAction>;

/** Bottom sheet on the phone, centred dialog on the laptop layout. */
export function Overlay({ visible, onClose, testID, children }: { visible: boolean; onClose: () => void; testID: string; children: React.ReactNode }) {
  const laptop = useLayout() === "laptop";
  if (laptop) return <Dialog visible={visible} onClose={onClose} testID={testID}>{children}</Dialog>;
  return (
    <Sheet visible={visible} onClose={onClose} testID={testID}>
      <View style={{ gap: 14, paddingTop: 6 }}>{children}</View>
    </Sheet>
  );
}

const SLIPPAGES = [100, 300, 500];

function LevelField({ kind, mode, text, setText, p, m, testID }: { kind: LevelKind; mode: LevelMode; text: string; setText: (t: string) => void; p: Position; m: MarketConfig | undefined; testID: string }) {
  const dec = m?.priceDecimals ?? 0;
  const entry = toBig(p.entryPNS);
  const v = parseLevelInput(text, mode, entry, p.side, kind, dec);
  const pnl = v && v > 0n && m ? pnlAtCNS(toBig(p.lotLNS), entry, v, p.side, m.lotDecimals, m.priceDecimals) : null;
  const derived = v === null ? "Not a valid number" : v === 0n ? "None" : mode === "pct" ? `= ${fmtPrice(v, dec)}${pnl !== null ? ` · about ${ausdSigned(pnl)} AUSD` : ""}` : `${pctSigned(movePct(entry, v, p.side))} from entry${pnl !== null ? ` · about ${ausdSigned(pnl)} AUSD` : ""}`;
  return (
    <View style={{ gap: 4 }}>
      <T size={13} w={600}>{kind === "sl" ? "Stop-loss" : "Take-profit"}</T>
      <Field error={v === null}>
        <T size={15} mono color="mu">{mode === "pct" ? (kind === "sl" ? "−" : "+") : ""}</T>
        <NumInput testID={testID} value={text} onChangeText={setText} keyboardType="decimal-pad" placeholder={mode === "pct" ? (kind === "sl" ? "8" : "20") : "price"} />
        <T size={13} color="mu">{mode === "pct" ? "% from entry" : "price"}</T>
      </Field>
      <T size={12} mono color={v === null ? "neg" : "mu"} testID={`${testID}.derived`}>{derived}</T>
    </View>
  );
}

export function EditLevelsSheet({ visible, onClose, account, p, lv, m, act }: { visible: boolean; onClose: () => void; account: MirrorAccount; p: Position; lv: PositionLevel | null; m: MarketConfig | undefined; act: Act }) {
  const dec = m?.priceDecimals ?? 0;
  const entry = toBig(p.entryPNS);
  const [mode, setMode] = useState<LevelMode>("pct");
  const [sl, setSl] = useState("");
  const [tp, setTp] = useState("");
  const [slip, setSlip] = useState(LEVEL_SLIPPAGE_BPS);
  useEffect(() => {
    if (!visible) return;
    setSl(levelText(toBig(lv?.stopLossPNS), mode, entry, p.side, dec));
    setTp(levelText(toBig(lv?.takeProfitPNS), mode, entry, p.side, dec));
    setSlip(lv?.slippageBps || LEVEL_SLIPPAGE_BPS);
    act.clearError();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);
  const switchMode = (next: LevelMode) => {
    const a = parseLevelInput(sl, mode, entry, p.side, "sl", dec);
    const b = parseLevelInput(tp, mode, entry, p.side, "tp", dec);
    setSl(a === null ? "" : levelText(a, next, entry, p.side, dec));
    setTp(b === null ? "" : levelText(b, next, entry, p.side, dec));
    setMode(next);
  };
  const slV = parseLevelInput(sl, mode, entry, p.side, "sl", dec);
  const tpV = parseLevelInput(tp, mode, entry, p.side, "tp", dec);
  const check = slV === null || tpV === null ? { message: "Enter a number, or leave it empty for none" } : checkLevels(p.side, toBig(p.markPNS), slV, tpV, slip);
  const empty = slV === 0n && tpV === 0n;
  const busy = act.busy === "levels";
  const save = async () => {
    if (check || slV === null || tpV === null) return;
    const r = await act.setLevels(account, [empty ? clearLevel(p.perpId, p.side) : buildLevel(p.perpId, p.side, slV, tpV, slip)]);
    if (r) onClose();
  };
  return (
    <Overlay visible={visible} onClose={onClose} testID="levels.sheet">
      <Row gap={8}>
        <T size={19} w={600} style={{ flex: 1 }}>Edit levels</T>
        <T size={13} w={600}>{m?.symbol}</T>
        <Side side={p.side} />
      </Row>
      <T size={12} mono color="mu">Entry {fmtPrice(entry, dec)} · mark {fmtPrice(p.markPNS, dec)}</T>
      <Seg testIDPrefix="levels.mode" value={mode} onChange={switchMode} options={[{ key: "pct", label: "% from entry" }, { key: "price", label: "Price" }]} />
      <LevelField kind="sl" mode={mode} text={sl} setText={setSl} p={p} m={m} testID="levels.sl.input" />
      <LevelField kind="tp" mode={mode} text={tp} setText={setTp} p={p} m={m} testID="levels.tp.input" />
      <Row gap={8} style={{ flexWrap: "wrap" }}>
        <T size={13} style={{ marginRight: 4 }}>Slippage when it fires</T>
        {SLIPPAGES.map((b) => <Chip key={b} label={`${b / 100}%`} on={slip === b} onPress={() => setSlip(b)} height={30} testID={`levels.slippage.${b}`} />)}
      </Row>
      {check ? <Note tone="warn" icon="warn" testID="levels.error">{check.message}</Note> : null}
      <Note icon="shield">Stored in your account contract. When the mark and a fresh Chainlink price reach a level, anyone can execute it: it only closes this position, within your slippage, and the caller is paid nothing. New copies in this market then pause until you save your limits again.</Note>
      {act.error ? <Note tone="neg" icon="warn" testID="levels.relayError">{act.error}</Note> : null}
      <Row gap={10}>
        {lv ? <Button title="Clear levels" kind="out" size="md" flex disabled={busy} onPress={async () => { if (await act.setLevels(account, [clearLevel(p.perpId, p.side)])) onClose(); }} testID="levels.clear" /> : <Button title="Cancel" kind="out" size="md" flex onPress={onClose} testID="levels.cancel" />}
        <Button title={busy ? "Waiting" : empty && lv ? "Save (clears)" : "Save with passkey"} icon="fp" size="md" flex disabled={busy || !!check || (empty && !lv)} onPress={save} testID="levels.save" />
      </Row>
    </Overlay>
  );
}

export function ClosePositionDialog({ visible, onClose, account, p, m, act }: { visible: boolean; onClose: () => void; account: MirrorAccount; p: Position; m: MarketConfig | undefined; act: Act }) {
  const busy = act.busy === "closeMarket";
  return (
    <Dialog visible={visible} onClose={onClose} testID="position.close.dialog">
      <T size={19} w={600} center>Close {m?.symbol} {p.side}?</T>
      <T size={13} color="mu" lh={19}>
        Closes the whole position at market on Perpl, reduce-only, within 3% of the mark, and realises about{" "}
        <T size={13} w={600} mono>{ausdSigned(p.upnlCNS)} AUSD</T>. Your follow keeps running, so the leader's next {m?.symbol} trade can open a new copy.
      </T>
      {act.error ? <Note tone="neg" icon="warn" testID="position.close.error">{act.error}</Note> : null}
      <Row gap={8} justify="flex-end">
        <Button title="Cancel" kind="txt" size="md" onPress={() => { act.clearError(); onClose(); }} testID="position.close.cancel" />
        <Button title={busy ? "Waiting" : "Close position"} kind="dng" size="md" icon="fp" disabled={busy} onPress={async () => { if (await act.closeMarket(account, p.perpId)) onClose(); }} testID="position.close.confirm" />
      </Row>
    </Dialog>
  );
}

/** After a level fired: opening copies in that market are refused onchain until the next policy. */
export function HaltNotice({ symbols, onResume, busy, testID = "positions.halted" }: { symbols: string[]; onResume: () => void; busy: boolean; testID?: string }) {
  if (!symbols.length) return null;
  const list = symbols.join(", ");
  return (
    <View testID={testID} style={{ gap: 8 }}>
      <Note tone="warn" icon="pause">{`A level fired. New copies in ${list} are paused until you save your limits again.`}</Note>
      <Button title={busy ? "Waiting" : `Save limits again · resume ${list}`} icon="fp" kind="ton" size="md" disabled={busy} onPress={onResume} testID={`${testID}.resume`} />
    </View>
  );
}
