// eth_getLogs for the mock RPC: MirrorAccount Mirrored / Blocked logs encoded from each account's feed,
// so watch mode can read the demo follower straight from "Monad" while the mock API is switched off.
import { encodeAbiParameters, encodeEventTopics, toFunctionSelector, toHex } from "viem";
import { BLOCK_REASONS } from "../src/lib/contracts.ts";
import MirrorAccount from "../src/lib/MirrorAccount.json" with { type: "json" };

const ABI = MirrorAccount.abi ?? MirrorAccount;
const EV = Object.fromEntries(ABI.filter((x) => x.type === "event" && (x.name === "Mirrored" || x.name === "Blocked")).map((x) => [x.name, x]));
export const EQUITY_SELECTOR = toFunctionSelector("equity()");
const KEEPER = "0x6b5ee0b2a9f1c3d5e7f9a1b3c5d7e9f1a3b5c7d9";

function encode(e, i) {
  const ev = EV[e.kind];
  const args = {
    keeper: KEEPER,
    leaderAccountId: e.leaderAccountId ?? 0,
    perpId: e.perpId ?? 0,
    orderType: e.orderType ?? 0,
    lotLNS: BigInt(e.lotLNS ?? 0),
    leaderRef: e.leaderRef ?? `0x${"00".repeat(32)}`,
  };
  if (e.kind === "Mirrored") {
    const p = e.proof ?? {};
    Object.assign(args, {
      pricePNS: BigInt(e.pricePNS ?? 0),
      leverageHdths: e.leverageHdths ?? 0,
      lotsBefore: 0n,
      lotsAfter: BigInt(e.lotLNS ?? 0),
      proof: { leaderFillPNS: BigInt(p.leaderFillPNS ?? 0), leaderEntryPNS: BigInt(p.leaderEntryPNS ?? 0), markPNS: BigInt(p.markPNS ?? 0), fillPNS: BigInt(p.fillPNS ?? e.pricePNS ?? 0), entryDeviationBps: p.entryDeviationBps ?? 0, builderFeeCNS: BigInt(p.builderFeeCNS ?? 0) },
    });
  } else {
    Object.assign(args, {
      reason: Math.max(0, BLOCK_REASONS.indexOf(e.blocked?.reason)),
      limit: BigInt(e.blocked?.limit ?? 0),
      actual: BigInt(e.blocked?.actual ?? 0),
      leaderFillPNS: BigInt(e.data?.leaderFillPNS ?? e.pricePNS ?? 0),
      markPNS: BigInt(e.data?.markPNS ?? e.pricePNS ?? 0),
    });
  }
  const indexed = ev.inputs.filter((x) => x.indexed);
  const plain = ev.inputs.filter((x) => !x.indexed);
  return {
    address: e.account,
    topics: encodeEventTopics({ abi: [ev], eventName: e.kind, args: Object.fromEntries(indexed.map((x) => [x.name, args[x.name]])) }),
    data: encodeAbiParameters(plain, plain.map((x) => args[x.name])),
    blockNumber: toHex(e.block),
    blockHash: `0x${"ab".repeat(32)}`,
    transactionHash: e.txHash,
    transactionIndex: "0x0",
    logIndex: toHex(i),
    removed: false,
  };
}

export function rpcGetLogs(accounts, filter) {
  const from = BigInt(filter.fromBlock ?? 0);
  const to = BigInt(filter.toBlock ?? 2n ** 62n);
  const addr = String(filter.address ?? "").toLowerCase();
  const a = accounts.get(addr);
  if (!a) return [];
  return a.feed
    .filter((e) => (e.kind === "Mirrored" || e.kind === "Blocked") && e.txHash && BigInt(e.block) >= from && BigInt(e.block) <= to)
    .sort((x, y) => x.block - y.block)
    .map(encode);
}
