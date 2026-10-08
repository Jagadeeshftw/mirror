// Shared helpers for the mainnet operations scripts (demo-setup-mainnet, return-funds-mainnet, smoke-mainnet).
//
// Rules these helpers enforce:
//   - Plan mode by default. Nothing is signed or sent without --send; on mainnet --send also needs
//     --confirm-mainnet and --expect-nonce N (the signer's current nonce).
//   - Every gas limit comes from the target chain itself: eth_estimateGas for a step whose inputs already exist
//     onchain, or, for a step that depends on earlier steps of the same run (approve -> deposit), a binary search
//     over eth_simulateV1 on the same RPC with the earlier steps in front of it. On Monad that is Monad's own
//     execution; never forge's Ethereum-priced simulation or a third-party quote. Monad charges the full limit.
//   - Right before each send the step is re-estimated with eth_estimateGas against live state.
//   - --network local talks only to a localhost RPC, and refuses to sign when that RPC reports chain 143: start
//     the fork with --chain-id 31337 so a transaction signed with the real ops key there can never be replayed on
//     Monad mainnet (EIP-155).
//   - The RPC URL is printed only when it is a public endpoint or localhost (a private URL carries an API key).

import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, createWalletClient, defineChain, formatEther, formatGwei, getAddress, http, toHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

export const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const OPS = getAddress("0x299E77E58DD37607e4890C761924D829F8ACe82C");

// ---- arguments ------------------------------------------------------------------------------------------

export const argv = process.argv.slice(2);
export const flag = (name) => argv.includes(`--${name}`);
export const opt = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] !== undefined && !argv[i + 1].startsWith("--") ? argv[i + 1] : fallback;
};

export function loadEnv() {
  const p = join(root, ".env");
  if (!existsSync(p)) return {};
  const env = {};
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return env;
}
export const env = { ...loadEnv(), ...process.env };

export const sharedConfig = JSON.parse(readFileSync(join(root, "shared", "config.json"), "utf8"));
const main = sharedConfig.networks.mainnet;

const test = sharedConfig.networks.testnet;

export const NETWORKS = {
  mainnet: { chainId: 143, rpc: env.MONAD_RPC_URL || main.rpc, exchange: main.perplExchange, collateral: main.collateral },
  testnet: { chainId: 10143, rpc: env.MONAD_TESTNET_RPC_URL || test.rpc, exchange: test.perplExchange, collateral: test.collateral },
  local: {
    chainId: undefined,
    rpc: opt("rpc", "http://127.0.0.1:8560"),
    exchange: opt("exchange", main.perplExchange),
    collateral: opt("collateral", main.collateral),
  },
};
export const USDC = getAddress("0x754704Bc059F8C67012fEd69BC8A327a5aafb603");

const PUBLIC_RPCS = ["https://rpc.monad.xyz", "https://testnet-rpc.monad.xyz"];
export function rpcLabel(url) {
  const u = url.replace(/\/$/, "");
  if (PUBLIC_RPCS.includes(u) || /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(u)) return u;
  return "<private RPC from .env>";
}

// ---- connection -----------------------------------------------------------------------------------------

/**
 * @param {{ signer?: boolean }} o  signer=false: read-only (no key needed, never signs).
 */
export async function connect({ signer = true, networks = ["mainnet", "testnet", "local"] } = {}) {
  const networkName = opt("network", "mainnet");
  const net = networks.includes(networkName) ? NETWORKS[networkName] : undefined;
  if (!net) throw new Error(`unknown --network ${networkName} (${networks.join(" | ")})`);
  if (networkName === "local" && !/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/?$/.test(net.rpc)) {
    throw new Error("--network local only talks to a localhost RPC (a local fork)");
  }
  const send = flag("send");
  if (send && !signer) throw new Error("this script is read-only; --send is not accepted");
  if (networkName === "mainnet" && send && !flag("confirm-mainnet")) throw new Error("mainnet --send needs --confirm-mainnet");

  const probe = createPublicClient({ transport: http(net.rpc, { timeout: 60_000 }) });
  const chainId = await probe.getChainId();
  if (net.chainId !== undefined && chainId !== net.chainId) throw new Error(`RPC is chain ${chainId}, expected ${net.chainId}`);
  if (networkName === "local" && chainId === 143 && send) {
    throw new Error("the local fork reports chain 143: restart anvil with --chain-id 31337 so nothing signed here is valid on mainnet");
  }
  const chain = defineChain({
    id: chainId,
    name: `monad-${networkName}`,
    nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
    rpcUrls: { default: { http: [net.rpc] } },
  });
  const client = createPublicClient({ chain, transport: http(net.rpc, { timeout: 60_000 }) });

  let account, wallet;
  if (signer) {
    const key = env.OPS_PRIVATE_KEY;
    if (!key) throw new Error("OPS_PRIVATE_KEY missing in .env");
    account = privateKeyToAccount(key.startsWith("0x") ? key : `0x${key}`);
    wallet = createWalletClient({ chain, account, transport: http(net.rpc, { timeout: 60_000 }) });
  }
  return {
    networkName,
    isMainnet: networkName === "mainnet",
    explorerTx: networkName === "mainnet" ? main.explorerTx : networkName === "testnet" ? test.explorerTx : undefined,
    chainId,
    rpc: net.rpc,
    exchange: getAddress(net.exchange),
    collateral: getAddress(net.collateral),
    client,
    wallet,
    account,
    send,
  };
}

