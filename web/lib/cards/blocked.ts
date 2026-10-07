/**
 * Explains a Blocked feed item (docs/api.md: reason, limit, actual, leaderLeverageHdths, data.leaderEntryPNS) in
 * the card's voice. Same rule names and check order as the app (app/src/lib/blockReasons.ts, app/src/ui/feed.tsx).
 */
import { ZERO, ausd, bpsPct, leverage, price, toBig, toNum } from "./format";
import type { Seg, Stat } from "./types";

export const RULE_NAMES: Record<string, string> = {
  LeverageTooHigh: "Max leverage",
  LeverageTooLow: "Leverage safety",
  MarketNotAllowed: "Market not allowed",
  ExceedsMaxNotional: "Max notional",
  SlippageTooHigh: "Max slippage",
  DailyLossStop: "Daily loss stop",
  DrawdownStop: "Account loss stop",
  Paused: "Paused",
  Expired: "Expired",
  LeaderNotAllowed: "Leader not followed",
  LeaderSideMismatch: "Leader position changed",
  FlipNotAllowed: "No flip",
  StaleMark: "Stale price",
  ExceedsLeaderTarget: "Copy ratio",
  EntryTooFar: "Entry filter",
  MarketHeldByOtherLeader: "Market held by another leader",
  LeaderBudgetExceeded: "Budget",
  LeaderLossStop: "Leader loss stop",
  MarketHalted: "Market halted by a stop",
};
export const ruleName = (r: string) => RULE_NAMES[r] ?? r.replace(/([a-z])([A-Z])/g, "$1 $2");

/**
 * Order of checks in MirrorAccount._checkOpen, grouped as in the app. A Blocked event names the first check that
 * failed, so the groups before it passed; the ones after it were never reached and are not shown.
 */
