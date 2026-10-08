#!/usr/bin/env node
// Funds return, one command: brings back everything the team's own keys can move, to the ops wallet, and with
// --to <owner wallet> on to the owner.
//
// What a script CAN return (signed by the ops key, the only key in .env):
//   1. The ops EOA's own Perpl account (the team-run demo leader, account 5416 on mainnet): closes any open
//      position with a bounded IOC order (unless --keep-positions) and withdraws the free balance to the ops wallet.
//   2. A MirrorAccount whose owner is the ops EOA itself (none is planned; checked at salt 0): withdraw(), which by
//      contract always pays its owner, i.e. the ops wallet. Only when it holds no position.
//   3. With --to <owner wallet>: all AUSD and USDC in the ops wallet, and with --mon all MON above --keep-mon.
//
// What it CANNOT return (reported read-only, never touched):
//   - The team-run demo follower's MirrorAccount and its passkey owner address. Only the passkey can sign for
//     them: in the app, Close all, then Withdraw (the contract pays the owner address), then send from the owner.
//   - Any follower's collateral. No step of this script calls a MirrorAccount it does not own; withdrawals from a
//     MirrorAccount only ever go to that account's owner, by contract.
//
// Monad reserve balance: a transaction that leaves an EOA below 10 MON reverts unless it is an "emptying"
// transaction (the sender sent nothing in the last few blocks). The engine uses the ops key too, so the MON step
// keeps 10 MON by default (--keep-mon). Going lower needs --engine-stopped; the script then waits 5 s before it.
//
// Plan only by default. Sending needs --send --expect-nonce N, and on mainnet also --confirm-mainnet.
// Gas limits from the chain's own estimator (scripts/lib/ops.mjs); closing orders get x1.3 (the book can move).
//
//   cd scripts
//   node return-funds-mainnet.mjs
//   node return-funds-mainnet.mjs --to 0xOwnerWallet --mon
//   node return-funds-mainnet.mjs --to 0xOwnerWallet --mon --send --expect-nonce N --confirm-mainnet
//   node return-funds-mainnet.mjs --network local --rpc http://127.0.0.1:8560 ...
//
// Options: --to <addr>, --mon, --keep-mon <MON> (default 10), --engine-stopped, --keep-positions,
//          --close-slippage-bps <n> (default 100, max 500), --follower-account <addr> (report only).

import { encodeFunctionData, getAddress, isAddress, parseEther, zeroHash } from "viem";
import {
  OPS,
  USDC,
  artifact,
  connect,
  env,
  erc20Abi,
  exchangeAbi,
  flag,
  fmtMon,
  fmtUnits,
  opt,
  perpIdsOf,
  perplAccountOf,
  planAndSend,
  readDeployment,
  rpcLabel,
  sharedConfig,
  slippageBound,
} from "./lib/ops.mjs";

const ctx = await connect({ networks: ["mainnet", "local"] });
const { client, account, exchange, collateral, networkName, chainId } = ctx;
const ops = account.address;
if (ops !== OPS) console.log(`note: signer ${ops} is not the documented ops wallet ${OPS}`);

const to = opt("to") ? getAddress(opt("to")) : undefined;
if (opt("to") && !isAddress(opt("to"))) throw new Error("bad --to");
if (to && to === ops) throw new Error("--to is the ops wallet itself; omit it");
const withMon = flag("mon");
if (withMon && !to) throw new Error("--mon needs --to");
const keepMon = parseEther(opt("keep-mon", "10"));
if (keepMon < parseEther("10") && !flag("engine-stopped")) {
  throw new Error("--keep-mon below 10 MON needs --engine-stopped (Monad's reserve rule; stop the engine first so the ops key sends nothing else)");
}
const slip = Number(opt("close-slippage-bps", "100"));
if (!Number.isInteger(slip) || slip < 1 || slip > 500) throw new Error("--close-slippage-bps must be 1..500");

const accAbi = artifact("MirrorAccount").abi;
const facAbi = artifact("MirrorAccountFactory").abi;
const { deployment } = readDeployment(chainId, networkName);
const factory = deployment?.factory ? getAddress(deployment.factory) : undefined;
const markets = sharedConfig.networks.mainnet.markets;
const sym = (perpId) => markets.find((m) => m.perpId === perpId)?.symbol ?? `perp ${perpId}`;

const bal = (token, who) => client.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [who] });

console.log(`network    ${networkName} (chain ${chainId}) via ${rpcLabel(ctx.rpc)}`);
console.log(`ops        ${ops}  ${fmtMon(await client.getBalance({ address: ops }))}  AUSD ${fmtUnits(await bal(collateral, ops))}  USDC ${fmtUnits(await bal(USDC, ops).catch(() => 0n))}`);
console.log(`to         ${to ?? "(none: funds stay in the ops wallet)"}`);
if (to) {
  const code = await client.getCode({ address: to });
  if (code && code !== "0x") console.log(`           note: ${to} is a contract (e.g. a Safe); make sure it can hold AUSD/USDC/MON`);
}

const steps = [];

// ---- 1. the ops EOA's own Perpl account ----------------------------------------------------------------

