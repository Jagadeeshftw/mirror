#!/usr/bin/env node
// End-to-end rehearsal of the mainnet runbook on a local anvil fork of Monad mainnet. Nothing is sent to Monad.
//
//   cd scripts && node fork-test-mainnet.mjs [--port 8560]
//
// The fork runs with --chain-id 31337, so every transaction the ops key signs here is invalid on mainnet
// (EIP-155); fork-only setup (marks, test AUSD, a test position) uses anvil impersonation and signs nothing.
// It runs the real scripts in order, as the owner would on mainnet:
//   1. deploy-contracts.mjs --network local (plan, then --send at the ops wallet's real nonce: same addresses as
//      the mainnet plan);
//   2. smoke-mainnet.mjs --network local;
//   3. demo-setup.mjs --network local: plan; then a demo follower stand-in (anvil key, playing the passkey owner)
//      creates and funds its MirrorAccount, and demo-setup reports its in-app checklist;
//   4. fork-only: the demo leader (ops) is left holding a BTC position, and an ops-owned MirrorAccount holds 10 AUSD;
//   5. return-funds-mainnet.mjs --network local --to <owner stand-in> --mon: plan, then --send;
//   6. asserts: demo leader flat with 0 free on Perpl, ops-owned MirrorAccount empty, ops wallet AUSD 0 and MON at
//      the 10 MON reserve, owner stand-in received it all, the demo follower's MirrorAccount and owner untouched;
//      smoke again. anvil is stopped at the end (by PID).

import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createPublicClient, createWalletClient, defineChain, encodeFunctionData, getAddress, http, keccak256, parseEther, toHex, zeroHash } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { OPS, artifact, erc20Abi, exchangeAbi, fmtUnits, opt, perpIdsOf, perplAccountOf, root, slippageBound } from "./lib/ops.mjs";

const PORT = Number(opt("port", "8560"));
if (PORT < 8560 || PORT > 8569) throw new Error("use a port in 8560..8569");
const RPC = `http://127.0.0.1:${PORT}`;
const EXCHANGE = getAddress("0x34B6552d57a35a1D042CcAe1951BD1C370112a6F");
const AUSD = getAddress("0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a");
const PERPL_OWNER = getAddress("0xd0a0205e9188998E0bE7F2600a715aD3CD289Cb1");
const PRICE_ADMIN = getAddress("0x53d5c4f9a2f32f0c27671340d8af93384ea93881");
const BTC = 1n;
// Throwaway test keys derived from fixed labels (fork only; fresh addresses with no mainnet code or history).
const follower = privateKeyToAccount(keccak256(toHex("mirror fork test: demo follower owner stand-in")));
const OWNER_WALLET = privateKeyToAccount(keccak256(toHex("mirror fork test: owner wallet stand-in"))).address;

const logDir = join(root, "scripts", ".fork-test");
mkdirSync(logDir, { recursive: true });
const log = [];
const say = (...a) => {
  const line = a.join(" ");
  log.push(line);
  console.log(line);
};

const chain = defineChain({ id: 31337, name: "fork", nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 }, rpcUrls: { default: { http: [RPC] } } });
const pub = createPublicClient({ chain, transport: http(RPC, { timeout: 60_000 }) });
const rpc = (method, params) => pub.request({ method, params });
const as = (address) => createWalletClient({ chain, account: address, transport: http(RPC, { timeout: 60_000 }) });
const fw = createWalletClient({ chain, account: follower, transport: http(RPC, { timeout: 60_000 }) });

async function tx(w, to, data, label) {
  const hash = await w.sendTransaction({ to, data, chain, account: w.account });
  const r = await pub.waitForTransactionReceipt({ hash });
  if (r.status !== "success") throw new Error(`fork setup tx failed: ${label}`);
  say(`  fork setup: ${label} (gas ${r.gasUsed})`);
  return r;
}