const CHECK_GROUPS: { label: string; reasons: string[] }[] = [
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

const ORDER_SIDES = ["long", "short", "long", "short"];

export interface BlockInput {
  reason: string;
  limit: unknown;
  actual: unknown;
  orderType: number;
  symbol: string;
  priceDecimals?: number;
  leaderEntryPNS?: unknown;
  leaderLeverageHdths?: unknown;
  block?: number | null;
  /** True: the team-run demo account ("its rule"); false: the sharer's own account ("my rule"). */
  teamRun: boolean;
}

export interface BlockExplained {
  title: string;
  sentence: Seg[];
  cmp: Stat[];
  chips: { label: string; ok: boolean }[];
}

/** "Leader opened *12x* BTC long." → segments, with *x* bold. */
function segs(s: string): Seg[] {
  return s.split(/(\*[^*]+\*)/).filter(Boolean).map((p) => (p.startsWith("*") ? { t: p.slice(1, -1), b: true } : { t: p }));
}

export function explainBlock(x: BlockInput): BlockExplained {
  const owner = x.teamRun ? "The demo account's" : "My";
  const side = ORDER_SIDES[x.orderType] ?? "";
  const sym = x.symbol;
  const limit = toBig(x.limit);
  const actual = toBig(x.actual);
  const blockStat: Stat[] = x.block ? [{ k: "Block", v: x.block.toLocaleString("en-US") }] : [];
  let sentence = "";
  let cmp: Stat[] = [];
  switch (x.reason) {
    case "LeverageTooHigh": {
      const lev = leverage(toNum(x.leaderLeverageHdths) ?? actual);
      const lim = leverage(limit);
      sentence = lev && lim ? `Leader opened *${lev}* ${sym} ${side}. ${owner} max leverage is *${lim}*. Not copied.` : `The leader's leverage was above ${owner.toLowerCase()} max. Not copied.`;
      cmp = [...(lev ? [{ k: "Leader's order", v: lev }] : []), ...(lim ? [{ k: "Rule", v: `max ${lim}` }] : []), ...blockStat];
      break;
    }
    case "MarketNotAllowed":
      sentence = `Leader opened ${sym} ${side}. ${sym} is not in ${owner.toLowerCase()} allowed markets. Not copied.`;
      cmp = [{ k: "Market", v: sym }, { k: "Rule", v: "not allowed" }, ...blockStat];
      break;
    case "ExceedsMaxNotional":
    case "LeaderBudgetExceeded": {
      const a = ausd(actual);
      const l = ausd(limit);
      const what = x.reason === "ExceedsMaxNotional" ? "max per market" : "budget for this leader";
      sentence = a && l ? `The copy needed *${a} AUSD*. ${owner} ${what} is *${l} AUSD*. Not copied.` : `The copy was above ${owner.toLowerCase()} ${what}. Not copied.`;
      cmp = [...(a ? [{ k: "Copy", v: `${a} AUSD` }] : []), ...(l ? [{ k: "Rule", v: `max ${l}` }] : []), ...blockStat];
      break;
    }
    case "EntryTooFar": {
      const entry = toBig(x.leaderEntryPNS);
      if (entry && entry > ZERO && actual !== null && limit !== null) {
        const moved = (Math.abs(Number(actual - entry)) / Number(entry)) * 100;
        const lim = (Math.abs(Number(limit - entry)) / Number(entry)) * 100;
        sentence = `Price moved *${moved.toFixed(1)}%* past the leader's entry; ${owner.toLowerCase()} limit is *${lim.toFixed(lim < 1 ? 2 : 1).replace(/\.?0+$/, "")}%*. Not copied.`;
        cmp = [
          { k: "Leader entry", v: price(entry, x.priceDecimals) ?? "" },
          { k: "Price for copy", v: price(actual, x.priceDecimals) ?? "" },
          { k: x.teamRun ? "Bound" : "My bound", v: price(limit, x.priceDecimals) ?? "" },
        ].filter((s) => s.v);
      } else {
        // The Blocked event carries the copy's price (actual) and the filter's bound (limit), not the leader's entry.
        const a = price(actual, x.priceDecimals);
        const l = price(limit, x.priceDecimals);
        sentence = a && l
          ? `The price for the copy was *${a}*; ${owner.toLowerCase()} entry filter allowed *${l}*. Not copied.`
          : `The price was too far from the leader's entry for ${owner.toLowerCase()} entry filter. Not copied.`;
        cmp = [...(a ? [{ k: "Price for copy", v: a }] : []), ...(l ? [{ k: x.teamRun ? "Bound" : "My bound", v: l }] : []), ...blockStat];
      }
      break;
    }
    case "SlippageTooHigh":
      sentence = `The price moved past ${owner.toLowerCase()} slippage bound. Not copied.`;
      cmp = [...(limit !== null && price(limit, x.priceDecimals) ? [{ k: "Bound", v: price(limit, x.priceDecimals)! }] : []), ...blockStat];
      break;
    case "DailyLossStop":
    case "DrawdownStop":
      sentence = `${owner} ${x.reason === "DailyLossStop" ? "daily loss stop" : "account loss stop"} was reached, so new exposure is paused. Not copied.`;
      cmp = [...(actual !== null ? [{ k: "Equity", v: `${ausd(actual)} AUSD` }] : []), ...(limit !== null ? [{ k: "Floor", v: `${ausd(limit)} AUSD` }] : []), ...blockStat];
      break;
    default:
      sentence = `${owner} rule "${ruleName(x.reason).toLowerCase()}" refused this copy. Not copied.`;
      cmp = blockStat;
  }
  if (x.reason === "EntryTooFar" && cmp.length < 3) cmp = [...cmp, ...blockStat].slice(0, 3);
  const failIdx = CHECK_GROUPS.findIndex((g) => g.reasons.includes(x.reason));
  const chips = CHECK_GROUPS.slice(0, Math.max(0, failIdx)).map((g) => ({ label: g.label, ok: true }));
  chips.push({ label: failLabel(x, limit, actual), ok: false });
  const name = ruleName(x.reason).toLowerCase();
  const title = x.teamRun ? "Blocked by its rule" : `Blocked by my ${name}${/filter|stop|budget/.test(name) ? "" : " rule"}`;
  return { title, sentence: segs(sentence), cmp, chips };
}

function failLabel(x: BlockInput, limit: bigint | null, actual: bigint | null): string {
  const name = ruleName(x.reason);
  if (x.reason === "LeverageTooHigh") {
    const lev = leverage(toNum(x.leaderLeverageHdths) ?? actual);
    const lim = leverage(limit);
    if (lev && lim) return `Leverage ${lev} > ${lim}`;
  }
  if (x.reason === "EntryTooFar") {
    const entry = toBig(x.leaderEntryPNS);
    if (entry && entry > ZERO && actual !== null && limit !== null) {
      const bps = (n: bigint) => Math.round((Math.abs(Number(n - entry)) / Number(entry)) * 10000);
      return `Entry ${bpsPct(bps(actual))} > ${bpsPct(bps(limit))}`;
    }
  }
  return name;
}
