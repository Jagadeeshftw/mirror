// Chain and engine helpers for the Stage-A web e2e (same calls as e2e-api.mjs: engine env, team-run demo
// follower set up through the public relay API, leader trades with anvil test keys, faucet).
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, createWalletClient, defineChain, encodeAbiParameters, http, zeroHash } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const HERE = dirname(fileURLToPath(import.meta.url));
export const LOCALNET = join(HERE, "..");
export const ROOT = join(LOCALNET, "..");
export const env = JSON.parse(readFileSync(join(LOCALNET, "out", "env.json"), "utf8"));
const abiOf = (n) => JSON.parse(readFileSync(join(ROOT, "contracts", "out", `${n}.sol`, `${n}.json`), "utf8")).abi;
export const MA = abiOf("MirrorAccount");
const F = abiOf("MirrorAccountFactory");
export const T = abiOf("MockAUSD");
export const X = JSON.parse(readFileSync(join(LOCALNET, "vendor", "perpl", "Exchange.json"), "utf8")).abi;
export const fnInputs = (name) => MA.find((f) => f.type === "function" && f.name === name).inputs;

const chain = defineChain({ id: env.chainId, name: "localnet", nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 }, rpcUrls: { default: { http: [env.rpcUrl] } } });
export const pub = createPublicClient({ chain, transport: http(env.rpcUrl), pollingInterval: 100 });
export const acct = (k) => privateKeyToAccount(k);
const wallet = (a) => createWalletClient({ chain, account: a, transport: http(env.rpcUrl) });
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const J = (v) => JSON.stringify(v, (_, x) => (typeof x === "bigint" ? x.toString() : x));

export function apiClient(base) {
  return async function api(method, path, body) {
    const res = await fetch(base + path, { method, headers: body ? { "content-type": "application/json" } : {}, body: body ? J(body) : undefined, signal: AbortSignal.timeout(30_000) });
    const text = await res.text();
    let json;
    try { json = JSON.parse(text); } catch { json = { raw: text }; }
    if (!res.ok) throw Object.assign(new Error(`${method} ${path} -> ${res.status}: ${text.slice(0, 300)}`), { status: res.status, json });
    return json;
  };
}

export async function waitFor(label, fn, timeoutMs = 45_000, every = 500) {
  const end = Date.now() + timeoutMs;
  let last;
  while (Date.now() < end) {
    try { last = await fn(); if (last) return last; } catch (e) { last = e; }
    await sleep(every);
  }
  throw new Error(`timed out waiting for ${label}${last instanceof Error ? `: ${last.message}` : ""}`);
}

export const faucet = (path, body) => fetch(env.faucetUrl + path, { method: "POST", body: JSON.stringify(body), signal: AbortSignal.timeout(30_000) }).then((r) => r.text());

const demoOwner = acct(env.testKeys.demoFollowerOwner);
export const demoAccountP = pub.readContract({ address: env.mirror.factory, abi: F, functionName: "predictAccount", args: [demoOwner.address, zeroHash] });

/** Starts the engine (same env as e2e-api.mjs plus PUBLIC_RPC_URL and CORS). Returns { stop, log }. */
export async function startEngine({ port, dbPath, logFile }) {
  const demoAccount = await demoAccountP;
  const engineEnv = {
    ...process.env,
    NETWORK: "localnet", PORT: String(port), PUBLIC_RPC_URL: env.rpcUrl, CORS_ORIGINS: "*", LOG_SUBSCRIPTION: "standard", LOG_LEVEL: "info",
    PERPL_WS_ENABLED: "0", PERPL_API_URL: "http://127.0.0.1:9/none", THIN_BOOK_GUARD_ENABLED: "0",
    KEEPER_PRIVATE_KEYS: env.testKeys.ops, RELAYER_PRIVATE_KEY: env.testKeys.ops, DEMO_LEADER_PRIVATE_KEY: env.testKeys.demoLeader,
    DEMO_FOLLOWER_ACCOUNT: demoAccount, DEMO_HOLD_MS: "5000", DEMO_IP_HOURLY: "50", DEMO_DAILY_CAP: "500",
    STOP_EXECUTOR_ENABLED: "0", DB_PATH: dbPath,
  };
  const chunks = [];
  const child = spawn("npx", ["tsx", "src/index.ts"], { cwd: join(ROOT, "engine"), env: engineEnv, stdio: ["ignore", "pipe", "pipe"], detached: true });
  child.stdout.on("data", (d) => chunks.push(d));
  child.stderr.on("data", (d) => chunks.push(d));
  const flush = () => { try { writeFileSync(logFile, Buffer.concat(chunks)); } catch {} };
  const api = apiClient(`http://127.0.0.1:${port}`);
  await waitFor("engine health", () => api("GET", "/v1/health").then((h) => h.ok && h), 90_000, 1000);
  let stopped = false;
  const stop = async () => {
    if (stopped) return;
    stopped = true;
    try { process.kill(-child.pid, "SIGTERM"); } catch {}
    await Promise.race([new Promise((r) => child.once("exit", r)), sleep(5000)]);
    try { process.kill(-child.pid, "SIGKILL"); } catch {}
    flush();
  };
  return { stop, flush, child };
}

