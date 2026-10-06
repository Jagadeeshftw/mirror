import React from "react";
import { View } from "react-native";
import { ausdSigned, toBig } from "../lib/format";
import type { AppConfig, MirrorAccount } from "../lib/types";
import { Icon } from "./icons";
import { Button, Dialog, MarketBadge, Note, Row, Side, T } from "./kit";
import { useColors } from "./theme";

export function CloseAllDialog({ visible, accounts, cfg, onCancel, onConfirm, busy, error }: { visible: boolean; accounts: MirrorAccount[]; cfg?: AppConfig; onCancel: () => void; onConfirm: () => void; busy: boolean; error?: string | null }) {
  const c = useColors();
  const pos = accounts.flatMap((a) => a.positions);
  const upnl = pos.reduce((s, p) => s + toBig(p.upnlCNS), 0n);
  return (
    <Dialog visible={visible} onClose={onCancel} testID="closeAll.dialog">
      <View style={{ width: 48, height: 48, borderRadius: 999, backgroundColor: c.negS, alignItems: "center", justifyContent: "center", alignSelf: "center" }}>
        <Icon name="warn" size={24} color={c.neg} />
      </View>
      <T size={19} w={600} center>
        Close all {pos.length} position{pos.length === 1 ? "" : "s"}?
      </T>
      <View style={{ gap: 8, padding: 12, borderRadius: 12, backgroundColor: c.bg, borderWidth: 1, borderColor: c.bd }}>
        {pos.map((p, i) => {
          const m = cfg?.markets.find((x) => x.perpId === p.perpId);
          return (
            <Row key={i} gap={8}>
              <MarketBadge symbol={m?.symbol ?? "?"} size={24} />
              <T size={13} w={600}>
                {m?.symbol}
              </T>
              <Side side={p.side} />
              <T size={13} mono color={toBig(p.upnlCNS) >= 0n ? "posI" : "neg"} style={{ flex: 1, textAlign: "right" }}>
                {ausdSigned(p.upnlCNS)}
              </T>
            </Row>
          );
        })}
      </View>
      <T size={13} color="mu">
        Closes at market on Perpl (within 1% of mark) and realises about{" "}
        <T size={13} w={600} mono>
          {ausdSigned(upnl)} AUSD
        </T>
        . Following is paused, so nothing reopens.
      </T>
      {error ? <Note tone="neg" icon="warn">{error}</Note> : null}
      <Row gap={8} justify="flex-end">
        <Button title="Cancel" kind="txt" size="md" onPress={onCancel} testID="closeAll.cancel" />
        <Button title={busy ? "Waiting" : "Close all"} kind="dng" size="md" icon="fp" onPress={onConfirm} disabled={busy} testID="portfolio.closeAll.confirm" />
      </Row>
    </Dialog>
  );
}
