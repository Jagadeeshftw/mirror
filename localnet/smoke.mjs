#!/usr/bin/env node
// Smoke test against a running localnet (npm start): Mirror's core flow on Perpl's real exchange.
// follower account -> permit deposit (opens a Perpl account) -> policy -> the leader trades on the book ->
// keeper copy with proof -> a copy blocked by a rule -> a take-profit executed by a stranger.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, createWalletClient, defineChain, decodeEventLog, http, keccak256, toHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const HERE = dirname(fileURLToPath(import.meta.url));
const env = JSON.parse(readFileSync(join(HERE, "out", "env.json"), "utf8"));
const abiOf = (n) => JSON.parse(readFileSync(join(HERE, "..", "contracts", "out", `${n}.sol`, `${n}.json`), "utf8")).abi;
const MA = abiOf("MirrorAccount");
const F = abiOf("MirrorAccountFactory");
const T = abiOf("MockAUSD");
const X = JSON.parse(readFileSync(join(HERE, "vendor", "perpl", "Exchange.json"), "utf8")).abi;

const chain = defineChain({ id: env.chainId, name: "localnet", nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 }, rpcUrls: { default: { http: [env.rpcUrl] } } });
const pub = createPublicClient({ chain, transport: http(env.rpcUrl), pollingInterval: 100 });
const who = (role) => privateKeyToAccount(env.testKeys[role]);
const w = (role) => createWalletClient({ chain, account: who(role), transport: http(env.rpcUrl) });
const stranger = privateKeyToAccount(keccak256(toHex("mirror-localnet-stranger")));

