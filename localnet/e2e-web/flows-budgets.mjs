// Several leaders in one account from the phone: a second Perpl leader (fresh key, MON + AUSD from the faucet,
// its own createAccount) is followed into the user's existing account with a budget split (one passkey prompt:
// permit top-up + SET_POLICY with both leaders); its ETH trade is copied and its margin is booked to it alone;
// its BTC trade is blocked because BTC belongs to the demo leader (MarketHeldByOtherLeader); an add beyond its
// budget is blocked (LeaderBudgetExceeded); the ETH mark is moved until its loss stop is hit, a stranger calls
// triggerLeaderStop -> the app shows the leader stopped; "Re-arm" (one prompt) clears it onchain; Edit budgets
// (one prompt) moves budget between the leaders.
import { keccak256, toHex } from "viem";
import { acct, env, faucet, leaderTrade, MA, position, pub, sleep, T, walletOf, X } from "./chain.mjs";
import { click, findCard, text, tid, until, visible } from "./browser.mjs";

const DEMO = env.teamRun.demoLeaderAccountId;
const feedOf = async (api, a) => (await api("GET", `/v1/accounts/${a}/feed`)).items ?? [];
const maxId = (items) => Math.max(0, ...items.map((i) => Number(i.id) || 0));
const cns = (v) => (Number(v) / 1e6).toFixed(2);

