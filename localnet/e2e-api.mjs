#!/usr/bin/env node
// Stage-A backend run: the engine and relayer against Perpl's exchange on the localnet, driven only through
// the public API the app uses (plus direct leader trades and a stranger's trigger, as in real life).
//
//   cd localnet && npm start          (another shell)
//   node e2e-api.mjs                  (starts and stops its own engine on port 8787)
//
// Writes devices/evidence/stage-a/<run>/api-e2e.json with every check, tx hash and number.
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createPublicClient, createWalletClient, defineChain, encodeAbiParameters, http, keccak256, parseSignature, toHex, zeroHash,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const env = JSON.parse(readFileSync(join(HERE, "out", "env.json"), "utf8"));
const abiOf = (n) => JSON.parse(readFileSync(join(ROOT, "contracts", "out", `${n}.sol`, `${n}.json`), "utf8")).abi;
const MA = abiOf("MirrorAccount");
const F = abiOf("MirrorAccountFactory");
const T = abiOf("MockAUSD");
const X = JSON.parse(readFileSync(join(HERE, "vendor", "perpl", "Exchange.json"), "utf8")).abi;
const fnInputs = (name) => MA.find((f) => f.type === "function" && f.name === name).inputs;

const API = process.env.API ?? "http://127.0.0.1:8787";
const RUN = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const OUT = join(ROOT, "devices", "evidence", "stage-a", RUN);
mkdirSync(OUT, { recursive: true });