let failures = 0;
const check = (name, ok, info = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${info ? `  ${info}` : ""}`);
  if (!ok) failures++;
};
async function tx(role, address, abi, functionName, args, account) {
  const client = account ? createWalletClient({ chain, account, transport: http(env.rpcUrl) }) : w(role);
  const hash = await client.writeContract({ address, abi, functionName, args });
  return pub.waitForTransactionReceipt({ hash });
}
const events = (r, abi) =>
  r.logs.flatMap((l) => {
    try {
      return [decodeEventLog({ abi, data: l.data, topics: l.topics })];
    } catch {
      return [];
    }
  });
const position = async (perpId, accountId) => {
  const [p, mark, valid] = await pub.readContract({ address: env.perplExchange, abi: X, functionName: "getPositionV2", args: [BigInt(perpId), BigInt(accountId)] });
  return { lots: p.lotLNS, side: p.positionType, entry: p.pricePNS, mark, valid };
};

const BTC = 1n;
const owner = who("demoFollowerOwner");
const salt = keccak256(toHex(`smoke-${Date.now()}`));

// 1. Account and a gasless permit deposit (opens the follower's own Perpl account).
const created = await tx("ops", env.mirror.factory, F, "createAccount", [owner.address, salt]);
const account = events(created, F).find((e) => e.eventName === "AccountCreated").args.account;
check("factory created the follower's MirrorAccount", !!account, account);

const amount = 50_000_000n;
const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
const nonce = await pub.readContract({ address: env.collateral, abi: T, functionName: "nonces", args: [owner.address] });
const signature = await w("demoFollowerOwner").signTypedData({
  domain: { name: "Agora Dollar", version: "1", chainId: env.chainId, verifyingContract: env.collateral },
  types: { Permit: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }, { name: "value", type: "uint256" }, { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint256" }] },
  primaryType: "Permit",
  message: { owner: owner.address, spender: account, value: amount, nonce, deadline },
});
const r = BigInt(`0x${signature.slice(2, 66)}`), s = BigInt(`0x${signature.slice(66, 130)}`), v = Number(`0x${signature.slice(130, 132)}`);
await tx("ops", account, MA, "depositWithPermit", [amount, deadline, v, toHex(r, { size: 32 }), toHex(s, { size: 32 })]);
const perplId = await pub.readContract({ address: account, abi: MA, functionName: "perplAccountId" });
check("relayed permit deposit opened a Perpl account owned by the contract", perplId > 0n, `Perpl account ${perplId}`);

// 2. Policy: follow the team-run demo leader at 100%, entry filter 2%, flatten on stop.
const leader = env.teamRun.demoLeaderAccountId;
const policy = {
  maxLeverageHdths: 500, maxSlippageBps: 100, dailyLossBps: 0, drawdownBps: 0,
  expiry: Math.floor(Date.now() / 1000) + 30 * 86400, maxEntryDeviationBps: 200, stopSlippageBps: 300, flattenOnStop: true,
  leaders: [{ accountId: leader, ratioBps: 10_000, budgetCNS: 50_000_000n, lossStopBps: 0 }],
  markets: [{ perpId: 1, maxNotionalCNS: 100_000_000n }, { perpId: 20, maxNotionalCNS: 100_000_000n }],
};
await tx("demoFollowerOwner", account, MA, "setPolicy", [policy]);
check("owner set the policy", true);

// 3. The leader opens 0.0002 BTC long on Perpl's book (an IOC that crosses the market maker's ask).
const { mark } = await position(BTC, leader);
const leaderOrder = {
  orderDescId: BigInt(Date.now()), perpId: BTC, orderType: 0, orderId: 0n, pricePNS: (mark * 1005n) / 1000n,
  lotLNS: 20n, expiryBlock: 0n, postOnly: false, fillOrKill: false, immediateOrCancel: true, maxMatches: 10n,
  leverageHdths: 300n, lastExecutionBlock: 0n, amountCNS: 0n, maxNegPnlCollatBPS: 1000n,
};
const lr = await tx("demoLeader", env.perplExchange, X, "execOrder", [leaderOrder]);
const lp = await position(BTC, leader);
check("leader filled on the local Perpl book", lp.lots > 0n, `${lp.lots} lots at ${lp.entry}`);

// 4. Keeper copy with proof.
const copy = (overrides = {}) => ({
  leaderAccountId: leader, perpId: 1, orderType: 0, lotLNS: lp.lots, pricePNS: (lp.mark * 1008n) / 1000n,
  leverageHdths: 300, maxMatches: 10, leaderRef: lr.transactionHash, leaderFillPNS: lp.entry, ...overrides,
});
const cr = await tx("ops", account, MA, "mirror", [copy()]);
const mirrored = events(cr, MA).find((e) => e.eventName === "Mirrored");
const fp = await position(BTC, perplId);
check("keeper copy filled at the leader's size", mirrored && fp.lots === lp.lots, `${fp.lots} lots`);
check("Mirrored carries the proof", !!mirrored && mirrored.args.proof.fillPNS > 0n && mirrored.args.proof.leaderEntryPNS === lp.entry,
  mirrored ? `leader entry ${mirrored.args.proof.leaderEntryPNS}, follower fill ${mirrored.args.proof.fillPNS}, deviation ${mirrored.args.proof.entryDeviationBps} bps` : "");

// 5. A copy that breaks a rule is recorded and trades nothing.
const br = await tx("ops", account, MA, "mirror", [copy({ lotLNS: 1n, leverageHdths: 2000 })]);
const blocked = events(br, MA).find((e) => e.eventName === "Blocked");
check("10x copy against a 5x rule is Blocked onchain", blocked && blocked.args.reason === 6, blocked ? `reason ${blocked.args.reason} limit ${blocked.args.limit} actual ${blocked.args.actual}` : "");

// 6. A take-profit already reached is executed by a stranger, reduce-only.
await pub.request({ method: "anvil_setBalance", params: [stranger.address, "0x8AC7230489E80000"] });
const now = await position(BTC, perplId);
await tx("demoFollowerOwner", account, MA, "setLevels", [[{ perpId: 1, side: 0, stopLossPNS: 0n, takeProfitPNS: (now.mark * 990n) / 1000n, slippageBps: 300 }]]);
const tr = await tx(null, account, MA, "triggerLevel", [BTC], stranger);
const after = await position(BTC, perplId);
const trig = events(tr, MA).find((e) => e.eventName === "StopTriggered");
check("stranger executed the take-profit; position closed", !!trig && after.lots === 0n, trig ? `closed ${trig.args.positionsClosed} lots` : "");
const strangerAusd = await pub.readContract({ address: env.collateral, abi: T, functionName: "balanceOf", args: [stranger.address] });
check("stranger received no collateral", strangerAusd === 0n);

console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
