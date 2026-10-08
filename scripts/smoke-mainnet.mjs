#!/usr/bin/env node
// Read-only smoke checks of a Mirror deployment. Signs nothing and sends nothing (eth_call / eth_estimateGas only).
//
//   cd scripts
//   node smoke-mainnet.mjs                                              mainnet, contracts/deployments/143.json
//   node smoke-mainnet.mjs --network testnet                            testnet, contracts/deployments/10143.json
//   node smoke-mainnet.mjs --network local --rpc http://127.0.0.1:8560  a fork, contracts/deployments/local-<id>.json
//
// Options: --deployment <file>, --cap <AUSD> (expected deposit cap; default: the deployment file's),
// --builder-id 26 --builder-fee 20 (expected), --owner <addr> (expected registry owner; default the ops wallet),
// --api (also GET Perpl's public REST context; Perpl geo-blocks the US and UK).
//
// Checks: code at the three addresses and that it is the compiled code (immutables masked); factory and
// implementation immutables (exchange, AUSD, registry, factory, deposit cap, BUILDER_ID, BUILDER_FEE_PER_100K);
// the implementation cannot be initialised; registry owner, no pending owner, keepers registered, a random address
// not a keeper; predictAccount == what createAccount would return (eth_call); Perpl exchange reachable (collateral,
// minimum open, BTC mark); the demo leader's Perpl account; shared/config.json addresses if filled in.
// Exit code 1 when any check fails.

import { encodeFunctionData, getAddress, zeroAddress, zeroHash } from "viem";
import { OPS, artifact, connect, exchangeAbi, flag, fmtUnits, opt, perplAccountOf, readDeployment, rpcLabel, sharedConfig } from "./lib/ops.mjs";

const ctx = await connect({ signer: false });
const { client, chainId, networkName, exchange, collateral } = ctx;
const { file, deployment: d } = readDeployment(chainId, networkName);

let failures = 0;
const check = (ok, what, detail = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${what}${detail ? `  (${detail})` : ""}`);
};
const warn = (what) => console.log(`WARN  ${what}`);

console.log(`network    ${networkName} (chain ${chainId}) via ${rpcLabel(ctx.rpc)}  block ${await client.getBlockNumber()}`);
console.log(`deployment ${file}\n`);
if (!d) {
  check(false, "deployment file exists", "deploy first: scripts/deploy-contracts.mjs");
  process.exit(1);
}
check(d.chainId === chainId, "deployment file is for this chain", `file ${d.chainId}, rpc ${chainId}`);

const reg = getAddress(d.keeperRegistry);
const fac = getAddress(d.factory);
const impl = getAddress(d.implementation);
const expect = {
  exchange,
  collateral,
  cap: opt("cap") ? BigInt(Math.round(Number(opt("cap")) * 1e6)) : BigInt(d.depositCap),
  builderId: Number(opt("builder-id", "26")),
  builderFee: Number(opt("builder-fee", "20")),
  owner: getAddress(opt("owner", OPS)),
};
check(getAddress(d.exchange) === exchange && getAddress(d.collateral) === collateral, "deployment file names this network's Perpl exchange and AUSD");

// ---- code -------------------------------------------------------------------------------------------------

function masked(hex, refs) {
  const b = Buffer.from(hex.replace(/^0x/, ""), "hex");
  for (const list of Object.values(refs ?? {})) for (const { start, length } of list) b.fill(0, start, start + length);
  return b.toString("hex");
}
for (const [name, addr] of [["KeeperRegistry", reg], ["MirrorAccountFactory", fac], ["MirrorAccount", impl]]) {
  const code = (await client.getCode({ address: addr })) ?? "0x";
  const art = artifact(name).deployedBytecode;
  const same = code !== "0x" && masked(code, art.immutableReferences) === masked(art.object, art.immutableReferences);
  check(code !== "0x", `${name} has code at ${addr}`, `${(code.length - 2) / 2} bytes`);
  check(same, `${name} runtime code equals contracts/out (immutables masked)`);
}

// ---- immutables -------------------------------------------------------------------------------------------

const facAbi = artifact("MirrorAccountFactory").abi;
const accAbi = artifact("MirrorAccount").abi;
const regAbi = artifact("KeeperRegistry").abi;
const rf = (functionName, args = []) => client.readContract({ address: fac, abi: facAbi, functionName, args });
const ri = (functionName, args = []) => client.readContract({ address: impl, abi: accAbi, functionName, args });
const rr = (functionName, args = []) => client.readContract({ address: reg, abi: regAbi, functionName, args });

check(getAddress(await rf("implementation")) === impl, "factory.implementation == deployment implementation");
check(getAddress(await rf("exchange")) === exchange, "factory.exchange == Perpl Exchange", exchange);
check(getAddress(await rf("collateral")) === collateral, "factory.collateral == AUSD", collateral);
check(getAddress(await rf("keepers")) === reg, "factory.keepers == KeeperRegistry");
const cap = await rf("depositCap");
check(cap === expect.cap, "factory.depositCap", `${fmtUnits(cap)} AUSD, expected ${fmtUnits(expect.cap)}`);
check(Number(await rf("builderId")) === expect.builderId, "factory.builderId", `${await rf("builderId")}, expected ${expect.builderId}`);
check(Number(await rf("builderFeePer100K")) === expect.builderFee, "factory.builderFeePer100K", `${await rf("builderFeePer100K")}, expected ${expect.builderFee}`);

check(getAddress(await ri("EXCHANGE")) === exchange, "implementation.EXCHANGE");
check(getAddress(await ri("COLLATERAL")) === collateral, "implementation.COLLATERAL");
check(getAddress(await ri("KEEPERS")) === reg, "implementation.KEEPERS");
check(getAddress(await ri("FACTORY")) === fac, "implementation.FACTORY");
check((await ri("DEPOSIT_CAP")) === expect.cap, "implementation.DEPOSIT_CAP", fmtUnits(await ri("DEPOSIT_CAP")));
check(Number(await ri("BUILDER_ID")) === expect.builderId, "implementation.BUILDER_ID", String(await ri("BUILDER_ID")));
check(Number(await ri("BUILDER_FEE_PER_100K")) === expect.builderFee, "implementation.BUILDER_FEE_PER_100K", String(await ri("BUILDER_FEE_PER_100K")));
check(getAddress(await ri("owner")) === zeroAddress, "implementation has no owner");
const stranger = "0x000000000000000000000000000000000000dEaD";
let initReverts = false;
try {
  await client.call({ account: fac, to: impl, data: encodeFunctionData({ abi: accAbi, functionName: "initialize", args: [stranger] }) });
} catch {
  initReverts = true;
}
check(initReverts, "implementation.initialize reverts even from the factory (initializers disabled)");

// ---- registry ---------------------------------------------------------------------------------------------

check(getAddress(await rr("owner")) === expect.owner, "KeeperRegistry.owner", getAddress(await rr("owner")));
check(getAddress(await rr("pendingOwner")) === zeroAddress, "KeeperRegistry has no pending owner");
for (const k of d.keepers ?? []) check(await rr("isKeeper", [getAddress(k)]), `isKeeper(${k})`);
if (!(d.keepers ?? []).length) warn("deployment file lists no keepers");
check(!(await rr("isKeeper", [stranger])), "a random address is not a keeper");

// ---- factory works ----------------------------------------------------------------------------------------

const predicted = getAddress(await rf("predictAccount", [expect.owner, zeroHash]));
const createData = encodeFunctionData({ abi: facAbi, functionName: "createAccount", args: [expect.owner, zeroHash] });
const existing = (await client.getCode({ address: predicted })) ?? "0x";
if (existing === "0x") {
  const { data } = await client.call({ account: stranger, to: fac, data: createData });
  const returned = getAddress(`0x${data.slice(-40)}`);
  check(returned === predicted, "createAccount (eth_call) returns predictAccount(owner, 0)", predicted);
  const gas = BigInt(await client.request({ method: "eth_estimateGas", params: [{ from: stranger, to: fac, data: createData }, "latest"] }));
  console.log(`INFO  createAccount costs ${gas} gas by this chain's eth_estimateGas (paid by the relayer per new follower)`);
} else {
  check(await rf("isAccount", [predicted]), "predicted account exists and the factory knows it", predicted);
}

