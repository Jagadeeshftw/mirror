#!/usr/bin/env node
// Harness hooks for the Android Stage-B flows on PUBLIC Monad testnet (devices/e2e/flows/stage-b*.flow). Reads go to
// the testnet RPC and the engine at ENGINE_URL (the hosted engine), else on STAGEB_ENGINE_PORT (default 8838,
// scripts/engine-testnet-local.sh). The only
// transactions are the team-run demo leader's own Perpl orders (the ops wallet, test funds), sent with gas from
// Monad's eth_estimateGas (viem's default on the testnet RPC). Prints "VAR name=value" lines for flow.py.
//
//   node stage-b-hook.mjs leader-trade <open|close> <lots> [leverageHdths]   demo leader (Perpl account 1000) BTC IOC
//   node stage-b-hook.mjs wait-copy <owner> <open|close>     the owner's follow account copy mined after the last
//                                                            leader-trade of that side: tx, builder 26 fee onchain
//   node stage-b-hook.mjs follow-check <owner>               the owner's follow account is deployed, funded, following 1000
//   node stage-b-hook.mjs detached <owner> <0|1>             leaderDetached(1000) onchain
//   node stage-b-hook.mjs lots <owner> <var>                 the follow account's BTC lots onchain
//   node stage-b-hook.mjs wallet <address>                   test AUSD in the wallet
//   node stage-b-hook.mjs devtime <serial> <var>             device local time "YYYY-MM-DD HH:MM"
//   node stage-b-hook.mjs demo-mark                          remember the demo follower's newest feed item
//   node stage-b-hook.mjs demo-copy <open|close>             the demo follower's next copy after demo-mark: tx, fee
//   node stage-b-hook.mjs demo-blocked                       the demo follower's next Blocked item after demo-mark
//   node stage-b-hook.mjs fund-web <address> <ausd>          team funds for the web test account: withdraw <ausd> from
//                                                            the demo leader's Perpl account (1000) to the ops wallet,
//                                                            then send it to <address> (the tester pool is not touched)
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, createWalletClient, decodeEventLog, defineChain, http, parseAbiItem } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const shared = JSON.parse(readFileSync(join(ROOT, "shared", "config.json"), "utf8")).networks.testnet;
const MA = JSON.parse(readFileSync(join(ROOT, "shared", "abi", "MirrorAccount.json"), "utf8"));
const X = JSON.parse(readFileSync(join(ROOT, "shared", "abi", "PerplExchange.json"), "utf8"));
const MA_ABI = MA.abi ?? MA;
const X_ABI = X.abi ?? X;
const PORT = Number(process.env.STAGEB_ENGINE_PORT ?? 8838);
const ENGINE = (process.env.ENGINE_URL || `http://127.0.0.1:${PORT}`).replace(/\/$/, "");
const MARK = join(ROOT, ".stage-b", "demo-mark.json");
const LAST = (side) => join(ROOT, ".stage-b", `leader-last-${side}.json`);
const LEADER = Number(shared.teamRun.demoLeaderAccountId);
const BTC = 16n;
const chain = defineChain({ id: 10143, name: "monad-testnet", nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 }, rpcUrls: { default: { http: [shared.rpc] } } });
const pub = createPublicClient({ chain, transport: http(shared.rpc) });
const [cmd, ...a] = process.argv.slice(2);
const out = (k, v) => console.log(`VAR ${k}=${v}`);
const short = (h) => `${h.slice(0, 6)}…${h.slice(-4)}`;
const ausd = (cns) => (Number(cns) / 1e6).toFixed(6);
const fail = (msg, extra = {}) => { console.log(JSON.stringify({ ok: false, msg, ...extra })); process.exit(1); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(what, fn, ms) {
  const t0 = Date.now();
  for (;;) {
    const v = await fn().catch(() => null);
    if (v) return v;
    if (Date.now() - t0 > ms) fail(`timed out: ${what}`);
    await sleep(1500);
  }
}
async function api(path) {
  const r = await fetch(`${ENGINE}${path}`);
  if (!r.ok) throw new Error(`${path}: ${r.status}`);
  return r.json();
}
async function followAccount(owner) {
  const o = await api(`/v1/owners/${owner}/accounts`);
  const x = (o.accounts ?? []).find((y) => y.deployed !== false && y.policy);
  if (!x) throw new Error(`no follow account for ${owner}`);
  return { address: x.address ?? x.account, raw: x };
}
const feed = async (account) => { const f = await api(`/v1/accounts/${account}/feed`); return f.items ?? f.events ?? []; };
const TAKER = parseAbiItem("event TakerOrderFilledV2(uint256 entryPricePNS, uint256 collatPricePNS, uint256 pnlPricePNS, uint256 lotLNS, uint256 feeCNS, int256 amountCNS, uint256 balanceCNS, uint256 builderId, uint256 builderFeeCNS)");
async function takerBuilder(hash) {
  const r = await pub.getTransactionReceipt({ hash });
  for (const l of r.logs) {
    if (l.address.toLowerCase() !== shared.perplExchange.toLowerCase()) continue;
    try {
      const e = decodeEventLog({ abi: [TAKER], data: l.data, topics: l.topics });
      return { builderId: Number(e.args.builderId), builderFeeCNS: String(e.args.builderFeeCNS) };
    } catch {}
  }
  return { builderId: 0, builderFeeCNS: "0" };
}
async function lotsOf(account) {
  const id = await pub.readContract({ address: account, abi: MA_ABI, functionName: "perplAccountId" });
  const [p] = await pub.readContract({ address: shared.perplExchange, abi: X_ABI, functionName: "getPositionV2", args: [BTC, id] });
  return p.lotLNS;
}

const opsWallet = () => {
  const env = readFileSync(join(ROOT, ".env"), "utf8");
  const m = env.match(/^OPS_PRIVATE_KEY=(0x[0-9a-fA-F]{64})/m);
  if (!m) fail("OPS_PRIVATE_KEY missing");
  const acct = privateKeyToAccount(m[1]);
  return { acct, wallet: createWalletClient({ chain, account: acct, transport: http(shared.rpc) }) };
};
const ERC20 = [parseAbiItem("function balanceOf(address) view returns (uint256)"), parseAbiItem("function transfer(address,uint256) returns (bool)")];

switch (cmd) {
  case "leader-trade": {
    const [side, lots, levArg] = a;
    const lev = BigInt(levArg ?? 200);
    const key = (() => { const env = readFileSync(join(ROOT, ".env"), "utf8"); const m = env.match(/^OPS_PRIVATE_KEY=(0x[0-9a-fA-F]{64})/m); if (!m) fail("OPS_PRIVATE_KEY missing"); return m[1]; })();
    const acct = privateKeyToAccount(key);
    const wallet = createWalletClient({ chain, account: acct, transport: http(shared.rpc) });
    const orderType = side === "open" ? 0 : 2; // open long / close long
    for (let attempt = 1; ; attempt++) {
      const [, mark] = await pub.readContract({ address: shared.perplExchange, abi: X_ABI, functionName: "getPositionV2", args: [BTC, BigInt(LEADER)] });
      const args = [{
        orderDescId: BigInt(Date.now()) * 1000n, perpId: BTC, orderType, orderId: 0n,
        pricePNS: orderType === 0 ? (mark * 1010n) / 1000n : (mark * 990n) / 1000n, lotLNS: BigInt(lots), expiryBlock: 0n,
        postOnly: false, fillOrKill: false, immediateOrCancel: true, maxMatches: 20n, leverageHdths: orderType === 0 ? lev : 0n,
        lastExecutionBlock: 0n, amountCNS: 0n, maxNegPnlCollatBPS: 1000n,
      }];
      try {
        const { request } = await pub.simulateContract({ account: acct, address: shared.perplExchange, abi: X_ABI, functionName: "execOrder", args });
        const hash = await wallet.writeContract(request);
        const r = await pub.waitForTransactionReceipt({ hash });
        if (r.status !== "success") throw new Error(`reverted ${hash}`);
        // wait-copy only accepts a copy mined after this trade (an older copy must never pass for this one).
        mkdirSync(dirname(LAST(side)), { recursive: true });
        writeFileSync(LAST(side), JSON.stringify({ block: Number(r.blockNumber), hash }));
        out(`leader_${side}_tx`, short(hash));
        console.log(JSON.stringify({ ok: true, hash, gasUsed: String(r.gasUsed) }));
        break;
      } catch (e) {
        if (attempt >= 3) fail(`leader ${side} failed`, { err: String(e.shortMessage ?? e.message).slice(0, 200) });
        await sleep(2000);
      }
    }
    break;
  }
  case "wait-copy": {
    const [owner, side] = a;
    const after = JSON.parse(readFileSync(LAST(side), "utf8")).block;
    const fa = await waitFor("follow account", () => followAccount(owner), 60_000);
    const item = await waitFor(`${side} copy after block ${after}`, async () => (await feed(fa.address))
      .filter((i) => i.kind === "Mirrored" && Number(i.block ?? 0) > after && (side === "open" ? Number(i.orderType) <= 1 : Number(i.orderType) >= 2))
      .sort((x, y) => Number(y.block ?? 0) - Number(x.block ?? 0))[0], 120_000);
    const b = await takerBuilder(item.txHash);
    out(`copy_${side}_tx`, short(item.txHash));
    out(`copy_${side}_fee`, ausd(b.builderFeeCNS));
    const ok = side === "open" ? b.builderId === 26 && BigInt(b.builderFeeCNS) > 0n : b.builderFeeCNS === "0";
    console.log(JSON.stringify({ ok, tx: item.txHash, ...b }));
    if (!ok) process.exit(1);
    break;
  }
  case "follow-check": {
    const fa = await waitFor("follow account indexed", () => followAccount(a[0]), 90_000);
    const leaders = await pub.readContract({ address: fa.address, abi: MA_ABI, functionName: "leaders" });
    const deposits = await pub.readContract({ address: fa.address, abi: MA_ABI, functionName: "netDeposits" });
    out("followAccount", fa.address);
    out("deposited", ausd(deposits));
    console.log(JSON.stringify({ account: fa.address, leaders: leaders.map((l) => Number(l.accountId)), deposits: String(deposits) }));
    if (!leaders.some((l) => Number(l.accountId) === LEADER)) fail("not following the demo leader");
    break;
  }
  case "detached": {
    const fa = await followAccount(a[0]);
    const want = a[1] === "1";
    const v = await waitFor(`leaderDetached = ${want}`, async () => { const d = await pub.readContract({ address: fa.address, abi: MA_ABI, functionName: "leaderDetached", args: [LEADER] }); return d === want ? "yes" : null; }, 90_000);
    out("detached", v);
    break;
  }
  case "lots": {
    const fa = await followAccount(a[0]);
    out(a[1], String(await lotsOf(fa.address)));
    break;
  }
  case "wallet": {
    const bal = await pub.readContract({ address: shared.collateral, abi: [parseAbiItem("function balanceOf(address) view returns (uint256)")], functionName: "balanceOf", args: [a[0]] });
    out("walletAusd", ausd(bal));
    break;
  }
  case "devtime": {
    const adb = join(process.env.ANDROID_HOME ?? "/opt/homebrew/share/android-commandlinetools", "platform-tools", "adb");
    out(a[1], execFileSync(adb, ["-s", a[0], "shell", "date '+%Y-%m-%d %H:%M'"], { encoding: "utf8" }).trim());
    break;
  }
  case "demo-mark": {
    const demo = await api("/v1/demo");
    const items = await feed(demo.follower.account);
    const top = Math.max(0, ...items.map((i) => Number(i.block ?? 0)));
    mkdirSync(dirname(MARK), { recursive: true });
    writeFileSync(MARK, JSON.stringify({ block: top, account: demo.follower.account }));
    out("demoMarkBlock", top);
    break;
  }
  case "demo-copy": {
    const want = a[0];
    const mark = JSON.parse(readFileSync(MARK, "utf8"));
    const item = await waitFor(`demo ${want} copy`, async () => (await feed(mark.account))
      .filter((i) => i.kind === "Mirrored" && Number(i.block ?? 0) > mark.block && (want === "open" ? Number(i.orderType) <= 1 : Number(i.orderType) >= 2))
      .sort((x, y) => Number(y.block ?? 0) - Number(x.block ?? 0))[0], 150_000);
    const b = await takerBuilder(item.txHash);
    out(`demo_${want}_tx`, short(item.txHash));
    out(`demo_${want}_fee`, ausd(b.builderFeeCNS));
    const ok = want === "open" ? b.builderId === 26 && BigInt(b.builderFeeCNS) > 0n : b.builderFeeCNS === "0";
    console.log(JSON.stringify({ ok, tx: item.txHash, ...b }));
    if (!ok) process.exit(1);
    break;
  }
  case "demo-blocked": {
    const mark = JSON.parse(readFileSync(MARK, "utf8"));
    const item = await waitFor("demo Blocked", async () => (await feed(mark.account)).find((i) => i.kind === "Blocked" && Number(i.block ?? 0) > mark.block), 150_000);
    out("demo_blocked_tx", short(item.txHash));
    console.log(JSON.stringify({ tx: item.txHash, reason: item.reason ?? item.blocked?.reason, limit: item.limit ?? item.blocked?.limit, actual: item.actual ?? item.blocked?.actual }));
    break;
  }
  case "fund-web": {
    const [to, ausdAmount] = a;
    const amount = BigInt(Math.round(Number(ausdAmount) * 1e6));
    const { acct, wallet } = opsWallet();
    const poolBefore = await pub.readContract({ address: shared.collateral, abi: ERC20, functionName: "balanceOf", args: [acct.address] });
    // Gas: viem's simulate + write estimate on the testnet RPC, i.e. Monad's own eth_estimateGas.
    const w = await pub.simulateContract({ account: acct, address: shared.perplExchange, abi: X_ABI, functionName: "withdrawCollateral", args: [amount] });
    const wh = await wallet.writeContract(w.request);
    const wr = await pub.waitForTransactionReceipt({ hash: wh });
    if (wr.status !== "success") fail("withdraw reverted", { tx: wh });
    const t = await pub.simulateContract({ account: acct, address: shared.collateral, abi: ERC20, functionName: "transfer", args: [to, amount] });
    const th = await wallet.writeContract(t.request);
    const tr = await pub.waitForTransactionReceipt({ hash: th });
    if (tr.status !== "success") fail("transfer reverted", { tx: th });
    const poolAfter = await pub.readContract({ address: shared.collateral, abi: ERC20, functionName: "balanceOf", args: [acct.address] });
    out("fundWithdrawTx", wh);
    out("fundTransferTx", th);
    console.log(JSON.stringify({ ok: poolAfter === poolBefore, withdraw: wh, transfer: th, opsAusdBefore: ausd(poolBefore), opsAusdAfter: ausd(poolAfter) }));
    if (poolAfter !== poolBefore) fail("the ops wallet's test AUSD changed: the tester pool must stay untouched");
    break;
  }
  case "notif-mark":
  case "notif": {
    // Notifications from the app posted after notif-mark: they must all be the generic "Mirror · New activity" (the
    // push carries only ciphertext; the app decrypts it in the foreground).
    const [serial, pkg = "com.zeroxo.mirror", secs = "120"] = a;
    const adb = join(process.env.ANDROID_HOME ?? "/opt/homebrew/share/android-commandlinetools", "platform-tools", "adb");
    const keysFile = join(ROOT, ".stage-b", `notif-keys-${serial}.json`);
    const grab = () => {
      const txt = execFileSync(adb, ["-s", serial, "shell", "dumpsys notification --noredact"], { encoding: "utf8", maxBuffer: 64 << 20 });
      const seen = new Set();
      return txt.split(/\n(?=\s*NotificationRecord\()/).filter((b) => b.includes(`pkg=${pkg}`)).map((b) => ({
        key: (b.match(/key=(\S+?):?\s/) ?? [])[1] ?? null,
        title: (b.match(/android\.title=\S+ \(([^)]*)\)/) ?? [])[1] ?? null,
        text: (b.match(/android\.text=\S+ \(([^)]*)\)/) ?? [])[1] ?? null,
        summary: /flags=\S*GROUP_SUMMARY|isGroupSummary=true/.test(b) || !/android\.title=/.test(b),
      })).filter((n) => n.key && !seen.has(n.key) && seen.add(n.key));
    };
    if (cmd === "notif-mark") {
      mkdirSync(dirname(keysFile), { recursive: true });
      const keys = grab().map((n) => n.key);
      writeFileSync(keysFile, JSON.stringify(keys));
      out("notifBefore", keys.length);
      break;
    }
    const before = new Set(JSON.parse(readFileSync(keysFile, "utf8")));
    const fresh = () => grab().filter((n) => !before.has(n.key) && !n.summary);
    await waitFor("new app notification", async () => { const n = fresh(); return n.some((x) => x.title === "Mirror") ? n : null; }, Number(secs) * 1000).catch(() => null);
    await sleep(3000);
    const all = fresh();
    console.log(JSON.stringify({ newNotifications: all.map(({ title, text }) => ({ title, text })) }));
    out("notifCount", all.length);
    if (!all.length) fail("no new notification from the app in the shade");
    if (!all.every((x) => x.title === "Mirror" && x.text === "New activity")) fail("a new notification is not the generic 'Mirror · New activity'");
    break;
  }
  default:
    fail(`unknown hook ${cmd}`);
}
process.exit(0);