export async function permitDeposit(api, owner, account, amount) {
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
  const nonce = await pub.readContract({ address: env.collateral, abi: T, functionName: "nonces", args: [owner.address] });
  const sig = await wallet(owner).signTypedData({
    domain: { name: "Agora Dollar", version: "1", chainId: env.chainId, verifyingContract: env.collateral },
    types: { Permit: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }, { name: "value", type: "uint256" }, { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint256" }] },
    primaryType: "Permit", message: { owner: owner.address, spender: account, value: amount, nonce, deadline },
  });
  return api("POST", "/v1/relay/deposit", { account, mode: "permit", amount: amount.toString(), deadline: deadline.toString(), signature: sig });
}

export async function execute(api, owner, account, kind, data) {
  const nonce = await pub.readContract({ address: account, abi: MA, functionName: "actionNonce" });
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);
  const signature = await wallet(owner).signTypedData({
    domain: { name: "Mirror Account", version: "1", chainId: env.chainId, verifyingContract: account },
    types: { Action: [{ name: "kind", type: "uint8" }, { name: "data", type: "bytes" }, { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint256" }] },
    primaryType: "Action", message: { kind, data, nonce, deadline },
  });
  return api("POST", "/v1/relay/execute", { account, action: { kind, data, nonce: nonce.toString(), deadline: deadline.toString() }, signature });
}

/** Team-run demo follower exactly as e2e-api: create, 50 AUSD permit deposit, follow the demo leader at 5x max. */
export async function setupDemoFollower(api) {
  const demoAccount = await demoAccountP;
  // Reused localnet: the account may already follow; otherwise make sure the owner holds the 50 AUSD.
  const existing = await api("GET", `/v1/accounts/${demoAccount}`).catch(() => null);
  if (existing?.policy?.leaders?.length && BigInt(existing.equityCNS ?? 0) > 10_000_000n) return { demoAccount, reused: true, ok: true };
  if ((await ausdOf(demoOwner.address)) < 50_000_000n) await faucet("/fund", { address: demoOwner.address, ausd: 60 });
  const c1 = await api("POST", "/v1/relay/create", { owner: demoOwner.address, salt: "0" });
  const d1 = await permitDeposit(api, demoOwner, demoAccount, 50_000_000n);
  const policy = {
    maxLeverageHdths: 500, maxSlippageBps: 100, dailyLossBps: 0, drawdownBps: 2000,
    expiry: Math.floor(Date.now() / 1000) + 30 * 86400, maxEntryDeviationBps: 100, stopSlippageBps: 300, flattenOnStop: true, maxBuilderFeePer100K: 20,
    leaders: [{ accountId: env.teamRun.demoLeaderAccountId, ratioBps: 10_000, budgetCNS: 50_000_000n, lossStopBps: 0 }],
    markets: [{ perpId: 1, maxNotionalCNS: 100_000_000n }, { perpId: 20, maxNotionalCNS: 100_000_000n }],
  };
  const f1 = await execute(api, demoOwner, demoAccount, 7, encodeAbiParameters(fnInputs("follow"), [policy, []]));
  await waitFor("engine indexed the demo follower", async () => {
    const v = await api("GET", `/v1/accounts/${demoAccount}`);
    return (v.policy?.leaders?.length ?? v.leaders?.length ?? 0) > 0 && v;
  }, 30_000);
  return { demoAccount, createTx: c1.txHash, depositTx: d1.txHash, followTx: f1.txHash, ok: d1.status === "success" && f1.status === "success" };
}

export async function position(perpId, accountId) {
  const [p, mark] = await pub.readContract({ address: env.perplExchange, abi: X, functionName: "getPositionV2", args: [BigInt(perpId), BigInt(accountId)] });
  return { lots: p.lotLNS, side: p.positionType, entry: p.pricePNS, mark };
}

let orderSeq = 1n;
/** An IOC order on Perpl from a leader's own key (orderType 0 open long, 1 open short, 2 close long, 3 close short). */
export async function leaderTrade(key, perpId, orderType, lots, lev = 200n) {
  const a = acct(key);
  const { mark } = await position(perpId, 0);
  const bid = orderType === 0 || orderType === 3;
  const args = [{
    orderDescId: BigInt(Date.now()) * 1000n + orderSeq++, perpId: BigInt(perpId), orderType, orderId: 0n,
    pricePNS: bid ? (mark * 1010n) / 1000n : (mark * 990n) / 1000n, lotLNS: BigInt(lots), expiryBlock: 0n, postOnly: false,
    fillOrKill: false, immediateOrCancel: true, maxMatches: 20n, leverageHdths: orderType <= 1 ? lev : 0n, lastExecutionBlock: 0n,
    amountCNS: 0n, maxNegPnlCollatBPS: 1000n }];
  await pub.simulateContract({ account: a, address: env.perplExchange, abi: X, functionName: "execOrder", args });
  const hash = await wallet(a).writeContract({ address: env.perplExchange, abi: X, functionName: "execOrder", args });
  const r = await pub.waitForTransactionReceipt({ hash });
  if (r.status !== "success") throw new Error(`leader order reverted ${hash}`);
  return hash;
}

export const ausdOf = (address) => pub.readContract({ address: env.collateral, abi: T, functionName: "balanceOf", args: [address] });