const chain = defineChain({ id: env.chainId, name: "localnet", nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 }, rpcUrls: { default: { http: [env.rpcUrl] } } });
const pub = createPublicClient({ chain, transport: http(env.rpcUrl), pollingInterval: 100 });
const acct = (k) => privateKeyToAccount(k);
const wallet = (a) => createWalletClient({ chain, account: a, transport: http(env.rpcUrl) });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const report = { run: RUN, network: "localnet", perpl: env.perplSource, checks: [], txs: {} };
let failures = 0;
function check(name, ok, info = {}) {
  report.checks.push({ name, ok: !!ok, ...info });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${Object.keys(info).length ? "  " + JSON.stringify(info).slice(0, 220) : ""}`);
  if (!ok) failures++;
}
async function api(method, path, body) {
  const res = await fetch(API + path, { method, headers: body ? { "content-type": "application/json" } : {}, body: body ? JSON.stringify(body, (_, v) => (typeof v === "bigint" ? v.toString() : v)) : undefined });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  if (!res.ok) throw Object.assign(new Error(`${method} ${path} -> ${res.status}: ${text.slice(0, 300)}`), { status: res.status, json });
  return json;
}
async function waitFor(label, fn, timeoutMs = 45_000, every = 500) {
  const end = Date.now() + timeoutMs;
  let last;
  while (Date.now() < end) {
    try { last = await fn(); if (last) return last; } catch (e) { last = e; }
    await sleep(every);
  }
  throw new Error(`timed out waiting for ${label}${last instanceof Error ? `: ${last.message}` : ""}`);
}

// ---- engine ------------------------------------------------------------------------------------------

const owners = { demo: acct(env.testKeys.demoFollowerOwner), user: acct(env.testKeys.testUserOwner) };
const ops = acct(env.testKeys.ops);
const salt0 = zeroHash;
const predict = (owner) => pub.readContract({ address: env.mirror.factory, abi: F, functionName: "predictAccount", args: [owner, salt0] });
const demoAccount = await predict(owners.demo.address);

const dbPath = join(OUT, "engine.db");
const engineEnv = {
  ...process.env,
  NETWORK: "localnet", PORT: "8787", LOG_SUBSCRIPTION: "standard", LOG_LEVEL: "info",
  PERPL_WS_ENABLED: "0", PERPL_API_URL: "http://127.0.0.1:9/none", THIN_BOOK_GUARD_ENABLED: "0",
  KEEPER_PRIVATE_KEYS: env.testKeys.ops, RELAYER_PRIVATE_KEY: env.testKeys.ops, DEMO_LEADER_PRIVATE_KEY: env.testKeys.demoLeader,
  DEMO_FOLLOWER_ACCOUNT: demoAccount, DEMO_HOLD_MS: "5000", DEMO_IP_HOURLY: "50", DEMO_DAILY_CAP: "500",
  // The stop in this run is executed by an unrelated wallet, to show anyone can; the engine's own executor
  // is covered by the mainnet-fork e2e and unit tests.
  STOP_EXECUTOR_ENABLED: "0",
  DB_PATH: dbPath,
};
const engineLog = join(OUT, "engine.log");
const engine = spawn("npx", ["tsx", "src/index.ts"], { cwd: join(ROOT, "engine"), env: engineEnv, stdio: ["ignore", "pipe", "pipe"] });
const logChunks = [];
engine.stdout.on("data", (d) => logChunks.push(d));
engine.stderr.on("data", (d) => logChunks.push(d));
const shutdown = () => { try { engine.kill("SIGTERM"); } catch {} writeFileSync(engineLog, Buffer.concat(logChunks)); };
process.on("exit", shutdown);

try {
  const health = await waitFor("engine health", () => api("GET", "/v1/health").then((h) => h.ok && h), 90_000, 1000);
  check("engine up on the localnet", health.chainId === env.chainId, { chainId: health.chainId, keeper: health.keeper.address });

  // ---- signing helpers ----------------------------------------------------------------------------------
  async function permitDeposit(owner, account, amount) {
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
    const nonce = await pub.readContract({ address: env.collateral, abi: T, functionName: "nonces", args: [owner.address] });
    const sig = await wallet(owner).signTypedData({
      domain: { name: "Agora Dollar", version: "1", chainId: env.chainId, verifyingContract: env.collateral },
      types: { Permit: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }, { name: "value", type: "uint256" }, { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint256" }] },
      primaryType: "Permit", message: { owner: owner.address, spender: account, value: amount, nonce, deadline },
    });
    return api("POST", "/v1/relay/deposit", { account, mode: "permit", amount: amount.toString(), deadline: deadline.toString(), signature: sig });
  }
  async function execute(owner, account, kind, data) {
    const nonce = await pub.readContract({ address: account, abi: MA, functionName: "actionNonce" });
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);
    const signature = await wallet(owner).signTypedData({
      domain: { name: "Mirror Account", version: "1", chainId: env.chainId, verifyingContract: account },
      types: { Action: [{ name: "kind", type: "uint8" }, { name: "data", type: "bytes" }, { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint256" }] },
      primaryType: "Action", message: { kind, data, nonce, deadline },
    });
    return api("POST", "/v1/relay/execute", { account, action: { kind, data, nonce: nonce.toString(), deadline: deadline.toString() }, signature });
  }
  const policyBody = (leaders, maxLev = 500, dev = 100) => ({
    maxLeverageHdths: maxLev, maxSlippageBps: 100, dailyLossBps: 0, drawdownBps: 2000,
    expiry: Math.floor(Date.now() / 1000) + 30 * 86400, maxEntryDeviationBps: dev, stopSlippageBps: 300, flattenOnStop: true,
    leaders, markets: [{ perpId: 1, maxNotionalCNS: 100_000_000n }, { perpId: 20, maxNotionalCNS: 100_000_000n }],
  });
  const follow = (owner, account, policy, orders = []) => execute(owner, account, 7, encodeAbiParameters(fnInputs("follow"), [policy, orders]));
  const feed = async (account) => (await api("GET", `/v1/accounts/${account}/feed`)).items ?? [];
  const position = async (perpId, accountId) => {
    const [p, mark] = await pub.readContract({ address: env.perplExchange, abi: X, functionName: "getPositionV2", args: [BigInt(perpId), BigInt(accountId)] });
    return { lots: p.lotLNS, side: p.positionType, entry: p.pricePNS, mark };
  };
  let orderId = 1n;
  async function leaderTrade(key, perpId, orderType, lots, lev = 200n) {
    const a = acct(key);
    const { mark } = await position(perpId, 0);
    const bid = orderType === 0 || orderType === 3;
    const args = [{
      orderDescId: BigInt(Date.now()) * 1000n + orderId++, perpId: BigInt(perpId), orderType, orderId: 0n,
      pricePNS: bid ? (mark * 1010n) / 1000n : (mark * 990n) / 1000n, lotLNS: BigInt(lots), expiryBlock: 0n, postOnly: false,
      fillOrKill: false, immediateOrCancel: true, maxMatches: 20n, leverageHdths: orderType <= 1 ? lev : 0n, lastExecutionBlock: 0n,
      amountCNS: 0n, maxNegPnlCollatBPS: 1000n }];
    try {
      await pub.simulateContract({ account: a, address: env.perplExchange, abi: X, functionName: "execOrder", args });
    } catch (e) {
      throw new Error(`leader order would revert: ${e.shortMessage ?? e.message}`.slice(0, 400));
    }
    const hash = await wallet(a).writeContract({ address: env.perplExchange, abi: X, functionName: "execOrder", args });
    const r = await pub.waitForTransactionReceipt({ hash });
    if (r.status !== "success") throw new Error(`leader order reverted ${hash}`);
    return hash;
  }
  const findItem = (items, pred) => items.find(pred);

  // ---- 1. team-run demo follower ------------------------------------------------------------------------
  const demoLeaderId = env.teamRun.demoLeaderAccountId;
  const c1 = await api("POST", "/v1/relay/create", { owner: owners.demo.address, salt: "0" });
  check("relay created the demo follower's MirrorAccount at the predicted address", (c1.account ?? demoAccount).toLowerCase() === demoAccount.toLowerCase(), { tx: c1.txHash });
  const d1 = await permitDeposit(owners.demo, demoAccount, 50_000_000n);
  check("relayed permit deposit (demo follower, 50 AUSD)", d1.status === "success", { tx: d1.txHash, gasUsed: d1.gasUsed, gasLimit: d1.gasLimit });
  const f1 = await follow(owners.demo, demoAccount, policyBody([{ accountId: demoLeaderId, ratioBps: 10_000, budgetCNS: 50_000_000n, lossStopBps: 0 }]));
  check("demo follower follows the demo leader (signed action, relayed)", f1.status === "success", { tx: f1.txHash });

  // ---- 2. test user follows two leaders with separate budgets ------------------------------------------
  const leader2Key = keccak256(toHex("mirror-stage-a-leader-2"));
  const leader2 = acct(leader2Key);
  await fetch(`${env.faucetUrl}/fund`, { method: "POST", body: JSON.stringify({ address: leader2.address, ausd: 2000, mon: 10 }) });
  const existing2 = await pub.readContract({ address: env.perplExchange, abi: X, functionName: "getAccountByAddr", args: [leader2.address] }).catch(() => null);
  if (!existing2 || existing2.accountId === 0n) await (async () => {
    const h1 = await wallet(leader2).writeContract({ address: env.collateral, abi: T, functionName: "approve", args: [env.perplExchange, 1_000_000_000n] });
    await pub.waitForTransactionReceipt({ hash: h1 });
    const h2 = await wallet(leader2).writeContract({ address: env.perplExchange, abi: X, functionName: "createAccount", args: [1_000_000_000n] });
    await pub.waitForTransactionReceipt({ hash: h2 });
  })();
  const leader2Id = Number((await pub.readContract({ address: env.perplExchange, abi: X, functionName: "getAccountByAddr", args: [leader2.address] })).accountId);
  check("second leader opened a Perpl account", leader2Id > 0, { leader2Id });

  const c2 = await api("POST", "/v1/relay/create", { owner: owners.user.address, salt: "0" });
  const userAccount = c2.account ?? (await predict(owners.user.address));
  const d2 = await permitDeposit(owners.user, userAccount, 60_000_000n);
  check("test user: account created and 60 AUSD deposited by permit", d2.status === "success", { account: userAccount, tx: d2.txHash });
  const userPolicy = policyBody([
    { accountId: demoLeaderId, ratioBps: 10_000, budgetCNS: 30_000_000n, lossStopBps: 0 },
    { accountId: leader2Id, ratioBps: 10_000, budgetCNS: 2_000_000n, lossStopBps: 0 },
  ]);
  const f2 = await follow(owners.user, userAccount, userPolicy);
  const leadersSet = await pub.readContract({ address: userAccount, abi: MA, functionName: "leaders" });
  check("test user follows two leaders with separate budgets (30 and 2 AUSD)", f2.status === "success" && leadersSet.length === 2, { tx: f2.txHash, budgets: leadersSet.map((l) => l.budgetCNS.toString()) });

  // ---- 3. demo trade: copied into both followers, with proof -----------------------------------------------
  // The engine learns policies from chain events; wait until it has indexed both follows.
  for (const a of [demoAccount, userAccount]) {
    await waitFor(`engine indexed ${a}`, async () => {
      const v = await api("GET", `/v1/accounts/${a}`);
      return (v.policy?.leaders?.length ?? v.leaders?.length ?? 0) > 0 && v;
    }, 30_000);
  }
  const demo = await api("POST", "/v1/demo/trade");
  report.txs.demoTrade = demo;
  const userOpen = await waitFor("test user's copy of the demo trade", async () => findItem(await feed(userAccount), (i) => i.kind === "Mirrored" && Number(i.orderType) === 0));
  const demoOpen = await waitFor("demo follower's copy", async () => findItem(await feed(demoAccount), (i) => i.kind === "Mirrored" && Number(i.orderType) === 0));
  const p = userOpen.proof ?? {};
  check("Run demo trade: leader trade copied into the test user and the demo follower", !!userOpen && !!demoOpen, { userTx: userOpen.txHash, demoTx: demoOpen.txHash, latencyMs: userOpen.latencyMs });
  check("price proof on the copy: leader fill, leader entry, your fill, deviation", BigInt(p.leaderEntryPNS ?? 0) > 0n && BigInt(p.fillPNS ?? 0) > 0n && p.entryDeviationBps !== undefined,
    { leaderFillPNS: p.leaderFillPNS, leaderEntryPNS: p.leaderEntryPNS, fillPNS: p.fillPNS, entryDeviationBps: p.entryDeviationBps });
  const userClose = await waitFor("copied close after the demo hold", async () => findItem(await feed(userAccount), (i) => i.kind === "Mirrored" && Number(i.orderType) === 2), 60_000);
  check("demo leader's close is copied (down to the leader's target)", !!userClose, { tx: userClose.txHash });

  // ---- 4. blocked trade ----------------------------------------------------------------------------------
  await waitFor("demo idle", async () => (await api("GET", "/v1/demo")).busy === false || !(await api("GET", "/v1/demo")).active, 60_000, 1000).catch(() => {});
  await sleep(2000);
  await api("POST", "/v1/demo/blocked");
  const blocked = await waitFor("Blocked on the test user", async () => findItem(await feed(userAccount), (i) => i.kind === "Blocked"), 60_000);
  check("Run blocked trade: 10x copy against a 5x rule is Blocked onchain with the numbers", blocked.reason === "LeverageTooHigh" || Number(blocked.reason) === 6,
    { reason: blocked.reason, limit: blocked.limit, actual: blocked.actual, tx: blocked.txHash, onchain: blocked.onchain });
  await sleep(8000);

  // ---- 5. several leaders: separate budgets and market ownership ---------------------------------------------
  const l2eth = await leaderTrade(leader2Key, 20, 0, 1);
  const ethCopy = await waitFor("leader 2's ETH copy", async () => findItem(await feed(userAccount), (i) => i.kind === "Mirrored" && Number(i.perpId) === 20 && Number(i.leaderAccountId) === leader2Id));
  const book2 = await pub.readContract({ address: userAccount, abi: MA, functionName: "leaderBook", args: [leader2Id] });
  const book1 = await pub.readContract({ address: userAccount, abi: MA, functionName: "leaderBook", args: [demoLeaderId] });
  check("second leader's ETH trade copied; its margin is booked to it alone", !!ethCopy && book2[0] > 0n, { leaderTx: l2eth, copyTx: ethCopy.txHash, leader2MarginCNS: book2[0].toString(), demoLeaderMarginCNS: book1[0].toString() });

  await leaderTrade(env.testKeys.demoLeader, 1, 0, 2);
  await waitFor("demo leader's BTC copy", async () => (await feed(userAccount)).filter((i) => i.kind === "Mirrored" && Number(i.perpId) === 1 && Number(i.orderType) === 0).length >= 2);
  await leaderTrade(leader2Key, 1, 0, 1);
  const held = await waitFor("MarketHeldByOtherLeader", async () => findItem(await feed(userAccount), (i) => i.kind === "Blocked" && (i.reason === "MarketHeldByOtherLeader" || Number(i.reason) === 16)));
  check("second leader's BTC copy blocked: BTC belongs to the first leader", !!held, { reason: held.reason, tx: held.txHash });

  await leaderTrade(leader2Key, 20, 0, 2);
  const budget = await waitFor("LeaderBudgetExceeded", async () => findItem(await feed(userAccount), (i) => i.kind === "Blocked" && (i.reason === "LeaderBudgetExceeded" || Number(i.reason) === 17)));
  check("second leader's budget (2 AUSD) refuses a copy that would exceed it", !!budget, { reason: budget.reason, limit: budget.limit, actual: budget.actual, tx: budget.txHash });

  // ---- 6. entry filter refuses a copy ---------------------------------------------------------------------
  const { mark: btcMark } = await position(1, 0);
  const moved = Number(btcMark) * 1.03 / 10;
  await fetch(`${env.faucetUrl}/mark`, { method: "POST", body: JSON.stringify({ perpId: 1, price: moved }) });
  await leaderTrade(env.testKeys.demoLeader, 1, 0, 1);
  const entry = await waitFor("EntryTooFar", async () => findItem(await feed(userAccount), (i) => i.kind === "Blocked" && (i.reason === "EntryTooFar" || Number(i.reason) === 15)));
  check("entry filter: price 3% past the leader's entry vs a 1% limit, copy refused onchain", !!entry, { reason: entry.reason, limit: entry.limit, actual: entry.actual, tx: entry.txHash });
  await fetch(`${env.faucetUrl}/mark`, { method: "POST", body: JSON.stringify({ perpId: 1, price: Number(btcMark) / 10 }) });

  // ---- 7. a stop executed by a stranger ---------------------------------------------------------------------
  const userPerpl = Number(await pub.readContract({ address: userAccount, abi: MA, functionName: "perplAccountId" }));
  const ethPos = await position(20, userPerpl);
  const lv = [{ perpId: 20, side: 0, stopLossPNS: 0n, takeProfitPNS: (ethPos.mark * 990n) / 1000n, slippageBps: 300 }];
  const setLv = await execute(owners.user, userAccount, 9, encodeAbiParameters(fnInputs("setLevels"), [lv]));
  check("owner set a take-profit with a passkey-signed action (relayed)", setLv.status === "success", { tx: setLv.txHash, takeProfitPNS: lv[0].takeProfitPNS.toString() });
  const stranger = acct(keccak256(toHex(`stranger-${RUN}`)));
  await fetch(`${env.faucetUrl}/fund`, { method: "POST", body: JSON.stringify({ address: stranger.address, ausd: 0, mon: 1 }) });
  const th = await wallet(stranger).writeContract({ address: userAccount, abi: MA, functionName: "triggerLevel", args: [20n] });
  const tr = await pub.waitForTransactionReceipt({ hash: th });
  const ethAfter = await position(20, userPerpl);
  const strangerAusd = await pub.readContract({ address: env.collateral, abi: T, functionName: "balanceOf", args: [stranger.address] });
  check("a stranger executed the take-profit; the position closed; the stranger got nothing", tr.status === "success" && ethAfter.lots === 0n && strangerAusd === 0n, { tx: th, lotsBefore: ethPos.lots.toString(), lotsAfter: ethAfter.lots.toString() });

  // ---- 8. proof on every copy, copy quality, backtest -------------------------------------------------------
  const items = await feed(userAccount);
  const opens = items.filter((i) => i.kind === "Mirrored" && Number(i.orderType) <= 1);
  check("every copied open in the feed carries its price proof", opens.length > 0 && opens.every((i) => i.proof && BigInt(i.proof.leaderEntryPNS) > 0n && BigInt(i.proof.fillPNS) > 0n), { opens: opens.length });
  const q = await api("GET", "/v1/stats/copy-quality?period=all");
  const teamInAgg = (q.copies ?? []).some((c) => (c.account ?? "").toLowerCase() === demoAccount.toLowerCase());
  check("copy-quality API: aggregates exclude the team-run follower, which is listed separately", q.aggregates?.copies > 0 && !teamInAgg && (q.teamRun?.aggregates?.copies ?? 0) > 0,
    { copies: q.aggregates?.copies, teamRunCopies: q.teamRun?.aggregates?.copies, medianDeviationBps: q.aggregates?.deviationBps?.median, source: q.source });
  try {
    const bt = await api("POST", `/v1/leaders/${demoLeaderId}/backtest`, { ratioBps: 10_000, maxLeverageHdths: 500, maxEntryDeviationBps: 100, budgetCNS: "30000000", depositCNS: "60000000", period: 7, markets: [{ perpId: 1, maxNotionalCNS: "100000000" }] });
    check("what-if backtest on the leader's recorded history returns a labelled simulation", bt.simulation === true && bt.tradesCopied > 0,
      { tradesCopied: bt.tradesCopied, tradesBlocked: bt.tradesBlocked, pnlCNS: bt.pnlCNS, slippage: bt.slippage, assumptions: bt.assumptions?.length });
  } catch (e) {
    check("what-if backtest", false, { status: e.status, body: e.json });
  }

  // ---- 9. close all and withdraw -------------------------------------------------------------------------------
  const ca = await execute(owners.user, userAccount, 3, encodeAbiParameters([{ type: "uint16" }], [300]));
  const eq = await pub.readContract({ address: userAccount, abi: MA, functionName: "equity" });
  const before = await pub.readContract({ address: env.collateral, abi: T, functionName: "balanceOf", args: [owners.user.address] });
  const wd = await execute(owners.user, userAccount, 4, encodeAbiParameters([{ type: "uint256" }], [eq]));
  const after = await pub.readContract({ address: env.collateral, abi: T, functionName: "balanceOf", args: [owners.user.address] });
  check("close all and withdraw, relayed; AUSD back in the owner's wallet", ca.status === "success" && wd.status === "success" && after - before === eq, { closeTx: ca.txHash, withdrawTx: wd.txHash, returnedCNS: (after - before).toString() });
} catch (err) {
  check("run completed", false, { error: String(err.message ?? err).slice(0, 400) });
} finally {
  report.passed = report.checks.filter((c) => c.ok).length;
  report.failed = failures;
  writeFileSync(join(OUT, "api-e2e.json"), JSON.stringify(report, (_, v) => (typeof v === "bigint" ? v.toString() : v), 2));
  shutdown();
  try { rmSync(dbPath + "-wal", { force: true }); rmSync(dbPath + "-shm", { force: true }); } catch {}
  console.log(`\n${report.passed} passed, ${failures} failed. Evidence: ${OUT}`);
  process.exit(failures ? 1 : 0);
}
