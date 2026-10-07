// Several leaders in one account: the deposit split bar and editor, a leader's budget row (Home), and the
// card of a leader its loss stop stopped (Home row, leader profile). Numbers from lib/budgets (leaderBook).
import React, { useMemo } from "react";
import { View } from "react-native";
import { leaderLabel, splitTotals, type LeaderBook, type SplitIssue, type SplitRow } from "../lib/budgets";
import { leaderAddressOf } from "../lib/engineShape";
import { ausd, ausdSigned, dateShort, parseUnits, pctSigned, timeHM, bps } from "../lib/format";
import type { FeedEvent, MirrorAccount } from "../lib/types";
import { useLeaderDirectory } from "../state/data";
import { Icon } from "./icons";
import { Button, ChipS, Identicon, Meter, NumInput, Press, Row, T } from "./kit";
import { useColors } from "./theme";

export const STEP_CNS = 1_000_000n;

/** Leader colours in split bars and legends, by position in the split. */
export function splitPalette(c: ReturnType<typeof useColors>) {
  return [c.ac, c.dark ? "#B4ABFF" : "#9C92FF", c.dark ? "#5F54C9" : "#6E62F0", c.dark ? "#D4CEFF" : "#C9C3FF"];
}

/** (leaderId) -> "0x7a3f…c91e" from the leaderboard or the accounts; "Perpl #id" when unknown. */
export function useLeaderNames(accounts?: MirrorAccount[]) {
  const dir = useLeaderDirectory();
  return useMemo(() => {
    const known = new Map<number, string>();
    for (const a of accounts ?? []) if (a.leader?.address) known.set(a.leader.accountId, a.leader.address);
    const address = (id: number) => dir.get(id)?.address ?? known.get(id) ?? leaderAddressOf(id);
    return { address, name: (id: number) => leaderLabel(address(id), id) };
  }, [dir, accounts]);
}

export function SplitBar({ depositCNS, rows, height = 10 }: { depositCNS: bigint; rows: Pick<SplitRow, "budgetCNS" | "stopped">[]; height?: number }) {
  const c = useColors();
  const pal = splitPalette(c);
  const t = splitTotals(depositCNS, rows);
  const whole = Number(t.assigned > depositCNS ? t.assigned : depositCNS) || 1;
  return <Meter height={height} parts={rows.map((r, i) => ({ frac: Number(r.budgetCNS) / whole, color: r.stopped ? c.mu : pal[i % pal.length] }))} />;
}

function Stepper({ value, onChange, min, testID }: { value: bigint; onChange: (v: bigint) => void; min: bigint; testID: string }) {
  const c = useColors();
  const [text, setText] = React.useState(ausd(value));
  React.useEffect(() => setText((t) => (parseUnits(t, 6) === value ? t : ausd(value))), [value]);
  const btn = (name: "minus" | "plus", on: () => void, id: string) => (
    <Press testID={id} onPress={on} hitSlop={6} style={{ width: 28, height: 28, alignItems: "center", justifyContent: "center" }}>
      {name === "plus" ? <Icon name="plus" size={16} color={c.ac} /> : <View style={{ width: 12, height: 2, borderRadius: 1, backgroundColor: c.ac }} />}
    </Press>
  );
  return (
    <Row gap={2} style={{ borderWidth: 1, borderColor: c.bd, borderRadius: 999, paddingHorizontal: 6, paddingVertical: 2, backgroundColor: c.sf }}>
      {btn("minus", () => onChange(value - STEP_CNS < min ? min : value - STEP_CNS), `${testID}.minus`)}
      <NumInput
        testID={`${testID}.input`}
        value={text}
        size={15}
        onChangeText={(t) => {
          setText(t);
          const v = parseUnits(t, 6);
          if (v !== null) onChange(v);
        }}
        style={{ width: 64, minWidth: 64, textAlign: "center" } as never}
      />
      {btn("plus", () => onChange(value + STEP_CNS), `${testID}.plus`)}
    </Row>
  );
}

