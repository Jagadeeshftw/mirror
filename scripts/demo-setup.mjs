#!/usr/bin/env node
// Team-run demo setup: the onchain steps that are not done in the app.
//
//   1. Demo leader = the ops EOA. Opens its Perpl account (exact AUSD approval + createAccount) if it has none,
//      or tops it up with --leader-topup <AUSD> (exact approval + depositCollateral).
//   2. Keepers: registers every --keepers address (default: the ops EOA) in KeeperRegistry if not yet registered.
//   3. Optional: sends --follower-fund <AUSD> from the ops wallet to the demo follower's passkey owner address
//      (--follower-owner, shown in the app), so the owner can deposit it in the app.
//   4. Read-only: reports the in-app steps (create account, deposit, follow the demo leader) and prints the
//      engine/indexer variables for the demo pair.
//
// The demo follower's MirrorAccount is created, funded and pointed at the demo leader in the app with the
// passkey (gasless, through the engine's relayer); this script never signs for it.
//
// Plan only by default. Sending needs --send --expect-nonce N, and on mainnet also --confirm-mainnet.
// Every gas limit comes from the target chain's own estimator (scripts/lib/ops.mjs).
//
//   cd scripts
//   node demo-setup.mjs --network mainnet
//   node demo-setup.mjs --network mainnet --follower-owner 0xPasskeyAddress
//   node demo-setup.mjs --network testnet --leader-deposit 200 --reserve-ausd 2500
//   node demo-setup.mjs --network local --rpc http://127.0.0.1:8560 --send --expect-nonce 7
//
// Options:
//   --leader-deposit <AUSD>  deposit that opens the leader's Perpl account (default: Perpl's minimum; env
//                            DEMO_LEADER_DEPOSIT in 6-decimal units also works)
//   --leader-topup <AUSD>    add to an existing leader account
//   --reserve-ausd <AUSD>    AUSD that must stay in the ops wallet after this script (testnet default 2500: the
//                            tester pool; mainnet default 0)
//   --keepers a,b            keepers to ensure (default: ops); --registry <addr> overrides the deployment file
//   --factory <addr>         overrides the deployment file
//   --follower-owner <addr>  the demo follower's passkey owner address (from the app)
//   --follower-fund <AUSD>   AUSD to send from ops to --follower-owner (default 0: none)
//   --perp <id>              demo market (default: BTC of the network)

import { encodeFunctionData, getAddress, isAddress, zeroHash } from "viem";
import {
  OPS,
  artifact,
  connect,
  env,
  erc20Abi,
  exchangeAbi,
  flag,
  fmtUnits,
  opt,
  perplAccountOf,
  planAndSend,
  readDeployment,
  rpcLabel,
  sharedConfig,
} from "./lib/ops.mjs";

const ctx = await connect({ networks: ["mainnet", "testnet", "local"] });
const { client, account, exchange, collateral, networkName, chainId } = ctx;
const ops = account.address;
const netCfg = sharedConfig.networks[networkName === "testnet" ? "testnet" : "mainnet"];

const toCNS = (s) => {
  if (!/^\d+(\.\d{1,6})?$/.test(String(s))) throw new Error(`bad AUSD amount ${s}`);
  const [w, f = ""] = String(s).split(".");
  return BigInt(w) * 1_000_000n + BigInt(f.padEnd(6, "0"));
};

const regAbi = artifact("KeeperRegistry").abi;
const factoryAbi = artifact("MirrorAccountFactory").abi;
const accountAbi = artifact("MirrorAccount").abi;

const { file: depFile, deployment } = readDeployment(chainId, networkName);
const registry = opt("registry") ? getAddress(opt("registry")) : deployment?.keeperRegistry ? getAddress(deployment.keeperRegistry) : undefined;
const factory = opt("factory") ? getAddress(opt("factory")) : deployment?.factory ? getAddress(deployment.factory) : undefined;
const btc = netCfg.markets.find((m) => m.symbol === "BTC");
const perpId = Number(opt("perp", String(btc.perpId)));

const [, , , , realCollateral] = await client.readContract({ address: exchange, abi: exchangeAbi, functionName: "getExchangeInfo" });
if (getAddress(realCollateral) !== collateral) throw new Error(`Perpl ${exchange} uses collateral ${realCollateral}, not ${collateral}`);
const minOpen = await client.readContract({ address: exchange, abi: exchangeAbi, functionName: "getMinAccountOpenCNS" });