// ---- formatting -----------------------------------------------------------------------------------------

export const fmtMon = (wei) => `${Number(formatEther(wei)).toFixed(6)} MON`;
export const fmtUnits = (v, d = 6) => {
  const neg = v < 0n;
  const a = neg ? -v : v;
  const s = a.toString().padStart(d + 1, "0");
  return `${neg ? "-" : ""}${s.slice(0, -d)}.${s.slice(-d)}`;
};

// ---- fees and gas ---------------------------------------------------------------------------------------

export async function fees(client) {
  const block = await client.getBlock();
  const base = block.baseFeePerGas ?? (await client.getGasPrice());
  let tip;
  try {
    tip = BigInt(await client.request({ method: "eth_maxPriorityFeePerGas", params: [] }));
  } catch {
    tip = 2_000_000_000n;
  }
  return { base, tip, maxFee: base * 2n + tip };
}

const withHeadroom = (g, h) => (g * BigInt(Math.round(h * 1000)) + 999n) / 1000n;

const callObj = (from, s, gas) => ({
  from,
  ...(s.to ? { to: s.to } : {}),
  data: s.data ?? "0x",
  ...(s.value ? { value: toHex(s.value) } : {}),
  ...(gas !== undefined ? { gas: toHex(gas) } : {}),
});

export async function estimateLive(client, from, s) {
  return BigInt(await client.request({ method: "eth_estimateGas", params: [callObj(from, s), "latest"] }));
}

/**
 * Smallest gas limit at which `step` succeeds when run after `prior` (each at its planned limit), found by binary
 * search over eth_simulateV1 on the target RPC. Monad reports gasUsed = gas limit there, so the status is the
 * signal, exactly as eth_estimateGas does internally.
 */
export async function estimateAfter(client, from, prior, step, hi = 30_000_000n) {
  const run = async (gas) => {
    const calls = [...prior.map((p) => callObj(from, p, p.gas)), callObj(from, step, gas)];
    const res = await client.request({ method: "eth_simulateV1", params: [{ blockStateCalls: [{ calls }] }, "latest"] });
    const all = res[0].calls;
    for (let i = 0; i < prior.length; i++) {
      if (all[i].status !== "0x1") throw new Error(`simulation: earlier step "${prior[i].label}" failed: ${JSON.stringify(all[i].error ?? {})}`);
    }
    const last = all[all.length - 1];
    return { ok: last.status === "0x1", error: last.error };
  };
  const top = await run(hi);
  if (!top.ok) throw new Error(`simulation: "${step.label}" reverts even with ${hi} gas: ${JSON.stringify(top.error ?? {})}`);
  let lo = 21_000n;
  let h = hi;
  while (h - lo > 1_000n) {
    const mid = (lo + h) / 2n;
    if ((await run(mid)).ok) h = mid;
    else lo = mid;
  }
  return h;
}

// ---- plan and send --------------------------------------------------------------------------------------

/**
 * Prints the plan for `steps` (label, to, data, value?, headroom?, build?) with Monad-estimated gas limits and
 * expected / worst-case MON, then sends them in order when --send was given.
 *
 * step.build(ctx) (optional) is called right before sending and returns fresh { data, value } from live state
 *   (e.g. the withdrawable balance after earlier steps landed). The plan uses step.data / step.value.
 * step.check(ctx) (optional) is called right before sending and must throw if the step is no longer safe.
 * opts.assertTarget(step) is called for every step at plan and send time.
 */
