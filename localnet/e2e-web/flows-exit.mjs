// Laptop repeats of the funded screens, then Positions -> Close all (passkey), Withdraw (passkey), and restore
// from the passkey alone (a second browser context, and the same authenticator with the app's storage wiped).
import { ausdOf, env, MA, position, pub, sleep } from "./chain.mjs";
import { click, findCard, isVisible, LAPTOP, openDevice, PHONE, text, tid, until, visible } from "./browser.mjs";
import { readBlocked, readProof } from "./flows-watch.mjs";

async function tableRow(page, prefix, match) {
  for (let i = 0; i < 30; i++) {
    const row = page.locator(tid(`${prefix}${i}`)).first();
    if (!(await row.count())) break;
    if (match.test(await row.innerText())) return row;
  }
  return null;
}

async function restoreOn(page, WEB) {
  await page.goto(`${WEB}/welcome`);
  await click(page, "onboarding.restore", 30_000);
  const end = await until("restore result", async () => ((await isVisible(page, "restore.go.home")) ? "home" : (await isVisible(page, "restore.error")) ? "error" : null), 60_000);
  if (end === "error") return { end, error: await text(page, "restore.error").catch(() => null) };
  await R_shot(page, "restore-welcome-back");
  await click(page, "restore.go.home");
  await page.goto(`${WEB}/funds`);
  return { end, address: (await text(page, "funds.address", 20_000)).replace(/\s+/g, "") };
}
let R_shot = async () => {};

export async function exitFlows(ctx) {
  const { R, page, dev, WEB, browser, state } = ctx;
  R_shot = R.shot;

  await page.setViewportSize(LAPTOP);
  await R.check("laptop: feed table -> copy detail panel with the fee row", page, async () => {
    await page.goto(`${WEB}/feed`);
    await visible(page, "feed.table", 20_000);
    const row = await until("copy row", () => tableRow(page, "feed.table.row.", /^(?![\s\S]*Not copied)[\s\S]*\bOpen\b/), 30_000, 1000);
    await row.click();
    const f = await readProof(page);
    return { ok: /builder 26/.test(f.fee ?? ""), shown: f };
  }, { needs: ["userCopy"] });
  await R.check("laptop: blocked row -> entry-filter blocked detail", page, async () => {
    const row = await until("blocked row", () => tableRow(page, "feed.table.row.", /Not copied/), 20_000, 1000);
    await row.click();
    const f = await readBlocked(page);
    return { ok: /your limit is 1%/.test(f.sentence ?? "") || /Leverage|leverage/.test(f.sentence ?? ""), detail: f };
  }, { needs: ["entryBlocked"] });
  await R.check("laptop: positions table", page, async () => {
    await page.goto(`${WEB}/positions`);
    await visible(page, "positions.table.card", 20_000);
    return {};
  }, { optional: true, needs: ["userAccount"] });
  await R.check("laptop: leaders table with the followed leader's panel showing Edit limits", page, async () => {
    await page.goto(`${WEB}/leaders?leader=${env.teamRun.demoLeaderAccountId}`);
    await visible(page, "leaders.table", 20_000);
    await visible(page, "leaders.panel", 15_000);
    await visible(page, "leader.rules", 15_000);
    return {};
  }, { needs: ["userAccount"] });
  await page.setViewportSize(PHONE);

  const perplId = state.userAccount ? Number(await pub.readContract({ address: state.userAccount, abi: MA, functionName: "perplAccountId" })) : 0;
  await R.check("Positions -> Close all (one passkey prompt): position closed onchain", page, async () => {
    await page.goto(`${WEB}/positions`);
    const count = await until("open positions", async () => { const t = await text(page, "portfolio.positions.count", 3000); return Number(t) > 0 && t; }, 30_000, 1000);
    await R.shot(page, "positions-before-close-all");
    const before = (await dev.webauthnLog()).length;
    await click(page, "portfolio.closeAll");
    await visible(page, "closeAll.dialog");
    await click(page, "portfolio.closeAll.confirm");
    const lots = await until("position closed onchain", async () => { const p = await position(1, perplId); return p.lots === 0n ? "0" : null; }, 60_000, 1000);
    await until("count 0 in the app", async () => (await isVisible(page, "positions.empty")) || (await text(page, "portfolio.positions.count", 2000).catch(() => "")) === "0", 30_000, 1000).catch(() => {});
    return { ok: (await dev.webauthnLog()).length - before === 1 && lots === "0", countBefore: count, lotsAfter: lots };
  }, { needs: ["userAccount"] });

  await R.check("Withdraw (one passkey prompt): balance back in the wallet", page, async () => {
    const walletBefore = await ausdOf(state.address);
    await page.goto(`${WEB}/withdraw`);
    await click(page, "withdraw.max", 20_000);
    const amount = await page.locator(tid("withdraw.amount.input")).inputValue().catch(async () => text(page, "withdraw.amount.input"));
    await click(page, "withdraw.continue");
    await visible(page, "withdraw.sheet");
    await R.shot(page, "withdraw-confirm-sheet");
    await click(page, "withdraw.confirm");
    const status = await until("withdraw status", async () => text(page, "withdraw.status", 3000), 90_000, 1000);
    const walletAfter = await ausdOf(state.address);
    const equity = await pub.readContract({ address: state.userAccount, abi: MA, functionName: "equity" });
    await page.goto(`${WEB}/home`);
    const chip = await text(page, "home.balance.ausd", 20_000).catch(() => null);
    return { ok: status === "Confirmed" && walletAfter > walletBefore, status, amount, returnedCNS: (walletAfter - walletBefore).toString(), walletAfterCNS: walletAfter.toString(), accountEquityAfterCNS: equity.toString(), chip };
  }, { needs: ["userAccount", "address"] });

  const creds = await dev.credentials();
  await R.check("restore in a second browser context with the same credential (CDP addCredential)", null, async () => {
    const dev2 = await openDevice(browser, PHONE, { credential: creds[0] });
    try {
      const r = await restoreOn(dev2.page, WEB);
      await R.shot(dev2.page, "restore-second-context");
      const log = await dev2.webauthnLog();
      return { ok: r.address?.toLowerCase() === state.address.toLowerCase(), ...r, ceremonies: log, why: r.end === "error" ? "CDP WebAuthn.addCredential cannot carry the PRF (hmac-secret) key, so the copied credential returns no PRF output" : undefined };
    } finally { await dev2.context.close(); }
  }, { optional: true, needs: ["address"] });

  await R.check("restore: same authenticator, app storage wiped (fresh install) -> same address", page, async () => {
    const origin = new URL(WEB).origin;
    await dev.cdp.send("Storage.clearDataForOrigin", { origin, storageTypes: "all" });
    await page.goto(`${WEB}/welcome`);
    await visible(page, "onboarding.screen", 30_000);
    await R.shot(page, "welcome-after-wipe");
    const r = await restoreOn(page, WEB);
    return { ok: r.address?.toLowerCase() === state.address.toLowerCase(), ...r, expected: state.address };
  }, { needs: ["address"] });

  R.note("stops executed by a stranger", { coverage: "not in Group 1 UI (no stop-loss / take-profit levels screen); covered onchain by e2e-api" });
  R.note("several leaders in one account", { coverage: "not in Group 1 UI (one leader per follow account; 'Follow another leader' opens a separate account); covered onchain by e2e-api" });
  await sleep(100);
}