/** Budget per leader with steppers, the unassigned rest, and what each budget can't go below. */
export function SplitEditor({ depositCNS, rows, onChange, name, address, issues, testIDPrefix, highlight, bar = true, extra, fixed }: { depositCNS: bigint; rows: SplitRow[]; onChange: (rows: SplitRow[]) => void; name: (id: number) => string; address: (id: number) => string | undefined; issues: SplitIssue[]; testIDPrefix: string; highlight?: number; bar?: boolean; extra?: (r: SplitRow) => React.ReactNode; fixed?: (r: SplitRow) => string | null }) {
  const c = useColors();
  const t = splitTotals(depositCNS, rows);
  const set = (i: number, budgetCNS: bigint) => onChange(rows.map((r, j) => (j === i ? { ...r, budgetCNS } : r)));
  const total = issues.find((x) => x.field === "total");
  return (
    <View style={{ gap: 8 }} testID={testIDPrefix}>
      {bar ? <SplitBar depositCNS={depositCNS} rows={rows} /> : null}
      {rows.map((r, i) => {
        const err = issues.find((x) => x.leaderId === r.accountId && x.field === "budget");
        const on = highlight === r.accountId;
        return (
          <View key={r.accountId} testID={`${testIDPrefix}.row.${r.accountId}`} style={{ gap: 4, padding: 10, borderRadius: 12, backgroundColor: on ? c.acs : "transparent" }}>
            <Row gap={10}>
              <Identicon seed={address(r.accountId) ?? String(r.accountId)} size={24} />
              <T size={13} w={on ? 600 : 400} mono style={{ flex: 1 }} lines={1}>
                {name(r.accountId)}
              </T>
              {r.stopped ? <ChipS label="Stopped" tone="neg" /> : null}
              {fixed?.(r) ? <T size={13} w={600} mono color="mu">{fixed(r)}</T> : <Stepper value={r.budgetCNS} min={r.marginCNS ?? 0n} onChange={(v) => set(i, v)} testID={`${testIDPrefix}.budget.${r.accountId}`} />}
            </Row>
            {r.marginCNS && r.marginCNS > 0n ? (
              <T size={12} color="mu" mono>{`${ausd(r.marginCNS)} margin in use, so it can't go below ${ausd(r.marginCNS)}`}</T>
            ) : r.isNew ? (
              <T size={12} color="mu">New leader · trades only with this budget</T>
            ) : null}
            {err ? <T size={12} color="neg" testID={`${testIDPrefix}.error.${r.accountId}`}>{err.message}</T> : null}
            {extra?.(r)}
          </View>
        );
      })}
      <Row gap={10} style={{ paddingHorizontal: 10, paddingVertical: 6 }} testID={`${testIDPrefix}.unassigned`}>
        <View style={{ width: 24, height: 24, borderRadius: 6, borderWidth: 1.5, borderStyle: "dashed", borderColor: c.mu }} />
        <T size={13} color="mu" style={{ flex: 1 }}>
          Not assigned
        </T>
        <T size={14} w={600} mono color={t.unassigned < 0n ? "neg" : "tx"} testID={`${testIDPrefix}.unassigned.value`}>
          {t.unassigned < 0n ? `−${ausd(-t.unassigned)}` : ausd(t.unassigned)}
        </T>
      </Row>
      {total ? (
        <T size={12} color="neg" testID={`${testIDPrefix}.error`}>
          {total.message}
        </T>
      ) : null}
    </View>
  );
}

