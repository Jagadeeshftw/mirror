// "Stop following" for one leader: keep my positions (the leader leaves the policy, or the follow is paused
// when it is the only leader) or stop and close. Either choice is one passkey prompt.
import React, { useEffect, useState } from "react";
import { View } from "react-native";
import { ausdSigned, shortAddr, toBig } from "../lib/format";
import { stopPlan, type StopChoice } from "../lib/levels";
import type { AppConfig, MirrorAccount } from "../lib/types";
import type { useOwnerAction } from "../state/ownerAction";
import { Button, Identicon, Note, Press, Row, T } from "./kit";
import { Overlay } from "./levelEdit";
import { useColors } from "./theme";

type Act = ReturnType<typeof useOwnerAction>;

function Option({ on, title, body, onPress, testID }: { on: boolean; title: string; body: string; onPress: () => void; testID: string }) {
  const c = useColors();
  return (
    <Press testID={testID} onPress={onPress} accessibilityRole="radio" accessibilityState={{ checked: on }} style={{ flexDirection: "row", gap: 12, padding: 14, borderRadius: 14, borderWidth: on ? 2 : 1, borderColor: on ? c.ac : c.bd, backgroundColor: on ? c.acs : c.sf }}>
      <View style={{ width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: on ? c.ac : c.mu, alignItems: "center", justifyContent: "center", marginTop: 1 }}>
        {on ? <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: c.ac }} /> : null}
      </View>
      <View style={{ flex: 1, gap: 3 }}>
        <T size={14} w={600}>{title}</T>
        <T size={12} color="mu" lh={17} testID={`${testID}.body`}>{body}</T>
      </View>
    </Press>
  );
}

export function StopFollowSheet({ visible, onClose, account, leaderId, leaderAddress, cfg, act, onDone }: { visible: boolean; onClose: () => void; account: MirrorAccount | null | undefined; leaderId: number; leaderAddress?: string; cfg: AppConfig | undefined; act: Act; onDone?: (choice: StopChoice) => void }) {
  const [choice, setChoice] = useState<StopChoice>("keep");
  useEffect(() => {
    if (visible) {
      setChoice("keep");
      act.clearError();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);
  if (!account) return null;
  const keep = stopPlan(account, leaderId, "keep");
  const close = stopPlan(account, leaderId, "close");
  const pos = keep.positions;
  const names = pos.map((p) => `${cfg?.markets.find((m) => m.perpId === p.perpId)?.symbol ?? "#" + p.perpId} ${p.side}`);
  const nameList = names.length ? (names.length > 2 ? `${names.slice(0, 2).join(", ")} and ${names.length - 2} more` : names.join(" and ")) : "";
  const upnl = pos.reduce((s, p) => s + toBig(p.upnlCNS), 0n);
  const n = pos.length;
  const keepBody = n
    ? `${nameList} stay${n === 1 ? "s" : ""} open with ${n === 1 ? "its" : "their"} stop-loss and take-profit. They are no longer mirrored: close them yourself when you want.`
    : "No open positions from this leader. Nothing is closed.";
  const closeBody = n
    ? `Closes ${n} position${n === 1 ? "" : "s"} at market now (within 3% of the mark), about ${ausdSigned(upnl)} AUSD before fees${close.how === "closeAll" ? ", and pauses this follow" : ""}. Your AUSD stays in the account until you withdraw.`
    : `Nothing to close${close.how === "closeAll" ? "; this follow is paused" : "; the leader is removed"}.`;
  const how = choice === "keep" ? keep.how : close.how;
  const explain =
    how === "detach"
      ? "One passkey approval: you tell Mirror to stop copying this follow (nothing is copied, not new trades and not this leader's closes), and the follow is paused onchain so nothing new can open. Stopping the copies is Mirror's keeper behaviour, not a contract rule; you keep full control of the positions: levels, close, close all, withdraw. Follow again any time from the leader's profile."
      : how === "remove"
        ? "The leader is removed from your limits (one signed policy). Its positions stay in your account and are no longer mirrored."
        : how === "removeAndClose"
          ? "The leader is removed from your limits and each of its markets is closed, in one passkey approval."
          : "Close all: every position in this follow closes at market and the follow is paused, so nothing reopens.";
  const busy = act.busy === "stopKeep" || act.busy === "stopClose";
  return (
    <Overlay visible={visible} onClose={onClose} testID="stop.sheet">
      <Row gap={12}>
        <Identicon seed={leaderAddress ?? String(leaderId)} size={40} />
        <View style={{ flex: 1 }}>
          <T size={12} w={500} color="mu" upper>Stop following</T>
          <T size={16} w={600} mono>{shortAddr(leaderAddress) || `#${leaderId}`}</T>
        </View>
      </Row>
      <T size={13} color="mu" lh={19}>
        No new copies from this leader either way. Choose what happens to {n === 1 ? "its open position" : `its ${n} open positions`}.
      </T>
      <Option on={choice === "keep"} onPress={() => setChoice("keep")} title="Stop following, keep my positions" body={keepBody} testID="stop.option.keep" />
      <Option on={choice === "close"} onPress={() => setChoice("close")} title="Stop and close" body={closeBody} testID="stop.option.close" />
      <Note icon="info" testID="stop.explain">{explain}</Note>
      {act.error ? <Note tone="neg" icon="warn" testID="stop.error">{act.error}</Note> : null}
      <Row gap={10}>
        <Button title="Cancel" kind="out" size="md" flex onPress={onClose} testID="stop.cancel" />
        <Button
          title={busy ? "Waiting" : choice === "keep" ? "Stop following" : "Stop and close"}
          icon="fp"
          kind={choice === "close" ? "dng" : "pri"}
          size="md"
          flex
          disabled={busy}
          testID="stop.confirm"
          onPress={async () => {
            if (await act.stopFollowing(account, leaderId, choice)) {
              onDone?.(choice);
              onClose();
            }
          }}
        />
      </Row>
    </Overlay>
  );
}
