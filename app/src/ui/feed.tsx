// Feed items and the "Blocked by your rule" explanation sheet.
import * as Linking from "expo-linking";
import { router } from "expo-router";
import React from "react";
import { View } from "react-native";
import { txUrl } from "../lib/chain";
import { BLOCK_REASONS } from "../lib/contracts";
import { notionalCNS } from "../lib/format";
import { ago, ausd, ausdSigned, bps, dateLong, leverage, lots as fmtLots, orderAction, orderSide, price as fmtPrice, shortAddr, toBig } from "../lib/format";
import type { AppConfig, FeedEvent, MarketConfig, MirrorAccount } from "../lib/types";
import { Icon } from "./icons";
import { Button, Card, ChipS, CommitTrack, IconButton, Identicon, KV, LatencyPill, Lbl, MarketBadge, Press, Row, Sheet, Side, T, TxLink } from "./kit";
import { ShareSheet } from "./shareSheet";
import { SmallChip, TeamBadge } from "./kit2";
import { EngineItem } from "./feedEngine";
import { StopItem } from "./stopFeed";
import { bpsText, fillDeviationBps } from "../lib/proof";
import { copyFeeCNS, feeText } from "../lib/fees";
import { isEngineKind, RULE_NAMES as RULES } from "../lib/blockReasons";
import { useColors } from "./theme";
import { leaderAddressOf } from "../lib/engineShape";

export function openTx(cfg: AppConfig | undefined, hash: string | null | undefined) {
  if (hash) void Linking.openURL(txUrl(cfg, hash));
}

/** "0x7a3f…c91e", or "Perpl #9001" for the team-run demo leader. */
export function leaderName(e: FeedEvent): string {
  if (e.teamRun && e.leaderAccountId) return `Perpl #${e.leaderAccountId}`;
  return e.leaderAddress ? shortAddr(e.leaderAddress) : e.leaderAccountId ? `Perpl #${e.leaderAccountId}` : "";
}

function mkt(cfg: AppConfig | undefined, perpId?: number): MarketConfig | undefined {
  return cfg?.markets.find((m) => m.perpId === perpId);
}

export function sizeText(cfg: AppConfig | undefined, perpId: number | undefined, lotLNS: string | undefined) {
  const m = mkt(cfg, perpId);
  if (!m || lotLNS === undefined) return "";
  return `${fmtLots(lotLNS, m.lotDecimals)} ${m.symbol}`;
}
export function priceText(cfg: AppConfig | undefined, perpId: number | undefined, pricePNS: string | undefined) {
  const m = mkt(cfg, perpId);
  if (!m || pricePNS === undefined) return "";
  return fmtPrice(pricePNS, m.priceDecimals);
}

// ---------------------------------------------------------------- block explanations
const RULE_NAMES: Record<string, string> = Object.fromEntries(Object.entries(RULES).map(([k, v]) => [k, v.toLowerCase().replace(/^max /, "max ")]));

/** Order of checks in MirrorAccount._checkOpen, grouped into the chips shown to the user. */
const CHECK_GROUPS: { label: string; reasons: string[] }[] = [
  // Checked first, for opens and closes alike: ACTION_SET_LEADER_DETACHED ("stop following, keep my positions").
  { label: "Following", reasons: ["LeaderDetached"] },
  { label: "Active", reasons: ["Paused", "Expired"] },
  { label: "Market", reasons: ["MarketNotAllowed", "LeaderNotAllowed"] },
  { label: "Leverage", reasons: ["LeverageTooLow", "LeverageTooHigh", "FlipNotAllowed", "StaleMark"] },
  { label: "Slippage", reasons: ["SlippageTooHigh", "LeaderSideMismatch", "ExceedsLeaderTarget"] },
  { label: "Notional", reasons: ["ExceedsMaxNotional"] },
  { label: "Entry", reasons: ["EntryTooFar"] },
  { label: "Market owner", reasons: ["MarketHeldByOtherLeader", "MarketHalted"] },
  { label: "Budget", reasons: ["LeaderBudgetExceeded"] },
  { label: "Loss stops", reasons: ["DailyLossStop", "DrawdownStop", "LeaderLossStop"] },
];

