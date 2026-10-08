// Watch mode without the Mirror backend: read the team-run demo follower (and the owner's own follow
// accounts) straight from Monad. Equity comes from MirrorAccount.equity(); copies come from its Mirrored /
// Blocked logs, fetched newest first in 100-block chunks (Monad's eth_getLogs limit), a few chunks at a
// time, never more than MAX_LOG_REQUESTS per read. Refreshes scan only the blocks since the last read.
// Reads only.
import { parseEventLogs, type Abi } from "viem";
import MirrorAccount from "./MirrorAccount.json";
import { BLOCK_REASONS, followSalt, predictAccount } from "./contracts";
import type { Address, AppConfig, FeedEvent, Hex } from "./types";

const FULL_ABI = ((MirrorAccount as any).abi ?? MirrorAccount) as Abi;
export const WATCH_ABI = FULL_ABI.filter((x: any) => (x.type === "event" && (x.name === "Mirrored" || x.name === "Blocked")) || (x.type === "function" && x.name === "equity")) as Abi;

export const LOG_CHUNK = 100;
/** Monad produces a block about every 0.4 s; timestamps of RPC-read copies are estimated from depth. */
export const BLOCK_MS = 400;
/** At most this many eth_getLogs calls per read (plus one block number and one equity call). */
export const MAX_LOG_REQUESTS = 28;
/** Look-back while Mirror's service is down: 2,800 blocks, about 19 minutes. */
export const DOWN_SCAN_BLOCKS = LOG_CHUNK * MAX_LOG_REQUESTS;
/** Default look-back when the service is up but the demo feed is not (about 10 minutes). */
export const DEFAULT_SCAN_BLOCKS = 1500;
/** eth_getLogs calls in flight at once. */
export const LOG_PARALLEL = 4;

export interface WatchClient {
  getBlockNumber(args?: { cacheTime?: number }): Promise<bigint>;
  getLogs(args: { address: Address; fromBlock: bigint; toBlock: bigint }): Promise<any[]>;
  readContract(args: { address: Address; abi: Abi; functionName: "equity" }): Promise<unknown>;
}

export interface WatchSnapshot {
  account?: Address;
  /** Head block of the read. */
  block: number;
  /** Oldest block scanned (inclusive): the copies shown cover fromBlock..block. */
  fromBlock: number;
  equityCNS: string;
  events: FeedEvent[];
  readAt: number;
  /** eth_getLogs calls this read made. */
  logRequests: number;
}

/** Minutes covered by a snapshot's scan, at BLOCK_MS per block (at least 1). */
export function scannedMinutes(s: Pick<WatchSnapshot, "block" | "fromBlock">): number {
  return Math.max(1, Math.round(((s.block - s.fromBlock + 1) * BLOCK_MS) / 60_000));
}

