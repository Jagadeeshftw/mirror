// Watch mode without the Mirror backend: read the team-run demo follower straight from Monad.
// Equity comes from MirrorAccount.equity(); copies come from its Mirrored / Blocked logs, fetched
// newest first in 100-block chunks (Monad's eth_getLogs limit). Reads only.
import { parseEventLogs, type Abi } from "viem";
import MirrorAccount from "./MirrorAccount.json";
import { BLOCK_REASONS } from "./contracts";
import type { Address, FeedEvent, Hex } from "./types";

const FULL_ABI = ((MirrorAccount as any).abi ?? MirrorAccount) as Abi;
export const WATCH_ABI = FULL_ABI.filter((x: any) => (x.type === "event" && (x.name === "Mirrored" || x.name === "Blocked")) || (x.type === "function" && x.name === "equity")) as Abi;

export const LOG_CHUNK = 100;
/** Monad produces a block about every 0.4 s; timestamps of RPC-read copies are estimated from depth. */
export const BLOCK_MS = 400;

export interface WatchClient {
  getBlockNumber(args?: { cacheTime?: number }): Promise<bigint>;
  getLogs(args: { address: Address; fromBlock: bigint; toBlock: bigint }): Promise<any[]>;
  readContract(args: { address: Address; abi: Abi; functionName: "equity" }): Promise<unknown>;
}

export interface WatchSnapshot {
  block: number;
  equityCNS: string;
  events: FeedEvent[];
  readAt: number;
}

export function logToEvent(log: any, account: Address, head: bigint, now: number): FeedEvent | null {
  const a = log.args ?? {};
  const block = Number(log.blockNumber);
  const depth = Number(head) - block;
  const base = {
    id: `rpc-${log.transactionHash}-${log.logIndex}`,
    account,
    txHash: log.transactionHash as Hex,
    onchain: true,
    block,
    timestamp: now - Math.max(0, depth) * BLOCK_MS,
    commitState: (depth >= 2 ? "finalized" : depth >= 1 ? "voted" : "proposed") as FeedEvent["commitState"],
    leaderAccountId: Number(a.leaderAccountId),
    perpId: Number(a.perpId),
    orderType: Number(a.orderType) as 0 | 1 | 2 | 3,
    lotLNS: String(a.lotLNS),
    leaderRef: a.leaderRef as Hex,
    teamRun: true,
  };
  if (log.eventName === "Mirrored") {
    const p = a.proof ?? {};
    return {
      ...base,
      kind: "Mirrored",
      pricePNS: String(p.fillPNS ?? a.pricePNS),
      leverageHdths: Number(a.leverageHdths),
      proof: {
        leaderFillPNS: String(p.leaderFillPNS ?? 0),
        leaderEntryPNS: String(p.leaderEntryPNS ?? 0),
        markPNS: String(p.markPNS ?? 0),
        fillPNS: String(p.fillPNS ?? 0),
        entryDeviationBps: Number(p.entryDeviationBps ?? 0),
        ...(p.builderFeeCNS !== undefined ? { builderFeeCNS: String(p.builderFeeCNS) } : {}),
      } as FeedEvent["proof"],
    };
  }
  if (log.eventName === "Blocked") {
    const code = Number(a.reason);
    return {
      ...base,
      kind: "Blocked",
      leaderLotLNS: String(a.lotLNS),
      pricePNS: String(a.markPNS),
      blocked: { reason: BLOCK_REASONS[code] ?? `Reason${code}`, reasonCode: code, limit: String(a.limit), actual: String(a.actual) },
      data: { leaderFillPNS: String(a.leaderFillPNS), markPNS: String(a.markPNS) },
    };
  }
  return null;
}

/** Reads equity and the latest copies of `account`, scanning back at most `maxBlocks`. */
export async function readWatchFromRpc(client: WatchClient, account: Address, opts: { maxBlocks?: number; want?: number; now?: number } = {}): Promise<WatchSnapshot> {
  const maxBlocks = opts.maxBlocks ?? 1500;
  const want = opts.want ?? 6;
  const now = opts.now ?? Date.now();
  const head = await client.getBlockNumber({ cacheTime: 0 });
  const equityP = client.readContract({ address: account, abi: WATCH_ABI, functionName: "equity" });
  const events: FeedEvent[] = [];
  const floor = head - BigInt(maxBlocks) > 0n ? head - BigInt(maxBlocks) : 0n;
  for (let to = head; to > floor && events.length < want; to -= BigInt(LOG_CHUNK)) {
    const from = to - BigInt(LOG_CHUNK - 1) > floor ? to - BigInt(LOG_CHUNK - 1) : floor;
    const raw = await client.getLogs({ address: account, fromBlock: from, toBlock: to });
    const parsed = parseEventLogs({ abi: WATCH_ABI, logs: raw as any, strict: false }) as any[];
    const chunk = parsed.map((l) => logToEvent(l, account, head, now)).filter((e): e is FeedEvent => !!e);
    chunk.sort((x, y) => y.block - x.block);
    events.push(...chunk);
  }
  const equity = await equityP;
  return { block: Number(head), equityCNS: String(equity as bigint), events: events.slice(0, want), readAt: now };
}
