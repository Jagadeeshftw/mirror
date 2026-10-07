#!/usr/bin/env node
// Harness hooks for the Android Stage-A flow (devices/e2e/flows/stage-a.flow calls these with `shell`).
// Localnet only: anvil test keys, the localnet faucet and the engine on E2E_ENGINE_PORT (default 8828).
// Prints "VAR name=value" lines that flow.py stores as ${name}; exits non-zero when a check fails.
//
//   node stage-a-hook.mjs setup-demo                       team-run demo follower (as e2e-api / e2e-web)
//   node stage-a-hook.mjs fund <address> <ausd>            faucet AUSD + MON to the app's wallet
//   node stage-a-hook.mjs demo-copy <open|close>           latest demo-follower copy: tx, short hash, onchain builder fee
//   node stage-a-hook.mjs follow-check <owner>             the user's follow account (entry filter 1%, 20 AUSD)
//   node stage-a-hook.mjs leader-trade <perpId> <orderType> <lots>   demo leader IOC order on Perpl
//   node stage-a-hook.mjs wait-copy <owner>                the user's copy of the leader open (builder 26 onchain)
//   node stage-a-hook.mjs mark-move <perpId> <pct>         move a mark (saves the original), mark-restore <perpId>
//   node stage-a-hook.mjs wait-blocked <owner> <reason>    the user's Blocked feed item (e.g. EntryTooFar)
//   node stage-a-hook.mjs closed <owner>                   the user's Perpl positions are flat onchain
//   node stage-a-hook.mjs wallet <address>                 AUSD in the wallet
//   node stage-a-hook.mjs devtime <serial> <var>           the device's local time "YYYY-MM-DD HH:MM" (passkey names)
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { LOCALNET, MA, apiClient, ausdOf, env, faucet, leaderTrade, position, pub, setupDemoFollower, waitFor } from "./e2e-web/chain.mjs";
import { takerBuilder } from "./e2e-web/flows-watch.mjs";

const PORT = Number(process.env.E2E_ENGINE_PORT ?? 8828);
const api = apiClient(`http://127.0.0.1:${PORT}`);
const [cmd, ...a] = process.argv.slice(2);
const out = (k, v) => console.log(`VAR ${k}=${v}`);
const short = (h) => `${h.slice(0, 6)}…${h.slice(-4)}`;
const ausd = (cns) => (Number(cns) / 1e6).toFixed(6);
const feed = async (account) => { const f = await api("GET", `/v1/accounts/${account}/feed`); return f.items ?? f.events ?? []; };
async function userAccount(owner) {
  const o = await api("GET", `/v1/owners/${owner}/accounts`);
  const x = (o.accounts ?? []).find((y) => y.deployed !== false && y.policy);
  if (!x) throw new Error(`no follow account for ${owner}`);
  return { address: x.address ?? x.account, raw: x };
}
const fail = (msg, extra = {}) => { console.log(JSON.stringify({ ok: false, msg, ...extra })); process.exit(1); };
const markFile = (perp) => join(LOCALNET, "out", `stagea-mark-${perp}.txt`);