const pa = await perplAccountOf(client, exchange, ops);
let plannedWithdraw = 0n;
if (!pa) {
  console.log("perpl      ops has no Perpl account");
} else {
  const acctId = pa.accountId;
  const perps = perpIdsOf(pa.positions);
  console.log(`perpl      account ${acctId}: free ${fmtUnits(pa.balanceCNS)} AUSD, locked ${fmtUnits(pa.lockedBalanceCNS)}, positions in ${perps.map(sym).join(", ") || "none"}`);
  if (pa.frozen) throw new Error(`Perpl account ${acctId} is frozen (${pa.frozen})`);
  if (pa.lockedBalanceCNS > 0n) console.log("           note: locked balance > 0 means resting orders; cancel them (the demo only uses IOC orders)");
  let addedFromCloses = 0n;
  for (const perpId of perps) {
    const [pos, mark] = await client.readContract({ address: exchange, abi: exchangeAbi, functionName: "getPositionV2", args: [BigInt(perpId), acctId] });
    if (pos.lotLNS === 0n) continue;
    const long = pos.positionType === 0;
    console.log(`           ${sym(perpId)}: ${long ? "long" : "short"} ${pos.lotLNS} lots, deposit ${fmtUnits(pos.depositCNS)}, pnl ${fmtUnits(pos.pnlCNS)}, mark ${mark}`);
    if (flag("keep-positions")) continue;
    addedFromCloses += pos.depositCNS + (pos.pnlCNS < 0n ? pos.pnlCNS : 0n);
    const orderType = long ? 2 : 3;
    const order = (lots, price) =>
      encodeFunctionData({
        abi: exchangeAbi,
        functionName: "execOrder",
        args: [{
          orderDescId: BigInt(Date.now()), perpId: BigInt(perpId), orderType, orderId: 0n, pricePNS: price, lotLNS: lots,
          expiryBlock: 0n, postOnly: false, fillOrKill: false, immediateOrCancel: true, maxMatches: 100n, leverageHdths: 100n,
          lastExecutionBlock: 0n, amountCNS: 0n, maxNegPnlCollatBPS: 1000n,
        }],
      });
    steps.push({
      label: `Perpl.execOrder: close ${long ? "long" : "short"} ${pos.lotLNS} lots ${sym(perpId)} (IOC, mark ${slip} bps worse at most)`,
      to: exchange,
      data: order(pos.lotLNS, slippageBound(orderType, mark, slip)),
      headroom: 1.3,
      build: async () => {
        const [p, m] = await client.readContract({ address: exchange, abi: exchangeAbi, functionName: "getPositionV2", args: [BigInt(perpId), acctId] });
        if (p.lotLNS === 0n) return { skip: "already flat" };
        const ot = p.positionType === 0 ? 2 : 3;
        if (ot !== orderType) return { skip: "position side changed since the plan; run again" };
        return { data: order(p.lotLNS, slippageBound(ot, m, slip)) };
      },
    });
  }
  plannedWithdraw = pa.balanceCNS - pa.lockedBalanceCNS;
  const planAmount = plannedWithdraw > 0n ? plannedWithdraw : addedFromCloses > 0n ? 1n : 0n;
  if (planAmount > 0n) {
    const wd = (amount) => encodeFunctionData({ abi: exchangeAbi, functionName: "withdrawCollateral", args: [amount] });
    steps.push({
      label: `Perpl.withdrawCollateral(free balance${steps.length ? " after the closes" : ""}: ${fmtUnits(plannedWithdraw)} AUSD now) to the ops wallet`,
      to: exchange,
      data: wd(planAmount),
      build: async () => {
        const a = await perplAccountOf(client, exchange, ops);
        const free = a ? a.balanceCNS - a.lockedBalanceCNS : 0n;
        if (free <= 0n) return { skip: "nothing free to withdraw" };
        return { data: wd(free), label: `Perpl.withdrawCollateral(${fmtUnits(free)} AUSD) to the ops wallet` };
      },
    });
    plannedWithdraw += addedFromCloses;
  }
}

// ---- 2. a MirrorAccount owned by the ops EOA (salt 0) ---------------------------------------------------

