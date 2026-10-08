#!/usr/bin/env node
// Sends testers their test AUSD from the ops wallet's tester pool, on Monad TESTNET only (refuses any other network).
// One AUSD.transfer per address, gas limits from Monad's eth_estimateGas (scripts/lib/ops.mjs planAndSend).
//
//   node send-test-ausd.mjs --network testnet --to 0xAAA --to 0xBBB                 (plan only, sends nothing)
//   node send-test-ausd.mjs --network testnet --to 0xAAA --send --expect-nonce N     (sends)
//
// Options: --amount <AUSD> (default 100), --keep <AUSD> (refuse if the ops wallet would hold less than this after the
// sends; default 0). Prints a funding-ledger row per send for docs/funding-ledger.md.
import { encodeFunctionData, getAddress, isAddress } from "viem";
import { argv, connect, erc20Abi, flag, fmtUnits, opt, planAndSend } from "./lib/ops.mjs";

if (opt("network", "") !== "testnet") throw new Error("testnet only: pass --network testnet");
const to = argv.flatMap((a, i) => (a === "--to" ? [argv[i + 1]] : []));
if (!to.length) throw new Error("give at least one --to <tester's Mirror address>");
for (const a of to) if (!isAddress(a)) throw new Error(`not an address: ${a}`);
const unique = [...new Set(to.map((a) => getAddress(a)))];
if (unique.length !== to.length) throw new Error("duplicate --to address");
const amount = BigInt(Math.round(Number(opt("amount", "100")) * 1e6));
const keep = BigInt(Math.round(Number(opt("keep", "0")) * 1e6));

const ctx = await connect({ networks: ["testnet"] });
const bal = await ctx.client.readContract({ address: ctx.collateral, abi: erc20Abi, functionName: "balanceOf", args: [ctx.account.address] });
const total = amount * BigInt(unique.length);
console.log(`pool       ops ${ctx.account.address} holds ${fmtUnits(bal)} test AUSD; sending ${unique.length} x ${fmtUnits(amount)} = ${fmtUnits(total)}; keep ${fmtUnits(keep)}`);
if (bal - total < keep) throw new Error(`not enough in the pool: ${fmtUnits(bal)} - ${fmtUnits(total)} < keep ${fmtUnits(keep)}`);

const steps = unique.map((addr) => ({
  label: `AUSD.transfer(${addr}, ${fmtUnits(amount)}): tester`,
  to: ctx.collateral,
  data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [addr, amount] }),
}));
const res = await planAndSend(ctx, steps);
if (flag("send") && res?.sent?.length) {
  const day = new Date().toISOString().slice(0, 16).replace("T", " ");
  console.log("\nledger rows (docs/funding-ledger.md, Monad testnet):");
  res.sent.forEach((s, i) => {
    const hash = s.hash ?? s.txHash ?? s;
    console.log(`| ${day} | Out (test funds) | test AUSD | ${fmtUnits(amount)} | Tester pool: to tester \`${unique[i].slice(0, 6)}…${unique[i].slice(-4)}\` | [${String(hash).slice(0, 10)}…](https://testnet.monadvision.com/tx/${hash}) |`);
  });
}
