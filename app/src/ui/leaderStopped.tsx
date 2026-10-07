// A leader its own loss stop stopped (MirrorAccount.leaderStopped): what happened with the numbers, who executed
// the close, and "Re-arm" (the same limits signed again, one passkey prompt). Leader profile and laptop panel.
import * as Linking from "expo-linking";
import React from "react";
import { View } from "react-native";
import type { LeaderBook } from "../lib/budgets";
import { txUrl } from "../lib/chain";
import { ausd, bps, dateShort, shortAddr, timeHM } from "../lib/format";
import type { AppConfig, FeedEvent, MirrorAccount } from "../lib/types";
import type { useOwnerAction } from "../state/ownerAction";
import { stopNumbers, stoppedEvent } from "./budgets";
import { Icon } from "./icons";
import { Button, KV, Note, Row, T, TxLink } from "./kit";
import { useColors } from "./theme";

type Act = ReturnType<typeof useOwnerAction>;

export function LeaderStoppedCard({ account, book, events, cfg, act }: { account: MirrorAccount; book: LeaderBook; events: FeedEvent[]; cfg: AppConfig | undefined; act: Act }) {
  const c = useColors();
  const stop = events.find((e) => e.kind === "StopTriggered" && String(e.reason ?? e.data?.kind) === "LeaderLoss" && Number(e.leaderAccountId) === book.leaderId && e.account.toLowerCase() === account.account.toLowerCase());
  const fired = stoppedEvent(events, book);
  const { lossAtStop: lost, limit, left, realisedLoss } = stopNumbers(book, fired);
  const fellTo = book.budgetCNS > lost ? book.budgetCNS - lost : 0n;
  const closed = book.positions.length === 0;
  const when = fired?.timestamp;
  const others = (account.policy?.leaders.length ?? 1) > 1;
  return (
    <View testID="leader.stopped" style={{ gap: 12 }}>
      <View style={{ padding: 16, borderRadius: 16, borderWidth: 1.5, borderColor: c.neg, backgroundColor: c.sf, gap: 8 }}>
        <Row gap={12} align="flex-start">
          <View style={{ width: 44, height: 44, borderRadius: 12, backgroundColor: c.negS, alignItems: "center", justifyContent: "center" }}>
            <Icon name="pause" size={20} color={c.neg} />
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <T size={12} w={600} color="neg" upper>{`Stopped${when ? ` · ${dateShort(when)}, ${timeHM(when)}` : ""}`}</T>
            <T size={18} w={600} testID="leader.stopped.title">{closed ? "Your loss stop closed this leader" : "Your loss stop stopped this leader"}</T>
          </View>
        </Row>
        <T size={13} lh={19} testID="leader.stopped.body">
          {`This leader's budget fell to ${ausd(fellTo)} AUSD, past its ${bps(book.lossStopBps)} stop at ${ausd(book.budgetCNS - limit)}. ${closed ? "Its positions were closed and copying stopped." : "Copying stopped; its open positions still follow the leader's closes until the stop is executed."}${others ? " Your other leaders kept running." : ""}`}
        </T>
      </View>
      <View style={{ borderRadius: 16, borderWidth: 1, borderColor: c.bd, backgroundColor: c.sf, paddingHorizontal: 14 }}>
        <KV k="Trigger" v={`Loss ${ausd(lost)} ≥ stop ${ausd(limit)}`} testID="leader.stopped.trigger" />
        <KV k="Realised since added" v={realisedLoss > 0n ? `−${ausd(realisedLoss)}` : ausd(book.realisedCNS)} testID="leader.stopped.realised" />
        <KV k="Budget left" v={`${ausd(left)} of ${ausd(book.budgetCNS)}`} testID="leader.stopped.left" />
        <KV k="Executed by" v={stop?.keeper ? `${shortAddr(stop.keeper)}` : closed ? "—" : "Not executed yet"} testID="leader.stopped.by" />
        <KV k="Transaction" v={<TxLink hash={stop?.txHash ?? fired?.txHash} onPress={() => (stop?.txHash ?? fired?.txHash) && Linking.openURL(txUrl(cfg, (stop?.txHash ?? fired?.txHash)!))} />} last />
      </View>
      <Row gap={8}>
        <Icon name="shield" size={14} color={c.mu} />
        <T size={12} color="mu" style={{ flex: 1 }}>Anyone can execute a leader loss stop when it is hit. It runs even if nobody at Mirror presses anything.</T>
      </Row>
      <Button title={act.busy === "rearm" ? "Waiting for your passkey" : "Re-arm"} icon="fp" disabled={!!act.busy} onPress={() => act.rearm(account, book.leaderId)} testID="leader.rearm" />
      <T size={12} color="mu" center>Re-arm signs your limits again: copying resumes with a clean loss record for this leader.</T>
      {act.error ? <Note tone="neg" icon="warn" testID="leader.error">{act.error}</Note> : null}
    </View>
  );
}

/** "You stopped following this leader; N positions stay, not mirrored." */
export function UnfollowedNote({ book }: { book: LeaderBook }) {
  return (
    <Note icon="info" testID="leader.unfollowed">
      {`You stopped following this leader. ${book.positions.length} position${book.positions.length === 1 ? "" : "s"} it opened stay${book.positions.length === 1 ? "s" : ""} in your account and ${book.positions.length === 1 ? "is" : "are"} no longer mirrored. You manage ${book.positions.length === 1 ? "it" : "them"}: levels, close, withdraw.`}
    </Note>
  );
}

/** Shown while MirrorAccount.leaderDetached(leader) is set: "stop following, keep my positions". */
export const DETACHED_TEXT =
  "You stopped following this leader. Your contract refuses every copy from this leader, opens and closes. Your positions stay open; close them yourself or with your stop-loss / take-profit.";
export function DetachedNote({ book, testID = "leader.detached" }: { book?: LeaderBook; testID?: string }) {
  const n = book?.positions.length ?? 0;
  return (
    <Note icon="info" testID={testID}>
      {`${DETACHED_TEXT}${book ? ` ${n} position${n === 1 ? "" : "s"} held for it.` : ""}`}
    </Note>
  );
}