switch (cmd) {
  case "setup-demo": {
    const r = await setupDemoFollower(api);
    console.log(JSON.stringify(r));
    if (!r.ok) process.exit(1);
    break;
  }
  case "fund": {
    const [address, amount] = a;
    const before = await ausdOf(address);
    console.log(await faucet("/fund", { address, ausd: Number(amount) }));
    const after = await waitFor("faucet mint", async () => { const b = await ausdOf(address); return b > before && b; }, 30_000);
    out("walletAusd", ausd(after));
    break;
  }
  case "demo-copy": {
    const want = a[0];
    const demo = await api("GET", "/v1/demo");
    const item = await waitFor(`demo ${want} copy`, async () => (await feed(demo.follower.account))
      .filter((i) => i.kind === "Mirrored" && (want === "open" ? Number(i.orderType) <= 1 : Number(i.orderType) >= 2))
      .sort((x, y) => Number(y.id) - Number(x.id))[0], 60_000);
    const chain = await takerBuilder(item.txHash);
    out(`demo_${want}_tx`, short(item.txHash));
    out(`demo_${want}_builder`, chain.builderId);
    out(`demo_${want}_fee`, ausd(chain.builderFeeCNS));
    const ok = want === "open" ? chain.builderId === 26 && BigInt(chain.builderFeeCNS) > 0n : chain.builderFeeCNS === "0";
    console.log(JSON.stringify({ ok, tx: item.txHash, ...chain }));
    if (!ok) process.exit(1);
    break;
  }
  case "follow-check": {
    const ua = await waitFor("follow account indexed", () => userAccount(a[0]), 45_000);
    const p = ua.raw.policy ?? {};
    out("userAccount", ua.address);
    out("entryBps", p.maxEntryDeviationBps);
    out("deposited", ausd(ua.raw.netDepositsCNS ?? 0));
    if (p.maxEntryDeviationBps !== 100) fail("entry filter is not 1%", { policy: p });
    break;
  }
  case "leader-trade": {
    const [perp, type, lots] = a.map(Number);
    // Right after a mark move the market makers may not have re-quoted yet and the IOC reverts: retry.
    let hash;
    for (let i = 1; !hash; i++) {
      try { hash = await leaderTrade(env.testKeys.demoLeader, perp, type, lots); } catch (e) {
        if (i >= 4) throw e;
        console.log(`leader order attempt ${i} failed (${e.shortMessage ?? e.message}); retrying`);
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
    out("leaderTx", short(hash));
    break;
  }
  case "wait-copy": {
    const ua = await userAccount(a[0]);
    const item = await waitFor("user copy", async () => (await feed(ua.address)).find((i) => i.kind === "Mirrored" && Number(i.orderType) <= 1), 90_000);
    const chain = await takerBuilder(item.txHash);
    out("copyTx", short(item.txHash));
    out("copyFee", ausd(chain.builderFeeCNS));
    console.log(JSON.stringify({ tx: item.txHash, ...chain }));
    if (chain.builderId !== 26 || BigInt(chain.builderFeeCNS) <= 0n) fail("copy without builder 26 fee", chain);
    break;
  }
  case "mark-move": {
    const [perp, pct] = a.map(Number);
    const m = env.markets.find((x) => x.perpId === perp);
    const { mark } = await position(perp, 0);
    writeFileSync(markFile(perp), String(mark));
    const price = (Number(mark) * (1 + pct / 100)) / 10 ** m.priceDecimals;
    console.log(await faucet("/mark", { perpId: perp, price }));
    out("markMoved", price);
    break;
  }
  case "mark-restore": {
    const perp = Number(a[0]);
    const m = env.markets.find((x) => x.perpId === perp);
    const mark = Number(readFileSync(markFile(perp), "utf8"));
    console.log(await faucet("/mark", { perpId: perp, price: mark / 10 ** m.priceDecimals }));
    break;
  }
  case "wait-blocked": {
    const ua = await userAccount(a[0]);
    const item = await waitFor(`Blocked ${a[1]}`, async () => (await feed(ua.address)).find((i) => i.kind === "Blocked" && String(i.reason) === a[1]), 90_000);
    out("blockedTx", short(item.txHash));
    console.log(JSON.stringify({ reason: item.reason, limit: item.limit, actual: item.actual }));
    break;
  }
  case "closed": {
    const ua = await userAccount(a[0]);
    const id = await pub.readContract({ address: ua.address, abi: MA, functionName: "perplAccountId" });
    const lots = await waitFor("flat onchain", async () => { const p = await position(1, id); const q = await position(20, id); return p.lots === 0n && q.lots === 0n ? "0" : null; }, 60_000);
    out("lotsAfter", lots);
    break;
  }
  case "wallet":
    out("walletAusd", ausd(await ausdOf(a[0])));
    break;
  case "devtime": {
    const adb = join(process.env.ANDROID_HOME ?? "/opt/homebrew/share/android-commandlinetools", "platform-tools", "adb");
    out(a[1], execFileSync(adb, ["-s", a[0], "shell", "date '+%Y-%m-%d %H:%M'"], { encoding: "utf8" }).trim());
    break;
  }
  default:
    fail(`unknown hook ${cmd}`);
}
process.exit(0);
