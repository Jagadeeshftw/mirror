import "server-only";
/** Assembles the wallet drill-down at /perpl/wallet/[account]: chain positions now, indexer history. */
import { account as readAccount } from "./chain";
import { INDEXER_CONFIGURED, walletHistory, type WalletEvent } from "./indexer";
import { marketRows, sourced, type MarketRow, type Sourced } from "./markets";
import { enrich, type RiskPosition } from "./overview";
import { liquidationPrice } from "./risk";
import { cns, scale } from "./format";

export type WalletPosition = RiskPosition & { deposit: number; pnl: number; funding: number; liqPrice: number | null; priceDecimals: number; sizeDecimals: number };

export type WalletFill = {
  timestamp: number;
  symbol: string;
  kind: string;
  side: "long" | "short";
  size: number | null;
  sizeDecimals: number;
  price: number | null;
  priceDecimals: number;
  priceEstimated: boolean;
  notional: number | null;
  realized: number | null;
  txHash: string;
};

export type Wallet = {
  query: string;
  found: boolean;
  accountId: number | null;
  address: string | null;
  block: number | null;
  balance: number | null;
  locked: number | null;
  frozen: boolean;
  positions: WalletPosition[];
  equity: number | null;
  unrealised: number | null;
  markets: Sourced<MarketRow[]>;
  chainError: string | null;
  history: Sourced<{
    isMirrorAccount: boolean;
    teamRun: boolean;
    createdAt: number | null;
    stats: NonNullable<Awaited<ReturnType<typeof walletHistory>>["PerplAccount_by_pk"]>["stats"];
    days: { t: number; net: number; cum: number; trades: number }[];
    leverage: { t: number; leverage: number; symbol: string }[];
    pnlFills: { t: number; cum: number }[];
    fills: WalletFill[];
    realized30d: number;
    trades30d: number;
  }> & { configured: boolean };
};

export const isAccountQuery = (q: string) => /^\d{1,9}$/.test(q) || /^0x[0-9a-fA-F]{40}$/.test(q);

function fills(events: WalletEvent[], markets: MarketRow[]): WalletFill[] {
  return events.map((e) => {
    const m = markets.find((x) => x.perpId === e.perpId);
    const pd = m?.priceDecimals ?? 0;
    const sd = m?.sizeDecimals ?? 0;
    return {
      timestamp: e.timestamp,
      symbol: m?.symbol ?? `#${e.perpId}`,
      kind: e.kind,
      side: e.side === "SHORT" ? "short" : "long",
      size: e.lotsKnown ? scale(e.lotsTradedLNS, sd) : null,
      sizeDecimals: sd,
      price: e.priceSource === "NONE" ? null : scale(e.pricePNS, pd),
      priceDecimals: pd,
      priceEstimated: e.priceSource === "LAST_TRADE",
      notional: e.lotsKnown ? cns(e.notionalCNS) : null,
      realized: cns(e.realizedPnlCNS),
      txHash: e.txHash,
    };
  });
}

/** Cumulative net realised PnL over the account's indexed fills, oldest first (for short indexed ranges). */
function pnlByFill(events: WalletEvent[]) {
  let cum = 0;
  return [...events].reverse().map((e) => {
    cum += cns(e.netPnlCNS) ?? 0;
    return { t: e.timestamp, cum };
  });
}

/**
 * Highest position leverage per hour, from each sized fill: size after x fill price / deposit after.
 * Per-hour maximum because fills of different markets interleave.
 */
function leverageSeries(events: WalletEvent[], markets: MarketRow[]) {
  const hourly = new Map<number, { t: number; leverage: number; symbol: string }>();
  for (const x of leverageFills(events, markets)) {
    const h = Math.floor(x.t / 3600) * 3600;
    const cur = hourly.get(h);
    if (!cur || x.leverage > cur.leverage) hourly.set(h, { ...x, t: h });
  }
  return [...hourly.values()].sort((a, b) => a.t - b.t);
}