// ---- Perpl ------------------------------------------------------------------------------------------------

const info = await client.readContract({ address: exchange, abi: exchangeAbi, functionName: "getExchangeInfo" });
check(getAddress(info[4]) === collateral, "Perpl getExchangeInfo collateral == AUSD");
const minOpen = await client.readContract({ address: exchange, abi: exchangeAbi, functionName: "getMinAccountOpenCNS" });
check(minOpen > 0n && minOpen <= expect.cap, "Perpl minimum account open <= deposit cap", `${fmtUnits(minOpen)} AUSD`);
const net = sharedConfig.networks[networkName === "testnet" ? "testnet" : "mainnet"];
const btc = net.markets.find((m) => m.symbol === "BTC");
const [, mark, valid] = await client.readContract({ address: exchange, abi: exchangeAbi, functionName: "getPositionV2", args: [BigInt(btc.perpId), 1n] });
check(mark > 0n, `Perpl BTC (perp ${btc.perpId}) mark readable`, `${Number(mark) / 10 ** btc.priceDecimals} valid=${valid}`);
if (!valid) warn("BTC mark not currently valid (stale): demo trades would fail until Perpl updates it");
const leader = await perplAccountOf(client, exchange, OPS);
if (leader) console.log(`INFO  demo leader ${OPS}: Perpl account ${leader.accountId}, balance ${fmtUnits(leader.balanceCNS)} AUSD`);
else warn(`demo leader ${OPS} has no Perpl account on this network (scripts/demo-setup.mjs)`);

if (flag("api")) {
  try {
    const res = await fetch(`${net.perplApi}/v1/pub/context`, { signal: AbortSignal.timeout(15_000) });
    check(res.ok, "Perpl REST context reachable", `${net.perplApi} HTTP ${res.status}`);
  } catch (e) {
    warn(`Perpl REST not reachable from here: ${e.message}`);
  }
}

// ---- shared/config.json -----------------------------------------------------------------------------------

if (networkName !== "local") {
  const m = net.mirror;
  if (!m.factory) warn("shared/config.json mirror addresses not filled in yet");
  else {
    check(getAddress(m.factory) === fac && getAddress(m.implementation) === impl && getAddress(m.keeperRegistry) === reg, "shared/config.json mirror addresses == deployment");
    check(m.deployBlock === d.block, "shared/config.json deployBlock == deployment block", String(m.deployBlock));
  }
}

console.log(`\n${failures ? `${failures} check(s) FAILED` : "all checks passed"}`);
process.exit(failures ? 1 : 0);
