// Budgets: move margin budget between the leaders of one account (one passkey prompt, ACTION_SET_POLICY with
// every leader). A leader its loss stop stopped is left out (its budget goes to Not assigned) unless re-armed,
// because any new policy that keeps a stopped leader re-arms it.
import { router, useLocalSearchParams } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import { View } from "react-native";
import { buildSplitPolicy, currentSplit, isMultiLeader, leaderBooks, splitTotals, validateSplit, type SplitRow } from "../lib/budgets";
import { ausd, bps, shortAddr } from "../lib/format";
import { useTotals } from "../state/data";
import { useOwnerAction } from "../state/ownerAction";
import { SplitBar, SplitEditor, useLeaderNames } from "../ui/budgets";
import { AppBar } from "../ui/chrome";
import { Button, Card, Chip, Hint, LoadingBlock, Note, Row, Screen, Scroll, T } from "../ui/kit";

const LOSS_CHOICES = [0, 1000, 1500, 2500];

export default function BudgetsScreen() {
  const { account: param } = useLocalSearchParams<{ account?: string }>();
  const { totals } = useTotals();
  const act = useOwnerAction();
  const accts = (totals?.accounts ?? []).filter((a) => a.policy);
  const pick = accts.find((a) => a.account.toLowerCase() === String(param ?? "").toLowerCase()) ?? accts.find(isMultiLeader) ?? accts[0];
  const [sel, setSel] = useState<string | null>(null);
  const a = accts.find((x) => x.account === sel) ?? pick;
  const names = useLeaderNames(totals?.accounts);
  const [rows, setRows] = useState<SplitRow[]>([]);
  const [rearm, setRearm] = useState<Record<number, boolean>>({});
  const [saved, setSaved] = useState(false);
  const key = a ? `${a.account}:${JSON.stringify(a.policy?.leaders)}` : "";
  useEffect(() => {
    if (!a) return;
    setRows(currentSplit(a));
    setRearm({});
  }, [key]);

  const books = useMemo(() => (a ? leaderBooks(a) : []), [a]);
  if (!totals) return <Screen><AppBar title="Budgets" showBack /><LoadingBlock label="Loading your account" /></Screen>;
  if (!a) return <Screen><AppBar title="Budgets" showBack /><Hint>No follow yet. Follow a leader first.</Hint></Screen>;

  const deposit = BigInt(a.netDepositsCNS || "0");
  // Stopped leaders are left out unless re-armed; their budget shows as Not assigned.
  const kept = rows.filter((r) => !r.stopped || rearm[r.accountId]);
  const shown = rows.map((r) => (r.stopped && !rearm[r.accountId] ? { ...r, budgetCNS: 0n } : r));
  const issues = validateSplit({ depositCNS: deposit, rows: kept, name: names.name, capCNS: BigInt(a.depositCapCNS || "0") || undefined });
  const before = currentSplit(a);
  const changed = JSON.stringify(kept.map((r) => [r.accountId, r.budgetCNS.toString(), r.lossStopBps])) !== JSON.stringify(before.filter((r) => !r.stopped).map((r) => [r.accountId, r.budgetCNS.toString(), r.lossStopBps])) || Object.values(rearm).some(Boolean);
  const t = splitTotals(deposit, kept);
  const save = async () => {
    setSaved(false);
    const r = await act.saveBudgets(a, buildSplitPolicy(a.policy!, kept));
    if (r) setSaved(true);
  };

  return (
    <Screen testID="budgets.screen">
      <AppBar title="Budgets" showBack />
      <Scroll testID="budgets.scroll" contentStyle={{ paddingHorizontal: 20, paddingTop: 4, gap: 14, paddingBottom: 24 }}>
        {accts.length > 1 ? (
          <Row gap={8} style={{ flexWrap: "wrap" }}>
            {accts.map((x, i) => (
              <Chip key={x.account} label={`Account ${i + 1} · ${shortAddr(x.account)}`} on={x.account === a.account} onPress={() => setSel(x.account)} testID={`budgets.account.${i}`} mono />
            ))}
          </Row>
        ) : null}
        <Card style={{ padding: 16, gap: 10 }} testID="budgets.deposit">
          <T size={12} w={500} color="mu" upper>Deposited</T>
          <Row align="flex-end" gap={6}>
            <T size={36} w={500} mono lh={40} testID="budgets.deposit.value">{ausd(deposit)}</T>
            <T size={14} color="mu" style={{ marginBottom: 5 }}>AUSD</T>
          </Row>
          <SplitBar depositCNS={deposit} rows={shown} />
          <T size={12} color="mu" lh={17}>Moving budget between leaders doesn't move money. It changes how much margin each leader may use.</T>
        </Card>

        <Card style={{ padding: 6 }}>
          <SplitEditor
            depositCNS={deposit}
            rows={shown}
            bar={false}
            onChange={(next) => setRows(next.map((r, i) => (rows[i].stopped && !rearm[r.accountId] ? { ...r, budgetCNS: rows[i].budgetCNS } : r)))}
            name={names.name}
            address={names.address}
            issues={issues}
            testIDPrefix="budgets.split"
            fixed={(r) => (r.stopped && !rearm[r.accountId] ? "Left out" : null)}
            extra={(r) => {
              const b = books.find((x) => x.leaderId === r.accountId);
              const out = r.stopped && !rearm[r.accountId];
              return (
                <View style={{ gap: 6, paddingTop: 2 }} testID={`budgets.leader.${r.accountId}`}>
                  {r.stopped && b ? (
                    <T size={12} color="neg" lh={17} testID={`budgets.leader.${r.accountId}.stopped`}>
                      {`Lost ${ausd(b.pnlCNS < 0n ? -b.pnlCNS : 0n)} of ${ausd(b.budgetCNS)} to its loss stop. ${rearm[r.accountId] ? "Saving re-arms it with the budget above." : `${ausd(rows.find((x) => x.accountId === r.accountId)?.budgetCNS ?? 0n)} moves to Not assigned on save.`}`}
                    </T>
                  ) : null}
                  <Row gap={6} style={{ flexWrap: "wrap" }}>
                    {r.stopped ? (
                      <>
                        <Chip label="Leave out" height={28} on={!rearm[r.accountId]} onPress={() => setRearm({ ...rearm, [r.accountId]: false })} testID={`budgets.leader.${r.accountId}.leaveOut`} />
                        <Chip label="Re-arm" height={28} icon="refresh" on={!!rearm[r.accountId]} onPress={() => setRearm({ ...rearm, [r.accountId]: true })} testID={`budgets.leader.${r.accountId}.rearm`} />
                      </>
                    ) : null}
                    {!out ? (
                      <>
                        <T size={12} color="mu">Loss stop</T>
                        {LOSS_CHOICES.map((v) => (
                          <Chip key={v} label={v ? bps(v) : "Off"} height={28} on={r.lossStopBps === v} onPress={() => setRows(rows.map((x) => (x.accountId === r.accountId ? { ...x, lossStopBps: v } : x)))} testID={`budgets.leader.${r.accountId}.loss.${v}`} />
                        ))}
                        {!LOSS_CHOICES.includes(r.lossStopBps) ? <Chip label={bps(r.lossStopBps)} height={28} on /> : null}
                      </>
                    ) : null}
                  </Row>
                </View>
              );
            }}
          />
        </Card>
        <T size={12} color="mu" testID="budgets.unassigned.note">{`Not assigned ${ausd(t.unassigned > 0n ? t.unassigned : 0n)} AUSD: free for a new leader or to withdraw.`}</T>
        <Note icon="info">Lowering a budget below its margin in use isn't possible. Close positions first, or lower it later.</Note>
        {kept.length === 0 ? <Note tone="neg" icon="warn" testID="budgets.none">Keep at least one leader, or re-arm the stopped one. To stop following everyone, use Stop following on a leader.</Note> : null}
        {act.error ? <Note tone="neg" icon="warn" testID="budgets.error">{act.error}</Note> : null}
        {saved ? <Note tone="ac" icon="check" testID="budgets.status">Saved. New budgets apply to the next copied order.</Note> : null}
        <Row>
          <T size={12} color="mu" style={{ flex: 1 }}>Network fee</T>
          <T size={12} color="mu"><T size={12} w={600} color="posI">Free</T> · sponsored</T>
        </Row>
        <Button title={act.busy === "budgets" ? "Waiting for your passkey" : "Save budgets with passkey"} icon="fp" onPress={save} disabled={!changed || issues.length > 0 || kept.length === 0 || !!act.busy} testID="budgets.save" />
        <Button title="Add leader" icon="plus" kind="ton" onPress={() => router.push("/leaders")} disabled={rows.length >= 4} testID="budgets.addLeader" />
      </Scroll>
    </Screen>
  );
}