export async function planAndSend(ctx, steps, opts = {}) {
  const { client, wallet, account, send } = ctx;
  const from = account.address;
  const headroomDefault = Number(opt("headroom", "1.15"));
  const f = await fees(client);
  const nonce = await client.getTransactionCount({ address: from, blockTag: "pending" });
  const balance = await client.getBalance({ address: from });

  console.log(`\nsigner     ${from}  nonce ${nonce}  balance ${fmtMon(balance)}`);
  console.log(`fees       base ${formatGwei(f.base)} gwei, tip ${formatGwei(f.tip)} gwei, max fee ${formatGwei(f.maxFee)} gwei (worst case = limit x max fee)`);
  if (!steps.length) {
    console.log("\nnothing to send.");
    return { sent: [], nonce };
  }

  let total = 0n;
  let totalValue = 0n;
  const planned = [];
  for (const [i, s] of steps.entries()) {
    opts.assertTarget?.(s);
    const h = s.headroom ?? headroomDefault;
    const how = i === 0 ? "eth_estimateGas" : "eth_simulateV1 after the steps above";
    s.estimate = i === 0 ? await estimateLive(client, from, s) : await estimateAfter(client, from, planned, s);
    s.gas = withHeadroom(s.estimate, h);
    planned.push(s);
    total += s.gas;
    totalValue += s.value ?? 0n;
    console.log(`${i + 1}. ${s.label}`);
    console.log(`   to ${s.to}${s.value ? `  value ${fmtMon(s.value)}` : ""}`);
    console.log(`   gas ${s.estimate} (${how}) x ${h} = limit ${s.gas}; expected ${fmtMon(s.gas * (f.base + f.tip))}, worst ${fmtMon(s.gas * f.maxFee)}`);
  }
  const worst = total * f.maxFee;
  console.log(`\ntotal gas limit ${total}: expected ${fmtMon(total * (f.base + f.tip))}, worst case ${fmtMon(worst)}${totalValue ? `, plus ${fmtMon(totalValue)} value` : ""}`);
  if (worst + totalValue > balance) throw new Error(`signer balance ${fmtMon(balance)} is below the worst case ${fmtMon(worst + totalValue)}`);

  if (!send) {
    console.log(`\nplan only: nothing was signed or sent. To send: add --send --expect-nonce ${nonce}${ctx.isMainnet ? " --confirm-mainnet" : ""}`);
    return { sent: [], nonce };
  }
  const expect = opt("expect-nonce");
  if (expect === undefined) throw new Error(`--send needs --expect-nonce ${nonce}`);
  if (Number(expect) !== nonce) throw new Error(`signer nonce is ${nonce}, expected ${expect}; refusing`);

  const sent = [];
  for (const s of steps) {
    if (s.build) Object.assign(s, await s.build(ctx));
    if (s.skip) {
      console.log(`skip ${s.label}: ${s.skip}`);
      continue;
    }
    opts.assertTarget?.(s);
    await s.check?.(ctx);
    s.estimate = await estimateLive(client, from, s);
    s.gas = withHeadroom(s.estimate, s.headroom ?? headroomDefault);
    const fee = await fees(client);
    if (s.finalize) Object.assign(s, await s.finalize(ctx, s.gas, fee));
    if (s.skip) {
      console.log(`skip ${s.label}: ${s.skip}`);
      continue;
    }
    const hash = await wallet.sendTransaction({
      to: s.to,
      data: s.data,
      value: s.value ?? 0n,
      gas: s.gas,
      maxFeePerGas: fee.maxFee,
      maxPriorityFeePerGas: fee.tip,
    });
    const r = await client.waitForTransactionReceipt({ hash, timeout: 120_000 });
    console.log(`${s.label}: ${r.status} tx ${hash} gasUsed ${r.gasUsed} / limit ${s.gas}`);
    sent.push({ label: s.label, hash, status: r.status, block: Number(r.blockNumber), gasLimit: s.gas.toString() });
    if (r.status !== "success") throw new Error(`${s.label} failed: ${hash}`);
  }
  return { sent, nonce };
}

// ---- ABIs (only what these scripts call) ----------------------------------------------------------------

