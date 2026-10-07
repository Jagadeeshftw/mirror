#!/usr/bin/env node
// Deploys KeeperRegistry and MirrorAccountFactory (which deploys the MirrorAccount implementation) and
// registers keepers, with every gas limit taken from the target chain's own eth_estimateGas.
//
// Why not `forge script`: forge sizes gas limits from its own Ethereum-priced simulation, and Monad charges
// the full gas limit and prices cold access differently. An estimate from anything but Monad itself can be
// far off (a third-party estimate of 680k for a swap that Monad needed 3.44M for failed on mainnet).
//
//   cd scripts && npm install
//   node deploy-contracts.mjs --network testnet --cap 200 --keepers 0xKeeper           (plan only, sends nothing)
//   node deploy-contracts.mjs --network testnet --cap 200 --keepers 0xKeeper --send --expect-nonce 0
//   node deploy-contracts.mjs --network local --rpc http://127.0.0.1:8545 --cap 25 --send --expect-nonce 0
//
// Mainnet needs --confirm-mainnet as well. Contracts must be built first (`cd contracts && forge build`).
// Reads OPS_PRIVATE_KEY (and MONAD_RPC_URL / MONAD_TESTNET_RPC_URL) from ../.env. Writes
// contracts/deployments/<chainId>.json after a successful --send (local-<chainId>.json for a local fork).

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createPublicClient,
  createWalletClient,
  encodeDeployData,
  encodeFunctionData,
  formatEther,
  formatGwei,
  getContractAddress,
  http,
  isAddress,
  getAddress,
  defineChain,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// ---- arguments and environment ----------------------------------------------------------------------

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : fallback;
};

function loadEnv() {
  const p = join(root, ".env");
  if (!existsSync(p)) return {};
  const env = {};
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return env;
}
const env = { ...loadEnv(), ...process.env };

const NETWORKS = {
  mainnet: {
    chainId: 143,
    rpc: env.MONAD_RPC_URL || "https://rpc.monad.xyz",
    exchange: "0x34B6552d57a35a1D042CcAe1951BD1C370112a6F",
    collateral: "0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a",
  },
  testnet: {
    chainId: 10143,
    rpc: env.MONAD_TESTNET_RPC_URL || "https://testnet-rpc.monad.xyz",
    exchange: "0x1964C32f0bE608E7D29302AFF5E61268E72080cc",
    collateral: "0xa9012a055bd4e0edff8ce09f960291c09d5322dc",
  },
  local: {
    chainId: undefined,
    rpc: opt("rpc", "http://127.0.0.1:8545"),
    exchange: opt("exchange", "0x34B6552d57a35a1D042CcAe1951BD1C370112a6F"),
    collateral: opt("collateral", "0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a"),
  },
};

const networkName = opt("network", "testnet");
const net = NETWORKS[networkName];
if (!net) throw new Error(`unknown --network ${networkName} (mainnet | testnet | local)`);
if (networkName === "local" && !/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/?$/.test(net.rpc)) {
  throw new Error("--network local only talks to a localhost RPC (a local fork)");
}
const send = flag("send");
const headroom = Number(opt("headroom", "1.15"));
const capAusd = Number(opt("cap", networkName === "mainnet" ? "25" : "200"));
// Perpl builder attribution: Mirror is builder 26; 20 per 100,000 = 0.02% of opening size (confirmed 7 Oct 2026).
const builderId = Number(opt("builder-id", "26"));
const builderFee = Number(opt("builder-fee", "20"));
if (!Number.isInteger(builderId) || builderId < 0 || builderId > 255) throw new Error("--builder-id must be 0..255");
if (!Number.isInteger(builderFee) || builderFee < 0 || builderFee > 1000 || (builderId === 0 && builderFee !== 0)) {
  throw new Error("--builder-fee must be 0..1000 per 100,000, and 0 without a builder");
}
const keepers = (opt("keepers", "") || "").split(",").filter(Boolean).map((k) => {
  if (!isAddress(k)) throw new Error(`bad keeper address ${k}`);
  return getAddress(k);
});
if (networkName === "mainnet" && send && !flag("confirm-mainnet")) {
  throw new Error("mainnet --send needs --confirm-mainnet");
}

const key = env.OPS_PRIVATE_KEY || env.DEPLOYER_PRIVATE_KEY;
if (!key) throw new Error("OPS_PRIVATE_KEY missing in .env");
const account = privateKeyToAccount(key.startsWith("0x") ? key : `0x${key}`);

const artifact = (name) => {
  const p = join(root, "contracts", "out", `${name}.sol`, `${name}.json`);
  if (!existsSync(p)) throw new Error(`missing ${p}; run forge build in contracts/`);
  const j = JSON.parse(readFileSync(p, "utf8"));
  return { abi: j.abi, bytecode: j.bytecode.object, deployedBytecode: j.deployedBytecode.object };
};

