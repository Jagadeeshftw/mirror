#!/usr/bin/env node
// Group 2 harness hooks for the Android Stage-A flow (devices/e2e/flows/stage-a-g2.flow, `shell ${HOOK2} ...`).
// Localnet only: anvil test keys, the localnet faucet, the engine on E2E_ENGINE_PORT (default 8828), the website on
// STAGEA_SITE_PORT (default 8819) and the engine DB in STAGEA_EVID. Prints "VAR name=value" lines; exits non-zero
// when a check fails. Never reads or prints the FCM service account.
//
//   account <owner>                              the user's follow account: userAccount, perplId, lots on BTC
//   push-check <owner>                           engine has FCM; this owner has an fcm registration (owner-signed)
//   demo-push <owner>                            run a demo trade, wait until the engine's FCM send was accepted
//   notif-mark <serial> <pkg>                    remember the app's notifications now in the shade
//   notif <serial> <pkg> [secs]                  notifications posted since notif-mark: all generic "Mirror / New activity"
//   card <owner>                                 the user's newest Blocked item: card PNG + landing page from the site
//   trade <owner> <demo|l2> <perp> <type> <lots> <expect>   leader order, then wait for the user's item:
//                                                expect = copied | close | none | blocked:<Reason>
//   level <owner> <perp>                         level onchain: tpPNS, tpText (as the app prints it), slippage, side
//   trigger <owner> <perp>                       mark past the take-profit, a STRANGER calls triggerLevel
//   mark-reset <perp>                            the mark saved by trigger / suggest
//   halted <owner> <perp> <0|1>                  wait for the market halt flag onchain
//   paused <owner> <0|1> [detached 0|1]          wait for paused onchain (and the engine's detached flag)
//   leader2                                      second leader: fresh key, faucet, its own Perpl account (l2Id)
//   leaders <owner> <l2Id>                       two leaders onchain with their budgets
//   book <owner> <leaderId> [var]                leaderBook margin of one leader (VAR margin_<id> or var)
//   suggest <urlId>                              the friend's take-profit (+0.6% of mark) as a direct POST
//   level-is <owner> <perp> <tpPNS>              wait until the take-profit onchain equals tpPNS
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { keccak256, toHex } from "viem";
import { LOCALNET, MA, T, X, acct, apiClient, ausdOf, env, faucet, leaderTrade, position, pub, waitFor, walletOf } from "./e2e-web/chain.mjs";

const PORT = Number(process.env.E2E_ENGINE_PORT ?? 8828);
const SITE = `http://127.0.0.1:${process.env.STAGEA_SITE_PORT ?? 8819}`;
const api = apiClient(`http://127.0.0.1:${PORT}`);
const [cmd, ...a] = process.argv.slice(2);
const out = (k, v) => console.log(`VAR ${k}=${v}`);
const short = (h) => `${h.slice(0, 6)}…${h.slice(-4)}`;
const fail = (msg, extra = {}) => { console.log(JSON.stringify({ ok: false, msg, ...extra })); process.exit(1); };
const J = (v) => JSON.stringify(v, (_, x) => (typeof x === "bigint" ? x.toString() : x));
const feed = async (account) => { const f = await api("GET", `/v1/accounts/${account}/feed`); return f.items ?? f.events ?? []; };
const maxId = (items) => Math.max(0, ...items.map((i) => Number(i.id) || 0));
const markFile = (perp) => join(LOCALNET, "out", `stagea-g2-mark-${perp}.txt`);
const l2File = join(LOCALNET, "out", "stagea-g2-leader2.json");
const mkt = (perp) => env.markets.find((x) => x.perpId === Number(perp));
const pxText = (pns, perp) => (Number(pns) / 10 ** mkt(perp).priceDecimals).toLocaleString("en-US", { minimumFractionDigits: 1 });
async function userAccount(owner) {
  const o = await api("GET", `/v1/owners/${owner}/accounts`);
  const x = (o.accounts ?? []).find((y) => y.deployed !== false && y.policy);
  if (!x) throw new Error(`no follow account for ${owner}`);
  return x.address ?? x.account;
}
const read = (A, fn, args = []) => pub.readContract({ address: A, abi: MA, functionName: fn, args });
const lotsOf = async (A, perp) => (await position(perp, Number(await read(A, "perplAccountId")))).lots;
const db = () => new DatabaseSync(join(process.env.STAGEA_EVID ?? ".", "engine.db"), { readOnly: true });
const fcmSubs = (owner) => { const d = db(); try { return d.prepare("SELECT channel, length(target) AS len, last_sent_ms, failures FROM push_subs WHERE lower(owner) = lower(?)").all(owner); } finally { d.close(); } };
const saveMark = async (perp) => { const { mark } = await position(perp, 0); writeFileSync(markFile(perp), String(mark)); return mark; };
const setMark = (perp, pns) => faucet("/mark", { perpId: Number(perp), price: Number(pns) / 10 ** mkt(perp).priceDecimals });

