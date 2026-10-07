import "server-only";
/**
 * Indexer (Envio + Hasura) client for the analytics view. URL from NEXT_PUBLIC_INDEXER_URL (or INDEXER_URL),
 * e.g. https://<host>/v1/graphql. Unset or unreachable: callers render "not available".
 */
import { QUERIES, type QueryName } from "./queries";

export const INDEXER_URL = (process.env.NEXT_PUBLIC_INDEXER_URL ?? process.env.INDEXER_URL ?? "").trim();
export const INDEXER_CONFIGURED = /^https?:\/\//.test(INDEXER_URL);

export class IndexerError extends Error {}

export async function gql<T>(name: QueryName, variables: Record<string, unknown> = {}, revalidate = 30): Promise<T> {
  if (!INDEXER_CONFIGURED) throw new IndexerError("Indexer URL not set");
  let res: Response;
  try {
    res = await fetch(INDEXER_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: QUERIES[name], variables, operationName: name }),
      next: { revalidate },
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new IndexerError("Indexer did not answer");
  }
  if (!res.ok) throw new IndexerError(`Indexer answered HTTP ${res.status}`);
  const body = (await res.json()) as { data?: T; errors?: { message: string }[] };
  if (body.errors?.length || !body.data) throw new IndexerError(body.errors?.[0]?.message ?? "Empty indexer response");
  return body.data;
}

export type Coverage = { startBlock: number; processedBlock: number; headBlock: number; fromTs: number | null; toTs: number | null };

export async function coverage(): Promise<Coverage> {
  const d = await gql<{
    chain_metadata: { start_block: number; latest_processed_block: number | null; block_height: number }[];
    first: { timestamp: number }[];
    last: { timestamp: number }[];
  }>("AnalyticsCoverage");
  const c = d.chain_metadata[0];
  return {
    startBlock: c?.start_block ?? 0,
    processedBlock: c?.latest_processed_block ?? 0,
    headBlock: c?.block_height ?? 0,
    fromTs: d.first[0]?.timestamp ?? null,
    toTs: d.last[0]?.timestamp ?? null,
  };
}

export type LiquidationRow = {
  accountId: string;
  perpId: number;
  kind: "LIQUIDATION" | "DELEVERAGE";
  side: "LONG" | "SHORT";
  lotsClosedLNS: string;
  pricePNS: string;
  notionalCNS: string;
  realizedPnlCNS: string;
  depositBeforeCNS: string;
  timestamp: number;
  txHash: string;
};

export async function liquidations(since: number, limit = 1000) {
  return (await gql<{ PositionEvent: LiquidationRow[] }>("Liquidations", { since, limit })).PositionEvent;
}

export async function activeTraders(since: number, limit = 20000) {
  const rows = (await gql<{ PositionEvent: { accountId: string }[] }>("ActiveTraders", { since, limit })).PositionEvent;
  return { count: rows.length, capped: rows.length >= limit };
}

export type WalletEvent = {
  perpId: number;
  kind: string;
  side: "LONG" | "SHORT";
  lotsTradedLNS: string;
  lotsAfterLNS: string;
  lotsKnown: boolean;
  pricePNS: string;
  priceSource: string;
  notionalCNS: string;
  realizedPnlCNS: string;
  netPnlCNS: string;
  leverageHdths: number;
  depositAfterCNS: string;
  timestamp: number;
  txHash: string;
};

export type WalletDay = { day: number; date: string; trades: number; realizedPnlCNS: string; fundingCNS: string; feesCNS: string; netPnlCNS: string; volumeCNS: string; endCumPnlCNS: string };

export type WalletHistory = {
  PerplAccount_by_pk: {
    accountId: string;
    address: string | null;
    isMirrorAccount: boolean;
    teamRun: boolean;
    createdAt: number | null;
    netDepositedCNS: string;
    stats: null | {
      trades: number;
      closingTrades: number;
      wins: number;
      losses: number;
      winRateBps: number;
      liquidations: number;
      realizedPnlCNS: string;
      fundingCNS: string;
      feesCNS: string;
      netPnlCNS: string;
      volumeCNS: string;
      avgLeverageHdths: number;
      maxDrawdownCNS: string;
      firstTradeAt: number;
      lastTradeAt: number;
      followers: number;
    };
  } | null;
  DailyAccountStats: WalletDay[];
  PositionEvent: WalletEvent[];
};

export function walletHistory(accountId: number, sinceDay: number, events = 200) {
  return gql<WalletHistory>("WalletHistory", { id: String(accountId), accountId: String(accountId), sinceDay, events });
}
