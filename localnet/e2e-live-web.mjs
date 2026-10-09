#!/usr/bin/env node
// Live web app end-to-end on PUBLIC Monad testnet against the HOSTED engine: https://mirror.0xo.in/app in real Google
// Chrome with a CDP virtual authenticator (passkeys with PRF), no localnet and no mocks. Chain-side steps go through
// localnet/stage-b-hook.mjs (reads, the demo leader's own Perpl orders, and team funds for the web test account).
//
//   ENGINE_URL=https://engine-production-0fd2.up.railway.app node localnet/e2e-live-web.mjs [--parts laptop,phone,blocked]
//
// Chrome runs headed, with background networking on: Web Push needs Chrome's real push service, which headless Chrome
// doesn't have. `--headless` runs without a window, and the Web Push checks then fail.
//
// 1. A brand-new account with no funds (laptop layout): watch mode on the hosted engine, Run demo trade (copy with
//    builder 26's fee onchain), the close (no fee), Run blocked trade (Blocked with the rule).
// 2. The same account funded with 100 test AUSD of TEAM money (withdrawn from the demo leader's Perpl account, never
//    the tester pool): follow the demo leader with a permit deposit, alerts on (real Web Push), a real copied trade
//    with the Web Push delivered, stop following and keep positions (onchain), the leader's exit refused, close all,
//    withdraw, and the test AUSD sent back to the ops wallet.
// 3. The demo follower's 2x rule blocking a 10x copy, seen on the Demo screen.
// Evidence: devices/evidence/stage-b-hosted/web-<timestamp>/ (screenshots, report.json, index.html).
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
process.env.PLAYWRIGHT ??= createRequire(join(ROOT, "web", "package.json")).resolve("playwright");
const { openDevice, tid, text, click, visible, until, findCard, PHONE, LAPTOP } = await import("./e2e-web/browser.mjs");
const { createReport } = await import("./e2e-web/report.mjs");
const { chromium } = createRequire(join(ROOT, "web", "package.json"))("playwright");

const WEB = "https://mirror.0xo.in/app";
const ENGINE = (process.env.ENGINE_URL || "https://engine-production-0fd2.up.railway.app").replace(/\/$/, "");
const OPS = "0x299E77E58DD37607e4890C761924D829F8ACe82C";
const DEMO_OWNER = "0x3abf625be454f8f78e5ada1b4ab627ede6c26c78";
const RUN = new Date().toISOString().replace(/[:.]/g, "-");
const OUT = join(ROOT, "devices", "evidence", "stage-b-hosted", `web-${RUN}`);
const R = createReport(OUT, { run: RUN, web: WEB, engine: ENGINE, perpl: "Perpl testnet (chain 10143)" });
const state = R.state;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shortHash = (h) => `${h.slice(0, 6)}…${h.slice(-4)}`;

/** Runs a hook command; returns its VAR values and the last JSON line. Throws if the hook fails. */
function hook(...args) {
  const out = execFileSync("node", [join(HERE, "stage-b-hook.mjs"), ...args.map(String)], { encoding: "utf8", env: { ...process.env, ENGINE_URL: ENGINE }, timeout: 300_000 });
  const vars = Object.fromEntries(out.split("\n").filter((l) => l.startsWith("VAR ")).map((l) => l.slice(4).split("=")).map(([k, ...v]) => [k, v.join("=")]));
  const json = out.split("\n").filter((l) => l.startsWith("{")).pop();
  return { vars, json: json ? JSON.parse(json) : null, out };
}
const disabled = async (page, id) => (await page.locator(tid(id)).getAttribute("aria-disabled")) === "true";
const isVisible = (page, id) => page.locator(tid(id)).first().isVisible().catch(() => false);