export async function budgetsFlows(ctx) {
  const { R, page, dev, WEB, api, state, RUN } = ctx;
  const A = state.userAccount;
  const prompts = async () => (await dev.webauthnLog()).length;
  const read = (fn, args = []) => pub.readContract({ address: A, abi: MA, functionName: fn, args });
  const perplId = A ? Number(await read("perplAccountId")) : 0;
  const book = async (id) => { const [marginCNS, unrealizedCNS, realizedCNS, stopped] = await read("leaderBook", [id]); return { marginCNS, unrealizedCNS, realizedCNS, stopped }; };

  await R.check("second leader: fresh key funded by the faucet opens its own Perpl account", null, async () => {
    const key = keccak256(toHex(`mirror-stage-a-web-leader-2-${RUN}`));
    const L = acct(key);
    await faucet("/fund", { address: L.address, ausd: 500, mon: 10 });
    const w = walletOf(L);
    await pub.waitForTransactionReceipt({ hash: await w.writeContract({ address: env.collateral, abi: T, functionName: "approve", args: [env.perplExchange, 400_000_000n] }) });
    await pub.waitForTransactionReceipt({ hash: await w.writeContract({ address: env.perplExchange, abi: X, functionName: "createAccount", args: [400_000_000n] }) });
    const id = Number((await pub.readContract({ address: env.perplExchange, abi: X, functionName: "getAccountByAddr", args: [L.address] })).accountId);
    state.leader2 = { key, id, address: L.address };
    return { ok: id > 0, leader2Id: id, address: L.address };
  }, { needs: ["userAccount"] });

  await R.check("follow sheet: 'Add to my account (split my deposit)' with a budget per leader, Not assigned, top-up and market ownership", page, async () => {
    const { id } = state.leader2;
    await page.goto(`${WEB}/follow/${id}`);
    await visible(page, "follow.mode.split", 30_000);
    await visible(page, "follow.section.split", 20_000);
    const modeOn = await page.locator(tid("follow.mode.split")).getAttribute("aria-checked");
    // ETH must be allowed for the second leader's ETH trades (markets are account-wide).
    const eth = page.locator(tid("follow.market.ETH"));
    await eth.scrollIntoViewIfNeeded();
    if ((await eth.getAttribute("aria-selected")) !== "true") await eth.click();
    const slider = page.locator(tid("follow.ratio.slider"));
    await slider.scrollIntoViewIfNeeded();
    const b = await slider.boundingBox();
    await page.mouse.click(b.x + b.width - 1, b.y + b.height / 2);
    await page.locator(tid("follow.section.split")).scrollIntoViewIfNeeded();
    await page.locator(tid(`follow.split.budget.${id}.input`)).fill("2.00");
    await page.locator(tid("follow.topUp.input")).fill("1.00");
    await sleep(500);
    const unassigned = await text(page, "follow.split.unassigned.value");
    const ownership = await text(page, "follow.split.ownership.text");
    const demoBudget = await page.locator(tid(`follow.split.budget.${DEMO}.input`)).inputValue();
    state.splitDemoBudget = demoBudget;
    await R.shot(page, "budgets-follow-split");
    return { ok: modeOn === "true" && /held by/.test(ownership) && /BTC/.test(ownership) && Number(unassigned) >= 0, modeChecked: modeOn, demoBudget, leader2Budget: "2.00", topUp: "1.00", unassigned, ownership, ratio: await text(page, "follow.ratio.value") };
  }, { needs: ["leader2"] });

  await R.check("review keeps the builder fee line; one passkey prompt (permit + SET_POLICY): both leaders onchain with their budgets, deposit topped up", page, async () => {
    const { id } = state.leader2;
    const depBefore = await read("netDeposits");
    await click(page, "follow.seeWhatIf");
    await visible(page, "follow.whatif", 20_000);
    await click(page, "follow.review");
    const split = await text(page, "follow.review.split", 20_000);
    const fee = await text(page, "follow.review.fee");
    const topUp = await text(page, "follow.review.topUp");
    const p0 = await prompts();
    await click(page, "follow.confirm");
    const status = await until("split done", async () => { const s = await text(page, "follow.status", 3000); return /Following|Matched|Failed/.test(s) && s; }, 120_000, 1000);
    const n = (await prompts()) - p0;
    const leaders = await until("two leaders onchain", async () => { const l = await read("leaders"); return l.length === 2 && l; }, 60_000, 1000);
    const depAfter = await read("netDeposits");
    const l2 = leaders.find((l) => Number(l.accountId) === id);
    await until("engine sees two leaders", async () => ((await api("GET", `/v1/accounts/${A}`)).policy?.leaders?.length === 2) || null, 30_000, 1000);
    return { ok: status !== "Failed" && n === 1 && l2?.budgetCNS === 2_000_000n && Number(l2?.ratioBps) === 1000 && depAfter - depBefore === 1_000_000n && /26/.test(fee), status, prompts: n, split, fee, topUp, budgets: leaders.map((l) => `${l.accountId}:${cns(l.budgetCNS)} ratio ${l.ratioBps} stop ${l.lossStopBps}`), netDepositsBefore: cns(depBefore), netDepositsAfter: cns(depAfter) };
  }, { needs: ["leader2"] });

  await R.check("second leader's ETH trade is copied; its margin is booked to it alone (leaderBook) and its row shows it", page, async () => {
    const { id, key } = state.leader2;
    if (await page.locator(tid("follow.done")).isVisible().catch(() => false)) await click(page, "follow.done");
    const demoBefore = await book(DEMO);
    const last = maxId(await feedOf(api, A));
    await sleep(1000);
    const tx = await leaderTrade(key, 20, 0, 10);
    const copy = await until("leader 2's ETH copy", async () => (await feedOf(api, A)).find((i) => Number(i.id) > last && i.kind === "Mirrored" && Number(i.perpId) === 20 && Number(i.leaderAccountId) === id), 60_000, 700);
    const b2 = await until("margin booked to leader 2", async () => { const b = await book(id); return b.marginCNS > 0n && b; }, 30_000, 700);
    const demoAfter = await book(DEMO);
    await page.goto(`${WEB}/home`);
    const margin = await until("leader 2 row margin", async () => { const t = await text(page, `home.leader.${id}.margin`, 3000); return t.includes(cns(b2.marginCNS)) && t; }, 45_000, 1500);
    const status = await text(page, `home.leader.${id}.status`);
    await page.locator(tid(`home.leader.${id}`)).scrollIntoViewIfNeeded();
    await R.shot(page, "budgets-home-two-leaders");
    state.leader2Copied = copy.txHash;
    return { ok: demoAfter.marginCNS === demoBefore.marginCNS && /Copying/.test(status), leaderTx: tx, copyTx: copy.txHash, leader2MarginCNS: cns(b2.marginCNS), demoMarginBefore: cns(demoBefore.marginCNS), demoMarginAfter: cns(demoAfter.marginCNS), row: margin, status };
  }, { needs: ["leader2"] });

  await R.check("second leader trades BTC (held by the demo leader) -> Blocked: market held by … (MarketHeldByOtherLeader)", page, async () => {
    const { id, key } = state.leader2;
    if ((await position(1, perplId)).lots === 0n) {
      await leaderTrade(env.testKeys.demoLeader, 1, 0, 20);
      await until("user holds BTC for the demo leader", async () => (await position(1, perplId)).lots > 0n || null, 60_000, 1000);
    }
    const holder = Number(await read("marketLeader", [1n]));
    const last = maxId(await feedOf(api, A));
    const tx = await leaderTrade(key, 1, 0, 10);
    const blocked = await until("MarketHeldByOtherLeader", async () => (await feedOf(api, A)).find((i) => Number(i.id) > last && i.kind === "Blocked" && (i.reason === "MarketHeldByOtherLeader" || Number(i.reason) === 16)), 60_000, 700);
    await page.goto(`${WEB}/feed`);
    const card = await until("blocked card", () => findCard(page, "activity.item.", "Blocked", { max: 20, contains: "market held by" }), 45_000, 1500);
    const banner = (await card.card.locator(tid("activity.blocked.banner")).innerText()).trim();
    await card.card.scrollIntoViewIfNeeded();
    await R.shot(page, "budgets-feed-market-held");
    return { ok: holder === DEMO && Number(blocked.leaderAccountId) === id && Number(blocked.actual) === DEMO && /market held by/i.test(banner), leaderTx: tx, blockedTx: blocked.txHash, limit: blocked.limit, actual: blocked.actual, marketHolder: holder, banner };
  }, { needs: ["leader2Copied"] });

  await R.check("second leader adds ETH beyond its 2.00 budget -> Blocked LeaderBudgetExceeded with the numbers", page, async () => {
    const { key } = state.leader2;
    const last = maxId(await feedOf(api, A));
    const tx = await leaderTrade(key, 20, 0, 10);
    const blocked = await until("LeaderBudgetExceeded", async () => (await feedOf(api, A)).find((i) => Number(i.id) > last && i.kind === "Blocked" && (i.reason === "LeaderBudgetExceeded" || Number(i.reason) === 17)), 60_000, 700);
    await page.goto(`${WEB}/feed`);
    const card = await until("budget card", () => findCard(page, "activity.item.", "Blocked", { max: 20, contains: "budget" }), 45_000, 1500);
    const banner = (await card.card.locator(tid("activity.blocked.banner")).innerText()).trim();
    await card.card.click();
    const sentence = await text(page, "blocked.sentence", 15_000);
    await R.shot(page, "budgets-blocked-budget");
    if (await page.locator(tid("blocked.done")).isVisible().catch(() => false)) await click(page, "blocked.done");
    return { ok: blocked.limit === "2000000" && BigInt(blocked.actual) > 2_000_000n && sentence.includes(`Its budget is ${cns(blocked.limit)} AUSD`), leaderTx: tx, blockedTx: blocked.txHash, limit: cns(blocked.limit), actual: cns(blocked.actual), banner, sentence };
  }, { needs: ["leader2Copied"] });

  await R.check("loss stop: ETH mark moved down; a stranger calls triggerLeaderStop -> its ETH closed, LeaderStopped; the app shows it stopped with the numbers", page, async () => {
    const { id } = state.leader2;
    const { mark } = await position(20, 0);
    state.ethMark = mark;
    const stranger = acct(keccak256(toHex(`stranger-leader-stop-${RUN}`)));
    await faucet("/fund", { address: stranger.address, ausd: 0, mon: 1 });
    let target = (Number(mark) / 100) * 0.9;
    await faucet("/mark", { perpId: 20, price: target });
    await until("triggerLeaderStop simulates", async () => {
      try {
        await pub.simulateContract({ account: stranger, address: A, abi: MA, functionName: "triggerLeaderStop", args: [id] });
        return true;
      } catch (e) {
        target *= 0.98;
        await faucet("/mark", { perpId: 20, price: target });
        throw e;
      }
    }, 60_000, 2000);
    const hash = await walletOf(stranger).writeContract({ address: A, abi: MA, functionName: "triggerLeaderStop", args: [id] });
    const r = await pub.waitForTransactionReceipt({ hash });
    const b = await book(id);
    const ethLots = (await position(20, perplId)).lots;
    await until("engine: leader 2 stopped", async () => ((await api("GET", `/v1/accounts/${A}`)).pnlByLeader ?? []).find((x) => Number(x.leaderAccountId) === id && x.stopped) || null, 30_000, 1000);
    await until("engine indexed LeaderStopped", async () => (await feedOf(api, A)).find((i) => i.kind === "LeaderStopped" && Number(i.leaderAccountId) === id) || null, 60_000, 1000);
    await page.goto(`${WEB}/home`);
    const status = await until("Stopped in the row", async () => { const t = await text(page, `home.leader.${id}.status`, 3000); return /Stopped by loss stop/.test(t) && t; }, 45_000, 1500);
    const loss = await text(page, `home.leader.${id}.lossStop`);
    await page.locator(tid(`home.leader.${id}`)).scrollIntoViewIfNeeded();
    await R.shot(page, "budgets-home-leader-stopped");
    await page.goto(`${WEB}/leader/${id}`);
    const title = await text(page, "leader.stopped.title", 30_000);
    // The numbers come from the LeaderStopped / StopTriggered items once the feed has loaded.
    const by = await until("executed by shown", async () => { const t = await text(page, "leader.stopped.by", 3000); return !t.endsWith("—") && t; }, 30_000, 1000).catch(() => null);
    const trigger = await text(page, "leader.stopped.trigger");
    await R.shot(page, "budgets-leader-stopped-profile");
    state.leader2Stopped = hash;
    return { ok: r.status === "success" && b.stopped && ethLots === 0n && /Lost/.test(loss) && !!by?.toLowerCase().endsWith(`${stranger.address.slice(0, 6)}…${stranger.address.slice(-4)}`.toLowerCase()), tx: hash, stranger: stranger.address, ethMarkPNS: (await position(20, 0)).mark.toString(), stoppedOnchain: b.stopped, realizedCNS: cns(b.realizedCNS), userEthLots: ethLots.toString(), row: { status, loss }, profile: { title, trigger, by } };
  }, { needs: ["leader2Copied"] });

  await R.check("'Re-arm' on the leader profile (one passkey prompt, SET_POLICY with the same limits) clears the stop onchain; the row reads Copying", page, async () => {
    const { id } = state.leader2;
    await faucet("/mark", { perpId: 20, price: Number(state.ethMark) / 100 });
    const p0 = await prompts();
    await click(page, "leader.rearm");
    const cleared = await until("leaderStopped false onchain", async () => ((await book(id)).stopped === false ? "cleared" : null), 60_000, 1000);
    const n = (await prompts()) - p0;
    const leaders = await read("leaders");
    await until("engine sees it", async () => !((await api("GET", `/v1/accounts/${A}`)).pnlByLeader ?? []).some((x) => Number(x.leaderAccountId) === id && x.stopped) || null, 30_000, 1000);
    await page.goto(`${WEB}/home`);
    const status = await until("Copying again", async () => { const t = await text(page, `home.leader.${id}.status`, 3000); return /Copying/.test(t) && t; }, 45_000, 1500);
    return { ok: n === 1 && cleared === "cleared" && leaders.length === 2, prompts: n, leaders: leaders.map((l) => `${l.accountId}:${cns(l.budgetCNS)}`), status };
  }, { needs: ["leader2Stopped"] });

  await R.check("Edit budgets (one passkey prompt): 1.00 moved to the second leader, saved onchain", page, async () => {
    const { id } = state.leader2;
    const before = await read("leaders");
    const demoB = before.find((l) => Number(l.accountId) === DEMO).budgetCNS;
    await page.goto(`${WEB}/budgets`);
    await visible(page, "budgets.split", 30_000);
    await page.locator(tid(`budgets.split.budget.${DEMO}.input`)).fill(cns(demoB - 1_000_000n));
    await click(page, `budgets.split.budget.${id}.plus`);
    await R.shot(page, "budgets-edit");
    const p0 = await prompts();
    await click(page, "budgets.save");
    await visible(page, "budgets.status", 90_000);
    const n = (await prompts()) - p0;
    const after = await read("leaders");
    const get = (ls, x) => ls.find((l) => Number(l.accountId) === x).budgetCNS;
    return { ok: n === 1 && get(after, DEMO) === demoB - 1_000_000n && get(after, id) === 3_000_000n, prompts: n, before: before.map((l) => `${l.accountId}:${cns(l.budgetCNS)}`), after: after.map((l) => `${l.accountId}:${cns(l.budgetCNS)}`) };
  }, { needs: ["leader2Copied"] });
}