let opsMirror;
if (factory) {
  const predicted = getAddress(await client.readContract({ address: factory, abi: facAbi, functionName: "predictAccount", args: [ops, zeroHash] }));
  const code = await client.getCode({ address: predicted });
  if (code && code !== "0x") {
    const r = (functionName, args = []) => client.readContract({ address: predicted, abi: accAbi, functionName, args });
    const owner = getAddress(await r("owner"));
    if (owner === ops) {
      const pid = await r("perplAccountId");
      const idle = await bal(collateral, predicted);
      const pp = pid ? await perplAccountOf(client, exchange, predicted) : undefined;
      const open = pp ? perpIdsOf(pp.positions).length : 0;
      const total = idle + (pp ? pp.balanceCNS - pp.lockedBalanceCNS : 0n);
      opsMirror = predicted;
      console.log(`mirror     ops-owned MirrorAccount ${predicted}: idle ${fmtUnits(idle)}, Perpl free ${fmtUnits(total - idle)}, open positions ${open}`);
      if (open) console.log("           has open positions: close them first (closeAll as owner); skipped");
      else if (total > 0n) {
        const wdm = (amount) => encodeFunctionData({ abi: accAbi, functionName: "withdraw", args: [amount] });
        steps.push({
          label: `MirrorAccount(${predicted}).withdraw(${fmtUnits(total)}): pays its owner, the ops wallet`,
          to: predicted,
          data: wdm(total),
          check: async () => {
            if (getAddress(await r("owner")) !== ops) throw new Error("owner changed; refusing");
          },
          build: async () => {
            const i = await bal(collateral, predicted);
            const p = pid ? await perplAccountOf(client, exchange, predicted) : undefined;
            if (p && perpIdsOf(p.positions).length) return { skip: "positions opened since the plan" };
            const t = i + (p ? p.balanceCNS - p.lockedBalanceCNS : 0n);
            return t > 0n ? { data: wdm(t) } : { skip: "empty" };
          },
        });
        plannedWithdraw += total;
      }
    }
  }
}

// ---- 3. on to the owner ---------------------------------------------------------------------------------

if (to) {
  for (const [token, name, extra] of [[collateral, "AUSD", plannedWithdraw], [USDC, "USDC", 0n]]) {
    const now = await bal(token, ops).catch(() => 0n);
    const planned = now + extra;
    if (planned === 0n) continue;
    const tx = (amount) => encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [to, amount] });
    steps.push({
      label: `${name}.transfer(${to}, all: about ${fmtUnits(planned)})`,
      to: token,
      data: tx(now > 0n ? now : 1n),
      build: async () => {
        const b = await bal(token, ops);
        return b > 0n ? { data: tx(b), label: `${name}.transfer(${to}, ${fmtUnits(b)})` } : { skip: `no ${name}` };
      },
    });
  }
  if (withMon) {
    steps.push({
      label: `MON to ${to}: everything above ${fmtMon(keepMon)} (amount set at send time, after gas)`,
      to,
      data: "0x",
      value: 1n,
      check: async () => {
        if (keepMon < parseEther("10")) await new Promise((r) => setTimeout(r, 5_000));
      },
      finalize: async (_ctx, gas, fee) => {
        const b = await client.getBalance({ address: ops });
        const value = b - gas * fee.maxFee - keepMon;
        return value > 0n ? { value, label: `MON transfer ${fmtMon(value)} to ${to} (keeps ${fmtMon(keepMon)})` } : { skip: "nothing above the reserve" };
      },
    });
  }
}

const allowedTargets = new Set([exchange, collateral, USDC, ...(opsMirror ? [opsMirror] : []), ...(to ? [to] : [])].map((a) => getAddress(a)));
const { sent } = await planAndSend(ctx, steps, {
  assertTarget: (s) => {
    const t = getAddress(s.to);
    if (!allowedTargets.has(t)) throw new Error(`refusing a call to ${t}`);
    if (t === to && s.data !== "0x") throw new Error("only plain MON may go to --to");
  },
});
for (const s of sent) if (ctx.explorerTx) console.log(`  ${ctx.explorerTx}${s.hash}`);

if (withMon && !ctx.send) {
  const b = await client.getBalance({ address: ops });
  console.log(`MON step: about ${fmtMon(b - keepMon)} minus the gas of the steps above would go to ${to}`);
}

// ---- 4. what only the passkey can return (read-only) ----------------------------------------------------

const followerAccount = opt("follower-account") ?? env.DEMO_FOLLOWER_ACCOUNT ?? sharedConfig.networks.mainnet.teamRun.demoFollowerAccount;
console.log("\nnot returnable by a script (passkey only):");
if (!followerAccount) {
  console.log("  demo follower: unknown (pass --follower-account <MirrorAccount>); return it in the app: Close all, then Withdraw");
} else {
  const fa = getAddress(followerAccount);
  const code = await client.getCode({ address: fa });
  if (!code || code === "0x") console.log(`  demo follower ${fa}: not deployed on this chain`);
  else {
    const r = (functionName) => client.readContract({ address: fa, abi: accAbi, functionName });
    const [owner, pid, nd] = await Promise.all([r("owner"), r("perplAccountId"), r("netDeposits")]);
    const idle = await bal(collateral, fa);
    const pp = pid ? await perplAccountOf(client, exchange, fa) : undefined;
    console.log(`  demo follower MirrorAccount ${fa}: owner ${owner}, idle ${fmtUnits(idle)} AUSD, Perpl ${pp ? `free ${fmtUnits(pp.balanceCNS)}, positions ${perpIdsOf(pp.positions).map(sym).join(", ") || "none"}` : "none"}, net deposits ${fmtUnits(nd)}`);
    console.log(`  owner ${owner}: ${fmtUnits(await bal(collateral, owner))} AUSD, ${fmtMon(await client.getBalance({ address: owner }))}`);
    console.log("  -> in the app with the passkey: Close all, then Withdraw (paid to the owner address); then send from the owner address");
  }
}