export function explainBlock(cfg: AppConfig | undefined, e: FeedEvent, acct?: MirrorAccount) {
  const b = e.blocked!;
  const m = mkt(cfg, e.perpId);
  const sym = m?.symbol ?? "";
  const side = orderSide(e.orderType ?? 0).toLowerCase();
  const lev = e.leaderLeverageHdths ?? e.leverageHdths ?? 0;
  const limit = toBig(b.limit);
  const actual = toBig(b.actual);
  let sentence = "";
  let compare: { leader: string; limit: string; frac: number } | null = null;
  switch (b.reason) {
    case "LeverageTooHigh":
      sentence = `Leader opened ${leverage(Number(actual))} ${sym} ${side}. Your max leverage is ${leverage(Number(limit))}. Not copied.`;
      compare = { leader: leverage(Number(actual)), limit: leverage(Number(limit)), frac: Number(limit) / Math.max(1, Number(actual)) };
      break;
    case "MarketNotAllowed":
      sentence = `Leader opened ${sym} ${side}. ${sym} is not in your allowed markets. Not copied.`;
      break;
    case "ExceedsMaxNotional":
      sentence = `Your copy would be ${ausd(actual)} AUSD in ${sym}. Your max per market is ${ausd(limit)} AUSD. Not copied.`;
      compare = { leader: ausd(actual), limit: ausd(limit), frac: Number(limit) / Math.max(1, Number(actual)) };
      break;
    case "SlippageTooHigh":
      sentence = `The price moved past your ${acct?.policy ? bps(acct.policy.maxSlippageBps) : ""} slippage bound (${m ? fmtPrice(limit, m.priceDecimals) : b.limit}). Not copied.`;
      break;
    case "DailyLossStop":
      sentence = `Daily loss stop reached: equity ${ausd(actual)} is under today's floor of ${ausd(limit)} AUSD. New exposure is paused until 00:00 UTC. Open positions still follow the leader's closes.`;
      break;
    case "DrawdownStop":
      sentence = `Drawdown stop reached: equity ${ausd(actual)} is under ${ausd(limit)} AUSD (your stop below the peak). New exposure is paused. Existing positions still follow the leader's closes.`;
      break;
    case "Paused":
      sentence = "Following is paused, so new leader trades are not copied. Closes still follow.";
      break;
    case "Expired":
      sentence = `This follow ended on ${dateLong(Number(limit) * 1000)}. It only reduces exposure now.`;
      break;
    case "LeverageTooLow":
      sentence = "The order's leverage was below 1x, which the contract never allows.";
      break;
    case "ExceedsLeaderTarget":
      sentence = "The copy would have been larger than your share of the leader's position. Not copied.";
      break;
    case "LeaderSideMismatch":
      sentence = "The leader no longer held that position when the copy arrived. Not copied.";
      break;
    case "StaleMark":
      sentence = "Perpl's mark price was stale, so the contract refused to trade. Not copied.";
      break;
    case "FlipNotAllowed":
      sentence = "The copy would have flipped your position to the other side. Not copied.";
      break;
    case "EntryTooFar": {
      const entry = toBig((e.data?.leaderEntryPNS as string | undefined) ?? "0");
      const pct = entry > 0n ? (Math.abs(Number(actual - entry)) / Number(entry)) * 100 : 0;
      const lim = entry > 0n ? (Math.abs(Number(limit - entry)) / Number(entry)) * 100 : 0;
      sentence = entry > 0n ? `Price moved ${pct.toFixed(1)}% past the leader's entry; your limit is ${lim.toFixed(lim < 1 ? 2 : 1).replace(/\.?0+$/, "")}%. Not copied.` : "The price was too far from the leader's entry for your entry filter. Not copied.";
      if (entry > 0n && m) compare = { leader: fmtPrice(actual, m.priceDecimals), limit: fmtPrice(limit, m.priceDecimals), frac: lim / Math.max(pct, 0.0001) };
      break;
    }
    case "LeaderBudgetExceeded":
      sentence = `This copy would bring ${leaderName(e) || "this leader"}'s margin to ${ausd(actual)} AUSD. Its budget is ${ausd(limit)} AUSD. Not copied; your other leaders' budgets are untouched.`;
      compare = { leader: ausd(actual), limit: ausd(limit), frac: Number(limit) / Math.max(1, Number(actual)) };
      break;
    case "LeaderLossStop":
      sentence = limit > 0n
        ? `${leaderName(e) || "This leader"} lost ${ausd(actual)} AUSD, past its loss stop of ${ausd(limit)}. Its new trades are no longer copied until you re-arm it. Your other leaders keep running.`
        : `${leaderName(e) || "This leader"}'s loss stop has fired, so its new trades are no longer copied until you re-arm it. Your other leaders keep running.`;
      if (limit > 0n) compare = { leader: ausd(actual), limit: ausd(limit), frac: Number(limit) / Math.max(1, Number(actual)) };
      break;
    case "MarketHeldByOtherLeader": {
      const holder = heldByName(actual);
      sentence = `${sym} is held by ${holder}, the leader whose copy opened it. A market belongs to one leader at a time, so ${leaderName(e) || "this leader"}'s ${sym} trades are blocked until that position closes.`;
      break;
    }
    case "LeaderDetached":
      sentence = `You stopped following ${leaderName(e) || "this leader"}. Your contract refuses every copy from this leader, opens and closes. Your positions stay open; close them yourself or with your stop-loss / take-profit.`;
      break;
    case "MarketHalted":
      sentence = `A stop-loss or take-profit closed your ${sym} position and paused new copies in ${sym} until you set your limits again.`;
      break;
    default:
      sentence = b.rule ?? "A rule in your account blocked this copy.";
  }
  const failIdx = CHECK_GROUPS.findIndex((g) => g.reasons.includes(b.reason));
  const chips = CHECK_GROUPS.map((g, i) => ({ label: g.label, state: i < failIdx ? "ok" : i === failIdx ? "fail" : "skip" })) as { label: string; state: "ok" | "fail" | "skip" }[];
  const name = RULE_NAMES[b.reason] ?? "account";
  const title =
    b.reason === "MarketHeldByOtherLeader" ? `Blocked: market held by ${heldByName(actual)}`
    : b.reason === "LeaderBudgetExceeded" ? "Blocked by this leader's budget"
    : b.reason === "LeaderLossStop" ? "Blocked by this leader's loss stop"
    : b.reason === "LeaderDetached" ? "Blocked: you stopped following this leader"
    : `Blocked by your ${name}${/filter|stop|budget/.test(name) ? "" : " rule"}`;
  return { title, sentence, compare, chips, short: b.rule ?? sentence, reasonName: RULES[b.reason] ?? b.reason };
}

