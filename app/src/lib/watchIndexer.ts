// Watch mode with the engine down but Mirror's indexer up: the team-run demo follower's latest copies and blocked
// copies from the indexer's public, read-only GraphQL (Hasura over the Envio indexer), so the laptop and phone
// feeds show real history instead of only the last minutes an RPC scan can cover. Reads only.
import type { Address, FeedEvent, Hex } from "./types";
import { BLOCK_REASONS } from "./contracts";

const ORDER = { OPEN_LONG: 0, OPEN_SHORT: 1, CLOSE_LONG: 2, CLOSE_SHORT: 3 } as const;

const QUERY = `query Watch($a: String!, $n: Int!) {
  CopyEvent(where: { mirrorAccount_id: { _eq: $a } }, order_by: { timestamp: desc }, limit: $n) {
    id txHash timestamp blockNumber leaderAccountId perpId orderType lotLNS pricePNS fillPricePNS leverageHdths leaderRef
    leaderFillReportedPNS leaderEntryPNS markPNS proofFillPNS entryDeviationBps builderFeeCNS builderFeePerplCNS
    latencyBlocks latencySeconds teamRun
  }
  BlockedCopy(where: { mirrorAccount_id: { _eq: $a } }, order_by: { timestamp: desc }, limit: $n) {
    id txHash timestamp blockNumber leaderAccountId perpId orderType lotLNS reason reasonCode limit actual leaderFillPNS markPNS teamRun
  }
}`;

export interface IndexerCopy {
  id: string; txHash: string; timestamp: number; blockNumber: number; leaderAccountId: string; perpId: number;
  orderType: keyof typeof ORDER; lotLNS: string; pricePNS: string; fillPricePNS: string; leverageHdths: number; leaderRef: string;
  leaderFillReportedPNS: string; leaderEntryPNS: string; markPNS: string; proofFillPNS: string; entryDeviationBps: number;
  builderFeeCNS: string; builderFeePerplCNS: string | null; latencyBlocks: number | null; latencySeconds: number | null; teamRun: boolean;
}
export interface IndexerBlocked {
  id: string; txHash: string; timestamp: number; blockNumber: number; leaderAccountId: string; perpId: number;
  orderType: keyof typeof ORDER; lotLNS: string; reason: string; reasonCode: number; limit: string; actual: string;
  leaderFillPNS: string; markPNS: string; teamRun: boolean;
}

export function copyToEvent(c: IndexerCopy, account: Address): FeedEvent {
  return {
    id: `idx-${c.id}`,
    account,
    kind: "Mirrored",
    txHash: c.txHash as Hex,
    onchain: true,
    block: c.blockNumber,
    timestamp: c.timestamp * 1000,
    commitState: "finalized",
    leaderAccountId: Number(c.leaderAccountId),
    perpId: c.perpId,
    orderType: ORDER[c.orderType],
    lotLNS: String(c.lotLNS),
    leaderRef: c.leaderRef as Hex,
    teamRun: c.teamRun,
    pricePNS: String(c.proofFillPNS !== "0" ? c.proofFillPNS : c.fillPricePNS),
    leverageHdths: c.leverageHdths,
    // Block timestamps are whole seconds, so the indexer's latencySeconds would read as "0.00 s": blocks only.
    ...(c.latencyBlocks !== null && c.latencyBlocks !== undefined ? { latencyBlocks: c.latencyBlocks } : {}),
    proof: {
      leaderFillPNS: String(c.leaderFillReportedPNS),
      leaderEntryPNS: String(c.leaderEntryPNS),
      markPNS: String(c.markPNS),
      fillPNS: String(c.proofFillPNS),
      entryDeviationBps: c.entryDeviationBps,
      builderFeeCNS: String(c.builderFeePerplCNS ?? c.builderFeeCNS),
    },
  } as FeedEvent;
}

export function blockedToEvent(b: IndexerBlocked, account: Address): FeedEvent {
  return {
    id: `idx-${b.id}`,
    account,
    kind: "Blocked",
    txHash: b.txHash as Hex,
    onchain: true,
    block: b.blockNumber,
    timestamp: b.timestamp * 1000,
    commitState: "finalized",
    leaderAccountId: Number(b.leaderAccountId),
    perpId: b.perpId,
    orderType: ORDER[b.orderType],
    lotLNS: String(b.lotLNS),
    leaderLotLNS: String(b.lotLNS),
    teamRun: b.teamRun,
    pricePNS: String(b.markPNS),
    blocked: { reason: BLOCK_REASONS[b.reasonCode] ?? b.reason, reasonCode: b.reasonCode, limit: String(b.limit), actual: String(b.actual) },
    data: { leaderFillPNS: String(b.leaderFillPNS), markPNS: String(b.markPNS) },
  } as FeedEvent;
}

/** Latest copies and blocked copies of `account`, newest first (at most `want`). Throws when the indexer can't answer. */
export async function readWatchFromIndexer(url: string, account: Address, want = 20, fetchFn: typeof fetch = fetch): Promise<FeedEvent[]> {
  const r = await fetchFn(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query: QUERY, variables: { a: account, n: want } }),
    signal: AbortSignal.timeout ? AbortSignal.timeout(8000) : undefined,
  });
  if (!r.ok) throw new Error(`indexer ${r.status}`);
  const j = (await r.json()) as { data?: { CopyEvent: IndexerCopy[]; BlockedCopy: IndexerBlocked[] }; errors?: unknown };
  if (!j.data) throw new Error("indexer: no data");
  const events = [...j.data.CopyEvent.map((c) => copyToEvent(c, account)), ...j.data.BlockedCopy.map((b) => blockedToEvent(b, account))];
  events.sort((a, b) => b.timestamp - a.timestamp || b.block - a.block);
  return events.slice(0, want);
}