function run(script, args) {
  say(`\n$ node ${script} ${args.join(" ")}`);
  const r = spawnSync("node", [script, ...args], { cwd: join(root, "scripts"), encoding: "utf8" });
  const out = (r.stdout + r.stderr).trimEnd();
  for (const l of out.split("\n")) say(`  ${l}`);
  if (r.status !== 0) throw new Error(`${script} exited ${r.status}`);
  return out;
}

let failures = 0;
const check = (ok, what, detail = "") => {
  if (!ok) failures++;
  say(`${ok ? "PASS" : "FAIL"}  ${what}${detail ? `  (${detail})` : ""}`);
};

// ---- anvil ----------------------------------------------------------------------------------------------

const busy = spawnSync("lsof", ["-nP", `-iTCP:${PORT}`, "-sTCP:LISTEN"], { encoding: "utf8" }).stdout.trim();
if (busy) throw new Error(`port ${PORT} is in use`);
const anvil = spawn(
  "anvil",
  ["--fork-url", "https://rpc.monad.xyz", "--chain-id", "31337", "--port", String(PORT), "--disable-code-size-limit", "--no-storage-caching", "--silent"],
  { stdio: "ignore" },
);
say(`anvil pid ${anvil.pid} on ${RPC} (fork of Monad mainnet, chain id 31337)`);
const stop = () => {
  try {
    process.kill(anvil.pid, "SIGTERM");
  } catch {}
};
process.on("exit", stop);
process.on("SIGINT", () => process.exit(130));

