/**
 * Engine JSON (docs/api.md) → CardModel. Pure functions: no fetches, no defaults that look like data. A value the
 * engine did not send is left out of the card, never filled in.
 */
import { explainBlock } from "./blocked";
import { MINUS, ZERO, ausd, ausdSigned, bpsSigned, dateShort, lots, median, pct, pctSigned, plural, seconds, shortAddr, toBig, toNum } from "./format";
import type { CardKind, CardModel, ProofLink, Stat } from "./types";

type Json = Record<string, any>;
export type Market = { symbol: string; priceDecimals: number; lotDecimals: number };

export interface Ctx {
  /** Absolute landing URL of this card (QR target for leader, follower and sim). */
  landing: string;
  explorerTx: string;
  explorerAddress: string;
  markets: Record<number, Market>;
  depositCapCNS: string | null;
  builderFeePer100K: number | null;
  amounts: boolean;
}

export function ctxFromConfig(cfg: Json | null, landing: string, amounts: boolean): Ctx {
  const markets: Record<number, Market> = {};
  for (const m of (cfg?.markets ?? []) as Json[]) {
    const id = toNum(m.perpId);
    if (id !== null && m.symbol) markets[id] = { symbol: String(m.symbol), priceDecimals: toNum(m.priceDecimals) ?? 0, lotDecimals: toNum(m.lotDecimals) ?? 0 };
  }
  return {
    landing,
    explorerTx: typeof cfg?.explorerTx === "string" ? cfg.explorerTx : "https://monadvision.com/tx/",
    explorerAddress: typeof cfg?.explorerAddress === "string" ? cfg.explorerAddress : "https://monadvision.com/address/",
    markets,
    depositCapCNS: cfg?.depositCapCNS != null ? String(cfg.depositCapCNS) : null,
    builderFeePer100K: toNum(cfg?.builder?.feePer100K),
    amounts,
  };
}