// ---- clients ------------------------------------------------------------------------------------------

const probe = createPublicClient({ transport: http(net.rpc) });
const chainId = net.chainId ?? (await probe.getChainId());
const actualChainId = await probe.getChainId();
if (actualChainId !== chainId) throw new Error(`RPC ${net.rpc} is chain ${actualChainId}, expected ${chainId}`);
const chain = defineChain({
  id: chainId,
  name: `monad-${networkName}`,
  nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: [net.rpc] } },
});
const client = createPublicClient({ chain, transport: http(net.rpc) });
const wallet = createWalletClient({ chain, account, transport: http(net.rpc) });

const exchangeInfoAbi = [
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
  { type: "function", name: "getMinAccountOpenCNS", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
];

// ---- plan -----------------------------------------------------------------------------------------------

const registryArt = artifact("KeeperRegistry");
const factoryArt = artifact("MirrorAccountFactory");
const accountArt = artifact("MirrorAccount");

const exchange = getAddress(net.exchange);
const collateral = getAddress(net.collateral);
const [, , , , realCollateral] = await client.readContract({ address: exchange, abi: exchangeInfoAbi, functionName: "getExchangeInfo" });
if (getAddress(realCollateral) !== collateral) {
  throw new Error(`Perpl ${exchange} uses collateral ${realCollateral}, not ${collateral}`);
}
const minOpen = await client.readContract({ address: exchange, abi: exchangeInfoAbi, functionName: "getMinAccountOpenCNS" });
const cap = BigInt(Math.round(capAusd * 1e6));
if (cap < minOpen) throw new Error(`deposit cap ${capAusd} AUSD is below Perpl's minimum account opening of ${Number(minOpen) / 1e6} AUSD`);

const nonce = await client.getTransactionCount({ address: account.address, blockTag: "pending" });
const expect = opt("expect-nonce");
if (send && expect === undefined) throw new Error("--send needs --expect-nonce N (the deployer's current nonce)");
if (expect !== undefined && Number(expect) !== nonce) {
  throw new Error(`deployer nonce is ${nonce}, expected ${expect}; refusing so predicted addresses stay valid`);
}

const registryAddr = getContractAddress({ from: account.address, nonce: BigInt(nonce) });
const factoryAddr = getContractAddress({ from: account.address, nonce: BigInt(nonce + 1) });
const implAddr = getContractAddress({ from: factoryAddr, nonce: 1n });

const steps = [
  {
    label: "deploy KeeperRegistry",
    to: undefined,
    data: encodeDeployData({ abi: registryArt.abi, bytecode: registryArt.bytecode, args: [account.address] }),
    expectCodeAt: registryAddr,
  },
  {
    label: "deploy MirrorAccountFactory (+ MirrorAccount implementation)",
    to: undefined,
    data: encodeDeployData({ abi: factoryArt.abi, bytecode: factoryArt.bytecode, args: [exchange, collateral, registryAddr, cap, builderId, builderFee] }),
    expectCodeAt: factoryAddr,
  },
];
if (keepers.length) {
  steps.push({
    label: `KeeperRegistry.setKeepers(${keepers.join(", ")})`,
    to: registryAddr,
    data: encodeFunctionData({ abi: registryArt.abi, functionName: "setKeepers", args: [keepers, true] }),
    // Before the registry exists (plan mode), estimate against its runtime code with the deployer as owner
    // (OpenZeppelin Ownable keeps _owner in slot 0).
    override: {
      [registryAddr]: {
        code: registryArt.deployedBytecode,
        stateDiff: { "0x0000000000000000000000000000000000000000000000000000000000000000": `0x${account.address.slice(2).toLowerCase().padStart(64, "0")}` },
      },
    },
  });
}

// ---- gas from Monad's estimator only ------------------------------------------------------------------

function withHeadroom(estimate) {
  const m = BigInt(Math.round(headroom * 1000));
  return (estimate * m + 999n) / 1000n;
}

async function monadEstimate(step) {
  const tx = { from: account.address, data: step.data, ...(step.to ? { to: step.to } : {}) };
  const deployed = step.to ? (await client.getCode({ address: step.to })) ?? "0x" : "0x";
  const params = step.override && deployed === "0x" ? [tx, "latest", step.override] : [tx, "latest"];
  const hex = await client.request({ method: "eth_estimateGas", params });
  return BigInt(hex);
}

async function fees() {
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

const fmt = (wei) => `${Number(formatEther(wei)).toFixed(6)} MON`;

console.log(`network    ${networkName} (chain ${chainId}) via ${net.rpc}`);
console.log(`deployer   ${account.address}  nonce ${nonce}  balance ${fmt(await client.getBalance({ address: account.address }))}`);
console.log(`perpl      ${exchange}  collateral ${collateral}  min open ${Number(minOpen) / 1e6} AUSD`);
console.log(`cap        ${capAusd} AUSD per account`);
console.log(`builder    id ${builderId}, fee ${builderFee} per 100,000 (${(builderFee / 1000).toFixed(3)}%) on opening size only`);
console.log(`predicted  KeeperRegistry ${registryAddr}`);
console.log(`           MirrorAccountFactory ${factoryAddr}`);
console.log(`           MirrorAccount implementation ${implAddr}`);
console.log(`runtime    MirrorAccount ${(accountArt.deployedBytecode.length - 2) / 2} bytes`);
console.log(`gas        every limit = Monad eth_estimateGas x ${headroom}\n`);

let totalLimit = 0n;
const f = await fees();
for (const s of steps) {
  s.estimate = await monadEstimate(s);
  s.gas = withHeadroom(s.estimate);
  totalLimit += s.gas;
  console.log(`${s.label}\n   estimate ${s.estimate}  limit ${s.gas}  expected fee ${fmt(s.gas * (f.base + f.tip))}  worst ${fmt(s.gas * f.maxFee)}`);
}
console.log(`\nbase fee ${formatGwei(f.base)} gwei, tip ${formatGwei(f.tip)} gwei, max fee ${formatGwei(f.maxFee)} gwei`);
console.log(`total limit ${totalLimit}: expected ${fmt(totalLimit * (f.base + f.tip))}, worst case ${fmt(totalLimit * f.maxFee)}`);

if (!send) {
  console.log("\nplan only: nothing was sent. Add --send --expect-nonce", nonce, "to deploy.");
  process.exit(0);
}

// ---- send ---------------------------------------------------------------------------------------------

const results = [];
for (const s of steps) {
  // Re-estimate against live state right before sending.
  s.estimate = await monadEstimate(s);
  s.gas = withHeadroom(s.estimate);
  const fee = await fees();
  const hash = await wallet.sendTransaction({
    to: s.to,
    data: s.data,
    gas: s.gas,
    maxFeePerGas: fee.maxFee,
    maxPriorityFeePerGas: fee.tip,
  });
  const receipt = await client.waitForTransactionReceipt({ hash, timeout: 120_000 });
  console.log(`${s.label}: ${receipt.status} tx ${hash} gasUsed ${receipt.gasUsed} / limit ${s.gas}`);
  if (receipt.status !== "success") throw new Error(`${s.label} failed: ${hash}`);
  if (s.expectCodeAt) {
    const code = await client.getCode({ address: s.expectCodeAt });
    if (!code || code === "0x") throw new Error(`no code at predicted ${s.expectCodeAt}`);
  }
  results.push({ label: s.label, hash, block: Number(receipt.blockNumber), gasUsed: receipt.gasUsed.toString(), gasLimit: s.gas.toString() });
}

const implCode = await client.getCode({ address: implAddr });
if (!implCode || implCode === "0x") throw new Error(`no implementation code at ${implAddr}`);
const deployment = {
  chainId,
  keeperRegistry: registryAddr,
  factory: factoryAddr,
  implementation: implAddr,
  exchange,
  collateral,
  depositCap: Number(cap),
  builderId,
  builderFeePer100K: builderFee,
  keepers,
  block: results[0].block,
  transactions: results,
};
// A local fork shares the mainnet chain id; never let it overwrite the real deployment record.
const out = join(root, "contracts", "deployments", networkName === "local" ? `local-${chainId}.json` : `${chainId}.json`);
writeFileSync(out, JSON.stringify(deployment, null, 2) + "\n");
console.log(`\nwrote ${out}`);
console.log("verify (no transaction):");
console.log(`  cd contracts && forge verify-contract ${registryAddr} src/KeeperRegistry.sol:KeeperRegistry --chain ${chainId} --verifier sourcify --constructor-args $(cast abi-encode "c(address)" ${account.address})`);
console.log(`  cd contracts && forge verify-contract ${factoryAddr} src/MirrorAccountFactory.sol:MirrorAccountFactory --chain ${chainId} --verifier sourcify --constructor-args $(cast abi-encode "c(address,address,address,uint256,uint8,uint16)" ${exchange} ${collateral} ${registryAddr} ${cap} ${builderId} ${builderFee})`);
console.log(`  cd contracts && forge verify-contract ${implAddr} src/MirrorAccount.sol:MirrorAccount --chain ${chainId} --verifier sourcify --constructor-args $(cast abi-encode "c(address,address,address,address,uint256,uint8,uint16)" ${exchange} ${collateral} ${registryAddr} ${factoryAddr} ${cap} ${builderId} ${builderFee})`);