export function logToEvent(log: any, account: Address, head: bigint, now: number, teamRun = true): FeedEvent | null {
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
    teamRun,
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

export interface ReadOpts {
  /** Look-back in blocks, capped at MAX_LOG_REQUESTS chunks. */
  maxBlocks?: number;
  /** Stop once this many copies are found (a full read only). */
  want?: number;
  now?: number;
  /** The previous read of the same account: only blocks after prev.block are scanned and merged in. */
  prev?: WatchSnapshot | null;
  /** Mark events as team-run (watch mode) or as the owner's own copies. */
  teamRun?: boolean;
  parallel?: number;
}

/** Reads equity and the latest copies of `account`, newest first, scanning back at most `maxBlocks`. */
export async function readWatchFromRpc(client: WatchClient, account: Address, opts: ReadOpts = {}): Promise<WatchSnapshot> {
  const maxBlocks = Math.min(opts.maxBlocks ?? DEFAULT_SCAN_BLOCKS, LOG_CHUNK * MAX_LOG_REQUESTS);
  const want = opts.want ?? 6;
  const now = opts.now ?? Date.now();
  const parallel = Math.max(1, opts.parallel ?? LOG_PARALLEL);
  const teamRun = opts.teamRun ?? true;
  const head = await client.getBlockNumber({ cacheTime: 0 });
  const equityP = client.readContract({ address: account, abi: WATCH_ABI, functionName: "equity" });
  const prev = opts.prev && (!opts.prev.account || opts.prev.account.toLowerCase() === account.toLowerCase()) ? opts.prev : null;
  const fullFloor = head - BigInt(maxBlocks) > 0n ? head - BigInt(maxBlocks) : 0n;
  // Incremental: the previous read is recent enough that the gap fits in the look-back.
  const incremental = !!prev && BigInt(prev.block) <= head && head - BigInt(prev.block) < BigInt(maxBlocks);
  const floor = incremental ? BigInt(prev!.block) : fullFloor; // scans (floor, head]
  const ranges: [bigint, bigint][] = [];
  for (let to = head; to > floor && ranges.length < MAX_LOG_REQUESTS; to -= BigInt(LOG_CHUNK)) {
    const from = to - BigInt(LOG_CHUNK - 1) > floor ? to - BigInt(LOG_CHUNK - 1) : floor + 1n;
    ranges.push([from, to]);
  }
  const found: FeedEvent[] = [];
  let lowest = head + 1n;
  let requests = 0;
  for (let i = 0; i < ranges.length; i += parallel) {
    if (!incremental && found.length >= want) break;
    const batch = ranges.slice(i, i + parallel);
    const logs = await Promise.all(batch.map(([fromBlock, toBlock]) => client.getLogs({ address: account, fromBlock, toBlock })));
    requests += batch.length;
    for (let j = 0; j < batch.length; j++) {
      lowest = batch[j][0] < lowest ? batch[j][0] : lowest;
      const parsed = parseEventLogs({ abi: WATCH_ABI, logs: logs[j] as any, strict: false }) as any[];
      found.push(...parsed.map((l) => logToEvent(l, account, head, now, teamRun)).filter((e): e is FeedEvent => !!e));
    }
  }
  const seen = new Set<string>();
  const events = [...found, ...(incremental ? prev!.events : [])]
    .filter((e) => (seen.has(e.id) ? false : (seen.add(e.id), true)))
    .sort((x, y) => (y.block ?? 0) - (x.block ?? 0));
  const equity = await equityP;
  const fromBlock = incremental ? prev!.fromBlock : ranges.length ? Number(lowest <= head ? lowest : head) : Number(head);
  return { account, block: Number(head), fromBlock, equityCNS: String(equity as bigint), events: events.slice(0, want), readAt: now, logRequests: requests };
}

/** Code lookup for account discovery (viem's getCode). */
export interface OwnClient extends WatchClient {
  getCode(args: { address: Address }): Promise<Hex | undefined>;
}

export const MAX_OWN_ACCOUNTS = 3;
/** Total RPC calls per own-accounts read. */
export const MAX_RPC_PER_READ = 30;

/**
 * The owner's follow accounts, found without Mirror's service: the factory's CREATE2 address for salts 0, 1, 2…
 * (followSalt), kept while code is deployed there. Needs the factory and implementation in the config.
 */
export async function discoverOwnAccounts(client: Pick<OwnClient, "getCode">, cfg: Pick<AppConfig, "contracts">, owner: Address, max = MAX_OWN_ACCOUNTS): Promise<Address[]> {
  const { factory, implementation } = cfg.contracts;
  if (!factory || !implementation) return [];
  const out: Address[] = [];
  for (let i = 0; i < max; i++) {
    const a = predictAccount(factory, implementation, owner, followSalt(i));
    const code = await client.getCode({ address: a });
    if (!code || code === "0x") break;
    out.push(a);
  }
  return out;
}

export interface OwnSnapshot {
  accounts: { account: Address; equityCNS: string }[];
  /** Sum of the accounts' equity. */
  equityCNS: string;
  events: FeedEvent[];
  block: number | null;
  fromBlock: number | null;
  readAt: number;
}

/** The owner's own accounts, equity and latest copies, read from Monad. The log budget is split across accounts. */
export async function readOwnFromRpc(client: OwnClient, cfg: Pick<AppConfig, "contracts">, owner: Address, opts: { now?: number; want?: number; prev?: OwnSnapshot | null } = {}): Promise<OwnSnapshot> {
  const now = opts.now ?? Date.now();
  const accounts = await discoverOwnAccounts(client, cfg, owner);
  if (!accounts.length) return { accounts: [], equityCNS: "0", events: [], block: null, fromBlock: null, readAt: now };
  // At most 30 RPC calls in all: getCode lookups, then per account a block number, an equity call and its share of logs.
  const codeCalls = Math.min(accounts.length + 1, MAX_OWN_ACCOUNTS);
  const per = Math.max(1, Math.floor((MAX_RPC_PER_READ - codeCalls - 2 * accounts.length) / accounts.length));
  const snaps: WatchSnapshot[] = [];
  for (const a of accounts) {
    const prevEvents = opts.prev?.events.filter((e) => e.account?.toLowerCase() === a.toLowerCase()) ?? [];
    const prev = opts.prev?.block != null && opts.prev.fromBlock != null && opts.prev.accounts.some((x) => x.account.toLowerCase() === a.toLowerCase())
      ? { account: a, block: opts.prev.block, fromBlock: opts.prev.fromBlock, equityCNS: "0", events: prevEvents, readAt: opts.prev.readAt, logRequests: 0 }
      : null;
    snaps.push(await readWatchFromRpc(client, a, { maxBlocks: per * LOG_CHUNK, want: opts.want ?? 20, now, prev, teamRun: false }));
  }
  const events = snaps.flatMap((x) => x.events).sort((x, y) => (y.block ?? 0) - (x.block ?? 0));
  return {
    accounts: snaps.map((x, i) => ({ account: accounts[i], equityCNS: x.equityCNS })),
    equityCNS: snaps.reduce((t, x) => t + BigInt(x.equityCNS), 0n).toString(),
    events: events.slice(0, opts.want ?? 20),
    block: Math.max(...snaps.map((x) => x.block)),
    fromBlock: Math.max(...snaps.map((x) => x.fromBlock)),
    readAt: now,
  };
}
