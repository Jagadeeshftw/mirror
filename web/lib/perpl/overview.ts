import "server-only";
/** Assembles the protocol overview at /perpl from Perpl REST, onchain reads and the indexer. */
import { snapshot, type ChainPosition } from "./chain";
import { activeTraders, coverage, INDEXER_CONFIGURED, liquidations, type Coverage, type LiquidationRow } from "./indexer";
import { chainOi, fundingHistory, marketRows, sourced, volumeHistory, type MarketRow, type Sourced } from "./markets";
import { distanceToLiquidation, effectiveLeverage, hhi, leverageBuckets, marginUsed, topShare, type Bucket } from "./risk";
import { cns, scale } from "./format";

export type RiskPosition = {
  accountId: number;
  perpId: number;
  symbol: string;
  side: "long" | "short";
  size: number;
  entry: number;
  mark: number;
  notional: number;
  equity: number;
  leverage: number;
  liqDistance: number | null;
  marginUsed: number | null;
};

export type RiskSummary = {
  block: number;
  readAt: number;
  accounts: number;
  positions: number;
  traders: number;
  longNotional: number;
  shortNotional: number;
  top10Share: number | null;
  hhi: number | null;
  topAccounts: { accountId: number; address: string | null; notional: number; share: number; positions: number; symbols: string[] }[];
  closest: RiskPosition[];
  within5: number;
  within10: number;
  buckets: Bucket[];
  skipped: number;
  /** Open positions per market and side (counts); open interest itself is always matched long = short. */
  sides: Record<number, { long: number; short: number }>;
};

/** Enrich chain positions with display units and the risk estimates. Positions of unknown markets are skipped. */
export function enrich(positions: ChainPosition[], markets: MarketRow[]): { rows: RiskPosition[]; skipped: number } {
  const rows: RiskPosition[] = [];
  let skipped = 0;
  for (const p of positions) {
    const m = markets.find((x) => x.perpId === p.perpId);
    if (!m || m.maintFraction === null) {
      skipped++;
      continue;
    }
    const size = scale(p.lotLNS, m.sizeDecimals)!;
    const entry = scale(p.entryPNS, m.priceDecimals)!;
    const mark = p.markValid && p.markPNS > BigInt(0) ? scale(p.markPNS, m.priceDecimals)! : (m.mark ?? 0);
    const input = { side: p.side, size, entry, mark, deposit: cns(p.depositCNS)!, pnl: cns(p.pnlCNS)! };
    rows.push({
      accountId: p.accountId,
      perpId: p.perpId,
      symbol: m.symbol,
      side: p.side,
      size,
      entry,
      mark,
      notional: size * mark,
      equity: input.deposit + input.pnl,
      leverage: effectiveLeverage(input),
      liqDistance: distanceToLiquidation(input, m.maintFraction),
      marginUsed: marginUsed(input, m.maintFraction),
    });
  }
  return { rows, skipped };
}

async function risk(markets: MarketRow[]): Promise<RiskSummary> {
  const snap = await snapshot();
  const { rows, skipped } = enrich(snap.positions, markets);
  const byAccount = new Map<number, { notional: number; positions: number; symbols: Set<string> }>();
  for (const r of rows) {
    const a = byAccount.get(r.accountId) ?? { notional: 0, positions: 0, symbols: new Set<string>() };
    a.notional += r.notional;
    a.positions += 1;
    a.symbols.add(r.symbol);
    byAccount.set(r.accountId, a);
  }
  const total = rows.reduce((s, r) => s + r.notional, 0);
  const accountNotional = [...byAccount.values()].map((a) => a.notional);
  const topAccounts = [...byAccount.entries()]
    .sort((a, b) => b[1].notional - a[1].notional)
    .slice(0, 10)
    .map(([accountId, a]) => ({ accountId, address: snap.addresses[accountId] ?? null, notional: a.notional, share: total > 0 ? a.notional / total : 0, positions: a.positions, symbols: [...a.symbols] }));
  const withDist = rows.filter((r) => r.liqDistance !== null);
  const sides: RiskSummary["sides"] = {};
  for (const r of rows) {
    const x = (sides[r.perpId] ??= { long: 0, short: 0 });
    x[r.side] += 1;
  }
  return {
    block: snap.block,
    readAt: snap.readAt,
    accounts: snap.accounts,
    positions: rows.length,
    traders: byAccount.size,
    longNotional: rows.filter((r) => r.side === "long").reduce((s, r) => s + r.notional, 0),
    shortNotional: rows.filter((r) => r.side === "short").reduce((s, r) => s + r.notional, 0),
    top10Share: topShare(accountNotional, 10),
    hhi: hhi(accountNotional),
    topAccounts,
    closest: [...withDist].sort((a, b) => a.liqDistance! - b.liqDistance! || b.notional - a.notional).slice(0, 10),
    within5: withDist.filter((r) => r.liqDistance! < 0.05).length,
    within10: withDist.filter((r) => r.liqDistance! < 0.1).length,
    buckets: leverageBuckets(rows.map((r) => ({ leverage: r.leverage, notional: r.notional }))),
    skipped,
    sides,
  };
}

