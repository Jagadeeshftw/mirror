// Follow sheet parts for a second (third, fourth) leader: "Add to my account (split my deposit)" or "New
// account", the split with a budget per leader, an optional top-up, which markets another leader holds, and
// the new leader's own loss stop. The sheet signs it all in one passkey prompt (lib/actions addLeader).
import React from "react";
import { View } from "react-native";
import { heldByOthers, ownershipSentence, splitTotals, type SplitIssue, type SplitRow } from "../lib/budgets";
import { ausd, parseUnits } from "../lib/format";
import type { MarketConfig, MirrorAccount } from "../lib/types";
import { SplitEditor } from "./budgets";
import { Chip, Field, Hint, NumInput, Press, Row, Slider, T } from "./kit";
import { useColors } from "./theme";

export type FollowMode = "split" | "new";

function Radio({ on, title, body, onPress, testID }: { on: boolean; title: string; body: string; onPress: () => void; testID: string }) {
  const c = useColors();
  return (
    <Press testID={testID} onPress={onPress} accessibilityRole="radio" accessibilityState={{ checked: on }} aria-checked={on} style={{ flex: 1, flexDirection: "row", gap: 10, padding: 12, borderRadius: 14, borderWidth: on ? 2 : 1, borderColor: on ? c.ac : c.bd, backgroundColor: on ? c.acs : c.sf }}>
      <View style={{ width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: on ? c.ac : c.mu, alignItems: "center", justifyContent: "center", marginTop: 1 }}>
        {on ? <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: c.ac }} /> : null}
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <T size={13} w={600}>{title}</T>
        <T size={12} color="mu" lh={16}>{body}</T>
      </View>
    </Press>
  );
}

export function ModeChoice({ mode, onMode, targets, target, onTarget, name }: { mode: FollowMode; onMode: (m: FollowMode) => void; targets: MirrorAccount[]; target?: MirrorAccount; onTarget: (a: MirrorAccount) => void; name: (id: number) => string }) {
  const n = target?.policy?.leaders.length ?? 0;
  return (
    <View style={{ gap: 10, paddingBottom: 14 }} testID="follow.mode">
      <Row gap={10} align="stretch">
        <Radio on={mode === "split"} onPress={() => onMode("split")} title="Add to my account" body={`Split my deposit · ${n} leader${n === 1 ? "" : "s"} there now`} testID="follow.mode.split" />
        <Radio on={mode === "new"} onPress={() => onMode("new")} title="New account" body="A separate deposit just for this leader" testID="follow.mode.new" />
      </Row>
      {mode === "split" && targets.length > 1 ? (
        <Row gap={8} style={{ flexWrap: "wrap" }}>
          {targets.map((a, i) => (
            <Chip key={a.account} label={`${(a.policy?.leaders ?? []).map((l) => name(l.accountId).slice(0, 6)).join(" + ")} · ${ausd(a.netDepositsCNS)}`} mono on={a.account === target?.account} onPress={() => onTarget(a)} testID={`follow.split.account.${i}`} />
          ))}
        </Row>
      ) : null}
    </View>
  );
}

/** "Split your deposit": budgets, Not assigned, top-up from the wallet, and market ownership. */
export function SplitSection({ target, rows, onRows, topUp, onTopUp, walletCNS, capCNS, issues, name, address, leaderId, leaderMarkets, byPerp }: {
  target: MirrorAccount;
  rows: SplitRow[];
  onRows: (r: SplitRow[]) => void;
  topUp: string;
  onTopUp: (v: string) => void;
  walletCNS: bigint;
  capCNS: bigint;
  issues: SplitIssue[];
  name: (id: number) => string;
  address: (id: number) => string | undefined;
  leaderId: number;
  leaderMarkets: number[];
  byPerp: Map<number, MarketConfig>;
}) {
  const c = useColors();
  const deposit = BigInt(target.netDepositsCNS || "0");
  const top = parseUnits(topUp || "0", 6) ?? 0n;
  const room = capCNS > deposit ? capCNS - deposit : 0n;
  const held = heldByOthers(target, leaderId, leaderMarkets);
  const t = splitTotals(deposit + top, rows);
  const topErr = issues.find((x) => x.field === "topUp");
  return (
    <View style={{ gap: 10 }}>
      <SplitEditor depositCNS={deposit + top} rows={rows} onChange={onRows} name={name} address={address} issues={issues} testIDPrefix="follow.split" highlight={leaderId} />
      <View style={{ gap: 6 }}>
        <Row>
          <T size={13} style={{ flex: 1 }}>Add to the deposit</T>
          <T size={12} color="mu" mono>{`wallet ${ausd(walletCNS)} · room ${ausd(room)}`}</T>
        </Row>
        <Field error={!!topErr}>
          <NumInput testID="follow.topUp.input" value={topUp} placeholder="0.00" onChangeText={onTopUp} />
          <T size={13} color="mu" style={{ flex: 1 }}>AUSD</T>
          {t.unassigned < 0n && -t.unassigned <= room ? <Chip label={`Add ${ausd(-t.unassigned)}`} height={28} onPress={() => onTopUp(ausd(top - t.unassigned))} testID="follow.topUp.fill" /> : null}
        </Field>
        {topErr ? <Hint warn>{topErr.message}</Hint> : <Hint>Optional. Signed in the same passkey prompt (permit), deposited before the new budgets apply.</Hint>}
      </View>
      <View testID="follow.split.ownership" style={{ padding: 12, borderRadius: 12, backgroundColor: c.sf2 }}>
        <T size={12} color="mu" lh={17} testID="follow.split.ownership.text">
          {ownershipSentence(held, (p) => byPerp.get(p)?.symbol ?? `#${p}`, name)}
        </T>
      </View>
    </View>
  );
}

const LOSS_STEPS = [0, 5, 10, 15, 20, 25, 30, 40, 50];

/** The new leader's own loss stop (% of its budget): stops this leader only. */
export function LeaderLossSection({ bpsValue, onChange, budgetCNS, flatten }: { bpsValue: number; onChange: (bps: number) => void; budgetCNS: bigint; flatten: boolean }) {
  const pct = bpsValue / 100;
  const idx = LOSS_STEPS.reduce((bi, v, i) => (Math.abs(v - pct) < Math.abs(LOSS_STEPS[bi] - pct) ? i : bi), 0);
  const stopAt = budgetCNS - (budgetCNS * BigInt(bpsValue)) / 10_000n;
  return (
    <View style={{ gap: 8 }}>
      <Row>
        <T size={22} w={600} mono testID="follow.leaderLoss.value">{bpsValue ? `${pct}%` : "Off"}</T>
        <T size={12} color="mu" mono style={{ flex: 1, textAlign: "right" }}>{bpsValue ? `stops at ${ausd(stopAt)} of ${ausd(budgetCNS)}` : "this leader has no loss stop"}</T>
      </Row>
      <Slider testID="follow.leaderLoss.slider" steps={LOSS_STEPS.length} index={idx} onChange={(i) => onChange(LOSS_STEPS[i] * 100)} ticks={[{ label: "0", at: 0 }, { label: "10%", at: 2 / 8 }, { label: "25%", at: 5 / 8 }, { label: "50%", at: 1 }]} />
      <T size={12} color="mu">{flatten ? "Executable by anyone · same as your account setting" : "Executed by Mirror's keeper · same as your account setting"}</T>
    </View>
  );
}
