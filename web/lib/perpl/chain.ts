import "server-only";
/**
 * Onchain reads of the Perpl Exchange on Monad mainnet (no indexer needed):
 *  - snapshot(): every Perpl account (ids are sequential from 1) via getAccountById, then getPositionV2 for
 *    every market bit set in its position bitmap. Batched with Multicall3, about 25 eth_calls, cached 60 s.
 *  - perpetuals(): getPerpetualInfoV2 per market (long and short open interest, mark, oracle).
 *  - account(): one account by id or address and its open positions.
 * Struct layouts follow contracts/src/interfaces/IPerplExchange.sol (published Exchange ABI).
 */
import { createPublicClient, http, parseAbi, type Address } from "viem";

export const EXCHANGE: Address = "0x34B6552d57a35a1D042CcAe1951BD1C370112a6F";
const MULTICALL3: Address = "0xcA11bde05977b3631167028862bE2a173976CA11";
const RPC_URL = process.env.MONAD_RPC_URL ?? "https://rpc.monad.xyz";
const ZERO = "0x0000000000000000000000000000000000000000";
const N0 = BigInt(0);
const N1 = BigInt(1);

const abi = parseAbi([
  "struct PositionBitMap { uint256 bank1; uint256 bank2; uint256 bank3; uint256 bank4; }",
  "struct AccountInfo { uint256 accountId; uint256 balanceCNS; uint256 lockedBalanceCNS; uint8 frozen; address accountAddr; PositionBitMap positions; }",
  "struct PositionInfoV2 { uint256 accountId; uint256 nextNodeId; uint256 prevNodeId; uint8 positionType; uint256 depositCNS; uint256 pricePNS; uint256 lotLNS; uint256 entryBlock; int256 pnlCNS; int256 deltaPnlCNS; int256 premiumPnlCNS; uint256 priceResiduePNSQ16; }",
  "struct PerpetualInfoV2 { string name; string symbol; uint256 priceDecimals; uint256 lotDecimals; bytes32 linkFeedId; uint256 priceTolPer100K; uint256 marginTol; uint256 marginTolDecimals; uint256 refPriceMaxAgeSec; uint256 positionBalanceCNS; uint256 insuranceBalanceCNS; uint256 markPNS; uint256 markTimestamp; uint256 lastPNS; uint256 lastTimestamp; uint256 oraclePNS; uint256 oracleTimestampSec; uint256 longOpenInterestLNS; uint256 shortOpenInterestLNS; uint256 fundingStartBlock; int16 fundingRatePct100k; uint256 absFundingClampPctPer100K; uint8 status; uint256 basePricePNS; uint256 maxBidPriceONS; uint256 minBidPriceONS; uint256 maxAskPriceONS; uint256 minAskPriceONS; uint256 numOrders; bool ignOracle; uint256 fundingSumScalingExp; }",
  "function getAccountById(uint256 accountId) view returns (AccountInfo accountInfo)",
  "function getAccountByAddr(address accountAddress) view returns (AccountInfo accountInfo)",
  "function getPositionV2(uint256 perpId, uint256 accountId) view returns (PositionInfoV2 positionInfo, uint256 markPricePNS, bool markPriceValid)",
  "function getPerpetualInfoV2(uint256 perpId) view returns (PerpetualInfoV2 perpetualInfo)",
]);

const client = createPublicClient({ transport: http(RPC_URL, { timeout: 15_000, retryCount: 2 }) });

/** Raw position read from the chain. Integers as bigint in Perpl's native scales. */
export type ChainPosition = {
  accountId: number;
  perpId: number;
  side: "long" | "short";
  depositCNS: bigint;
  entryPNS: bigint;
  lotLNS: bigint;
  pnlCNS: bigint;
  fundingCNS: bigint;
  markPNS: bigint;
  markValid: boolean;
  entryBlock: number;
};

export type ChainAccount = { accountId: number; address: string; balanceCNS: bigint; lockedCNS: bigint; frozen: boolean; perpIds: number[] };

export type Snapshot = { block: number; readAt: number; accounts: number; positions: ChainPosition[]; addresses: Record<number, string> };

type RawAccount = { accountId: bigint; balanceCNS: bigint; lockedBalanceCNS: bigint; frozen: number; accountAddr: string; positions: { bank1: bigint; bank2: bigint; bank3: bigint; bank4: bigint } };

function bits(p: RawAccount["positions"]): number[] {
  const out: number[] = [];
  [p.bank1, p.bank2, p.bank3, p.bank4].forEach((bank, k) => {
    for (let i = 0; i < 256 && bank > N0; i++) if ((bank >> BigInt(i)) & N1) out.push(k * 256 + i);
  });
  return out;
}

function toAccount(a: RawAccount): ChainAccount | null {
  if (!a || a.accountAddr === ZERO || a.accountId === N0) return null;
  return { accountId: Number(a.accountId), address: a.accountAddr, balanceCNS: a.balanceCNS, lockedCNS: a.lockedBalanceCNS, frozen: a.frozen !== 0, perpIds: bits(a.positions) };
}

const isRevert = (e: unknown) => e instanceof Error && /revert/i.test(e.message);