/** The leader holding a market (MarketHeldByOtherLeader's `actual`), by address when known. */
function heldByName(id: bigint): string {
  const a = leaderAddressOf(Number(id));
  return a ? shortAddr(a) : `Perpl #${id}`;
}

/** Card banner after "Not copied.": the user's rule, or what another leader / a leader's own limits did. */
export function blockBanner(cfg: AppConfig | undefined, e: FeedEvent): string {
  const b = e.blocked;
  if (!b) return "";
  if (b.reason === "MarketHeldByOtherLeader") return `Blocked: market held by ${heldByName(toBig(b.actual))}`;
  if (b.reason === "LeaderBudgetExceeded") return `Blocked: over ${leaderName(e) || "this leader"}'s ${ausd(b.limit)} budget`;
  if (b.reason === "LeaderLossStop") return `Blocked: ${leaderName(e) || "this leader"}'s loss stop`;
  if (b.reason === "LeaderDetached") return `Blocked: you stopped following ${leaderName(e) || "this leader"} (positions kept)`;
  return `Your rule: ${shortRule(cfg, e)}`;
}

export function shortRule(cfg: AppConfig | undefined, e: FeedEvent): string {
  const b = e.blocked;
  if (!b) return "";
  if (b.rule) return b.rule;
  const n = BLOCK_REASONS.indexOf(b.reason as any);
  return n >= 0 ? explainBlock(cfg, e).title.replace("Blocked by your ", "").replace(" rule", "") : b.reason;
}