const argAt = process.argv.indexOf("--parts");
const PARTS = new Set((argAt > 0 ? process.argv[argAt + 1] : "laptop,phone,blocked").split(","));
// Records the service worker's "mirror-push" pings (sent on every Web Push it receives) across reloads of the tab.
const PUSH_LOG = () => {
  try {
    navigator.serviceWorker?.addEventListener("message", (e) => {
      if (e.data?.type !== "mirror-push") return;
      const a = JSON.parse(sessionStorage.getItem("__mirrorPushes") || "[]");
      a.push(Date.now());
      sessionStorage.setItem("__mirrorPushes", JSON.stringify(a));
    });
  } catch {}
};
/** Withdraws everything from the follow account to the owner's wallet (one passkey prompt). */
async function withdrawAll(page) {
  await page.goto(`${WEB}/withdraw`);
  // "Max" fills in what is withdrawable at the time of the tap: wait until the balance has loaded.
  await until("withdrawable loaded", async () => /Max [1-9]/.test(await text(page, "withdraw.max", 3000).catch(() => "")), 60_000, 1000);
  await click(page, "withdraw.max");
  await click(page, "withdraw.continue", 20_000);
  await visible(page, "withdraw.sheet");
  await click(page, "withdraw.confirm");
  const status = await until("withdraw status", async () => { const t = await text(page, "withdraw.status", 3000).catch(() => ""); return /Confirmed|Sent/.test(t) && t; }, 150_000, 1500);
  const w = await until("wallet credited", async () => { const v = hook("wallet", state.owner).vars.walletAusd; return Number(v) > 99 && v; }, 60_000, 3000).catch(() => hook("wallet", state.owner).vars.walletAusd);
  state.withdrawn = Number(w) > 0 ? w : null;
  return { ok: /Confirmed/.test(status) && Number(w) > 99, status, wallet: w };
}

/** Sends the whole wallet back to the ops wallet with Send's "Max" (one passkey prompt, no gas). */
async function sendBack(page) {
  await page.goto(`${WEB}/send`);
  await until("wallet loaded", async () => /Max [1-9]/.test(await text(page, "send.max", 3000).catch(() => "")), 60_000, 1000);
  await page.locator(tid("send.address.input")).fill(OPS);
  await click(page, "send.max");
  const amount = await page.locator(tid("send.amount.input")).inputValue().catch(() => null);
  await click(page, "send.confirm", 20_000);
  const status = await until("send status", async () => { const t = await text(page, "send.status", 3000).catch(() => ""); return /Sent|Confirmed/.test(t) && t; }, 150_000, 1500);
  const left = await until("wallet empty", async () => { const v = hook("wallet", state.owner).vars.walletAusd; return Number(v) === 0 && v; }, 60_000, 3000).catch(() => hook("wallet", state.owner).vars.walletAusd);
  state.returned = Number(left) === 0;
  return { ok: /Sent|Confirmed/.test(status) && Number(left) === 0, status, amount, walletLeft: left, returned: state.withdrawn };
}
const pushes = (page) => page.evaluate(() => JSON.parse(sessionStorage.getItem("__mirrorPushes") || "[]")).catch(() => []);
const shownNotifications = (page) => page.evaluate(async () => (await (await navigator.serviceWorker.getRegistration()).getNotifications()).map((x) => ({ title: x.title, body: x.body }))).catch(() => []);