const reserve = toCNS(opt("reserve-ausd", networkName === "testnet" ? "2500" : "0"));
const leaderDeposit = opt("leader-deposit")
  ? toCNS(opt("leader-deposit"))
  : env.DEMO_LEADER_DEPOSIT
    ? BigInt(env.DEMO_LEADER_DEPOSIT)
    : minOpen;
const leaderTopup = opt("leader-topup") ? toCNS(opt("leader-topup")) : 0n;
const followerOwner = opt("follower-owner") ? getAddress(opt("follower-owner")) : undefined;
const followerFund = opt("follower-fund") ? toCNS(opt("follower-fund")) : 0n;
if (followerFund > 0n && !followerOwner) throw new Error("--follower-fund needs --follower-owner");
const keepers = (opt("keepers", ops) || "").split(",").filter(Boolean).map((k) => {
  if (!isAddress(k)) throw new Error(`bad keeper ${k}`);
  return getAddress(k);
});

const ausdBal = await client.readContract({ address: collateral, abi: erc20Abi, functionName: "balanceOf", args: [ops] });
const allowance = await client.readContract({ address: collateral, abi: erc20Abi, functionName: "allowance", args: [ops, exchange] });
const leader = await perplAccountOf(client, exchange, ops);

console.log(`network    ${networkName} (chain ${chainId}) via ${rpcLabel(ctx.rpc)}`);
console.log(`perpl      ${exchange}  collateral ${collateral}  min open ${fmtUnits(minOpen)} AUSD  demo market perp ${perpId}`);
console.log(`ops        ${ops}${ops === OPS ? "" : "  (not the documented ops wallet)"}  AUSD ${fmtUnits(ausdBal)}  must keep ${fmtUnits(reserve)}`);
console.log(`leader     ${leader ? `Perpl account ${leader.accountId}, balance ${fmtUnits(leader.balanceCNS)} AUSD, locked ${fmtUnits(leader.lockedBalanceCNS)}` : "no Perpl account yet"}`);
console.log(`contracts  ${deployment ? depFile : "no deployment file"}  registry ${registry ?? "-"}  factory ${factory ?? "-"}`);

// ---- steps ---------------------------------------------------------------------------------------------

const steps = [];
let ausdSpend = 0n;
const approveStep = (amount) => ({
  label: `AUSD.approve(Perpl Exchange, ${fmtUnits(amount)}) (exact)`,
  to: collateral,
  data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [exchange, amount] }),
});

if (!leader) {
  if (leaderDeposit < minOpen) throw new Error(`--leader-deposit ${fmtUnits(leaderDeposit)} is below Perpl's minimum ${fmtUnits(minOpen)}`);
  if (allowance < leaderDeposit) steps.push(approveStep(leaderDeposit));
  steps.push({
    label: `Perpl.createAccount(${fmtUnits(leaderDeposit)} AUSD): demo leader account for ${ops}`,
    to: exchange,
    data: encodeFunctionData({ abi: exchangeAbi, functionName: "createAccount", args: [leaderDeposit] }),
  });
  ausdSpend += leaderDeposit;
} else if (leaderTopup > 0n) {
  if (allowance < leaderTopup) steps.push(approveStep(leaderTopup));
  steps.push({
    label: `Perpl.depositCollateral(${fmtUnits(leaderTopup)} AUSD) into demo leader account ${leader.accountId}`,
    to: exchange,
    data: encodeFunctionData({ abi: exchangeAbi, functionName: "depositCollateral", args: [leaderTopup] }),
  });
  ausdSpend += leaderTopup;
}

if (registry) {
  const owner = getAddress(await client.readContract({ address: registry, abi: regAbi, functionName: "owner" }));
  const missing = [];
  for (const k of keepers) {
    const ok = await client.readContract({ address: registry, abi: regAbi, functionName: "isKeeper", args: [k] });
    console.log(`keeper     ${k} ${ok ? "registered" : "NOT registered"}`);
    if (!ok) missing.push(k);
  }
  if (missing.length) {
    if (owner !== ops) throw new Error(`KeeperRegistry owner is ${owner}, not the signer; cannot register keepers`);
    steps.push({
      label: `KeeperRegistry.setKeepers([${missing.join(", ")}], true)`,
      to: registry,
      data: encodeFunctionData({ abi: regAbi, functionName: "setKeepers", args: [missing, true] }),
    });
  }
} else {
  console.log("keeper     no KeeperRegistry known (deploy first, or pass --registry); skipped");
}

