// Follow the demo leader from the phone (limits with a 1% entry filter, What if, Review with the Mirror fee,
// one passkey: permit deposit + FOLLOW), a leader trade copied into the user, and the entry filter refusing one.
import { env, faucet, leaderTrade, position, sleep } from "./chain.mjs";
import { click, findCard, isVisible, text, tid, until, visible } from "./browser.mjs";
import { feeNumber, readBlocked, readProof, takerBuilder } from "./flows-watch.mjs";

const LEADER = env.teamRun.demoLeaderAccountId;
const LEADER_SHORT = env.teamRun.demoLeaderAddress.slice(0, 6).toLowerCase();

async function leaderRow(page, prefix) {
  for (let i = 0; i < 20; i++) {
    const row = page.locator(tid(`${prefix}${i}`)).first();
    if (!(await row.count())) continue;
    if ((await row.innerText()).toLowerCase().includes(LEADER_SHORT)) return row;
  }
  return null;
}

export async function userAccount(api, owner) {
  const o = await api("GET", `/v1/owners/${owner}/accounts`);
  const a = (o.accounts ?? []).find((x) => x.deployed !== false && x.policy);
  return a ? { address: a.address ?? a.account, raw: a } : null;
}

const feed = async (api, account) => { const f = await api("GET", `/v1/accounts/${account}/feed`); return f.items ?? f.events ?? []; };