// ---------------------------------------------------------------- feed item
export function FeedItem({ e, cfg, onBlockedPress, onCopyPress, highlight, testID }: { e: FeedEvent; cfg: AppConfig | undefined; onBlockedPress?: (e: FeedEvent) => void; onCopyPress?: (e: FeedEvent) => void; highlight?: boolean; testID?: string }) {
  const c = useColors();
  const m = mkt(cfg, e.perpId);
  const leaderAddr = e.leaderAddress ?? (e.leaderAccountId ? String(e.leaderAccountId) : "");
  if (isEngineKind(e.kind)) return <EngineItem e={e} cfg={cfg} testID={testID} name={leaderName(e)} />;
  if (e.kind === "StopTriggered" || e.kind === "LevelSet" || e.kind === "MarketClosed" || e.kind === "LeaderStopped") return <StopItem e={e} cfg={cfg} testID={testID} />;
  const typeLabel = e.kind === "Blocked" ? "Blocked" : e.kind === "Mirrored" ? ((e.orderType ?? 0) <= 1 ? "Copy" : "Close") : e.kind;
  const header = (
    <Row gap={8}>
      {leaderAddr ? <Identicon seed={leaderAddr} size={28} /> : null}
      {leaderAddr ? (
        <T size={13} w={500} mono lines={1} style={{ flexShrink: 1 }}>
          {leaderName(e)}
        </T>
      ) : null}
      {e.teamRun ? <TeamBadge /> : null}
      <T size={12} mono color="mu" lines={1}>
        {ago(e.timestamp)}
      </T>
      <View style={{ flex: 1 }} />
      {e.teamRun ? null : (
        <T size={11} w={600} color={e.kind === "Blocked" ? "neg" : "mu"} upper testID={testID ? `${testID}.type` : undefined}>
          {typeLabel}
        </T>
      )}
      <TxLink hash={e.txHash} onPress={() => openTx(cfg, e.txHash)} testID={testID ? `${testID}.tx` : undefined} />
    </Row>
  );

  if (e.kind === "Blocked") {
    const lev = e.leaderLeverageHdths ?? e.leverageHdths ?? 0;
    const size = sizeText(cfg, e.perpId, e.leaderLotLNS ?? e.lotLNS);
    return (
      <Card testID={testID ?? `activity.blocked.${e.id}`} dashed={!highlight} borderColor={highlight ? c.neg : undefined} onPress={() => onBlockedPress?.(e)} style={{ paddingVertical: 12, paddingHorizontal: 14, gap: 10 }}>
        {header}
        <Row gap={10} style={{ opacity: 0.72 }}>
          <MarketBadge symbol={m?.symbol ?? "?"} />
          <View style={{ flex: 1, gap: 2 }}>
            <Row gap={6}>
              <T size={15} w={600}>
                {m?.symbol}
              </T>
              <Side side={orderSide(e.orderType ?? 0)} />
              <T size={13} color="mu">
                Leader {orderAction(e.orderType ?? 0).toLowerCase()}{lev > 0 ? ` · ${leverage(lev)}` : ""}
              </T>
            </Row>
            <T size={13} mono>
              {size} @ {priceText(cfg, e.perpId, e.pricePNS)}
            </T>
          </View>
        </Row>
        <Row gap={6} style={{ paddingTop: 10, borderTopWidth: 1, borderTopColor: c.bd }}>
          <Icon name="ban" size={16} color={c.neg} />
          <T size={13} color={c.neg} style={{ flex: 1 }} lines={2} testID="activity.blocked.banner">
            <T size={13} w={600} color={c.neg}>
              Not copied.{" "}
            </T>
            {blockBanner(cfg, e)}
          </T>
          <Row gap={2}>
            <T size={13} w={600} color="ac">
              Details
            </T>
            <Icon name="chev" size={14} color={c.ac} />
          </Row>
        </Row>
      </Card>
    );
  }

  if (e.kind === "Mirrored") {
    const open = (e.orderType ?? 0) <= 1;
    const pnl = e.realisedPnlCNS !== undefined ? toBig(e.realisedPnlCNS) : null;
    return (
      <Card testID={testID ?? `activity.copy.${e.id}`} onPress={onCopyPress ? () => onCopyPress(e) : undefined} style={{ paddingVertical: 12, paddingHorizontal: 14, gap: 10 }}>
        {header}
        <Row gap={10}>
          <MarketBadge symbol={m?.symbol ?? "?"} />
          <View style={{ flex: 1, gap: 2 }}>
            <Row gap={6}>
              <T size={15} w={600}>
                {m?.symbol}
              </T>
              <Side side={orderSide(e.orderType ?? 0)} />
              <T size={13} color="mu">
                {orderAction(e.orderType ?? 0)}
                {open && e.leverageHdths ? ` · ${leverage(e.leverageHdths)}` : ""}
                {e.matchNow ? " · Match now" : ""}
              </T>
            </Row>
            <T size={13} mono lines={1}>
              {sizeText(cfg, e.perpId, e.lotLNS)} · {ausd(e.notionalCNS ?? (m && e.lotLNS && e.pricePNS ? notionalCNS(toBig(e.lotLNS), toBig(e.pricePNS), m.lotDecimals, m.priceDecimals) : 0n))} AUSD @ {priceText(cfg, e.perpId, e.pricePNS)}
            </T>
            {copyFeeCNS(e) !== null ? (
              <T size={11} mono color="mu" testID={testID ? `${testID}.fee` : undefined}>
                {open ? `fee ${feeText(copyFeeCNS(e)!)} AUSD` : "fee 0 on closes"}
              </T>
            ) : null}
          </View>
          {pnl !== null ? (
            <View style={{ alignItems: "flex-end" }}>
              <T size={13} mono color={pnl >= 0n ? "posI" : "neg"}>
                {ausdSigned(pnl)}
              </T>
              <T size={12} color="mu">
                realised
              </T>
            </View>
          ) : null}
        </Row>
        <Row justify="space-between" style={{ paddingTop: 10, borderTopWidth: 1, borderTopColor: c.bd }}>
          <Row gap={6} style={{ flexShrink: 1 }}>
            {e.latencyMs !== undefined ? (
              <LatencyPill ms={e.latencyMs} label={e.latencyBlocks ? "" : e.matchNow ? "Matched in" : "Copied in"} blocks={e.latencyBlocks} testID={testID ? `${testID}.latency` : undefined} />
            ) : (
              <T size={12} mono color="mu">{`block ${e.block.toLocaleString("en-US")}`}</T>
            )}
            {e.proof ? <SmallChip label={`${bpsText(fillDeviationBps(e.proof, e.orderType ?? 0))} bps`} testID={testID ? `${testID}.deviation` : undefined} /> : null}
          </Row>
          <CommitTrack state={e.commitState} />
        </Row>
      </Card>
    );
  }

  // account events
  const meta: Record<string, { icon: any; title: string; tone: string }> = {
    Deposited: { icon: "arrdown", title: `Deposited ${ausd(e.amountCNS ?? "0")} AUSD`, tone: "nu" },
    Withdrawn: { icon: "arrup", title: `Withdrew ${ausd(e.amountCNS ?? "0")} AUSD to your wallet`, tone: "nu" },
    Followed: { icon: "check", title: `Started following ${shortAddr(e.leaderAddress)}`, tone: "ac" },
    PolicyUpdated: { icon: "edit", title: "Limits updated", tone: "ac" },
    Paused: { icon: "pause", title: e.paused ? "Following paused" : "Following resumed", tone: "nu" },
    ClosedAll: { icon: "close", title: `Closed ${e.positionsClosed ?? 0} position${e.positionsClosed === 1 ? "" : "s"}`, tone: "nu" },
    LeaderDetached: {
      icon: e.data?.detached ? "pause" : "check",
      title: `${(e.data?.label as string | undefined) ?? (e.data?.detached ? "Stopped following this leader (positions kept)" : "Following this leader again")}${leaderName(e) ? `: ${leaderName(e)}` : ""}`,
      tone: e.data?.detached ? "nu" : "ac",
    },
    // Retired engine-held detach (old rows, no tx).
    Detached: { icon: e.data?.detached ? "pause" : "check", title: e.label ?? (e.data?.detached ? "Stopped following; positions kept" : "Following again"), tone: e.data?.detached ? "nu" : "ac" },
    LeaderStopped: { icon: "pause", title: `Leader loss stop hit for ${leaderName(e) || "a leader"}${e.actual ? `: lost ${ausd(toBig(e.actual) < 0n ? -toBig(e.actual) : toBig(e.actual))} of ${ausd(e.limit ?? "0")}` : ""}. Copying it stopped`, tone: "nu" },
  };
  const mm = meta[e.kind] ?? { icon: "info", title: e.kind, tone: "nu" };
  return (
    <Card testID={testID ?? `activity.account.${e.id}`} style={{ paddingVertical: 12, paddingHorizontal: 14, gap: 8 }}>
      <Row gap={10}>
        <View style={{ width: 32, height: 32, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: mm.tone === "ac" ? c.acs : c.sf2 }}>
          <Icon name={mm.icon} size={16} color={mm.tone === "ac" ? c.ac : c.mu} />
        </View>
        <View style={{ flex: 1 }}>
          <T size={14} w={600}>
            {mm.title}
          </T>
          <T size={12} color="mu" mono>
            {ago(e.timestamp)} ago · block {e.block.toLocaleString("en-US")}
          </T>
          <T size={11} w={600} color="mu" upper testID={testID ? `${testID}.type` : undefined}>
            {e.kind === "Withdrawn" ? "Withdraw" : e.kind === "Deposited" ? "Deposit" : e.kind === "Followed" ? "Follow" : e.kind === "LeaderDetached" ? (e.data?.detached ? "Stop following" : "Follow again") : e.kind === "Detached" ? "Mirror · no tx" : e.kind}
          </T>
        </View>
        <TxLink hash={e.txHash} onPress={() => openTx(cfg, e.txHash)} />
      </Row>
      <CommitTrack state={e.commitState} />
    </Card>
  );
}