try {
  for (let i = 0; ; i++) {
    try {
      await pub.getBlockNumber();
      break;
    } catch {
      if (i > 120) throw new Error("anvil did not start");
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  const forkBlock = await pub.getBlockNumber();
  say(`forked at mainnet block ${forkBlock}`);
  const nonce = await pub.getTransactionCount({ address: OPS });

  // ---- 1-2. deploy + smoke --------------------------------------------------------------------------------
  const local = ["--network", "local", "--rpc", RPC];
  run("deploy-contracts.mjs", [...local, "--cap", "25", "--builder-id", "26", "--builder-fee", "20", "--keepers", OPS]);
  run("deploy-contracts.mjs", [...local, "--cap", "25", "--builder-id", "26", "--builder-fee", "20", "--keepers", OPS, "--send", "--expect-nonce", String(nonce)]);
  run("smoke-mainnet.mjs", [...local, "--cap", "25"]);

  const dep = JSON.parse(spawnSync("cat", [join(root, "contracts", "deployments", "local-31337.json")], { encoding: "utf8" }).stdout);
  const factory = getAddress(dep.factory);
  const facAbi = artifact("MirrorAccountFactory").abi;
  const accAbi = artifact("MirrorAccount").abi;

  // ---- fork-only setup (impersonation; nothing is signed with a real key) ---------------------------------
  say("\nfork-only setup:");
  for (const a of [PERPL_OWNER, PRICE_ADMIN, EXCHANGE, OPS]) await rpc("anvil_impersonateAccount", [a]);
  for (const a of [PERPL_OWNER, PRICE_ADMIN, EXCHANGE]) await rpc("anvil_setBalance", [a, "0x56BC75E2D63100000"]);
  await rpc("anvil_setBalance", [follower.address, "0x56BC75E2D63100000"]);
  const [, mark0] = await pub.readContract({ address: EXCHANGE, abi: exchangeAbi, functionName: "getPositionV2", args: [BTC, 1n] });
  await tx(as(PERPL_OWNER), EXCHANGE, encodeFunctionData({ abi: [{ type: "function", name: "setIgnOracle", inputs: [{ type: "uint256" }, { type: "bool" }], outputs: [], stateMutability: "nonpayable" }], functionName: "setIgnOracle", args: [BTC, true] }), "Perpl owner: BTC ignores the oracle (no oracle updates on a fork)");
  await tx(as(PRICE_ADMIN), EXCHANGE, encodeFunctionData({ abi: [{ type: "function", name: "updateMarkPricePNS", inputs: [{ type: "uint256" }, { type: "uint32" }], outputs: [], stateMutability: "nonpayable" }], functionName: "updateMarkPricePNS", args: [BTC, Number(mark0)] }), `price admin: BTC mark refreshed at ${mark0}`);
  const give = async (to, amount, why) => tx(as(EXCHANGE), AUSD, encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [to, amount] }), `test AUSD ${fmtUnits(amount)} to ${why}`);

  // demo follower stand-in: creates its MirrorAccount and deposits (in the app this is the passkey + relayer)
  await give(follower.address, 12_000_000n, `the demo follower owner stand-in ${follower.address}`);
  const fAcct = getAddress(await pub.readContract({ address: factory, abi: facAbi, functionName: "predictAccount", args: [follower.address, zeroHash] }));
  await tx(fw, factory, encodeFunctionData({ abi: facAbi, functionName: "createAccount", args: [follower.address, zeroHash] }), `demo follower MirrorAccount ${fAcct} created`);
  await tx(fw, AUSD, encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [fAcct, 10_000_000n] }), "demo follower owner approves 10 AUSD");
  await tx(fw, fAcct, encodeFunctionData({ abi: accAbi, functionName: "deposit", args: [10_000_000n] }), "demo follower deposits 10 AUSD (opens its Perpl account)");

  // ---- 3. demo setup --------------------------------------------------------------------------------------
  run("demo-setup.mjs", [...local, "--follower-owner", follower.address]);
  const n1 = await pub.getTransactionCount({ address: OPS });
  run("demo-setup.mjs", [...local, "--follower-owner", follower.address, "--leader-topup", "0.3", "--send", "--expect-nonce", String(n1)]);

  // ---- 4. leave funds where the return script must find them ----------------------------------------------
  say("\nfork-only: state for the return test");
  const opsMirror = getAddress(await pub.readContract({ address: factory, abi: facAbi, functionName: "predictAccount", args: [OPS, zeroHash] }));
  await give(OPS, 20_000_000n, "the ops wallet");
  await tx(as(OPS), factory, encodeFunctionData({ abi: facAbi, functionName: "createAccount", args: [OPS, zeroHash] }), `ops-owned MirrorAccount ${opsMirror} created`);
  await tx(as(OPS), AUSD, encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [opsMirror, 10_000_000n] }), "ops approves its MirrorAccount");
  await tx(as(OPS), opsMirror, encodeFunctionData({ abi: accAbi, functionName: "deposit", args: [10_000_000n] }), "ops deposits 10 AUSD into its MirrorAccount");
  const [, markNow] = await pub.readContract({ address: EXCHANGE, abi: exchangeAbi, functionName: "getPositionV2", args: [BTC, 1n] });
  const openData = encodeFunctionData({
    abi: exchangeAbi,
    functionName: "execOrder",
    args: [{ orderDescId: 1n, perpId: BTC, orderType: 0, orderId: 0n, pricePNS: slippageBound(0, markNow, 100), lotLNS: 1n, expiryBlock: 0n, postOnly: false, fillOrKill: false, immediateOrCancel: true, maxMatches: 100n, leverageHdths: 200n, lastExecutionBlock: 0n, amountCNS: 0n, maxNegPnlCollatBPS: 1000n }],
  });
  await tx(as(OPS), EXCHANGE, openData, "demo leader (ops) opens 1 lot BTC long at 2x against the forked book (a demo cycle left open)");
  await rpc("anvil_stopImpersonatingAccount", [OPS]);
  const leaderBefore = await perplAccountOf(pub, EXCHANGE, OPS);
  say(`  demo leader Perpl ${leaderBefore.accountId}: free ${fmtUnits(leaderBefore.balanceCNS)}, positions ${perpIdsOf(leaderBefore.positions).join(",")}`);
  const fBefore = {
    perpl: await perplAccountOf(pub, EXCHANGE, fAcct),
    nd: await pub.readContract({ address: fAcct, abi: accAbi, functionName: "netDeposits" }),
    owner: await pub.readContract({ address: AUSD, abi: erc20Abi, functionName: "balanceOf", args: [follower.address] }),
  };
  const ownerBefore = await pub.readContract({ address: AUSD, abi: erc20Abi, functionName: "balanceOf", args: [OWNER_WALLET] });
  const ownerMonBefore = await pub.getBalance({ address: OWNER_WALLET });

  // ---- 5. funds return ------------------------------------------------------------------------------------
  const ret = [...local, "--to", OWNER_WALLET, "--mon", "--follower-account", fAcct];
  run("return-funds-mainnet.mjs", ret);
  const n2 = await pub.getTransactionCount({ address: OPS });
  run("return-funds-mainnet.mjs", [...ret, "--send", "--expect-nonce", String(n2)]);

  // ---- 6. asserts -----------------------------------------------------------------------------------------
  say("\nchecks:");
  const leaderAfter = await perplAccountOf(pub, EXCHANGE, OPS);
  check(perpIdsOf(leaderAfter.positions).length === 0, "demo leader position closed");
  check(leaderAfter.balanceCNS === 0n, "demo leader Perpl free balance withdrawn", fmtUnits(leaderAfter.balanceCNS));
  const om = await perplAccountOf(pub, EXCHANGE, opsMirror);
  const omIdle = await pub.readContract({ address: AUSD, abi: erc20Abi, functionName: "balanceOf", args: [opsMirror] });
  check((om?.balanceCNS ?? 0n) === 0n && omIdle === 0n, "ops-owned MirrorAccount emptied to its owner");
  const opsAusd = await pub.readContract({ address: AUSD, abi: erc20Abi, functionName: "balanceOf", args: [OPS] });
  check(opsAusd === 0n, "ops wallet AUSD swept", fmtUnits(opsAusd));
  const ownerAfter = await pub.readContract({ address: AUSD, abi: erc20Abi, functionName: "balanceOf", args: [OWNER_WALLET] });
  say(`  owner stand-in received ${fmtUnits(ownerAfter - ownerBefore)} AUSD`);
  check(ownerAfter - ownerBefore > 30_000_000n, "owner stand-in received the AUSD (leader account + ops-owned MirrorAccount + wallet)", fmtUnits(ownerAfter - ownerBefore));
  const opsMon = await pub.getBalance({ address: OPS });
  check(opsMon >= parseEther("10") && opsMon < parseEther("10.01"), "ops wallet MON left at the 10 MON reserve", `${Number(opsMon) / 1e18}`);
  check((await pub.getBalance({ address: OWNER_WALLET })) > ownerMonBefore, "owner stand-in received MON");
  const fAfter = {
    perpl: await perplAccountOf(pub, EXCHANGE, fAcct),
    nd: await pub.readContract({ address: fAcct, abi: accAbi, functionName: "netDeposits" }),
    owner: await pub.readContract({ address: AUSD, abi: erc20Abi, functionName: "balanceOf", args: [follower.address] }),
  };
  check(fAfter.perpl.balanceCNS === fBefore.perpl.balanceCNS && fAfter.nd === fBefore.nd, "demo follower MirrorAccount untouched", `Perpl ${fmtUnits(fAfter.perpl.balanceCNS)}, net deposits ${fmtUnits(fAfter.nd)}`);
  check(fAfter.owner === fBefore.owner, "demo follower owner untouched");
  run("smoke-mainnet.mjs", [...local, "--cap", "25"]);
} catch (e) {
  failures++;
  say(`ERROR ${e.message}`);
} finally {
  stop();
  say(`\nanvil ${anvil.pid} stopped. ${failures ? `${failures} FAILED` : "fork test passed"}`);
  writeFileSync(join(logDir, "fork-test.log"), log.join("\n") + "\n");
  const local = join(root, "contracts", "deployments", "local-31337.json");
  if (existsSync(local)) rmSync(local);
}
process.exit(failures ? 1 : 0);