export async function followFlows(ctx) {
  const { R, page, dev, WEB, api, state } = ctx;

  await R.check("Leaders: the leaderboard renders; the team-run demo leader's profile opens (/leader/<id>)", page, async () => {
    await page.goto(`${WEB}/leaders`);
    await visible(page, "leaders.list", 30_000);
    const rows = await until("leader rows", async () => (await page.locator('[data-testid^="leaders.item."]').count()) || null, 30_000, 1000).catch(() => 0);
    // Team-run accounts are left out of the leaderboard by design (docs/api.md), so the profile opens by its link.
    const listed = !!(await leaderRow(page, "leaders.item."));
    await R.shot(page, "leaders-list");
    await page.goto(`${WEB}/leader/${LEADER}`);
    await visible(page, "leader.screen", 20_000);
    await visible(page, "leader.follow", 20_000);
    state.leaderOpen = true;
    return { leader: LEADER, rows, teamRunLeaderListed: listed, ok: !listed };
  });

  await R.check("Follow sheet: limits set (entry filter 1%, 20 AUSD, sizing 10%)", page, async () => {
    await click(page, "leader.follow");
    await visible(page, "follow.sheet", 20_000);
    state.followSheet = true;
    await page.locator(tid("follow.amount.input")).fill("20");
    await click(page, "follow.entryFilter.1");
    const slider = page.locator(tid("follow.ratio.slider"));
    await slider.scrollIntoViewIfNeeded();
    const b = await slider.boundingBox();
    await page.mouse.click(b.x + b.width - 1, b.y + b.height / 2);
    const entry = await text(page, "follow.entryFilter.value");
    const ratio = await text(page, "follow.ratio.value");
    await page.locator(tid("follow.section.entryFilter")).scrollIntoViewIfNeeded();
    return { ok: entry.startsWith("1%") && ratio.startsWith("10"), entry, ratio, leverage: await text(page, "follow.leverage.value").catch(() => null) };
  }, { needs: ["leaderOpen"] });

  await R.check("What if: the backtest renders, labelled a simulation", page, async () => {
    await click(page, "follow.seeWhatIf");
    await visible(page, "follow.whatif", 20_000);
    const which = await until("backtest result", async () => ((await isVisible(page, "follow.whatif.pnl")) ? "pnl" : (await isVisible(page, "follow.whatif.unavailable")) ? "unavailable" : (await isVisible(page, "follow.whatif.error")) ? "error" : null), 45_000);
    const sim = await text(page, "follow.whatif.sim").catch(() => "");
    return { ok: which === "pnl" && /simulation/i.test(sim), result: which, label: sim, pnl: which === "pnl" ? await text(page, "follow.whatif.pnl") : null };
  }, { needs: ["followSheet"] });

  await R.check("Review shows the Mirror fee line (builder 26) before the passkey prompt", page, async () => {
    await click(page, "follow.review");
    const fee = await text(page, "follow.review.fee", 20_000);
    const entry = await text(page, "follow.review.entryFilter").catch(() => null);
    const prompts = (await dev.webauthnLog()).length;
    state.promptsBeforeFollow = prompts;
    return { ok: /26/.test(fee) && /0\.02%/.test(fee) && /1%/.test(entry ?? ""), fee, entry };
  }, { needs: ["followSheet"] });

  await R.check("Approve with one passkey prompt: account created, permit deposit, FOLLOW -> Following", page, async () => {
    await click(page, "follow.confirm");
    const status = await until("follow done", async () => { const s = await text(page, "follow.status", 3000); return /Following|Matched|Failed/.test(s) && s; }, 120_000, 1000);
    const log = await dev.webauthnLog();
    const prompts = log.length - state.promptsBeforeFollow;
    const ua = await until("account indexed", () => userAccount(api, state.address), 30_000);
    state.userAccount = ua.address;
    const steps = {};
    for (const k of ["sign", "create", "deposit", "follow"]) for (const s of ["done", "failed", "now", "pending"]) if (await isVisible(page, `step.${k}.${s}`)) steps[k] = s;
    const p = ua.raw.policy ?? {};
    return { ok: status !== "Failed" && prompts === 1 && p.maxEntryDeviationBps === 100 && ua.raw.netDepositsCNS === "20000000", status, prompts, steps, account: ua.address, maxEntryDeviationBps: p.maxEntryDeviationBps, netDepositsCNS: ua.raw.netDepositsCNS, error: await text(page, "follow.error", 500).catch(() => undefined) };
  }, { needs: ["followSheet", "promptsBeforeFollow", "address"] });

  await R.check("leader trade (anvil key) copied into the user: feed row with fee, latency, deviation", page, async () => {
    if (await isVisible(page, "follow.done")) await click(page, "follow.done");
    await sleep(2000);
    state.leaderOpenTx = await leaderTrade(env.testKeys.demoLeader, 1, 0, 20);
    const copy = await until("user copy (API)", async () => (await feed(api, state.userAccount)).find((i) => i.kind === "Mirrored" && Number(i.orderType) === 0), 60_000);
    state.userCopy = copy;
    await page.goto(`${WEB}/feed`);
    const card = await until("Copy card in the feed", () => findCard(page, "activity.item.", "Copy"), 45_000, 1500);
    const g = async (k) => text(page, `${card.id}.${k}`, 3000).catch(() => null);
    const row = { fee: await g("fee"), latency: await g("latency"), deviation: await g("deviation"), tx: await g("tx") };
    return { ok: !!row.fee && /fee/.test(row.fee) && !!row.latency, row, leaderTx: state.leaderOpenTx, copyTx: copy.txHash };
  }, { needs: ["userAccount"] });

  await R.check("copy proof view for the user's copy (builder 26 charged onchain)", page, async () => {
    const card = await findCard(page, "activity.item.", "Copy");
    await card.card.click();
    const f = await readProof(page);
    const chain = await takerBuilder(state.userCopy.txHash);
    return { ok: f.leaderFill !== "—" && f.yourFill !== "—" && !!f.yourTx && !!f.leaderTx && feeNumber(f.fee ?? "") > 0 && chain.builderId === 26, shown: f, onchain: chain };
  }, { needs: ["userCopy"] });

  await R.check("entry filter: BTC mark moved ~3%, the leader adds -> Blocked 'price moved … past the leader's entry; your limit is 1%'", page, async () => {
    if (await isVisible(page, "copy.detail.close")) await click(page, "copy.detail.close");
    const { mark } = await position(1, 0);
    state.btcMark = mark;
    await faucet("/mark", { perpId: 1, price: (Number(mark) * 1.03) / 10 });
    await sleep(1500);
    state.leaderAddTx = await leaderTrade(env.testKeys.demoLeader, 1, 0, 10);
    const blocked = await until("EntryTooFar (API)", async () => (await feed(api, state.userAccount)).find((i) => i.kind === "Blocked" && (i.reason === "EntryTooFar" || Number(i.reason) === 15)), 60_000);
    state.entryBlocked = blocked;
    await page.goto(`${WEB}/feed`);
    const card = await until("Blocked card", () => findCard(page, "activity.item.", "Blocked"), 45_000, 1500);
    const banner = (await card.card.locator(tid("activity.blocked.banner")).innerText()).trim();
    await R.shot(page, "entry-filter-blocked-card");
    await card.card.click();
    const f = await readBlocked(page);
    await faucet("/mark", { perpId: 1, price: Number(mark) / 10 });
    return { ok: /past the leader's entry; your limit is 1%/.test(f.sentence ?? "") && /Price moved \d/.test(f.sentence ?? ""), banner, detail: f, tx: blocked.txHash, limit: blocked.limit, actual: blocked.actual };
  }, { needs: ["userAccount"] });
  if (await isVisible(page, "blocked.done")) await click(page, "blocked.done").catch(() => {});
}