const STATUS: Record<LeaderBook["status"], { label: string; tone: "ok" | "neg" | "wrn" | "neutral"; icon?: "pause" }> = {
  copying: { label: "Copying", tone: "ok" },
  paused: { label: "Paused", tone: "wrn", icon: "pause" },
  stopped: { label: "Stopped by loss stop", tone: "neg", icon: "pause" },
  unfollowed: { label: "Stopped following", tone: "neutral" },
};
export const statusChip = (b: LeaderBook, testID?: string) => <ChipS label={STATUS[b.status].label} tone={STATUS[b.status].tone} icon={STATUS[b.status].icon} testID={testID} />;

/** "Loss stop at 10.20 · 2.42 away", "Loss stop off", "hit at 3.40". */
export function lossStopText(b: LeaderBook): string {
  if (b.status === "unfollowed") return "Not mirrored · you manage its positions";
  if (!b.lossStopBps) return "Loss stop off";
  if (b.stopped) return `Loss stop hit at ${ausd(b.stopAtCNS)}`;
  return `Loss stop at ${ausd(b.stopAtCNS)} · ${ausd(b.lossLeftCNS > 0n ? b.lossLeftCNS : 0n)} away`;
}

export const pctOfBudget = (b: LeaderBook) => (b.budgetCNS > 0n ? (Number(b.pnlCNS) / Number(b.budgetCNS)) * 100 : 0);

/** The LeaderStopped item for this leader (when it fired), newest first. */
export const stoppedEvent = (events: FeedEvent[], b: LeaderBook) =>
  events.find((e) => (e.kind === "LeaderStopped" || (e.kind === "StopTriggered" && String(e.reason ?? e.data?.kind) === "LeaderLoss")) && Number(e.leaderAccountId) === b.leaderId && e.account.toLowerCase() === b.account.toLowerCase());

/**
 * The loss when the stop fired, from the LeaderStopped (pnl) or StopTriggered (loss) item, and its limit; the
 * book's PnL when neither is in the feed. The close can fill better than the mark the stop was checked at.
 */
export function stopNumbers(b: LeaderBook, ev?: FeedEvent | null) {
  const abs = (v: bigint) => (v < 0n ? -v : v);
  const raw = ev?.actual ?? (ev?.data?.pnlCNS as string | undefined) ?? (ev?.data?.actual as string | undefined);
  const lossAtStop = raw !== undefined && raw !== null ? abs(BigInt(String(raw))) : b.pnlCNS < 0n ? -b.pnlCNS : 0n;
  const limit = ev?.limit ? BigInt(String(ev.limit)) : b.lossLimitCNS;
  const realisedLoss = b.pnlCNS < 0n ? -b.pnlCNS : 0n;
  return { lossAtStop, limit, left: b.budgetCNS > realisedLoss ? b.budgetCNS - realisedLoss : 0n, realisedLoss };
}