export type ActivityWindow = { since: number; partial: boolean; traders: number; tradersCapped: boolean; liqCount: number; delevCount: number; liqNotional: number; liqAccounts: number };

export type IndexerPanel = { coverage: Coverage; day: ActivityWindow; week: ActivityWindow; recent: LiquidationRow[] };

async function indexerPanel(): Promise<IndexerPanel> {
  const now = Math.floor(Date.now() / 1000);
  const cov = await coverage();
  const window = async (secs: number): Promise<{ w: ActivityWindow; rows: LiquidationRow[] }> => {
    const since = now - secs;
    const [t, rows] = await Promise.all([activeTraders(since), liquidations(since)]);
    const liq = rows.filter((r) => r.kind === "LIQUIDATION");
    return {
      rows,
      w: {
        since,
        partial: cov.fromTs === null || cov.fromTs > since + 600,
        traders: t.count,
        tradersCapped: t.capped,
        liqCount: liq.length,
        delevCount: rows.length - liq.length,
        liqNotional: rows.reduce((s, r) => s + (cns(r.notionalCNS) ?? 0), 0),
        liqAccounts: new Set(rows.map((r) => r.accountId)).size,
      },
    };
  };
  const [day, week] = await Promise.all([window(86_400), window(7 * 86_400)]);
  return { coverage: cov, day: day.w, week: week.w, recent: week.rows.slice(0, 12) };
}

export type Overview = {
  generatedAt: number;
  markets: Sourced<MarketRow[]>;
  oi: Sourced<Awaited<ReturnType<typeof chainOi>>>;
  volume: Sourced<Awaited<ReturnType<typeof volumeHistory>>>;
  funding: Sourced<Awaited<ReturnType<typeof fundingHistory>>>;
  risk: Sourced<RiskSummary>;
  indexer: Sourced<IndexerPanel> & { configured: boolean };
};

export async function overview(): Promise<Overview> {
  const markets = await sourced("Perpl REST /v1/pub/context", marketRows);
  const list = markets.ok ? markets.value : [];
  const none = (): Promise<never> => Promise.reject(new Error("Perpl market list unavailable"));
  const [oi, volume, funding, riskS, idx] = await Promise.all([
    sourced("Exchange getPerpetualInfoV2", () => (list.length ? chainOi(list) : none())),
    sourced("Perpl REST candles", () => (list.length ? volumeHistory(list) : none())),
    sourced("Perpl REST funding", () => (list.length ? fundingHistory(list) : none())),
    sourced("Exchange getAccountById + getPositionV2", () => (list.length ? risk(list) : none())),
    sourced("Mirror indexer", () => (INDEXER_CONFIGURED ? indexerPanel() : Promise.reject(new Error("Indexer URL not set")))),
  ]);
  return { generatedAt: Math.floor(Date.now() / 1000), markets, oi, volume, funding, risk: riskS, indexer: { ...idx, configured: INDEXER_CONFIGURED } };
}