/** getAccountById for each id. A revert means "no such account" (null); any other failure throws. */
async function accountsByIds(ids: number[]): Promise<(ChainAccount | null)[]> {
  const out: (ChainAccount | null)[] = [];
  for (let s = 0; s < ids.length; s += 500) {
    const chunk = ids.slice(s, s + 500);
    const r = await client.multicall({
      multicallAddress: MULTICALL3,
      allowFailure: true,
      contracts: chunk.map((id) => ({ address: EXCHANGE, abi, functionName: "getAccountById" as const, args: [BigInt(id)] as const })),
    });
    for (const x of r) {
      if (x.status === "success") out.push(toAccount(x.result as RawAccount));
      else if (isRevert(x.error)) out.push(null);
      else throw x.error;
    }
  }
  return out;
}

async function positionsOf(pairs: [number, number][]): Promise<ChainPosition[]> {
  const out: ChainPosition[] = [];
  for (let s = 0; s < pairs.length; s += 300) {
    const chunk = pairs.slice(s, s + 300);
    const r = await client.multicall({
      multicallAddress: MULTICALL3,
      allowFailure: true,
      contracts: chunk.map(([perpId, id]) => ({ address: EXCHANGE, abi, functionName: "getPositionV2" as const, args: [BigInt(perpId), BigInt(id)] as const })),
    });
    r.forEach((x, i) => {
      if (x.status !== "success") {
        if (isRevert(x.error)) return;
        throw x.error;
      }
      const [pos, mark, valid] = x.result as readonly [{ positionType: number; depositCNS: bigint; pricePNS: bigint; lotLNS: bigint; entryBlock: bigint; pnlCNS: bigint; premiumPnlCNS: bigint }, bigint, boolean];
      if (pos.lotLNS === N0) return;
      out.push({
        accountId: chunk[i][1],
        perpId: chunk[i][0],
        side: pos.positionType === 1 ? "short" : "long",
        depositCNS: pos.depositCNS,
        entryPNS: pos.pricePNS,
        lotLNS: pos.lotLNS,
        pnlCNS: pos.pnlCNS,
        fundingCNS: pos.premiumPnlCNS,
        markPNS: mark,
        markValid: valid,
        entryBlock: Number(pos.entryBlock),
      });
    });
  }
  return out;
}

let highestId = 0;

let cache: { at: number; value: Promise<Snapshot> } | null = null;

async function readSnapshot(): Promise<Snapshot> {
  // Account ids are sequential from 1: read in chunks of 500 until a chunk past the highest known id is empty.
  const block = await client.getBlockNumber();
  const accounts: ChainAccount[] = [];
  for (let start = 1; ; start += 500) {
    const got = (await accountsByIds(Array.from({ length: 500 }, (_, i) => start + i))).filter((a): a is ChainAccount => a !== null);
    accounts.push(...got);
    if (got.length === 0 && start > highestId) break;
    if (start > 1 << 22) break;
  }
  const pairs: [number, number][] = [];
  const addresses: Record<number, string> = {};
  for (const a of accounts) {
    highestId = Math.max(highestId, a.accountId);
    if (a.perpIds.length) addresses[a.accountId] = a.address;
    for (const p of a.perpIds) pairs.push([p, a.accountId]);
  }
  return { block: Number(block), readAt: Date.now(), accounts: accounts.length, positions: await positionsOf(pairs), addresses };
}

/** Every open Perpl position, read from the chain. Cached for 60 s per server instance. */
export function snapshot(): Promise<Snapshot> {
  if (cache && Date.now() - cache.at < 60_000) return cache.value;
  const value = readSnapshot();
  cache = { at: Date.now(), value };
  value.catch(() => {
    if (cache?.value === value) cache = null;
  });
  return value;
}

export type ChainPerpetual = { perpId: number; markPNS: bigint; oraclePNS: bigint; longOiLNS: bigint; shortOiLNS: bigint; fundingRatePct100k: number; insuranceCNS: bigint };

export async function perpetuals(perpIds: number[]): Promise<ChainPerpetual[]> {
  const r = await client.multicall({
    multicallAddress: MULTICALL3,
    allowFailure: true,
    contracts: perpIds.map((id) => ({ address: EXCHANGE, abi, functionName: "getPerpetualInfoV2" as const, args: [BigInt(id)] as const })),
  });
  const out: ChainPerpetual[] = [];
  r.forEach((x, i) => {
    if (x.status !== "success") return;
    const p = x.result as { markPNS: bigint; oraclePNS: bigint; longOpenInterestLNS: bigint; shortOpenInterestLNS: bigint; fundingRatePct100k: number; insuranceBalanceCNS: bigint };
    out.push({ perpId: perpIds[i], markPNS: p.markPNS, oraclePNS: p.oraclePNS, longOiLNS: p.longOpenInterestLNS, shortOiLNS: p.shortOpenInterestLNS, fundingRatePct100k: Number(p.fundingRatePct100k), insuranceCNS: p.insuranceBalanceCNS });
  });
  return out;
}

/** One account by Perpl id or 0x address, with its open positions. null when it does not exist. */
export async function account(idOrAddress: string): Promise<{ account: ChainAccount; positions: ChainPosition[]; block: number } | null> {
  const raw = /^0x[0-9a-fA-F]{40}$/.test(idOrAddress)
    ? await client.readContract({ address: EXCHANGE, abi, functionName: "getAccountByAddr", args: [idOrAddress as Address] })
    : await client.readContract({ address: EXCHANGE, abi, functionName: "getAccountById", args: [BigInt(idOrAddress)] });
  const a = toAccount(raw as RawAccount);
  if (!a) return null;
  const [block, positions] = await Promise.all([client.getBlockNumber(), positionsOf(a.perpIds.map((p) => [p, a.accountId]))]);
  return { account: a, positions, block: Number(block) };
}