/** URL as printed on the card: no scheme, no query, long hex shortened ("0xcD6F…4F61"). */
const display = (url: string) => url.replace(/^https?:\/\//, "").replace(/\?.*$/, "").replace(/0x[0-9a-fA-F]{12,}/g, (h) => shortAddr(h));
const TEAM_FINE = "Run by the Mirror team for demos. Not counted in Mirror's public numbers.";
const sym = (ctx: Ctx, perpId: unknown) => ctx.markets[toNum(perpId) ?? -1]?.symbol ?? (perpId != null ? `market ${perpId}` : "");
const txLink = (ctx: Ctx, hash: string, label: string, note?: string): ProofLink => ({ label, href: ctx.explorerTx + hash, hash, note });
const isBuy = (orderType: number) => orderType === 0 || orderType === 3;
const ACTIONS = ["Open long", "Open short", "Close long", "Close short"];

function base(kind: CardKind, ctx: Ctx): Pick<CardModel, "kind" | "ok" | "proof" | "links"> {
  return { kind, ok: true, proof: { url: ctx.landing, display: display(ctx.landing), caption: "Every number links to its Monad transaction." }, links: [] };
}

export function unavailableModel(kind: CardKind, reason: string, ctx: Ctx): CardModel {
  const tag = { leader: "Leader record", follower: "Copy result", blocked: "Blocked copy", sim: "Simulation" }[kind];
  return {
    ...base(kind, ctx),
    ok: false,
    tag,
    simulation: kind === "sim" ? "Simulation" : undefined,
    message: reason,
    fine: ["No numbers are shown because they could not be read from Mirror's server or Monad."],
    app: { label: "Open Mirror", href: "/app" },
    title: `${tag} · not available`,
    description: `This Mirror card is not available right now. ${reason}`,
  };
}

/** GET /v1/leaders/:id?window=30d */
export function leaderModel(id: string, p: Json, ctx: Ctx): CardModel {
  const pnl = toNum(p.pnlPct);
  const dd = toNum(p.maxDrawdownPct);
  const win = toNum(p.winRate);
  const winPct = win === null ? null : win <= 1 ? win * 100 : win;
  const curve = ((p.equityCurve ?? []) as Json[]).map((x) => toNum(x.equityCNS ?? x.pnlCNS)).filter((v): v is number => v !== null);
  const stats: Stat[] = [];
  if (dd !== null) stats.push({ k: "Max drawdown", v: dd > 0 ? `${MINUS}${dd.toFixed(1)}%` : "0.0%", tone: dd > 0 ? "neg" : "tx" });
  if (winPct !== null) stats.push({ k: "Win rate", v: `${Math.round(winPct)}%` });
  if (toNum(p.trades) !== null) stats.push({ k: "Trades", v: String(toNum(p.trades)) });
  if (toNum(p.followers) !== null) stats.push({ k: "Followers on Mirror", v: String(toNum(p.followers)) });
  const label = Array.isArray(p.nansen?.labels) && p.nansen.labels[0] ? String(p.nansen.labels[0]) : undefined;
  const markets = Array.isArray(p.markets) && p.markets.length ? `Trades ${p.markets.slice(0, 4).join(", ")} on Perpl` : "Trades on Perpl";
  const team = !!p.teamRun;
  const trades = (p.recentTrades ?? []) as Json[];
  const addr = String(p.address ?? "");
  return {
    ...base("leader", ctx),
    tag: `Leader record · ${String(p.window ?? "30d").replace("d", " days")}`,
    teamRun: team ? "Team-run demo leader" : undefined,
    who: { seed: addr, addr: shortAddr(addr) || `Perpl #${id}`, label, sub: markets },
    big: pnl === null ? undefined : { text: pctSigned(pnl)!, tone: pnl >= 0 ? "pos" : "neg" },
    chart: curve.length >= 2 ? { points: curve, tone: (pnl ?? 0) >= 0 ? "pos" : "neg" } : undefined,
    stats,
    fine: [team ? TEAM_FINE : "From Perpl fills on Monad. Past results don't predict future returns."],
    links: [
      ...(addr ? [{ label: "Leader account on MonadVision", href: ctx.explorerAddress + addr }] : []),
      ...trades.slice(0, 20).map((t) => txLink(ctx, t.txHash, `${String(t.kind ?? t.action ?? "fill")} ${sym(ctx, t.perpId)} ${t.side ?? ""}`.trim(), dateShort(t.t ?? (toNum(t.timestamp) ?? 0) / 1000) ?? undefined)),
    ],
    app: { label: "Open this leader in Mirror", href: `/app/leader/${id}` },
    title: `${team ? "Team-run demo leader" : `Leader ${shortAddr(addr)}`} · ${pnl === null ? "record" : `${pctSigned(pnl)} in ${p.window ?? "30d"}`}`,
    description: `${team ? "Team-run demo leader on Perpl. " : ""}${stats.map((s) => `${s.k} ${s.v}`).join(" · ")}. Every fill links to its Monad transaction.`,
  };
}

/** Signed bps, positive = follower got the worse price (app/src/lib/proof.ts). */
export function copyDeviationBps(proof: Json | null | undefined, orderType: number): number | null {
  const ref = toBig(proof?.leaderFillPNS);
  const fill = toBig(proof?.fillPNS);
  if (!ref || !fill) return null;
  const diff = isBuy(orderType) ? fill - ref : ref - fill;
  return Number((diff * BigInt(1_000_000)) / ref) / 100;
}

/** GET /v1/accounts/:account + its feed. */
export function followerModel(acct: Json, items: Json[], complete: boolean, ctx: Ctx): CardModel {
  const addr = String(acct.address ?? acct.account ?? "");
  const equity = toBig(acct.equityCNS);
  const net = toBig(acct.netDepositsCNS);
  const pnl = toBig(acct.pnlCNS) ?? (equity !== null && net !== null ? equity - net : null);
  const pnlPct = pnl !== null && net && net > ZERO ? (Number(pnl) / Number(net)) * 100 : null;
  const copies = items.filter((i) => i.kind === "Mirrored");
  const blocked = items.filter((i) => i.kind === "Blocked");
  const more = complete ? "" : "+";
  const lat = median(copies.map((i) => toNum(i.latencyMs)).filter((v): v is number => v !== null));
  const dev = median(copies.map((i) => copyDeviationBps(i.proof ?? i.data?.proof, toNum(i.orderType) ?? 0)).filter((v): v is number => v !== null));
  const leaders = ((acct.policy?.leaders ?? []) as Json[]).length;
  const team = !!acct.teamRun;
  const stats: Stat[] = [{ k: "Copies", v: `${copies.length}${more}` }];
  if (seconds(lat)) stats.push({ k: "Median copy time", v: seconds(lat)! });
  if (bpsSigned(dev)) stats.push({ k: "Median deviation", v: bpsSigned(dev)! });
  stats.push({ k: team ? "Blocked by its rules" : "Blocked by my rules", v: `${blocked.length}${more}` });
  // Builder fee wherever copies are shown: the AUSD paid, or the rate when amounts are hidden.
  const fee = ctx.amounts && acct.builderFeesCNS != null ? `builder fees ${ausd(acct.builderFeesCNS)} AUSD` : ctx.builderFeePer100K !== null ? `builder fee ${((ctx.builderFeePer100K / 100_000) * 100).toFixed(3).replace(/0+$/, "")}% of opens` : null;
  const since = dateShort(acct.createdAt);
  let big: CardModel["big"];
  let sub: string | undefined;
  if (ctx.amounts && pnl !== null) {
    big = { text: ausdSigned(pnl)!, unit: "AUSD", tone: pnl >= ZERO ? "pos" : "neg" };
    if (net !== null) sub = `${pnlPct !== null ? `${pctSigned(pnlPct)} on ` : ""}${ausd(net)} AUSD deposited`;
  } else if (pnlPct !== null) {
    big = { text: pctSigned(pnlPct)!, tone: pnlPct >= 0 ? "pos" : "neg" };
    sub = "on the amount deposited";
  }
  if (fee) sub = sub ? `${sub} · ${fee}` : fee;
  const cap = ctx.depositCapCNS ? ` Beta deposits are capped at ${ausd(ctx.depositCapCNS, 0)} AUSD.` : "";
  return {
    ...base("follower", ctx),
    tag: `${team ? "Demo copy result" : "My copy result"}${since ? ` · since ${since}` : ""}`,
    teamRun: team ? "Team-run demo account" : undefined,
    who: { seed: addr, addr: shortAddr(addr), sub: leaders ? `Following ${plural(leaders, "leader")} on Perpl` : "Copying on Perpl" },
    big,
    sub,
    stats,
    fine: [team ? TEAM_FINE : `Real account, real fills.${cap}`],
    links: [
      { label: "Account contract on MonadVision", href: ctx.explorerAddress + addr },
      ...items.filter((i) => i.txHash && i.onchain !== false).slice(0, 20).map((i) => txLink(ctx, i.txHash, i.kind === "Mirrored" ? `Copy · ${ACTIONS[toNum(i.orderType) ?? 0]} ${sym(ctx, i.perpId)}` : String(i.kind), i.kind === "Mirrored" && i.proof?.builderFeeCNS != null ? `builder fee ${ausd(i.proof.builderFeeCNS)} AUSD` : dateShort(i.timestamp) ?? undefined)),
    ],
    app: { label: "Copy traders with Mirror", href: "/app" },
    title: `${team ? "Team-run demo account" : shortAddr(addr)} · ${big ? `${big.text}${big.unit ? ` ${big.unit}` : ""}` : "copy result"}`,
    description: `${team ? "Team-run demo account. " : ""}${stats.map((s) => `${s.k} ${s.v}`).join(" · ")}. Every copy links to its Monad transaction.`,
  };
}

/** One Blocked feed item, with its account (for teamRun) and optional leader address. */
export function blockedModel(item: Json, acct: Json | null, leaderAddr: string | null, ctx: Ctx): CardModel {
  const team = !!(acct?.teamRun ?? item.teamRun);
  const perpId = toNum(item.perpId) ?? -1;
  const m = ctx.markets[perpId];
  const ot = toNum(item.orderType) ?? 0;
  const x = explainBlock({
    reason: String(item.reason ?? "Unknown"),
    limit: item.limit,
    actual: item.actual,
    orderType: ot,
    symbol: m?.symbol ?? sym(ctx, item.perpId),
    priceDecimals: m?.priceDecimals,
    leaderEntryPNS: item.data?.leaderEntryPNS,
    leaderLeverageHdths: item.leaderLeverageHdths,
    block: toNum(item.block),
    teamRun: team,
  });
  const leaderName = team && item.leaderAccountId ? `Perpl #${item.leaderAccountId}` : leaderAddr ? shortAddr(leaderAddr) : item.leaderAccountId ? `Perpl #${item.leaderAccountId}` : "Leader";
  const size = lots(item.leaderLotLNS ?? item.lotLNS, m?.lotDecimals);
  const acctAddr = String(acct?.address ?? item.account ?? "");
  const who = team
    ? { seed: acctAddr, addr: shortAddr(acctAddr), sub: `Demo follower · copies ${leaderName}` }
    : { seed: leaderAddr ?? String(item.leaderAccountId ?? ""), addr: leaderName, sub: `Leader ${ACTIONS[ot]?.toLowerCase() ?? "trade"}${size ? ` ${size} ${m?.symbol ?? ""}` : ""}${item.leaderBlock ? ` · block ${Number(item.leaderBlock).toLocaleString("en-US")}` : ""}` };
  const tx = String(item.txHash);
  const url = ctx.explorerTx + tx;
  return {
    ...base("blocked", ctx),
    tag: team ? "Blocked copy" : "Blocked by my rule",
    teamRun: team ? "Team-run demo account" : undefined,
    blocked: x,
    who,
    proof: { url, display: `${display(ctx.explorerTx)}${shortAddr(tx)}`, caption: "The Blocked event, recorded onchain by the account contract." },
    fine: [team ? TEAM_FINE : "Recorded onchain by my account contract. My funds were not touched."],
    links: [
      txLink(ctx, tx, "Blocked event (account contract)", item.block ? `block ${Number(item.block).toLocaleString("en-US")}` : undefined),
      ...(item.leaderRef ? [txLink(ctx, String(item.leaderRef), "Leader's fill on Perpl", item.leaderBlock ? `block ${Number(item.leaderBlock).toLocaleString("en-US")}` : undefined)] : []),
      ...(acctAddr ? [{ label: team ? "Demo account contract" : "Account contract", href: ctx.explorerAddress + acctAddr }] : []),
    ],
    app: { label: "Set your own limits in Mirror", href: "/app" },
    title: `${team ? "Team-run demo · " : ""}${x.title}`,
    description: `${x.sentence.map((s) => s.t).join("")}${team ? " Team-run demo account." : ""}`,
  };
}

/** POST /v1/leaders/:id/backtest response, with the leader profile when it could be read. */
export function simModel(id: string, bt: Json, leader: Json | null, ctx: Ctx): CardModel {
  const addr = String(leader?.address ?? "");
  const name = shortAddr(addr) || `Perpl #${id}`;
  const pnl = toBig(bt.pnlCNS);
  const pnlPct = toNum(bt.pnlPct);
  const period = String(bt.period ?? "30d").replace("d", " days");
  const curve = ((bt.equityCurve ?? []) as Json[]).map((p) => toNum(p.equityCNS)).filter((v): v is number => v !== null);
  const pts = (bt.equityCurve ?? []) as Json[];
  const blockedTotal = toNum(bt.tradesBlockedTotal) ?? 0;
  const parts = [
    ctx.amounts && bt.depositCNS != null ? `on a ${ausd(bt.depositCNS)} AUSD deposit` : null,
    toNum(bt.tradesCopied) !== null ? `${bt.tradesCopied} copied` : null,
    `${blockedTotal} blocked by my rules`,
  ].filter(Boolean);
  const fees = ctx.amounts && bt.feesCNS != null ? `Fees ${ausd(bt.feesCNS)} AUSD${bt.builderFeesCNS != null ? ` incl. builder fee ${ausd(bt.builderFeesCNS)} AUSD` : ""}` : bt.builderFee?.feePer100K != null ? `Builder fee ${((Number(bt.builderFee.feePer100K) / 100_000) * 100).toFixed(3).replace(/0+$/, "")}% of opening size` : null;
  const dd = toNum(bt.maxDrawdownBps);
  const stats: Stat[] = [];
  if (dd !== null) stats.push({ k: "Max drawdown", v: dd > 0 ? `${MINUS}${pct(dd / 100, 2)}` : "0.00%", tone: dd > 0 ? "neg" : "tx" });
  if (fees) stats.push({ k: "Fees", v: fees.replace(/^Fees /, "") });
  const team = !!leader?.teamRun;
  const slip = toNum(bt.slippage?.bps);
  const taker = toNum(bt.takerFeeBps);
  let big: CardModel["big"];
  if (ctx.amounts && pnl !== null) big = { text: ausdSigned(pnl)!, unit: "AUSD", tone: pnl >= ZERO ? "pos" : "neg" };
  else if (pnlPct !== null) big = { text: pctSigned(pnlPct, 2)!, tone: pnlPct >= 0 ? "pos" : "neg" };
  // The QR opens the leader's page (design 08d): the real fills the simulation replays.
  const leaderUrl = ctx.landing.replace(/\/c\/sim\/([^/?]+).*$/, "/c/leader/$1");
  const day = (d: unknown) => (typeof d === "string" ? dateShort(Date.parse(`${d}T00:00:00Z`) / 1000) ?? d : undefined);
  return {
    ...base("sim", ctx),
    proof: { url: leaderUrl, display: display(leaderUrl), caption: "The leader's real fills, each linked to its Monad transaction." },
    tag: "Past fills, my limits",
    simulation: "Simulation",
    teamRun: team ? "Team-run demo leader" : undefined,
    kicker: `What if I had followed ${name} · ${period} · my limits`,
    big,
    sub: parts.join(" · "),
    chart: curve.length >= 2 ? { points: curve, tone: "tx", baseline: toNum(bt.depositCNS) ?? undefined, from: day(pts[0]?.date), to: day(pts[pts.length - 1]?.date) } : undefined,
    stats,
    fine: [
      `Simulation, not a promise. Leader fills${slip !== null ? ` moved ${slip} bps against the copy` : ""}${taker !== null ? `, Perpl taker fee ${taker} bps` : ""}, builder fee on opens, no funding.`,
      ...(team ? [TEAM_FINE] : []),
    ],
    links: [
      ...(addr ? [{ label: "Leader account on MonadVision", href: ctx.explorerAddress + addr }] : []),
      ...((leader?.recentTrades ?? []) as Json[]).slice(0, 12).map((t) => txLink(ctx, t.txHash, `Leader ${String(t.kind ?? "fill")} ${sym(ctx, t.perpId)}`, "real fill the simulation replays")),
    ],
    app: { label: "See this leader in Mirror", href: `/app/leader/${id}` },
    title: `Simulation · what if I had followed ${name}`,
    description: `Simulation, not a record of real copies. ${big ? `${big.text}${big.unit ? ` ${big.unit}` : ""} over ${period}` : ""} ${parts.join(" · ")}.`.trim(),
  };
}

