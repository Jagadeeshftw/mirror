// Follow sheet: every policy control, "Match the leader now" with a live quote, review, and
// one passkey approval (permit + ACTION_FOLLOW). With ?account=0x… it edits an existing
// follow's limits instead (ACTION_SET_POLICY, single step).
import { useRelayGate } from "../../state/conn";
import { RelayNote, relayBlocked } from "../../ui/serviceDown";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import { KeyboardAvoidingView, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { addLeader, follow as followFlow, executeActions, type StepState } from "../../lib/actions";
import { buildSplitPolicy, splitTargets, splitWithNewLeader, validateSplit, type SplitRow } from "../../lib/budgets";
import { signablePolicy } from "../../lib/levels";
import { LeaderLossSection, ModeChoice, SplitSection, type FollowMode } from "../../ui/followSplit";
import { useLeaderNames } from "../../ui/budgets";
import { api, ApiError } from "../../lib/api";
import { ACTION, encodeSetPolicy, validatePolicy } from "../../lib/contracts";
import { ausd, bps, cnsToNumber, dateLong, leverage, lots as fmtLots, parseUnits, price as fmtPrice, shortAddr, toBig } from "../../lib/format";
import { sealNote } from "../../lib/notifyKey";
import { ALL_MARKETS, BETA_CAP_CNS, EXPIRY_PRESETS, MIN_FOLLOW_CNS, SLIPPAGE_PRESETS, buildPolicy, defaultForm, followLimits, formErrors, ratioPresets, suggestRatioBps, type FollowForm } from "../../lib/policy";
import type { FeedEvent, FollowQuote, MirrorAccount, QuoteRow, RelayResult } from "../../lib/types";
import { describeError, loadNotifyKey } from "../../lib/wallet";
import { useConfig, useLeader, useMarkets, useOwner, useTotals, useWallet } from "../../state/data";
import { useSession } from "../../state/session";
import { BlockedSheet, FeedItem, openTx } from "../../ui/feed";
import { Icon, type IconName } from "../../ui/icons";
import { Button, Card, Checklist, Chip, ChipS, Field, Hint, IconButton, Identicon, KV, Lbl, LatencyPill, NumInput, Note, Row, Scroll, Side, Slider, Switch, T, TxLink } from "../../ui/kit";
import { fonts, useColors } from "../../ui/theme";
import { StepTabs } from "../../ui/kit2";
import { WhatIfBody } from "../../ui/whatif";
import { useLayout } from "../../ui/layout";
import { FollowModal } from "../../ui/laptop/FollowModal";
import { AlertsCard } from "../../ui/alertsCard";
import { BUILDER_ID, FEE_PCT, feeFor, feeText, plannedFeeCNS } from "../../lib/fees";

const LEV_STEPS = Array.from({ length: 15 }, (_, i) => i + 1);
const ENTRY_FILTER_PRESETS = [0, 0.5, 1, 2, 5];
const LOSS_STEPS = [0, 2, 5, 8, 10, 12, 15, 20, 25, 30, 40, 50];

function Section({ title, sub, icon, children, testID }: { title: string; sub?: string; icon: IconName; children: React.ReactNode; testID?: string }) {
  const c = useColors();
  return (
    <View testID={testID} style={{ paddingVertical: 16, borderTopWidth: 1, borderTopColor: c.bd, gap: 10 }}>
      <Row gap={10} align="flex-start">
        <View style={{ marginTop: 1 }}>
          <Icon name={icon} size={18} color={c.ac} />
        </View>
        <View style={{ flex: 1 }}>
          <T size={15} w={600}>
            {title}
          </T>
          {sub ? (
            <T size={12} color="mu" lh={17}>
              {sub}
            </T>
          ) : null}
        </View>
      </Row>
      {children}
    </View>
  );
}

function BigV({ v, right, testID }: { v: string; right?: string; testID?: string }) {
  return (
    <Row>
      <T testID={testID} size={22} w={600} mono>
        {v}
      </T>
      {right ? (
        <T size={12} color="mu" mono style={{ flex: 1, textAlign: "right" }}>
          {right}
        </T>
      ) : null}
    </Row>
  );
}

export default function FollowSheet() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const { id, account: editAccount } = useLocalSearchParams<{ id: string; account?: string }>();
  const leaderId = Number(id);
  const { account: me } = useSession();
  const gate = useRelayGate();
  const cfg = useConfig().data;
  const limits = followLimits(cfg);
  const { bySymbol, byPerp } = useMarkets(cfg);
  const leaderQ = useLeader(leaderId);
  const owner = useOwner();
  const wallet = useWallet();
  const { totals } = useTotals();
  const l = leaderQ.data;
  const existing: MirrorAccount | undefined = editAccount ? owner.data?.accounts.find((a) => a.account.toLowerCase() === editAccount.toLowerCase()) : undefined;
  const isEdit = !!editAccount;
  // A second (third, fourth) leader can join an existing account: one deposit, a budget per leader.
  const names = useLeaderNames(owner.data?.accounts);
  const targets = useMemo(() => (isEdit ? [] : splitTargets(owner.data?.accounts, leaderId)), [owner.data, leaderId, isEdit]);
  const [modeSel, setModeSel] = useState<FollowMode | null>(null);
  const mode: FollowMode = modeSel ?? (targets.length ? "split" : "new");
  const [targetSel, setTargetSel] = useState<string | null>(null);
  const target = mode === "split" ? (targets.find((a) => a.account === targetSel) ?? targets[0]) : undefined;
  const split = !!target;
  const [splitRows, setSplitRows] = useState<SplitRow[]>([]);
  const [topUp, setTopUp] = useState("");
  const [leaderLoss, setLeaderLoss] = useState(1000);
  useEffect(() => {
    if (target) setSplitRows(splitWithNewLeader(target, leaderId, 0, 0));
  }, [target?.account, target?.policy?.leaders?.length]);

  const [form, setForm] = useState<FollowForm>(defaultForm());
  const [initialised, setInitialised] = useState(false);
  const [step, setStep] = useState<"limits" | "whatif" | "review" | "approving" | "done" | "error">("limits");
  const laptop = useLayout() === "laptop";
  const [steps, setSteps] = useState<Record<string, StepState>>({});
  const [results, setResults] = useState<Record<string, Partial<RelayResult>>>({});
  const [error, setError] = useState<{ title: string; detail: string } | null>(null);
  const [blocked, setBlocked] = useState<FeedEvent | null>(null);
  const [newAccount, setNewAccount] = useState<string | null>(null);
  const [t0, setT0] = useState(0);
  const resultFeed = useQuery({
    queryKey: ["feed", newAccount ?? "none"],
    queryFn: () => api.feed(newAccount as any),
    enabled: !!newAccount && step === "done",
  });

  // Pre-set limits from this leader's risk (or from the existing follow).
  useEffect(() => {
    if (initialised || !l || !cfg) return;
    if (!isEdit && !owner.data && !owner.isError) return;
    const from = existing ?? (isEdit ? undefined : targets[0]);
    const maxLeaderNotional = l.positions.reduce((m, p) => {
      const mk = byPerp.get(p.perpId);
      if (!mk) return m;
      const n = (toBig(p.lotLNS) * toBig(p.markPNS) * 10n ** 6n) / 10n ** BigInt(mk.lotDecimals + mk.priceDecimals);
      return n > m ? n : m;
    }, 0n);
    if (from?.policy) {
      const p = from.policy;
      const mine = p.leaders.find((x) => x.accountId === leaderId);
      setForm({
        ...defaultForm(),
        allocationAusd: existing ? ausd(from.netDepositsCNS) : "12.00",
        ratioBps: mine?.ratioBps ?? (existing ? (p.leaders[0]?.ratioBps ?? 10) : suggestRatioBps(maxLeaderNotional, toBig(p.markets[0]?.maxNotionalCNS ?? "0") || 1n)),
        maxLeverage: p.maxLeverageHdths / 100,
        maxSlippageBps: p.maxSlippageBps,
        maxNotionalAusd: ausd(p.markets[0]?.maxNotionalCNS ?? "0"),
        markets: [...new Set([...(p.markets.map((m) => byPerp.get(m.perpId)?.symbol).filter(Boolean) as string[]), ...(existing ? [] : l.markets.filter((x) => bySymbol.has(x)))])],
        dailyLossPct: p.dailyLossBps / 100,
        drawdownPct: p.drawdownBps / 100,
        expiryDays: Math.max(1, Math.round((p.expiry * 1000 - Date.now()) / 86400e3)),
        entryFilterPct: (p.maxEntryDeviationBps ?? 0) / 100,
        matchNow: !existing,
      });
      if (!existing) setLeaderLoss(1000);
    } else if (!isEdit) {
      const start = limits.minCNS > 12_000_000n ? limits.minCNS : 12_000_000n;
      const alloc = wallet.cns >= start ? start : wallet.cns >= limits.minCNS ? wallet.cns : limits.minCNS;
      const cap = alloc;
      const allowed = l.markets.filter((s) => bySymbol.has(s));
      setForm({
        ...defaultForm(),
        allocationAusd: ausd(alloc),
        maxNotionalAusd: ausd(cap),
        ratioBps: suggestRatioBps(maxLeaderNotional, cap),
        maxLeverage: Math.min(5, Math.max(2, Math.round(l.avgLeverage))),
        markets: allowed.length ? allowed : ["BTC", "ETH"],
      });
    }
    setInitialised(true);
  }, [l, cfg, existing, wallet.cns, owner.data, owner.isError]);

  const set = <K extends keyof FollowForm>(k: K, v: FollowForm[K]) => setForm((f) => ({ ...f, [k]: v }));
  const splitNow = useMemo(() => splitRows.map((r) => (r.isNew ? { ...r, ratioBps: form.ratioBps, lossStopBps: leaderLoss } : r)), [splitRows, form.ratioBps, leaderLoss]);
  const policy = useMemo(() => {
    if (!cfg || !l) return null;
    const base = buildPolicy(form, leaderId, cfg.markets);
    // Split: account-wide limits and markets from the form, every leader of the account with its budget.
    if (split && target) return buildSplitPolicy(base, splitNow);
    // Editing one leader of several: keep the others (and every budget) as they are.
    if (isEdit && existing?.policy && existing.policy.leaders.length > 1) return { ...base, leaders: signablePolicy(existing.policy).leaders.map((x) => (x.accountId === leaderId ? { ...x, ratioBps: Math.round(form.ratioBps) } : x)) };
    return base;
  }, [form, cfg, l, leaderId, split, target, splitNow, isEdit, existing]);
  const topUpCNS = topUp.trim() ? (parseUnits(topUp, 6) ?? -1n) : 0n;
  const splitDeposit = target ? BigInt(target.netDepositsCNS || "0") + (topUpCNS > 0n ? topUpCNS : 0n) : 0n;
  const splitIssues = split && target ? validateSplit({ depositCNS: BigInt(target.netDepositsCNS || "0"), rows: splitNow, topUpCNS, walletCNS: wallet.cns, capCNS: limits.capCNS, name: names.name }) : [];
  const allocCNS = split ? (splitNow.find((r) => r.isNew)?.budgetCNS ?? 0n) : (parseUnits(form.allocationAusd, 6) ?? 0n);
  /** What the account-wide loss stops are measured on: the whole deposit when several leaders share it. */
  const acctCNS = split ? splitDeposit : allocCNS;
  const walletAvail = wallet.cns;
  const errors = [
    ...(isEdit || split ? formErrors({ ...form, allocationAusd: ausd(limits.minCNS) }, limits.capCNS, limits).filter((e) => e.field !== "allocation") : formErrors(form, walletAvail, limits)),
    ...splitIssues.map((x) => ({ field: `split.${x.field}`, message: x.message })),
  ];
  /** Per-leader what-if: the new leader alone on its budget. */
  const whatIfPolicy = policy && split ? { ...policy, leaders: policy.leaders.filter((x) => x.accountId === leaderId) } : policy;
  const policyErr = policy ? validatePolicy(policy) : "loading";

  // Live quote for "Match the leader now".
  const quoteKey = JSON.stringify({ leaderId, p: policy && { ...policy, expiry: 0 }, a: allocCNS.toString(), t: target?.account ?? null });
  const quote = useQuery({
    queryKey: ["quote", quoteKey],
    enabled: !!me && !!policy && form.matchNow && !isEdit && policyErr === null,
    queryFn: () => api.quoteFollow({ owner: me!.address, leaderAccountId: leaderId, policy: { ...policy!, allocationCNS: allocCNS.toString() } as any, ...(target ? { account: target.account } : {}) }),
    staleTime: 15_000,
    refetchInterval: step === "review" ? 15_000 : false,
  });
  const q: FollowQuote | undefined = form.matchNow ? quote.data : undefined;
  const willCopy = (q?.rows ?? []).filter((r) => !r.wouldBlock);
  const willBlock = (q?.rows ?? []).filter((r) => r.wouldBlock);
  const marginNow = willCopy.reduce((s, r) => s + toBig(r.marginCNS), 0n);

  const largest = useMemo(() => {
    if (!l) return null;
    let best: { sym: string; lots: bigint; notional: bigint; dec: number } | null = null;
    for (const p of l.positions) {
      const mk = byPerp.get(p.perpId);
      if (!mk) continue;
      const n = (toBig(p.lotLNS) * toBig(p.markPNS) * 10n ** 6n) / 10n ** BigInt(mk.lotDecimals + mk.priceDecimals);
      if (!best || n > best.notional) best = { sym: mk.symbol, lots: toBig(p.lotLNS), notional: n, dec: mk.lotDecimals };
    }
    return best;
  }, [l, byPerp]);
  const capCNS = parseUnits(form.maxNotionalAusd, 6) ?? 0n;
  const suggested = largest ? suggestRatioBps(largest.notional, capCNS || 1n) : null;

  const close = () => (router.canGoBack() ? router.back() : router.replace("/home"));

  const approve = async () => {
    if (!cfg || !policy || !me || !owner.data) return;
    setError(null);
    setStep("approving");
    setT0(Date.now());
    const progress = (key: string, state: StepState, info?: Partial<RelayResult>) => {
      setSteps((s) => ({ ...s, [key]: state }));
      if (info) setResults((r) => ({ ...r, [key]: info }));
    };
    try {
      if (isEdit && existing) {
        await executeActions(cfg, [{ account: existing, kind: ACTION.SET_POLICY, data: encodeSetPolicy(policy) }], (k, s, i) => progress(k === "sign" ? "sign" : "policy", s, i));
        setNewAccount(existing.account);
      } else if (split && target) {
        const orders = form.matchNow ? (q?.orders ?? []) : [];
        const r = await addLeader(cfg, { owner: me.address, account: target, policy, orders, topUpCNS: topUpCNS > 0n ? topUpCNS : 0n }, progress);
        setNewAccount(target.account);
        if (r.execute?.status !== "success") throw new Error(r.deposit?.status !== "success" && r.deposit ? "The deposit reverted" : "The relayed policy reverted");
      } else {
        const orders = form.matchNow ? (q?.orders ?? []) : [];
        const r = await followFlow(cfg, { owner: me.address, leaderAccountId: leaderId, policy, allocationCNS: allocCNS, orders, existing: owner.data.accounts }, progress);
        setNewAccount(r.account);
        if (form.note.trim()) {
          const keys = await loadNotifyKey();
          if (keys) await api.putNote({ owner: me.address, account: r.account, note: sealNote(keys, form.note.trim()) }).catch(() => {});
        }
      }
      await qc.invalidateQueries({ queryKey: ["owner"] });
      await qc.invalidateQueries({ queryKey: ["feed"] });
      setStep("done");
    } catch (e) {
      if (e instanceof ApiError && e.code === "relay_unavailable") setError({ title: (e.body as any)?.title ?? "Can't reach Mirror's service", detail: e.message });
      else if (e instanceof ApiError) setError({ title: e.code === "rate_limited" ? "Too many requests" : "The relayer rejected it", detail: `${e.message}${e.revertReason ? ` (${e.revertReason})` : ""}` });
      else {
        const d = describeError(e);
        if (d.cancelled) {
          setStep(isEdit ? "limits" : "review");
          setSteps({});
          return;
        }
        setError(d);
      }
      setStep("error");
    }
  };

  // ---------------------------------------------------------------- header + frame
  const header = (
    <View style={{ gap: 12, paddingBottom: 12 }}>
      <Row gap={12}>
        {step === "review" || step === "whatif" ? <IconButton name="back" onPress={() => setStep(step === "review" && !laptop ? "whatif" : "limits")} testID="follow.back" /> : null}
        <Identicon seed={l?.address ?? String(leaderId)} size={40} />
        <View style={{ flex: 1 }}>
          <Lbl>{isEdit ? "Edit limits" : split ? `Follow a ${["second", "third", "fourth"][Math.min(2, (target?.policy?.leaders.length ?? 1) - 1)]} leader` : step === "review" ? "Review" : (totals?.accounts.length ?? 0) > 0 ? "Follow another leader" : "Follow"}</Lbl>
          <T size={14} w={600} mono>
            {shortAddr(l?.address)}
          </T>
        </View>
        <IconButton name="close" onPress={close} testID="follow.close" />
      </Row>
      {!isEdit && (step === "limits" || step === "whatif" || step === "review") ? (
        <StepTabs testIDPrefix="follow.step" steps={["Set limits", "What if", "Review"]} current={step === "limits" ? (laptop ? 1 : 0) : step === "whatif" ? 1 : 2} />
      ) : null}
    </View>
  );

  const frame = (body: React.ReactNode, cta: React.ReactNode, side?: React.ReactNode) =>
    laptop ? (
      <FollowModal header={header} side={side} footer={cta} onClose={close}>
        {body}
        <BlockedSheet e={blocked} cfg={cfg} account={existing ?? owner.data?.accounts.find((a) => a.account === newAccount)} onClose={() => setBlocked(null)} />
      </FollowModal>
    ) : (
    <View style={{ flex: 1, backgroundColor: c.scrim }}>
      <View style={{ height: insets.top + 24 }} />
      <KeyboardAvoidingView behavior="height" style={{ flex: 1 }}>
        <View testID="follow.sheet" style={{ flex: 1, backgroundColor: c.sf, borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingHorizontal: 20 }}>
          <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: c.mu, opacity: 0.45, alignSelf: "center", marginTop: 10, marginBottom: 6 }} />
          {header}
          <Scroll testID="follow.scroll" contentStyle={{ gap: 0, paddingBottom: 16 }}>
            {body}
          </Scroll>
          <View style={{ paddingTop: 12, paddingBottom: Math.max(insets.bottom, 8) + 4, borderTopWidth: 1, borderTopColor: c.bd, gap: 8 }}>{cta}</View>
        </View>
      </KeyboardAvoidingView>
      <BlockedSheet e={blocked} cfg={cfg} account={existing ?? owner.data?.accounts.find((a) => a.account === newAccount)} onClose={() => setBlocked(null)} />
    </View>
    );

  if (!l || !cfg) {
    return frame(
      <T size={13} color="mu" style={{ padding: 20 }}>
        {leaderQ.isError ? "Can't load this leader. Close and try again." : "Loading the leader's positions"}
      </T>,
      <Button title="Close" kind="out" onPress={close} />,
    );
  }

  // ---------------------------------------------------------------- done / approving / error
  if (step === "approving" || step === "done" || step === "error") {
    const acct = owner.data?.accounts.find((a) => a.account === newAccount);
    const evs = (resultFeed.data?.events ?? []).filter((e) => ((e.kind === "Mirrored" && e.matchNow) || e.kind === "Blocked") && (!split || (Number(e.leaderAccountId) === leaderId && e.timestamp >= t0 - 60_000))).slice(0, 8);
    const splitItems = [
      { key: "sign", title: "Sign with your passkey", sub: `${topUpCNS > 0n ? "Deposit permit + " : ""}Action ${form.matchNow && (q?.orders.length ?? 0) > 0 ? "FOLLOW" : "SET_POLICY"} with all ${policy?.leaders.length ?? 0} leaders, one prompt`, state: steps.sign ?? "now" },
      ...(topUpCNS > 0n ? [{ key: "deposit", title: `Add ${ausd(topUpCNS)} AUSD to the deposit`, sub: results.deposit?.txHash ? <TxLink hash={results.deposit.txHash} onPress={() => openTx(cfg, results.deposit!.txHash!)} /> : "Permit, relayed before the new budgets", state: steps.deposit ?? "pending" }] : []),
      { key: "policy", title: form.matchNow && (q?.orders.length ?? 0) > 0 ? "Split the deposit and match the leader" : "Split the deposit", sub: results.policy?.txHash ? <TxLink hash={results.policy.txHash} onPress={() => openTx(cfg, results.policy!.txHash!)} /> : "Budgets per leader, checked onchain", state: steps.policy ?? "pending" },
    ];
    const items = split ? splitItems : isEdit
      ? [
          { key: "sign", title: "Sign with your passkey", sub: "One EIP-712 Action: SET_POLICY", state: steps.sign ?? "now" },
          { key: "policy", title: "Write new limits onchain", sub: results.policy?.txHash ? <TxLink hash={results.policy.txHash} onPress={() => openTx(cfg, results.policy!.txHash!)} /> : "Gasless: the relayer pays", state: steps["relay:0"] ?? steps.policy ?? "pending" },
        ]
      : [
          { key: "sign", title: "Sign with your passkey", sub: "Deposit permit + Action FOLLOW, one prompt", state: steps.sign ?? "now" },
          { key: "create", title: "Create your account for this follow", sub: results.create?.txHash ? <TxLink hash={results.create.txHash} onPress={() => openTx(cfg, results.create!.txHash!)} /> : "One MirrorAccount per follow", state: steps.create ?? "pending" },
          { key: "deposit", title: `Deposit ${form.allocationAusd} AUSD`, sub: results.deposit?.txHash ? <TxLink hash={results.deposit.txHash} onPress={() => openTx(cfg, results.deposit!.txHash!)} /> : "Opens your Perpl account", state: steps.deposit ?? "pending" },
          { key: "follow", title: form.matchNow && (q?.orders.length ?? 0) > 0 ? "Set limits and match the leader" : "Set limits", sub: results.follow?.txHash ? <TxLink hash={results.follow.txHash} onPress={() => openTx(cfg, results.follow!.txHash!)} /> : "Policy + match orders, checked onchain", state: steps.follow ?? "pending" },
        ];
    const copiedN = evs.filter((e) => e.kind === "Mirrored").length;
    const blockedN = evs.filter((e) => e.kind === "Blocked").length;
    const statusText = step === "done" ? (isEdit ? "Saved" : copiedN > 0 ? "Matched" : "Following") : step === "error" ? "Failed" : "Approving";
    return frame(
      <View style={{ gap: 16, paddingTop: 4 }}>
        <View style={{ alignItems: "center", gap: 6, paddingVertical: 8 }}>
          <View style={{ width: 56, height: 56, borderRadius: 999, alignItems: "center", justifyContent: "center", backgroundColor: step === "done" ? c.posS : step === "error" ? c.negS : c.acs }}>
            <Icon name={step === "done" ? "check" : step === "error" ? "warn" : "fp"} size={26} color={step === "done" ? c.posI : step === "error" ? c.neg : c.ac} />
          </View>
          <T testID="follow.status" size={22} w={700}>
            {statusText}
          </T>
          <T size={13} color="mu" center>
            {step === "done"
              ? isEdit
                ? "Your new limits apply to the next copied order."
                : `Following ${shortAddr(l.address)}${copiedN ? ` · ${copiedN} order${copiedN > 1 ? "s" : ""} matched` : ""}${blockedN ? ` · ${blockedN} blocked by your rules` : ""}`
              : step === "error"
                ? "Nothing moved unless a step below shows a transaction."
                : "Confirm with your fingerprint or screen lock."}
          </T>
        </View>
        <Checklist items={items as any} />
        {error ? (
          <Note tone="neg" icon="warn" testID="follow.error">
            <T size={13} w={600}>
              {error.title}
            </T>
            <T size={12} color="mu">
              {error.detail}
            </T>
          </Note>
        ) : null}
        {step === "done" && evs.length ? (
          <View style={{ gap: 10 }}>
            <Lbl>Match orders</Lbl>
            {evs.map((e, i) => (
              <FeedItem key={e.id} e={e} cfg={cfg} onBlockedPress={setBlocked} testID={`follow.result.${i}`} />
            ))}
          </View>
        ) : null}
        {step === "done" && !isEdit && me ? <AlertsCard owner={me.address} /> : null}
        {step === "done" && results.follow?.latencyMs ? <LatencyPill ms={Date.now() - t0 > 0 ? results.follow.latencyMs : undefined} label="Landed in" /> : null}
        {acct ? null : null}
      </View>,
      step === "done" ? (
        <Row gap={10}>
          <Button title="View feed" kind="out" flex onPress={() => router.replace("/feed")} testID="follow.viewFeed" />
          <Button title="Done" flex onPress={() => router.replace("/home")} testID="follow.done" />
        </Row>
      ) : step === "error" ? (
        <Row gap={10}>
          <Button title="Close" kind="out" flex onPress={close} />
          <Button title="Try again" icon="fp" flex onPress={approve} testID="follow.retry" />
        </Row>
      ) : (
        <Button title="Waiting for your passkey" disabled />
      ),
    );
  }

  // ---------------------------------------------------------------- what if (phone; on a laptop it sits next to the limits)
  if (step === "whatif" && policy) {
    return frame(
      <View style={{ paddingTop: 4 }}>
        <WhatIfBody leaderId={leaderId} policy={whatIfPolicy ?? policy} depositCNS={allocCNS} onEdit={() => setStep("limits")} />
      </View>,
      <Row gap={10}>
        <Button title="Change limits" kind="out" flex onPress={() => setStep("limits")} testID="follow.whatif.back" />
        <Button title="Review follow" flex onPress={() => setStep("review")} testID="follow.review" />
      </Row>,
    );
  }

  // ---------------------------------------------------------------- review
  if (step === "review" && policy) {
    return frame(
      <View style={{ gap: 14 }}>
        <View>
          {split && target ? (
            <>
              <KV k="Account" v={`Your account ${shortAddr(target.account)}`} testID="follow.review.account" />
              <KV k="Budget for this leader" v={`${ausd(allocCNS)} AUSD`} testID="follow.review.budget" />
              <KV k="Deposit split" v={splitNow.map((r) => `${names.name(r.accountId).slice(0, 6)} ${ausd(r.budgetCNS)}`).join(" · ")} testID="follow.review.split" />
              <KV k="Add to the deposit" v={topUpCNS > 0n ? `${ausd(topUpCNS)} AUSD (permit)` : "None"} testID="follow.review.topUp" />
              <KV k="Loss stop for this leader" v={leaderLoss ? `${leaderLoss / 100}% · stops at ${ausd(allocCNS - (allocCNS * BigInt(leaderLoss)) / 10000n)}` : "Off"} testID="follow.review.leaderLoss" />
            </>
          ) : (
            <KV k="Allocation" v={`${form.allocationAusd} AUSD`} />
          )}
          <KV k="Sizing" v={`${bps(form.ratioBps)} of leader size`} />
          <KV k="Max leverage" v={`${form.maxLeverage}x`} />
          <KV k="Max slippage" v={bps(form.maxSlippageBps)} testID="follow.review.slippage" />
          <KV k="Max notional per market" v={`${form.maxNotionalAusd} AUSD`} />
          <KV k="Entry filter" v={form.entryFilterPct ? `within ${form.entryFilterPct}% of the leader's entry` : "Off"} testID="follow.review.entryFilter" />
          <KV k="Allowed markets" v={form.markets.join(", ")} />
          <KV k="Daily loss stop" v={form.dailyLossPct ? `${form.dailyLossPct}% · ${ausd((acctCNS * BigInt(Math.round(form.dailyLossPct * 100))) / 10000n)} AUSD` : "Off"} />
          <KV k="Account loss stop" v={form.drawdownPct ? `${form.drawdownPct}% · at ${ausd((acctCNS * BigInt(10000 - Math.round(form.drawdownPct * 100))) / 10000n)} AUSD` : "Off"} />
          <KV k="Who can execute stops" v={form.flattenOnStop ? "Anyone" : "Mirror's keeper only"} testID="follow.review.flattenOnStop" />
          <KV k="Expiry" v={dateLong(policy.expiry * 1000)} />
          <KV k="Match the leader now" v={form.matchNow ? `${willCopy.length} order${willCopy.length === 1 ? "" : "s"}${willBlock.length ? ` · ${willBlock.length} blocked` : ""}` : "Off"} last />
        </View>
        {form.matchNow && q?.rows.length ? <QuoteTable rows={q.rows} cfg={cfg} /> : null}
        <FeeNote rows={form.matchNow ? (q?.rows ?? []) : []} capCNS={capCNS} />
        <Note tone="ac" icon="shield">
          <T size={13} lh={19}>
            These limits are written to your own MirrorAccount and checked onchain on every copied order. Mirror can trade within them but can never withdraw. Daily loss and drawdown stops pause new exposure; existing positions still follow the leader's closes.
          </T>
        </Note>
        <Row>
          <T size={12} color="mu" style={{ flex: 1 }}>
            You sign
          </T>
          <T size={12} color="mu">
            {split ? `1 passkey prompt · ${topUpCNS > 0n ? "permit + " : ""}Action ${form.matchNow && (q?.orders.length ?? 0) > 0 ? "FOLLOW" : "SET_POLICY"}` : "1 passkey prompt · permit + Action FOLLOW"}
          </T>
        </Row>
        <Row>
          <T size={12} color="mu" style={{ flex: 1 }}>
            Network fee
          </T>
          <T size={12} color="mu">
            <T size={12} w={600} color="posI">
              Free
            </T>{" "}
            · sponsored, no MON needed
          </T>
        </Row>
      </View>,
      <View style={{ gap: 8 }}>
        <RelayNote gate={gate} testID="follow.notLive" />
        <Button title="Approve with passkey" icon="fp" onPress={approve} testID="follow.confirm" disabled={(form.matchNow && quote.isFetching && !q) || relayBlocked(gate)} />
      </View>,
    );
  }

  // ---------------------------------------------------------------- limits
  const levIdx = Math.max(0, LEV_STEPS.indexOf(Math.round(form.maxLeverage)));
  const ratioSteps = ratioPresets();
  const ratioIdx = ratioSteps.reduce((bi, v, i) => (Math.abs(v - form.ratioBps) < Math.abs(ratioSteps[bi] - form.ratioBps) ? i : bi), 0);
  const nearest = (arr: number[], v: number) => arr.reduce((bi, x, i) => (Math.abs(x - v) < Math.abs(arr[bi] - v) ? i : bi), 0);
  const btcMax = bySymbol.get("BTC")?.maxLeverage ?? 15;
  const leaderOver = l.avgLeverage > form.maxLeverage;
  const errFor = (f: string) => errors.find((e) => e.field === f)?.message;
  const youLots = largest ? (largest.lots * BigInt(form.ratioBps) + 9999n) / 10000n : 0n;
  const youNotional = largest && largest.lots > 0n ? (largest.notional * youLots) / largest.lots : 0n;

  return frame(
    <View>
      {!isEdit && targets.length ? <ModeChoice mode={mode} onMode={setModeSel} targets={targets} target={target} onTarget={(a) => setTargetSel(a.account)} name={names.name} /> : null}
      {split && target ? (
        <>
          <Section title="Split your deposit" icon="split" sub="One deposit, one account. Each leader trades only with its own budget." testID="follow.section.split">
            <SplitSection target={target} rows={splitNow} onRows={(r) => setSplitRows(r)} topUp={topUp} onTopUp={setTopUp} walletCNS={walletAvail} capCNS={limits.capCNS} issues={splitIssues} name={names.name} address={names.address} leaderId={leaderId} leaderMarkets={[...new Set([...l.positions.map((p) => p.perpId), ...[...l.markets, ...form.markets].map((m) => bySymbol.get(m)?.perpId ?? -1)])]} byPerp={byPerp} />
          </Section>
          <Section title="Loss stop for this leader" icon="shield" sub="Stops this leader only. The other leaders keep copying." testID="follow.section.leaderLoss">
            <LeaderLossSection bpsValue={leaderLoss} onChange={setLeaderLoss} budgetCNS={allocCNS} flatten={form.flattenOnStop} />
          </Section>
          <Hint>
            <T size={12} color="mu" lh={17} testID="follow.split.shared">
              Leverage, slippage, entry filter, markets, account loss stops and expiry below apply to every leader in this account.
            </T>
          </Hint>
        </>
      ) : !isEdit ? (
        <Section title="Allocation" icon="wallet" sub={`Deposited into a new account just for this follow. In your wallet: ${ausd(walletAvail)} AUSD.`} testID="follow.section.allocation">
          <Field big error={!!errFor("allocation")}>
            <NumInput testID="follow.amount.input" value={form.allocationAusd} onChangeText={(t) => set("allocationAusd", t)} size={24} />
            <T size={13} w={500} color="mu">
              AUSD
            </T>
          </Field>
          <Row gap={8} style={{ flexWrap: "wrap" }}>
            {[10, 15, 20].map((v) => (
              <Chip key={v} label={String(v)} on={allocCNS === BigInt(v * 1e6)} onPress={() => set("allocationAusd", v.toFixed(2))} testID={`follow.amount.${v}`} />
            ))}
            <Chip
              label={`Max ${ausd(walletAvail < limits.capCNS ? walletAvail : limits.capCNS)}`}
              on={allocCNS === (walletAvail < limits.capCNS ? walletAvail : limits.capCNS)}
              onPress={() => set("allocationAusd", ausd(walletAvail < limits.capCNS ? walletAvail : limits.capCNS))}
              testID="follow.amount.max"
            />
          </Row>
          {errFor("allocation") ? <Hint warn>{errFor("allocation")!}</Hint> : <Hint>Perpl needs at least 10 AUSD to open the trading account. Beta limit: 25 AUSD per follow.</Hint>}
          {errFor("allocation") === "More than your wallet balance" ? <Button title="Add funds" kind="ton" size="md" icon="arrdown" onPress={() => router.push("/funds")} /> : null}
        </Section>
      ) : null}

      <Section title="Sizing" icon="layers" sub="Each copy is a share of the leader's order size" testID="follow.section.sizing">
        <View style={{ alignSelf: "flex-start", paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, backgroundColor: c.acs }}>
          <T size={13} w={600} color="ac">
            % of leader size
          </T>
        </View>
        <BigV v={bps(form.ratioBps)} right="of the leader's size" testID="follow.ratio.value" />
        <Slider
          testID="follow.ratio.slider"
          steps={ratioSteps.length}
          index={ratioIdx}
          onChange={(i) => set("ratioBps", ratioSteps[i])}
          ticks={[
            { label: "0.01%", at: 0 },
            { label: "0.1%", at: 3 / (ratioSteps.length - 1) },
            { label: "1%", at: 6 / (ratioSteps.length - 1) },
            { label: "10%", at: 1 },
          ]}
        />
        {largest ? (
          <Hint>
            {`Leader holds ${fmtLots(largest.lots, largest.dec)} ${largest.sym}. At ${bps(form.ratioBps)} you'd hold ${fmtLots(youLots, largest.dec)} ${largest.sym}: ${ausd(youNotional)} AUSD notional${youNotional > capCNS ? `, over your ${form.maxNotionalAusd} AUSD cap, so it would be blocked` : `, under your ${form.maxNotionalAusd} AUSD cap`}.`}
          </Hint>
        ) : null}
        {suggested && suggested !== form.ratioBps ? (
          <Chip label={`Use ${bps(suggested)}: fits your per-market cap`} icon="check" onPress={() => set("ratioBps", suggested)} testID="follow.ratio.suggest" />
        ) : null}
      </Section>

      <Section title="Max leverage" icon="tune" sub="Orders above this are blocked onchain" testID="follow.section.leverage">
        <BigV v={`${form.maxLeverage}x`} right={`Leader avg ${l.avgLeverage.toFixed(1)}x · peak ${l.stats.peakLeverage}x`} testID="follow.leverage.value" />
        <Slider
          testID="follow.leverage.slider"
          steps={LEV_STEPS.length}
          index={levIdx}
          onChange={(i) => set("maxLeverage", LEV_STEPS[i])}
          ticks={[
            { label: "1x", at: 0 },
            { label: "5x", at: 4 / 14 },
            { label: "10x", at: 9 / 14 },
            { label: "15x", at: 1 },
          ]}
        />
        {leaderOver ? <Hint warn>{`This leader often trades above ${form.maxLeverage}x. Expect some trades to be blocked.`}</Hint> : <Hint>{`Perpl allows up to ${btcMax}x on BTC; smaller markets allow less.`}</Hint>}
      </Section>

      <Section title="Max slippage" icon="shield" sub="Copies fill no worse than mark plus or minus this, or not at all" testID="follow.section.slippage">
        <BigV v={bps(form.maxSlippageBps)} right={`${form.maxSlippageBps} bps · range 1 to 1000`} testID="follow.slippage.value" />
        <Row gap={8} style={{ flexWrap: "wrap" }}>
          {SLIPPAGE_PRESETS.map((b) => (
            <Chip key={b} label={bps(b)} on={form.maxSlippageBps === b} onPress={() => set("maxSlippageBps", b)} testID={`follow.slippage.${b}`} />
          ))}
        </Row>
        <Field error={!!errFor("slippage")}>
          <NumInput testID="follow.slippage.input" value={String(form.maxSlippageBps)} keyboardType="number-pad" onChangeText={(t) => set("maxSlippageBps", Math.max(0, Math.min(1000, Number(t.replace(/\D/g, "")) || 0)))} />
          <T size={13} color="mu" style={{ flex: 1 }}>
            bps
          </T>
          <T size={12} color="mu">
            maxSlippageBps
          </T>
        </Field>
      </Section>

      <Section title="Entry filter" icon="shield" sub="Only copy an opening order when the price is within this much of the leader's onchain entry. Checked by your contract." testID="follow.section.entryFilter">
        <BigV v={form.entryFilterPct ? `${form.entryFilterPct}%` : "Off"} right={form.entryFilterPct ? `${Math.round(form.entryFilterPct * 100)} bps · maxEntryDeviationBps` : "copies at any distance from the entry"} testID="follow.entryFilter.value" />
        <Row gap={8} style={{ flexWrap: "wrap" }}>
          {ENTRY_FILTER_PRESETS.map((v) => (
            <Chip key={v} label={v ? `${v}%` : "Off"} on={form.entryFilterPct === v} onPress={() => set("entryFilterPct", v)} testID={`follow.entryFilter.${v}`} />
          ))}
        </Row>
      </Section>

      <Section title="Max notional per market" icon="layers" sub="Largest position you can hold in any one market" testID="follow.section.notional">
        <Field error={!!errFor("notional")}>
          <NumInput testID="rules.maxTradeSize.input" value={form.maxNotionalAusd} onChangeText={(t) => set("maxNotionalAusd", t)} />
          <T size={13} w={500} color="mu">
            AUSD
          </T>
          <T size={12} color="mu" style={{ flex: 1, textAlign: "right" }}>
            per market
          </T>
        </Field>
      </Section>

      <Section title="Allowed markets" icon="globe" sub="Copies in other markets are blocked. Dot = leader traded it in the last 30 days" testID="follow.section.markets">
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {ALL_MARKETS.filter((m) => bySymbol.has(m)).map((m) => {
            const on = form.markets.includes(m);
            return (
              <Chip
                key={m}
                label={m}
                mono
                height={32}
                on={on}
                icon={on ? "check" : undefined}
                dot={l.markets.includes(m)}
                onPress={() => set("markets", on ? form.markets.filter((x) => x !== m) : [...form.markets, m])}
                testID={`follow.market.${m}`}
              />
            );
          })}
        </View>
        {errFor("markets") ? <Hint warn>{errFor("markets")!}</Hint> : null}
      </Section>

      <Section title="Daily loss stop" icon="pause" sub="If losses today reach this, new exposure stops until 00:00 UTC. Open positions still follow the leader's closes." testID="follow.section.dailyLoss">
        <BigV v={form.dailyLossPct ? `${form.dailyLossPct}%` : "Off"} right={form.dailyLossPct ? `= ${ausd((acctCNS * BigInt(form.dailyLossPct * 100)) / 10000n)} AUSD of ${ausd(acctCNS)}` : undefined} testID="follow.dailyLoss.value" />
        <Slider testID="follow.dailyLoss.slider" steps={LOSS_STEPS.length} index={nearest(LOSS_STEPS, form.dailyLossPct)} onChange={(i) => set("dailyLossPct", LOSS_STEPS[i])} ticks={[{ label: "Off", at: 0 }, { label: "10%", at: 4 / 11 }, { label: "25%", at: 8 / 11 }, { label: "50%", at: 1 }]} />
      </Section>

      <Section title="Account loss stop" icon="shield" sub="If this follow falls this far below its peak, new exposure stops. On by default at 20%." testID="follow.section.drawdown">
        <BigV v={form.drawdownPct ? `${form.drawdownPct}%` : "Off"} right={form.drawdownPct ? `peak ${ausd(acctCNS)} → stops at ${ausd((acctCNS * BigInt(10000 - form.drawdownPct * 100)) / 10000n)}` : undefined} testID="follow.drawdown.value" />
        <Slider testID="follow.drawdown.slider" steps={LOSS_STEPS.length} index={nearest(LOSS_STEPS, form.drawdownPct)} onChange={(i) => set("drawdownPct", LOSS_STEPS[i])} ticks={[{ label: "Off", at: 0 }, { label: "15%", at: 6 / 11 }, { label: "25%", at: 8 / 11 }, { label: "50%", at: 1 }]} />
        <View style={{ gap: 6, padding: 12, borderRadius: 12, backgroundColor: c.sf2 }}>
          <Row>
            <T size={13} w={600} style={{ flex: 1 }}>
              Loss stops can be executed by anyone
            </T>
            <Switch on={form.flattenOnStop} onChange={(v) => set("flattenOnStop", v)} testID="follow.flattenOnStop.toggle" />
          </Row>
          <T size={12} color="mu" lh={17}>
            When a loss stop is hit, anyone can trigger it onchain to close your positions (reduce-only, the caller is paid nothing), so it works even if Mirror is down.
          </T>
        </View>
        <Hint>
          <T size={12} color="mu" lh={17} testID="follow.levels.hint">
            Stop-loss and take-profit are set on each position once it is open (Positions, Edit levels). They are always executable by anyone when hit.
          </T>
        </Hint>
      </Section>

      <Section title="Expiry" icon="cal" sub="After this date the follow stops opening positions" testID="follow.section.expiry">
        <Row gap={8} style={{ flexWrap: "wrap" }}>
          {EXPIRY_PRESETS.map((d) => (
            <Chip key={d} label={`${d} days`} on={form.expiryDays === d} onPress={() => set("expiryDays", d)} testID={`follow.expiry.${d}`} />
          ))}
          <Chip label="180 days" icon="cal" on={form.expiryDays === 180} onPress={() => set("expiryDays", 180)} testID="follow.expiry.180" />
        </Row>
        <Field>
          <T size={13}>Ends {dateLong(Date.now() + form.expiryDays * 86400e3)}</T>
          <T size={12} color="mu" style={{ flex: 1, textAlign: "right" }}>
            closes still follow
          </T>
        </Field>
      </Section>

      {!isEdit ? (
        <Section title="Match the leader now" icon="feed" sub="Open your share of the leader's current positions in the same approval, so you don't wait for their next trade." testID="follow.section.matchNow">
          <Row>
            <T size={13} style={{ flex: 1 }}>
              {form.matchNow ? "On: orders land on Perpl right after approval" : "Off: copy only the leader's next trades"}
            </T>
            <Switch on={form.matchNow} onChange={(v) => set("matchNow", v)} testID="follow.matchNow.toggle" />
          </Row>
          {form.matchNow ? (
            quote.isError ? (
              <Hint warn>Couldn't get a quote from the Perpl book. You can turn this off and still follow.</Hint>
            ) : !q ? (
              <Hint>{policyErr ? "Fix the limits above to see the quote." : "Quoting from the Perpl order book"}</Hint>
            ) : q.rows.length === 0 ? (
              <Hint>The leader has no open positions in your allowed markets right now.</Hint>
            ) : (
              <>
                <QuoteTable rows={q.rows} cfg={cfg} />
                <T size={12} color="mu" testID="follow.matchNow.summary">
                  {willCopy.length} order{willCopy.length === 1 ? "" : "s"} · margin {ausd(marginNow)} of {ausd(allocCNS)} AUSD
                  {willBlock.length ? ` · ${willBlock.length} blocked by your rules` : ""}
                </T>
              </>
            )
          ) : null}
        </Section>
      ) : null}

      {!isEdit ? (
        <Section title="Private note" icon="lock" sub="Only you can read it. Encrypted on this phone with your passkey-derived notification key before it's stored." testID="follow.section.note">
          <TextInput
            testID="follow.note.input"
            value={form.note}
            onChangeText={(t) => set("note", t)}
            placeholder="Why you're following this trader"
            placeholderTextColor={c.mu}
            multiline
            style={{ minHeight: 60, borderWidth: 1, borderColor: c.bd, borderRadius: 12, padding: 12, fontFamily: fonts.ui, fontSize: 14, color: c.tx, textAlignVertical: "top" }}
          />
        </Section>
      ) : null}
    </View>,
    isEdit ? (
      <View style={{ gap: 8 }}>
        <RelayNote gate={gate} testID="rules.notLive" />
        <Button title="Save with passkey" icon="fp" onPress={approve} disabled={errors.length > 0 || !!policyErr || relayBlocked(gate)} testID="rules.save" />
      </View>
    ) : (
      laptop ? (
        <Button title="Review follow" onPress={() => setStep("review")} disabled={errors.length > 0 || !!policyErr} testID="follow.review" />
      ) : (
        <Button title="See what if" onPress={() => setStep("whatif")} disabled={errors.length > 0 || !!policyErr} testID="follow.seeWhatIf" />
      )
    ),
    !isEdit && policy && !policyErr ? <WhatIfBody leaderId={leaderId} policy={whatIfPolicy ?? policy} depositCNS={allocCNS} title={`What if I had followed ${shortAddr(l.address)}`} compact /> : undefined,
  );
}