if (followerFund > 0n) {
  steps.push({
    label: `AUSD.transfer(${followerOwner}, ${fmtUnits(followerFund)}): demo follower owner, to deposit in the app`,
    to: collateral,
    data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [followerOwner, followerFund] }),
  });
  ausdSpend += followerFund;
}

if (ausdSpend > 0n && ausdBal - ausdSpend < reserve) {
  throw new Error(`this would leave ${fmtUnits(ausdBal - ausdSpend)} AUSD in the ops wallet, below the ${fmtUnits(reserve)} that must stay (--reserve-ausd)`);
}
if (ausdSpend > ausdBal) throw new Error(`ops wallet holds ${fmtUnits(ausdBal)} AUSD, needs ${fmtUnits(ausdSpend)}`);
if (ausdSpend) console.log(`AUSD       this run spends ${fmtUnits(ausdSpend)}; ops keeps ${fmtUnits(ausdBal - ausdSpend)}`);

const { sent } = await planAndSend(ctx, steps, {
  assertTarget: (s) => {
    const allowed = [collateral, exchange, registry].filter(Boolean);
    if (!allowed.includes(getAddress(s.to))) throw new Error(`refusing a call to ${s.to}`);
  },
});
for (const s of sent) if (ctx.explorerTx) console.log(`  ${ctx.explorerTx}${s.hash}`);

// ---- read-only: demo follower (in-app steps) ------------------------------------------------------------

const leaderNow = await perplAccountOf(client, exchange, ops);
const leaderId = leaderNow ? Number(leaderNow.accountId) : undefined;
console.log("\ndemo follower (in the app, with the passkey; the relayer pays gas):");
let followerAccount = opt("follower-account") ? getAddress(opt("follower-account")) : undefined;
if (!followerAccount && followerOwner && factory) {
  followerAccount = getAddress(await client.readContract({ address: factory, abi: factoryAbi, functionName: "predictAccount", args: [followerOwner, zeroHash] }));
}
if (!followerAccount) {
  console.log("  pass --follower-owner <passkey address from the app> to check the follower's state");
} else {
  const code = await client.getCode({ address: followerAccount });
  const created = !!code && code !== "0x";
  const ownerBal = followerOwner ? await client.readContract({ address: collateral, abi: erc20Abi, functionName: "balanceOf", args: [followerOwner] }) : undefined;
  console.log(`  MirrorAccount ${followerAccount} (salt 0)`);
  if (ownerBal !== undefined) console.log(`  owner ${followerOwner} holds ${fmtUnits(ownerBal)} AUSD`);
  const r = (functionName) => client.readContract({ address: followerAccount, abi: accountAbi, functionName });
  const check = (ok, text) => console.log(`  [${ok ? "x" : " "}] ${text}`);
  check(created, "create account (app: Create account)");
  if (created) {
    const [pid, nd, ls, mk, paused] = await Promise.all([r("perplAccountId"), r("netDeposits"), r("leaders"), r("marketIds"), r("paused")]);
    check(pid !== 0, `deposit at least ${fmtUnits(minOpen)} AUSD (opens its Perpl account): perplAccountId ${pid}, net deposits ${fmtUnits(nd)}`);
    const follows = leaderId !== undefined && ls.some((l) => Number(l.accountId) === leaderId);
    check(follows && mk.map(Number).includes(perpId), `follow the demo leader ${leaderId ?? "?"} in perp ${perpId} with match now (leaders ${ls.map((l) => l.accountId).join(",") || "-"}, markets ${mk.join(",") || "-"})`);
    check(!paused, "not paused");
  }
}

console.log("\nengine variables for the demo pair (no secrets):");
console.log(`  DEMO_PERP_ID=${perpId}`);
console.log(`  DEMO_FOLLOWER_ACCOUNT=${followerAccount ?? "<MirrorAccount shown in the app>"}`);
console.log(`  TEAM_RUN_ADDRESSES=${[followerOwner ?? "<passkey owner address>"].join(",")}`);
console.log("  DEMO_LEADER_PRIVATE_KEY, KEEPER_PRIVATE_KEYS, RELAYER_PRIVATE_KEY = the ops key (set in Railway, never in a file)");
console.log("indexer variables:");
console.log(`  ENVIO_TEAM_RUN_ADDRESSES=${[ops, followerOwner ?? "<passkey owner>", followerAccount ?? "<MirrorAccount>"].join(",")}`);
console.log(`  ENVIO_TEAM_RUN_ACCOUNT_IDS=${leaderId ?? "<leader Perpl account id>"}`);
if (flag("send")) console.log("\ndone.");