function leverageFills(events: WalletEvent[], markets: MarketRow[]) {
  const out: { t: number; leverage: number; symbol: string }[] = [];
  for (const e of [...events].reverse()) {
    const m = markets.find((x) => x.perpId === e.perpId);
    if (!m || !e.lotsKnown || e.priceSource === "NONE") continue;
    const sizeAfter = scale(e.lotsAfterLNS, m.sizeDecimals) ?? 0;
    const px = scale(e.pricePNS, m.priceDecimals) ?? 0;
    const dep = cns(e.depositAfterCNS) ?? 0;
    if (sizeAfter > 0 && dep > 0 && px > 0) out.push({ t: e.timestamp, leverage: (sizeAfter * px) / dep, symbol: m.symbol });
  }
  return out;
}

export async function wallet(query: string): Promise<Wallet> {
  const markets = await sourced("Perpl REST /v1/pub/context", marketRows);
  const list = markets.ok ? markets.value : [];
  const base: Wallet = {
    query, found: false, accountId: null, address: null, block: null, balance: null, locked: null, frozen: false,
    positions: [], equity: null, unrealised: null, markets, chainError: null,
    history: { ok: false, reason: "not loaded", source: "Mirror indexer", configured: INDEXER_CONFIGURED },
  };
  let chain: Awaited<ReturnType<typeof readAccount>> = null;
  try {
    chain = await readAccount(query);
  } catch (e) {
    // getAccountById / getAccountByAddr revert for an id or address without a Perpl account.
    if (e instanceof Error && /revert/i.test(e.message)) chain = null;
    else return { ...base, chainError: e instanceof Error ? e.message.split("\n")[0] : "RPC unavailable" };
  }
  if (!chain) return base;
  const { rows } = enrich(chain.positions, list);
  const positions: WalletPosition[] = rows.map((r) => {
    const raw = chain!.positions.find((p) => p.perpId === r.perpId)!;
    const m = list.find((x) => x.perpId === r.perpId)!;
    const deposit = cns(raw.depositCNS)!;
    const pnl = cns(raw.pnlCNS)!;
    return {
      ...r, deposit, pnl, funding: cns(raw.fundingCNS)!, priceDecimals: m.priceDecimals, sizeDecimals: m.sizeDecimals,
      liqPrice: m.maintFraction === null ? null : liquidationPrice({ side: r.side, size: r.size, entry: r.entry, mark: r.mark, deposit, pnl }, m.maintFraction),
    };
  });
  const balance = cns(chain.account.balanceCNS)!;
  const locked = cns(chain.account.lockedCNS)!;
  const unrealised = positions.reduce((s, p) => s + p.pnl, 0);
  const id = chain.account.accountId;
  const history = await sourced("Mirror indexer", async () => {
    if (!INDEXER_CONFIGURED) throw new Error("Indexer URL not set");
    const today = Math.floor(Date.now() / 86_400_000);
    const h = await walletHistory(id, today - 90, 500);
    const acct = h.PerplAccount_by_pk;
    const days = h.DailyAccountStats.map((d) => ({ t: d.day * 86400, net: cns(d.netPnlCNS) ?? 0, cum: cns(d.endCumPnlCNS) ?? 0, trades: d.trades }));
    const last30 = h.DailyAccountStats.filter((d) => d.day > today - 30);
    return {
      isMirrorAccount: acct?.isMirrorAccount ?? false,
      teamRun: acct?.teamRun ?? false,
      createdAt: acct?.createdAt ?? null,
      stats: acct?.stats ?? null,
      days,
      leverage: leverageSeries(h.PositionEvent, list),
      pnlFills: pnlByFill(h.PositionEvent),
      fills: fills(h.PositionEvent, list),
      realized30d: last30.reduce((s, d) => s + (cns(d.netPnlCNS) ?? 0), 0),
      trades30d: last30.reduce((s, d) => s + d.trades, 0),
    };
  });
  return {
    ...base, found: true, accountId: id, address: chain.account.address, block: chain.block, balance, locked,
    frozen: chain.account.frozen, positions, unrealised,
    equity: balance + locked + positions.reduce((s, p) => s + p.deposit + p.pnl, 0),
    history: { ...history, configured: INDEXER_CONFIGURED },
  };
}