export const erc20Abi = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "allowance", stateMutability: "view", inputs: [{ type: "address" }, { type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ type: "address" }, { type: "uint256" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "transfer", stateMutability: "nonpayable", inputs: [{ type: "address" }, { type: "uint256" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
];

const positionBitMap = { type: "tuple", components: ["bank1", "bank2", "bank3", "bank4"].map((n) => ({ name: n, type: "uint256" })) };
const accountInfo = {
  type: "tuple",
  components: [
    { name: "accountId", type: "uint256" },
    { name: "balanceCNS", type: "uint256" },
    { name: "lockedBalanceCNS", type: "uint256" },
    { name: "frozen", type: "uint8" },
    { name: "accountAddr", type: "address" },
    { name: "positions", ...positionBitMap },
  ],
};
const orderDesc = {
  type: "tuple",
  components: [
    ["orderDescId", "uint256"], ["perpId", "uint256"], ["orderType", "uint8"], ["orderId", "uint256"], ["pricePNS", "uint256"],
    ["lotLNS", "uint256"], ["expiryBlock", "uint256"], ["postOnly", "bool"], ["fillOrKill", "bool"], ["immediateOrCancel", "bool"],
    ["maxMatches", "uint256"], ["leverageHdths", "uint256"], ["lastExecutionBlock", "uint256"], ["amountCNS", "uint256"],
    ["maxNegPnlCollatBPS", "uint256"],
  ].map(([name, type]) => ({ name, type })),
};
const positionInfo = {
  type: "tuple",
  components: [
    ["accountId", "uint256"], ["nextNodeId", "uint256"], ["prevNodeId", "uint256"], ["positionType", "uint8"], ["depositCNS", "uint256"],
    ["pricePNS", "uint256"], ["lotLNS", "uint256"], ["entryBlock", "uint256"], ["pnlCNS", "int256"], ["deltaPnlCNS", "int256"],
    ["premiumPnlCNS", "int256"], ["priceResiduePNSQ16", "uint256"],
  ].map(([name, type]) => ({ name, type })),
};

export const exchangeAbi = [
  { type: "function", name: "getAccountByAddr", stateMutability: "view", inputs: [{ type: "address" }], outputs: [accountInfo] },
  { type: "function", name: "getAccountById", stateMutability: "view", inputs: [{ type: "uint256" }], outputs: [accountInfo] },
  { type: "function", name: "getMinAccountOpenCNS", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  {
    type: "function",
    name: "getPositionV2",
    stateMutability: "view",
    inputs: [{ type: "uint256" }, { type: "uint256" }],
    outputs: [positionInfo, { name: "markPricePNS", type: "uint256" }, { name: "markPriceValid", type: "bool" }],
  },
  {
    type: "function",
    name: "getExchangeInfo",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "balanceCNS", type: "uint256" },
      { name: "protocolBalanceCNS", type: "uint256" },
      { name: "recycleBalanceCNS", type: "uint256" },
      { name: "collateralDecimals", type: "uint256" },
      { name: "collateralToken", type: "address" },
      { name: "verifierProxy", type: "address" },
    ],
  },
  { type: "function", name: "createAccount", stateMutability: "nonpayable", inputs: [{ type: "uint256" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "depositCollateral", stateMutability: "nonpayable", inputs: [{ type: "uint256" }], outputs: [] },
  { type: "function", name: "withdrawCollateral", stateMutability: "nonpayable", inputs: [{ type: "uint256" }], outputs: [] },
  {
    type: "function",
    name: "execOrder",
    stateMutability: "nonpayable",
    inputs: [orderDesc],
    outputs: [{ type: "tuple", components: [{ name: "perpId", type: "uint256" }, { name: "orderId", type: "uint256" }] }],
  },
];

/** Perpl account of an address, or undefined (getAccountByAddr reverts or returns id 0 when there is none). */
export async function perplAccountOf(client, exchange, addr) {
  try {
    const a = await client.readContract({ address: exchange, abi: exchangeAbi, functionName: "getAccountByAddr", args: [addr] });
    return a.accountId === 0n ? undefined : a;
  } catch {
    return undefined;
  }
}

/** perpIds whose bit is set in Perpl's position bitmap. */
export function perpIdsOf(positions) {
  const ids = [];
  [positions.bank1, positions.bank2, positions.bank3, positions.bank4].forEach((bank, b) => {
    for (let i = 0; i < 256; i++) if ((bank >> BigInt(i)) & 1n) ids.push(b * 256 + i);
  });
  return ids;
}

/** Same rounding as the contract and the engine: bids round down, asks round up. Order types 0 and 3 are bids. */
export function slippageBound(orderType, mark, bps) {
  const bid = orderType === 0 || orderType === 3;
  return bid ? (mark * (10_000n + BigInt(bps))) / 10_000n : (mark * (10_000n - BigInt(bps)) + 9_999n) / 10_000n;
}

export function artifact(name) {
  const p = join(root, "contracts", "out", `${name}.sol`, `${name}.json`);
  if (!existsSync(p)) throw new Error(`missing ${p}; run forge build in contracts/`);
  return JSON.parse(readFileSync(p, "utf8"));
}

export function readDeployment(chainId, networkName) {
  const file = opt("deployment", join(root, "contracts", "deployments", networkName === "local" ? `local-${chainId}.json` : `${chainId}.json`));
  if (!existsSync(file)) return { file, deployment: undefined };
  return { file, deployment: JSON.parse(readFileSync(file, "utf8")) };
}