/** Compact row for Home "Recent copies". */
export function RecentRow({ e, cfg, onPress }: { e: FeedEvent; cfg: AppConfig | undefined; onPress?: () => void }) {
  const m = mkt(cfg, e.perpId);
  return (
    <Press testID={`recent.${e.id}`} onPress={onPress} style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 11, paddingHorizontal: 14 }}>
      <MarketBadge symbol={m?.symbol ?? "?"} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Row gap={6}>
          <T size={13} w={600}>
            {m?.symbol}
          </T>
          <Side side={orderSide(e.orderType ?? 0)} />
          <T size={13} color="mu">
            {orderAction(e.orderType ?? 0)}
          </T>
        </Row>
        <T size={12} color="mu">
          <T size={12} mono color="mu">
            {shortAddr(e.leaderAddress)}
          </T>{" "}
          · {ago(e.timestamp)} ago
        </T>
      </View>
      {e.kind === "Blocked" ? (
        <ChipS label={e.blocked ? (e.blocked.reason === "MarketHeldByOtherLeader" ? "Market held" : (RULES[e.blocked.reason] ?? "Blocked")) : "Blocked"} tone="neg" icon="ban" />
      ) : (
        <View style={{ alignItems: "flex-end" }}>
          <T size={12} mono>
            {((e.latencyMs ?? 0) / 1000).toFixed(2)} s{e.latencyBlocks ? ` · ${e.latencyBlocks} blocks` : ""}
          </T>
          <T size={12} color="mu" mono={!!e.proof}>
            {e.proof ? `${bpsText(fillDeviationBps(e.proof, e.orderType ?? 0))} bps` : e.commitState[0].toUpperCase() + e.commitState.slice(1)}
          </T>
        </View>
      )}
    </Press>
  );
}