switch (cmd) {
  case "account": {
    const A = await waitFor("follow account", () => userAccount(a[0]), 45_000);
    out("userAccount", A);
    out("perplId", Number(await read(A, "perplAccountId")));
    out("btcLots", await lotsOf(A, 1));
    break;
  }
  case "push-check": {
    const cfg = await api("GET", "/v1/push/config");
    const subs = await waitFor("fcm registration", () => { const s = fcmSubs(a[0]).filter((x) => x.channel === "fcm"); return s.length ? s : null; }, 30_000).catch(() => []);
    console.log(J({ engineFcm: cfg.fcm, subs }));
    out("fcmSubs", subs.length);
    if (!cfg.fcm) fail("engine has no FCM sender (FCM_SERVICE_ACCOUNT_PATH)");
    if (!subs.length) fail("no fcm registration for this owner", { channels: fcmSubs(a[0]).map((x) => x.channel) });
    break;
  }
  case "demo-push": {
    const before = Math.max(0, ...fcmSubs(a[0]).map((s) => s.last_sent_ms ?? 0));
    await waitFor("demo idle", async () => { const d = await api("GET", "/v1/demo"); return !d.busy && !(d.cycles ?? []).some((c) => c.status === "running"); }, 120_000, 1000);
    const { cycleId } = await api("POST", "/v1/demo/trade", {});
    await waitFor("demo cycle done", async () => { const d = await api("GET", "/v1/demo"); return !d.busy && !(d.cycles ?? []).some((c) => c.status === "running"); }, 150_000, 1000);
    const sent = await waitFor("FCM accepted", () => { const s = fcmSubs(a[0]).find((x) => x.channel === "fcm" && (x.last_sent_ms ?? 0) > before); return s ?? null; }, 45_000, 1000).catch(() => null);
    const subs = fcmSubs(a[0]);
    console.log(J({ cycleId, subs }));
    out("demoCycle", cycleId);
    if (!sent) fail("the engine's FCM send was not accepted (see engine.log 'push send failed')", { subs });
    out("fcmSentMs", sent.last_sent_ms);
    break;
  }
  case "notif-mark":
  case "notif": {
    // Only notifications posted after notif-mark count (the shade keeps the foreground ones from before).
    const [serial, pkg, secs = "90"] = a;
    const adb = join(process.env.ANDROID_HOME ?? "/opt/homebrew/share/android-commandlinetools", "platform-tools", "adb");
    const keysFile = join(LOCALNET, "out", "stagea-g2-notif-keys.json");
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
      const keys = grab().map((n) => n.key);
      writeFileSync(keysFile, JSON.stringify(keys));
      out("notifBefore", keys.length);
      break;
    }
    const before = new Set(JSON.parse(readFileSync(keysFile, "utf8")));
    const fresh = () => grab().filter((n) => !before.has(n.key) && !n.summary);
    const notes = await waitFor("new app notification", () => { const n = fresh(); return n.some((x) => x.title === "Mirror") ? n : null; }, Number(secs) * 1000, 2000).catch(() => fresh());
    await new Promise((r) => setTimeout(r, 3000));
    const all = fresh();
    console.log(J({ newNotifications: all.map(({ title, text }) => ({ title, text })) }));
    out("notifCount", all.length);
    if (!all.length) fail("no new notification from the app in the shade");
    if (!all.every((x) => x.title === "Mirror" && x.text === "New activity")) fail("a new notification is not the generic 'Mirror · New activity'");
    break;
  }
  case "card": {
    const A = await userAccount(a[0]);
    const item = (await feed(A)).filter((i) => i.kind === "Blocked").sort((x, y) => Number(y.id) - Number(x.id))[0];
    if (!item) fail("no Blocked item");
    const src = `${SITE}/c/blocked/${item.txHash}/image?a=${A}`;
    const res = await fetch(src, { signal: AbortSignal.timeout(120_000) });
    const buf = Buffer.from(await res.arrayBuffer());
    const png = buf.subarray(0, 8).toString("hex") === "89504e470d0a1a0a";
    const html = await (await fetch(`${SITE}/c/blocked/${item.txHash}?a=${A}`, { signal: AbortSignal.timeout(120_000) })).text();
    const ogTitle = (html.match(/<meta property="og:title" content="([^"]*)"/) ?? [])[1] ?? null;
    const ogImage = (html.match(/<meta property="og:image" content="([^"]*)"/) ?? [])[1] ?? null;
    console.log(J({ src, status: res.status, type: res.headers.get("content-type"), bytes: buf.length, png, ogTitle, ogImage }));
    out("cardTx", short(item.txHash));
    out("cardTxHead", item.txHash.slice(0, 6));
    // The landing link the app must share (regex-escaped for the flow's expectResult).
    out("cardLandingRx", `c/blocked/${item.txHash}\\?a=${A}`);
    if (!(res.status === 200 && png && buf.length > 10_000 && /Blocked/i.test(ogTitle ?? "") && ogImage)) fail("card image / landing page check failed");
    break;
  }
  case "trade": {
    const [owner, who, perp, type, lots, expect] = a;
    const A = await userAccount(owner);
    const key = who === "demo" ? env.testKeys.demoLeader : JSON.parse(readFileSync(l2File, "utf8")).key;
    const last = maxId(await feed(A));
    const before = await lotsOf(A, Number(perp));
    await new Promise((r) => setTimeout(r, 1000));
    const tx = await leaderTrade(key, Number(perp), Number(type), Number(lots));
    out("leaderTx", short(tx));
    const isNew = (i) => Number(i.id) > last && Number(i.perpId) === Number(perp);
    if (expect === "none") {
      await new Promise((r) => setTimeout(r, 12_000));
      const copied = (await feed(A)).find((i) => isNew(i) && i.kind === "Mirrored");
      const after = await lotsOf(A, Number(perp));
      console.log(J({ before, after, copied: copied?.txHash ?? null }));
      if (copied || after !== before) fail("the leader's order was copied");
      break;
    }
    const [kind, reason] = expect.startsWith("blocked:") ? ["Blocked", expect.slice(8)] : ["Mirrored", null];
    const codes = { MarketHeldByOtherLeader: "16", LeaderBudgetExceeded: "17" };
    const item = await waitFor(`user ${expect}`, async () => (await feed(A)).find((i) => isNew(i) && i.kind === kind && (!reason || String(i.reason) === reason || String(i.reason) === codes[reason]) && (kind !== "Mirrored" || (expect === "close" ? Number(i.orderType) >= 2 : Number(i.orderType) <= 1))), 90_000, 700);
    const after = await lotsOf(A, Number(perp));
    console.log(J({ kind: item.kind, reason: item.reason, limit: item.limit, actual: item.actual, leader: item.leaderAccountId, before, after }));
    out("itemTx", short(item.txHash));
    out("itemLeader", item.leaderAccountId);
    out("lots", after);
    break;
  }
  case "level": {
    const A = await userAccount(a[0]);
    const lv = await waitFor("level onchain", async () => { const l = await read(A, "level", [BigInt(a[1])]); return l.takeProfitPNS > 0n && l; }, 60_000, 1000);
    console.log(J(lv));
    out("tpPNS", lv.takeProfitPNS);
    out("tpText", pxText(lv.takeProfitPNS, a[1]));
    if (lv.slippageBps !== 300 || lv.side !== 0) fail("level is not a 3% long take-profit", { lv });
    break;
  }
  case "trigger": {
    const A = await userAccount(a[0]);
    const perp = Number(a[1]);
    const { takeProfitPNS: tp } = await read(A, "level", [BigInt(perp)]);
    await saveMark(perp);
    const run = process.env.STAGEA_EVID ?? String(Date.now());
    const stranger = acct(keccak256(toHex(`android-stranger-${run}-${Date.now()}`)));
    await faucet("/fund", { address: stranger.address, ausd: 0, mon: 1 });
    const target = (tp * 1004n) / 1000n;
    const pid = Number(await read(A, "perplAccountId"));
    await waitFor("mark past the take-profit", async () => { const m = (await position(perp, pid)).mark; if (m >= tp) return m; await setMark(perp, target); return null; }, 45_000, 1500);
    await waitFor("triggerLevel simulates", async () => {
      try { await pub.simulateContract({ account: stranger, address: A, abi: MA, functionName: "triggerLevel", args: [BigInt(perp)] }); return true; } catch (e) { if ((await position(perp, pid)).mark < tp) await setMark(perp, target); throw e; }
    }, 30_000, 1500);
    const hash = await walletOf(stranger).writeContract({ address: A, abi: MA, functionName: "triggerLevel", args: [BigInt(perp)] });
    const r = await pub.waitForTransactionReceipt({ hash });
    const lots = await lotsOf(A, perp);
    const halted = (await read(A, "markets", [BigInt(perp)]))[1];
    const paid = await ausdOf(stranger.address);
    console.log(J({ tx: hash, status: r.status, stranger: stranger.address, lots, halted, strangerAusd: paid }));
    out("stranger", stranger.address);
    out("strangerShort", short(stranger.address).toLowerCase());
    out("triggerTx", short(hash));
    if (r.status !== "success" || lots !== 0n || !halted || paid !== 0n) fail("trigger did not close + halt");
    break;
  }
  case "mark-reset":
    console.log(await setMark(a[0], BigInt(readFileSync(markFile(a[0]), "utf8"))));
    break;
  case "halted": {
    const A = await userAccount(a[0]);
    const want = a[2] === "1";
    await waitFor("halt flag", async () => ((await read(A, "markets", [BigInt(a[1])]))[1] === want ? "ok" : null), 60_000, 1000);
    out("halted", want);
    break;
  }
  case "paused": {
    const A = await userAccount(a[0]);
    const want = a[1] === "1";
    await waitFor("paused onchain", async () => ((await read(A, "paused")) === want ? "ok" : null), 60_000, 1000);
    const v = await waitFor("engine view", async () => { const x = await api("GET", `/v1/accounts/${A}`); return x.paused === want && (a[2] === undefined || x.detached === (a[2] === "1")) && x; }, 60_000, 1000);
    console.log(J({ paused: v.paused, detached: v.detached }));
    break;
  }
  case "leader2": {
    const key = keccak256(toHex(`mirror-stage-a-android-leader-2-${Date.now()}`));
    const L = acct(key);
    await faucet("/fund", { address: L.address, ausd: 500, mon: 10 });
    await waitFor("leader 2 funded", async () => (await ausdOf(L.address)) > 0n, 30_000);
    const w = walletOf(L);
    await pub.waitForTransactionReceipt({ hash: await w.writeContract({ address: env.collateral, abi: T, functionName: "approve", args: [env.perplExchange, 400_000_000n] }) });
    await pub.waitForTransactionReceipt({ hash: await w.writeContract({ address: env.perplExchange, abi: X, functionName: "createAccount", args: [400_000_000n] }) });
    const id = Number((await pub.readContract({ address: env.perplExchange, abi: X, functionName: "getAccountByAddr", args: [L.address] })).accountId);
    writeFileSync(l2File, JSON.stringify({ key, id, address: L.address }));
    out("l2Id", id);
    out("l2Short", short(L.address));
    if (!(id > 0)) fail("no Perpl account for leader 2");
    break;
  }
  case "leaders": {
    const A = await userAccount(a[0]);
    const ls = await waitFor("two leaders onchain", async () => { const l = await read(A, "leaders"); return l.length === 2 && l; }, 60_000, 1000);
    console.log(J(ls.map((l) => ({ id: l.accountId, budget: l.budgetCNS, ratio: l.ratioBps, stop: l.lossStopBps }))));
    const l2 = ls.find((l) => Number(l.accountId) === Number(a[1]));
    out("l2Budget", (Number(l2?.budgetCNS ?? 0) / 1e6).toFixed(2));
    if (!l2) fail("leader 2 not in the policy");
    break;
  }
  case "book": {
    const A = await userAccount(a[0]);
    const [marginCNS, , , stopped] = await read(A, "leaderBook", [BigInt(a[1])]);
    out(a[2] ?? `margin_${a[1]}`, (Number(marginCNS) / 1e6).toFixed(2));
    console.log(J({ leader: a[1], marginCNS, stopped }));
    break;
  }
  case "suggest": {
    const card = await api("GET", `/v1/share/${a[0]}`);
    await saveMark(card.perpId ?? 1);
    const tp = (BigInt(card.markPNS) * 1006n) / 1000n;
    const res = await fetch(`http://127.0.0.1:${PORT}/v1/share/${a[0]}/suggest`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ takeProfitPNS: tp.toString(), note: "Funding flipped negative this morning. I'd take profit a bit earlier." }) });
    const body = await res.json().catch(() => ({}));
    console.log(J({ status: res.status, card: { status: card.status, side: card.side, symbol: card.symbol }, body }));
    out("shareTpPNS", tp);
    out("shareTpText", pxText(tp, card.perpId ?? 1));
    if (!res.ok) fail("suggestion refused");
    break;
  }
  case "level-is": {
    const A = await userAccount(a[0]);
    const lv = await waitFor("take-profit onchain", async () => { const l = await read(A, "level", [BigInt(a[1])]); return l.takeProfitPNS === BigInt(a[2]) && l; }, 60_000, 1000);
    console.log(J(lv));
    break;
  }
  default:
    fail(`unknown hook ${cmd}`);
}
process.exit(0);