const browser = await chromium.launch({ channel: "chrome", headless: process.argv.includes("--headless"), ignoreDefaultArgs: ["--disable-background-networking"] });
try {
  let page;
  if (PARTS.has("laptop")) {
  // ---------------------------------------------------------------- 1. fresh, unfunded (laptop)
  const lap = await openDevice(browser, LAPTOP, { serviceWorkers: "allow" });
  R.pageErrors = () => lap.consoleLog.filter((l) => l.startsWith("pageerror"));
  page = lap.page;
  await R.check("fresh account on the live web app: Create account with one passkey ceremony", page, async () => {
    await page.goto(`${WEB}/welcome`);
    await click(page, "onboarding.createAccount", 30_000);
    await visible(page, "home.screen", 60_000);
    const log = await lap.webauthnLog();
    state.fresh = true;
    return { ok: log.filter((x) => x.op === "create" && x.ok).length === 1, ceremonies: log.map(({ op, ok, gotFirst, gotSecond }) => ({ op, ok, gotFirst, gotSecond })) };
  });
  await R.check("hosted engine: watch mode Live, no service banner, Run buttons enabled", page, async () => {
    await visible(page, "home.watch", 60_000);
    const banner = await isVisible(page, "home.offline");
    await until("Run demo enabled", async () => !(await disabled(page, "watch.runDemo")), 60_000);
    return { ok: !banner && !(await disabled(page, "watch.runBlocked")), banner, source: await text(page, "watch.source").catch(() => null) };
  }, { needs: ["fresh"] });
  await R.check("Run demo trade: the copy lands; copy detail shows the proof and builder 26's fee (checked onchain)", page, async () => {
    hook("demo-mark");
    await click(page, "watch.runDemo");
    const h = hook("demo-copy", "open");
    state.demoOpen = h.json.tx;
    const card = await until("copy row", () => findCard(page, "watch.feed.", "Copy", { contains: shortHash(h.json.tx) }), 60_000, 1000);
    await card.card.click();
    await visible(page, "copy.detail", 20_000);
    const fee = await text(page, "copy.proof.fee").catch(() => "");
    const yourTx = await text(page, "copy.proof.yourTx").catch(() => "");
    const r = { ok: h.json.builderId === 26 && BigInt(h.json.builderFeeCNS) > 0n && /builder 26/.test(fee) && yourTx.includes(shortHash(h.json.tx).slice(0, 6)), tx: h.json.tx, builderFeeCNS: h.json.builderFeeCNS, fee, leaderFill: await text(page, "copy.proof.leaderFill").catch(() => null), yourFill: await text(page, "copy.proof.yourFill").catch(() => null), deviation: await text(page, "copy.proof.deviation").catch(() => null) };
    if (await isVisible(page, "copy.detail.close")) await click(page, "copy.detail.close");
    return r;
  }, { needs: ["fresh"] });
  await R.check("the demo's close copy follows with no builder fee (checked onchain)", null, async () => {
    const h = hook("demo-copy", "close");
    return { ok: h.json.ok, tx: h.json.tx, builderFeeCNS: h.json.builderFeeCNS };
  }, { needs: ["demoOpen"] });
  await R.check("Run blocked trade: Blocked onchain; the detail shows the rule, its limit and the actual value", page, async () => {
    await until("Run enabled again", async () => !(await disabled(page, "watch.runBlocked")), 180_000, 2000);
    hook("demo-mark");
    await click(page, "watch.runBlocked");
    const h = hook("demo-blocked");
    const card = await until("blocked row", () => findCard(page, "watch.feed.", "Blocked", { contains: shortHash(h.json.tx) }), 60_000, 1000);
    await card.card.click();
    const title = await text(page, "blocked.title", 20_000);
    const r = { ok: /max leverage/i.test(title), tx: h.json.tx, reason: h.json.reason, limit: h.json.limit, actual: h.json.actual, title };
    if (await isVisible(page, "blocked.done")) await click(page, "blocked.done");
    return r;
  }, { needs: ["fresh"] });
  state.address = await (async () => { await page.goto(`${WEB}/funds`); return (await text(page, "funds.address", 30_000)).replace(/\s+/g, ""); })().catch(() => null);
  R.note("web test account", { address: state.address });
  await lap.context.close();
  }

  // ---------------------------------------------------------------- 2. funded flows (phone layout, same passkey)
  // A virtual authenticator's passkey cannot be moved to another context with its PRF secret (Chrome's virtual
  // authenticator limit), so the funded part creates its own account in the phone layout.
  const ph = await openDevice(browser, PHONE, { serviceWorkers: "allow" });
  await ph.context.grantPermissions(["notifications"], { origin: "https://mirror.0xo.in" });
  await ph.context.addInitScript(PUSH_LOG);
  R.pageErrors = () => ph.consoleLog.filter((l) => l.startsWith("pageerror"));
  page = ph.page;
  if (PARTS.has("phone")) {
  await R.check("phone layout: a second fresh account, then 100 test AUSD of team funds (demo leader's Perpl account, not the tester pool)", page, async () => {
    await page.goto(`${WEB}/welcome`);
    await click(page, "onboarding.createAccount", 30_000);
    await visible(page, "home.screen", 60_000);
    await page.goto(`${WEB}/funds`);
    state.owner = (await text(page, "funds.address", 30_000)).replace(/\s+/g, "");
    const h = hook("fund-web", state.owner, 100);
    state.fundTxs = h.vars;
    const w = await until("wallet shows 100", async () => { const v = hook("wallet", state.owner).vars.walletAusd; return Number(v) >= 100 && v; }, 90_000, 3000);
    return { ok: h.json.ok && Number(w) >= 100, owner: state.owner, withdrawTx: h.vars.fundWithdrawTx, transferTx: h.vars.fundTransferTx, wallet: w, opsAusdBefore: h.json.opsAusdBefore, opsAusdAfter: h.json.opsAusdAfter };
  });
  await R.check("follow the demo leader with a permit deposit of 100 and match now: fee line before the one passkey prompt", page, async () => {
    await page.goto(`${WEB}/leader/1000`);
    await visible(page, "leader.screen", 30_000);
    await click(page, "leader.follow", 30_000);
    await visible(page, "follow.sheet", 20_000);
    await page.locator(tid("follow.amount.input")).fill("100");
    await click(page, "follow.seeWhatIf");
    await click(page, "follow.review", 30_000);
    const fee = await text(page, "follow.review.fee", 20_000);
    const before = (await ph.webauthnLog()).length;
    await click(page, "follow.confirm");
    const status = await until("follow done", async () => { const s = await text(page, "follow.status", 3000); return /Following|Matched|Failed/.test(s) && s; }, 180_000, 1500);
    const prompts = (await ph.webauthnLog()).length - before;
    const fc = hook("follow-check", state.owner);
    state.followAccount = fc.vars.followAccount;
    return { ok: status !== "Failed" && /26/.test(fee) && prompts === 1 && Number(fc.vars.deposited) === 100, status, fee, prompts, account: fc.vars.followAccount, deposited: fc.vars.deposited };
  }, { needs: ["owner"] });
  await R.check("alerts on (offered after the first follow): a real Web Push subscription, registered with the owner's signature", page, async () => {
    const before = (await ph.webauthnLog()).length;
    if (await isVisible(page, "follow.alerts.enable")) await click(page, "follow.alerts.enable");
    else { if (await isVisible(page, "follow.done")) await click(page, "follow.done"); await page.goto(`${WEB}/settings`); await click(page, "settings.alerts.toggle", 30_000); }
    // Stay on this page while the app subscribes, the owner signs (one passkey prompt) and the server registers it.
    const signed = await until("registration signed", async () => (await ph.webauthnLog()).slice(before).find((c) => c.op === "get" && c.ok === true), 60_000, 1000);
    const endpoint = await page.evaluate(async () => (await (await navigator.serviceWorker.getRegistration())?.pushManager.getSubscription())?.endpoint ?? null);
    await sleep(6000);
    const channel = await until("registered", async () => { await page.goto(`${WEB}/settings`); const t = await text(page, "settings.alerts.channel", 5000).catch(() => ""); return /Registered/.test(t) && t; }, 60_000, 4000);
    state.push = !!endpoint;
    return { ok: /Web Push/i.test(channel) && !!endpoint && !!signed, channel, pushService: endpoint ? new URL(endpoint).host : null, prompts: (await ph.webauthnLog()).length - before };
  }, { needs: ["followAccount"] });
  await R.check("a real copied Perpl testnet trade with builder 26's fee (checked onchain)", page, async () => {
    await page.goto(`${WEB}/home`);
    state.pushes0 = (await pushes(page)).length;
    const lt = hook("leader-trade", "open", 50);
    const c = hook("wait-copy", state.owner, "open");
    state.lots = hook("lots", state.owner, "lots").vars.lots;
    return { ok: c.json.ok && Number(state.lots) > 0 && BigInt(c.json.builderFeeCNS ?? 0) > 0n, leaderTx: lt.json.hash, copyTx: c.json.tx, builderFeeCNS: c.json.builderFeeCNS, lots: state.lots };
  }, { needs: ["followAccount"] });
  await R.check("that copy's Web Push reaches the service worker and shows the generic 'Mirror · New activity'", page, async () => {
    const got = await until("web push received", async () => { const p = await pushes(page); return p.length > state.pushes0 && p; }, 150_000, 3000).catch(() => []);
    const notes = await shownNotifications(page);
    return { ok: got.length > state.pushes0 && notes.some((n) => n.title === "Mirror" && n.body === "New activity"), pushesReceived: Math.max(0, got.length - state.pushes0), notifications: notes };
  }, { needs: ["push", "lots"] });
  await R.check("stop following, keep my positions (one passkey prompt): leaderDetached set onchain by the account's contract", page, async () => {
    await page.goto(`${WEB}/leader/1000`);
    await click(page, "leader.stopFollow", 30_000);
    await visible(page, "stop.sheet", 15_000);
    await click(page, "stop.option.keep");
    await click(page, "stop.confirm");
    hook("detached", state.owner, 1);
    const status = await until("profile status", async () => { await page.goto(`${WEB}/leader/1000`); const t = await text(page, "follow.status", 5000).catch(() => ""); return /positions kept/.test(t) && t; }, 120_000, 4000);
    return { ok: true, status };
  }, { needs: ["lots"] });
  await R.check("the leader exits: the demo follower's close is copied, the detached web account keeps its position", null, async () => {
    hook("demo-mark");
    const lt = hook("leader-trade", "close", 50);
    const d = hook("demo-copy", "close");
    const kept = hook("lots", state.owner, "lots").vars.lots;
    return { ok: kept === state.lots && d.json.ok, kept, before: state.lots, leaderTx: lt.json.hash, demoCloseTx: d.json.tx, demoCloseFeeCNS: d.json.builderFeeCNS };
  }, { needs: ["lots"] });
  await R.check("close all (one passkey prompt): flat onchain", page, async () => {
    await page.goto(`${WEB}/positions`);
    await click(page, "portfolio.closeAll", 30_000);
    await visible(page, "closeAll.dialog");
    await click(page, "portfolio.closeAll.confirm");
    const lots = await until("flat", async () => { const v = hook("lots", state.owner, "lots").vars.lots; return v === "0" && v; }, 150_000, 4000);
    return { ok: lots === "0", lots };
  }, { needs: ["lots"] });
  await R.check("withdraw (one passkey prompt): back in the wallet", page, async () => withdrawAll(page), { needs: ["lots"] });
  await R.check("send the test AUSD back to the ops wallet (one passkey prompt, no gas)", page, async () => sendBack(page), { needs: ["withdrawn"] });
  // Team funds never stay behind in a test account whose passkey goes away with this browser: one more try.
  if (state.owner && !state.returned) {
    const again = { withdraw: null, send: null };
    try { if (!state.withdrawn) again.withdraw = await withdrawAll(page); again.send = await sendBack(page); } catch (e) { again.error = String(e.message ?? e).split("\n")[0]; }
    const left = { wallet: hook("wallet", state.owner).vars.walletAusd, followAccount: state.followAccount ? hook("follow-check", state.owner).vars : null };
    R.note("recovery: withdraw and send the team funds back", { ...again, left });
  }
  }

  // ---------------------------------------------------------------- 3. the demo follower's rule blocks a 10x copy
  if (PARTS.has("blocked")) await R.check("the demo leader opens at 10x: the demo follower's 2x rule blocks the copy, shown on the Demo screen", page, async () => {
    hook("demo-mark");
    const lt = hook("leader-trade", "open", 20, 1000);
    const b = hook("demo-blocked");
    await page.goto(`${WEB}/demo`);
    const card = await until("blocked row on Demo", async () => { await page.reload(); await sleep(1500); return findCard(page, "demo.feed.", "Blocked", { contains: shortHash(b.json.tx) }).then((c) => c ?? findCard(page, "watch.feed.", "Blocked", { contains: shortHash(b.json.tx) })); }, 120_000, 5000).catch(() => null);
    const lc = hook("leader-trade", "close", 20);
    return { ok: !!card && /LeverageTooHigh/.test(String(b.json.reason)), leaderTx: lt.json.hash, tx: b.json.tx, reason: b.json.reason, shownOnDemoScreen: !!card, leaderCloseTx: lc.json.hash };
  });
  await ph.context.close();
} finally {
  // The run's own accounts are the team's: add them to the engine's TEAM_TEST_ADDRESSES so public numbers skip them.
  const owners = [state.address, state.owner].filter(Boolean);
  if (owners.length) R.note("team test accounts: add these owners to TEAM_TEST_ADDRESSES on the engine", { owners });
  const rep = R.finish({});
  console.log(`\n${rep.passed} passed, ${rep.failed} failed. Evidence: ${OUT}/index.html`);
  await browser.close();
  process.exit(rep.failed ? 1 : 0);
}