/** Builder fee, stated before the passkey prompt. */
function FeeNote({ rows, capCNS }: { rows: QuoteRow[]; capCNS: bigint }) {
  const planned = plannedFeeCNS(rows);
  const amount = rows.length ? `about ${feeText(planned)} AUSD for this follow's planned size` : `up to ${feeText(feeFor(capCNS))} AUSD per copy at your max notional`;
  return (
    <Note icon="info" testID="follow.review.fee">
      <T size={13} lh={19}>
        {`Mirror fee: ${FEE_PCT} of opening size (builder ${BUILDER_ID}), ${amount}; never on closes; your contract caps it at ${FEE_PCT}.`}
      </T>
    </Note>
  );
}

function QuoteTable({ rows, cfg }: { rows: QuoteRow[]; cfg: NonNullable<ReturnType<typeof useConfig>["data"]> }) {
  const c = useColors();
  return (
    <Card list testID="follow.quote">
      {rows.map((r, i) => {
        const m = cfg.markets.find((x) => x.perpId === r.perpId);
        const pd = m?.priceDecimals ?? 2;
        return (
          <View key={r.perpId} testID={`follow.quote.row.${i}`} style={{ paddingVertical: 10, paddingHorizontal: 12, gap: 6, opacity: r.wouldBlock ? 0.9 : 1 }}>
            <Row gap={6}>
              <T size={14} w={600}>
                {m?.symbol}
              </T>
              <Side side={r.orderType === 0 ? "long" : "short"} />
              <T size={12} mono color="mu">
                {leverage(r.leverageHdths)}
              </T>
              <View style={{ flex: 1 }} />
              {r.wouldBlock ? <ChipS label="Blocked" tone="neg" icon="ban" /> : <ChipS label="Will copy" tone="ok" icon="check" />}
            </Row>
            <View style={{ flexDirection: "row", flexWrap: "wrap", rowGap: 4 }}>
              {[
                ["Size", r.sizeDisplay],
                ["Exp. fill", fmtPrice(r.expectedFillPNS, pd)],
                ["Worst price", fmtPrice(r.pricePNS, pd)],
                ["Notional", `${ausd(r.notionalCNS)}`],
                ["Margin", `${ausd(r.marginCNS)}`],
                ["Leverage", leverage(r.leverageHdths)],
              ].map(([k, v]) => (
                <View key={k} style={{ width: "33.33%" }}>
                  <T size={11} color="mu">
                    {k}
                  </T>
                  <T size={12} mono lines={1}>
                    {v}
                  </T>
                </View>
              ))}
            </View>
            {r.wouldBlock ? (
              <Row gap={6}>
                <Icon name="ban" size={14} color={c.neg} />
                <T size={12} color={c.neg} style={{ flex: 1 }}>
                  {r.wouldBlock.rule ?? r.wouldBlock.reason}
                </T>
              </Row>
            ) : null}
          </View>
        );
      })}
    </Card>
  );
}