// ---------------------------------------------------------------- blocked sheet
export function BlockedSheet({ e, cfg, account, onClose, demo }: { e: FeedEvent | null; cfg: AppConfig | undefined; account?: MirrorAccount; onClose: () => void; demo?: boolean }) {
  if (!e || !e.blocked) return <Sheet visible={false} onClose={onClose}>{null}</Sheet>;
  return (
    <Sheet visible onClose={onClose} testID="blocked.sheet">
      <BlockedBody e={e} cfg={cfg} account={account} onClose={onClose} demo={demo} />
    </Sheet>
  );
}

/** Blocked detail: the rule, the numbers, the leader reference and the onchain record. */
export function BlockedBody({ e, cfg, account, onClose, demo }: { e: FeedEvent; cfg: AppConfig | undefined; account?: MirrorAccount; onClose: () => void; demo?: boolean }) {
  const c = useColors();
  const [sharing, setSharing] = React.useState(false);
  if (!e.blocked) return null;
  const x = explainBlock(cfg, e, account);
  const teamRun = !!(demo || e.teamRun || account?.teamRun);
  return (
      <View style={{ gap: 14 }} testID="blocked.detail">
        <Row gap={12} align="flex-start">
          <View style={{ width: 44, height: 44, borderRadius: 14, backgroundColor: c.negS, alignItems: "center", justifyContent: "center" }}>
            <Icon name="ban" size={22} color={c.neg} />
          </View>
          <View style={{ flex: 1 }}>
            <T size={12} w={500} color="neg" upper testID="blocked.detail.reason">
              {`Not copied · ${x.reasonName} · ${ago(e.timestamp)} ago`}
            </T>
            <T size={19} w={600} lh={24} testID="blocked.title">
              {x.title}
            </T>
          </View>
          {e.txHash ? <IconButton name="share" onPress={() => setSharing(true)} testID="blocked.share" /> : null}
        </Row>
        <T size={16} lh={23} testID="blocked.sentence">
          {x.sentence}
        </T>
        {x.compare ? (
          <Card style={{ padding: 14, gap: 10 }}>
            <CompareRow label={e.blocked.reason === "ExceedsMaxNotional" || e.blocked.reason === "LeaderBudgetExceeded" ? "Your copy" : e.blocked.reason === "EntryTooFar" ? "Price for copy" : "Leader's order"} value={x.compare.leader} frac={1} over capAt={x.compare.frac} testID="blocked.detail.actual" />
            <CompareRow label="Your limit" value={x.compare.limit} frac={x.compare.frac} testID="blocked.detail.limit" />
          </Card>
        ) : null}
        <View>
          <KV k="Leader" v={leaderName(e)} />
          <KV k="Leader trade" v={`${sizeText(cfg, e.perpId, e.leaderLotLNS ?? e.lotLNS)} ${orderSide(e.orderType ?? 0).toLowerCase()} @ ${priceText(cfg, e.perpId, (e.data?.leaderFillPNS as string | undefined) ?? e.pricePNS)}`} />
          {e.leaderRef ? <KV k="Leader ref" v={`${e.leaderRef.slice(0, 6)}…${e.leaderRef.slice(-4)}${e.leaderBlock ? ` · block ${e.leaderBlock.toLocaleString("en-US")}` : ""}`} testID="blocked.detail.leaderRef" /> : null}
          <KV k="Recorded" v={`${demo || e.teamRun ? "Demo account" : "Blocked by your rule"} · block ${e.block.toLocaleString("en-US")}`} last />
        </View>
        <Row gap={6} style={{ flexWrap: "wrap" }}>
          {x.chips.map((ch) => (
            <ChipS key={ch.label} label={ch.label} tone={ch.state === "ok" ? "ok" : ch.state === "fail" ? "neg" : "neutral"} icon={ch.state === "ok" ? "check" : ch.state === "fail" ? "close" : undefined} />
          ))}
        </Row>
        <Row>
          <T size={12} color="mu" style={{ flex: 1 }}>
            Your funds were not touched.
          </T>
          <TxLink hash={e.txHash} onPress={() => openTx(cfg, e.txHash)} testID="blocked.tx" />
        </Row>
        <Row gap={10}>
          <Button title="Done" kind="out" flex onPress={onClose} testID="blocked.done" />
          {!demo && account && account.leader ? (
            <Button
              title="Edit rule"
              icon="edit"
              flex
              testID="blocked.edit.rule"
              onPress={() => {
                onClose();
                router.push({ pathname: "/follow/[id]", params: { id: String(account.leader!.accountId), account: account.account } });
              }}
            />
          ) : null}
        </Row>
        {e.txHash ? (
          <ShareSheet
            visible={sharing}
            onClose={() => setSharing(false)}
            targets={[{ key: e.txHash, label: "Blocked", target: { kind: "blocked", txHash: e.txHash, account: e.account, teamRun } }]}
          />
        ) : null}
      </View>
  );
}

function CompareRow({ label, value, frac, over, capAt, testID }: { label: string; value: string; frac: number; over?: boolean; capAt?: number; testID?: string }) {
  const c = useColors();
  return (
    <View testID={testID} style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
      <T size={13} style={{ width: 104 }}>
        {label}
      </T>
      <View style={{ flex: 1, height: 10, borderRadius: 5, backgroundColor: c.sf2 }}>
        <View style={{ width: `${Math.min(1, frac) * 100}%`, height: 10, borderRadius: 5, backgroundColor: over ? c.neg : c.ac }} />
        {capAt !== undefined ? <View style={{ position: "absolute", left: `${Math.min(1, capAt) * 100}%`, top: -4, bottom: -4, width: 3, marginLeft: -1.5, borderRadius: 2, backgroundColor: c.tx, borderWidth: 0 }} /> : null}
      </View>
      <T size={14} w={600} mono style={{ minWidth: 52, textAlign: "right" }}>
        {value}
      </T>
    </View>
  );
}