/** Home row for one leader of a multi-leader account (design #leaders-budget). */
export function LeaderBudgetRow({ b, name, address, color, onPress, onRearm, busy, stop, testID }: { b: LeaderBook; name: string; address?: string; color: string; onPress?: () => void; onRearm?: () => void; busy?: boolean; stop?: FeedEvent | null; testID: string }) {
  const c = useColors();
  const stopped = b.status === "stopped";
  const stoppedAt = stop?.timestamp;
  const n = stopNumbers(b, stop);
  return (
    <Press testID={testID} onPress={onPress} style={{ padding: 14, gap: 10, backgroundColor: stopped ? c.negS : undefined }}>
      <Row gap={12} align="flex-start">
        <Identicon seed={address ?? String(b.leaderId)} size={40} />
        <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
          <Row gap={6} style={{ flexWrap: "wrap" }}>
            <T size={14} w={500} mono>{name}</T>
            {statusChip(b, `${testID}.status`)}
          </Row>
          <T size={12} color="mu" mono testID={`${testID}.budget`}>
            {stopped && stoppedAt ? `${dateShort(stoppedAt)} · ${timeHM(stoppedAt)} · positions closed` : `Budget ${ausd(b.budgetCNS)} · ${b.positions.length} open`}
          </T>
        </View>
        <View style={{ alignItems: "flex-end" }}>
          <T size={14} w={600} mono color={b.pnlCNS >= 0n ? "posI" : "neg"} testID={`${testID}.pnl`}>{ausdSigned(b.pnlCNS)}</T>
          {b.budgetCNS > 0n ? <T size={12} mono color="mu">{pctSigned(pctOfBudget(b))}</T> : null}
        </View>
      </Row>
      {stopped ? (
        <View style={{ gap: 8 }}>
          <T size={12} color="neg" lh={17} testID={`${testID}.lossStop`}>
            {stop || n.lossAtStop > 0n
              ? `Lost ${ausd(n.lossAtStop)} of ${ausd(b.budgetCNS)} (${bps(b.lossStopBps)} stop at ${ausd(n.limit)}). ${ausd(n.left)} AUSD waiting in this budget.`
              : `Its ${bps(b.lossStopBps)} loss stop (${ausd(n.limit)} of ${ausd(b.budgetCNS)}) was hit. ${ausd(n.left)} AUSD waiting in this budget.`}
          </T>
          {onRearm ? <Button title={busy ? "Waiting" : "Re-arm"} icon="fp" kind="out" size="md" disabled={busy} onPress={onRearm} testID={`${testID}.rearm`} /> : null}
        </View>
      ) : (
        <>
          {b.budgetCNS > 0n ? <Meter height={6} parts={[{ frac: Number(b.marginCNS) / Number(b.budgetCNS), color }]} /> : null}
          <Row align="flex-start" gap={8}>
            <T size={12} color="mu" mono style={{ flex: 1 }} testID={`${testID}.margin`}>
              {b.budgetCNS > 0n ? `Margin used ${ausd(b.marginCNS)} of ${ausd(b.budgetCNS)}` : `Margin ${ausd(b.marginCNS)}`}
            </T>
            <T size={12} color="mu" mono style={{ flex: 1, textAlign: "right" }} testID={`${testID}.lossStop`}>
              {lossStopText(b)}
            </T>
          </Row>
        </>
      )}
    </Press>
  );
}

/** "Deposit split" card: the bar, a legend per leader and what is not assigned. */
export function DepositSplitCard({ a, books, name, testID }: { a: MirrorAccount; books: LeaderBook[]; name: (id: number) => string; testID: string }) {
  const c = useColors();
  const pal = splitPalette(c);
  const rows = books.filter((b) => b.inPolicy);
  const dep = BigInt(a.netDepositsCNS || "0");
  const t = splitTotals(dep, rows);
  return (
    <View testID={testID} style={{ gap: 10, padding: 14, borderRadius: 16, borderWidth: 1, borderColor: c.bd, backgroundColor: c.sf }}>
      <Row>
        <T size={14} w={600} style={{ flex: 1 }}>Deposit split</T>
        <T size={13} mono>{`${ausd(dep)} / ${ausd(a.depositCapCNS)} AUSD`}</T>
      </Row>
      <SplitBar depositCNS={dep} rows={rows} />
      <View style={{ flexDirection: "row", flexWrap: "wrap", columnGap: 14, rowGap: 4 }}>
        {rows.map((b, i) => (
          <Row key={b.leaderId} gap={6}>
            <View style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: b.stopped ? c.mu : pal[i % pal.length] }} />
            <T size={12} mono color="mu">{`${name(b.leaderId).slice(0, 6)} ${ausd(b.budgetCNS)}${b.stopped ? ", stopped" : ""}`}</T>
          </Row>
        ))}
        <Row gap={6}>
          <View style={{ width: 8, height: 8, borderRadius: 2, borderWidth: 1, borderColor: c.mu }} />
          <T size={12} mono color="mu" testID={`${testID}.unassigned`}>{`Not assigned ${ausd(t.unassigned > 0n ? t.unassigned : 0n)}`}</T>
        </Row>
      </View>
    </View>
  );
}
