// Levels and stop choices from the phone: a take-profit set on the user's BTC position (one passkey prompt,
// ACTION_SET_LEVELS), the mark moved past it, a STRANGER wallet (fresh key, MON from the faucet) calls
// triggerLevel (the engine's stop executor is off in this run) -> the app shows the stop executed by that
// address, the position closed, the stranger got no AUSD; "Save limits again" lifts the halt; Pause still mirrors
// the leader's close; "Stop following, keep my positions" (ACTION_SET_LEADER_DETACHED: MirrorAccount.leaderDetached
// for this leader, enforced by the user's own contract) keeps the position: the engine sends no copy of the leader's
// exit, and a test-only keeper sending it straight to the contract gets Blocked (LeaderDetached, 22); the owner's own
// "Stop and close" still closes it; "Follow again", and the user holds a copy again for the exit flows.
import { keccak256, toHex } from "viem";
import { acct, ausdOf, env, faucet, leaderTrade, MA, position, pub, sleep, testKeeperMirror, walletOf } from "./chain.mjs";
import { click, findCard, text, tid, until, visible } from "./browser.mjs";

const LEADER = env.teamRun.demoLeaderAccountId;
const short = (a) => `${a.slice(0, 6)}…${a.slice(-4)}`.toLowerCase();
const feedOf = async (api, a) => (await api("GET", `/v1/accounts/${a}/feed`)).items ?? [];
const maxId = (items) => Math.max(0, ...items.map((i) => Number(i.id) || 0));

export async function stopsFlows(ctx) {
  const { R, page, dev, WEB, api, state, RUN } = ctx;
  const A = state.userAccount;
  const prompts = async () => (await dev.webauthnLog()).length;
  const read = (fn, args = []) => pub.readContract({ address: A, abi: MA, functionName: fn, args });
  const perplId = A ? Number(await read("perplAccountId")) : 0;
  const lots = async () => (await position(1, perplId)).lots;

  await R.check("position detail: Edit levels -> take-profit +1% saved onchain with one passkey prompt (ACTION_SET_LEVELS)", page, async () => {
    await until("user holds BTC", async () => (await lots()) > 0n, 60_000, 1000);
    await page.goto(`${WEB}/positions`);
    await click(page, "position.BTC.long", 30_000);
    await visible(page, "position.detail", 20_000);
    const before = await text(page, "position.levels.tp.value");
    await R.shot(page, "stops-position-detail");
    await click(page, "position.editLevels");
    await visible(page, "levels.sheet");
    await click(page, "levels.mode.pct");
    await page.locator(tid("levels.tp.input")).fill("1");
    const derived = await text(page, "levels.tp.input.derived");
    await R.shot(page, "stops-edit-levels");
    const p0 = await prompts();
    await click(page, "levels.save");
    const lv = await until("level onchain", async () => { const l = await read("level", [1n]); return l.takeProfitPNS > 0n && l; }, 60_000, 1000);
    const shown = await until("take-profit in the app", async () => { const t = await text(page, "position.levels.tp.value", 3000); return t !== "—" && t; }, 60_000, 1000);
    state.tpPNS = lv.takeProfitPNS;
    await R.shot(page, "stops-levels-saved");
    const onchainText = (Number(lv.takeProfitPNS) / 10).toLocaleString("en-US", { minimumFractionDigits: 1 });
    return { ok: (await prompts()) - p0 === 1 && shown === onchainText && lv.side === 0 && lv.slippageBps === 300, before, derived, shown, onchain: { takeProfitPNS: lv.takeProfitPNS, stopLossPNS: lv.stopLossPNS, slippageBps: lv.slippageBps, side: lv.side } };
  }, { needs: ["userAccount"] });

  await R.check("mark moved past the take-profit (faucet /mark); a STRANGER wallet calls triggerLevel -> closed, stranger paid nothing", null, async () => {
    const { mark } = await position(1, 0);
    state.markBeforeStops = mark;
    const stranger = acct(keccak256(toHex(`stranger-web-${RUN}`)));
    await faucet("/fund", { address: stranger.address, ausd: 0, mon: 1 });
    // Just past the level: the makers' bids from before the move are still resting, so the reduce-only close
    // (bounded at mark - 3%) fills against them. The price administrator's 4 s tick can land a mark computed
    // before /mark, so wait until the chain shows it.
    const target = (Number(state.tpPNS) * 1.004) / 10;
    const markNow = await until("mark past the take-profit onchain", async () => {
      const m = (await position(1, perplId)).mark;
      if (m >= state.tpPNS) return m;
      await faucet("/mark", { perpId: 1, price: target });
      return null;
    }, 45_000, 1500);
    const lotsBefore = await lots();
    const w = walletOf(stranger);
    await until("triggerLevel simulates", async () => {
      try {
        await pub.simulateContract({ account: stranger, address: A, abi: MA, functionName: "triggerLevel", args: [1n] });
        return true;
      } catch (e) {
        if ((await position(1, perplId)).mark < state.tpPNS) await faucet("/mark", { perpId: 1, price: target });
        throw e;
      }
    }, 30_000, 1500);
    const hash = await w.writeContract({ address: A, abi: MA, functionName: "triggerLevel", args: [1n] });
    const r = await pub.waitForTransactionReceipt({ hash });
    const after = await lots();
    const strangerAusd = await ausdOf(stranger.address);
    const halted = (await read("markets", [1n]))[1];
    state.stranger = stranger.address;
    state.triggerTx = hash;
    return { ok: r.status === "success" && after === 0n && strangerAusd === 0n && halted === true, tx: hash, stranger: stranger.address, markPNS: markNow.toString(), takeProfitPNS: state.tpPNS.toString(), lotsBefore: lotsBefore.toString(), lotsAfter: after.toString(), strangerAusd: strangerAusd.toString(), marketHalted: halted };
  }, { needs: ["tpPNS"] });

  await R.check("app: feed card 'Take-profit executed by <stranger>' with the tx; copy detail and position show how it closed; halt notice", page, async () => {
    await page.goto(`${WEB}/feed`);
    const card = await until("Take-profit card", () => findCard(page, "activity.item.", "Take-profit", { max: 20 }), 60_000, 1500);
    const title = await text(page, `${card.id}.title`);
    const sub = await text(page, `${card.id}.sub`);
    const tx = await text(page, `${card.id}.tx`).catch(() => null);
    await card.card.scrollIntoViewIfNeeded();
    await R.shot(page, "stops-feed-take-profit");
    await page.goto(`${WEB}/position?account=${A}&perp=1&side=long`);
    await visible(page, "position.closed", 20_000);
    const closedBy = await text(page, "copy.closedBy.title", 20_000);
    await visible(page, "position.halted", 20_000);
    await R.shot(page, "stops-position-closed-halted");
    const s = short(state.stranger);
    return { ok: title.toLowerCase().includes(s) && closedBy.toLowerCase().includes(s) && /anyone can execute/.test(sub), title, sub, tx, closedBy, triggerTx: state.triggerTx };
  }, { needs: ["stranger"] });

  await R.check("'Save limits again' lifts the halt (one passkey prompt, SET_POLICY with the same limits)", page, async () => {
    await faucet("/mark", { perpId: 1, price: Number(state.markBeforeStops) / 10 });
    const p0 = await prompts();
    await click(page, "position.halted.resume");
    const halted = await until("market resumed onchain", async () => ((await read("markets", [1n]))[1] === false ? "no" : null), 60_000, 1000);
    const engine = await until("engine sees it", async () => { const v = await api("GET", `/v1/accounts/${A}`); return !(v.policy?.markets ?? []).some((m) => m.halted) && v; }, 30_000, 1000);
    return { ok: (await prompts()) - p0 === 1 && halted === "no", halted, entryFilterKept: engine.policy?.maxEntryDeviationBps };
  }, { needs: ["stranger"] });

  await R.check("leader adds (anvil key) -> copied into the user again", null, async () => {
    const last = maxId(await feedOf(api, A));
    await sleep(1000);
    const tx = await leaderTrade(env.testKeys.demoLeader, 1, 0, 20);
    const copy = await until("user copy", async () => (await feedOf(api, A)).find((i) => Number(i.id) > last && i.kind === "Mirrored" && Number(i.orderType) === 0), 60_000, 700);
    state.reopened = await until("open onchain", async () => { const l = await lots(); return l > 0n && l; }, 30_000, 500);
    return { ok: !!copy, leaderTx: tx, copyTx: copy.txHash, userLots: state.reopened.toString() };
  }, { needs: ["stranger"] });

  await R.check("Pause (leader.pause, one prompt): no new exposure, but the leader's close IS copied while paused", page, async () => {
    await page.goto(`${WEB}/leader/${LEADER}`);
    await until("Following shown", async () => (await text(page, "follow.status", 3000)) === "Following" || null, 30_000, 1000);
    const p0 = await prompts();
    await click(page, "leader.pause");
    await until("paused onchain", async () => (await read("paused")) === true || null, 60_000, 1000);
    await until("engine sees the pause", async () => (await api("GET", `/v1/accounts/${A}`)).paused === true || null, 30_000, 500);
    const n = (await prompts()) - p0;
    const before = await lots();
    const last = maxId(await feedOf(api, A));
    const { lots: leaderLots } = await position(1, LEADER);
    const tx = await leaderTrade(env.testKeys.demoLeader, 1, 2, leaderLots / 2n);
    const copied = await until("copied close while paused", async () => (await feedOf(api, A)).find((i) => Number(i.id) > last && i.kind === "Mirrored" && Number(i.orderType) === 2), 60_000, 700);
    const after = await until("user reduced", async () => { const l = await lots(); return l < before && l; }, 30_000, 500);
    // Resume so the next step starts from a normal, unpaused follow.
    await until("Paused shown", async () => (await text(page, "follow.status", 3000)) === "Paused" || null, 30_000, 1000);
    await click(page, "leader.pause");
    await until("unpaused onchain", async () => (await read("paused")) === false || null, 60_000, 1000);
    await until("engine sees it unpaused", async () => (await api("GET", `/v1/accounts/${A}`)).paused === false || null, 30_000, 500);
    return { ok: n === 1 && !!copied && after > 0n, prompts: n, leaderCloseTx: tx, leaderLotsClosed: (leaderLots / 2n).toString(), copiedCloseTx: copied.txHash, userLotsBefore: before.toString(), userLotsAfter: after.toString() };
  }, { needs: ["reopened"] });

  await R.check("'Stop following, keep my positions' (one passkey prompt): leaderDetached set onchain by the user's own contract (ACTION_SET_LEADER_DETACHED), not paused; position stays open", page, async () => {
    await page.goto(`${WEB}/leader/${LEADER}`);
    await click(page, "leader.stopFollow", 30_000);
    await visible(page, "stop.sheet");
    const keep = await text(page, "stop.option.keep.body");
    const explain = await text(page, "stop.explain");
    await R.shot(page, "stops-stop-following-sheet");
    const p0 = await prompts();
    await click(page, "stop.confirm");
    const onchain = await until("leaderDetached onchain", async () => (await read("leaderDetached", [LEADER])) === true || null, 60_000, 1000);
    const engine = await until("engine: detachedLeaders", async () => { const v = await api("GET", `/v1/accounts/${A}`); return (v.detachedLeaders ?? []).includes(LEADER) && v; }, 60_000, 1000);
    const item = await until("LeaderDetached feed row", async () => (await feedOf(api, A)).find((i) => i.kind === "LeaderDetached" && Number(i.leaderAccountId) === LEADER && i.data?.detached === true), 30_000, 1000);
    const status = await until("detached state in the app", async () => { const t = await text(page, "follow.status", 3000); return t && t !== "Following" && t; }, 30_000, 1000);
    const note = await text(page, "leader.detached");
    const n = (await prompts()) - p0;
    await R.shot(page, "stops-detached-profile");
    const paused = await read("paused");
    return {
      ok: n === 1 && onchain && !paused && engine.paused === false && item.onchain === true && !!item.txHash && /contract/i.test(`${keep} ${explain} ${note}`) && (await lots()) > 0n,
      prompts: n, keep, explain, status, note, paused, feedItem: { kind: item.kind, onchain: item.onchain, tx: item.txHash, label: item.data?.label }, userLots: (await lots()).toString(),
    };
  }, { needs: ["reopened"] });

  await R.check("after 'keep my positions', the leader's exit is not copied (the engine sends nothing) and the contract refuses it: a keeper close naming the leader is Blocked LeaderDetached (22); the position stays open", null, async () => {
    const before = await lots();
    const last = maxId(await feedOf(api, A));
    const { lots: leaderLots } = await position(1, LEADER);
    const tx = await leaderTrade(env.testKeys.demoLeader, 1, 2, leaderLots);
    await sleep(12_000);
    const afterLeader = await lots();
    const engineSent = (await feedOf(api, A)).filter((i) => Number(i.id) > last && (i.kind === "Mirrored" || i.kind === "Blocked"));
    const leaderAfter = (await position(1, LEADER)).lots;
    // The exit sent straight to the contract by a test-only keeper (the engine would never send it).
    const { mark } = await position(1, perplId);
    const k = await testKeeperMirror(A, { leaderAccountId: LEADER, perpId: 1, orderType: 2, lotLNS: before, pricePNS: (mark * 970n) / 1000n }, "web");
    const after = await lots();
    const fed = await until("engine feed shows the Blocked", async () => (await feedOf(api, A)).find((i) => i.kind === "Blocked" && i.txHash?.toLowerCase() === k.hash.toLowerCase()), 30_000, 700).catch(() => null);
    return {
      ok: afterLeader === before && before > 0n && engineSent.length === 0 && leaderAfter === 0n && k.status === "success" && k.blocked?.reason === 22 && k.blocked.actual === String(LEADER) && !k.mirrored && after === before && fed?.reason === "LeaderDetached",
      leaderCloseTx: tx, leaderLotsClosed: leaderLots.toString(), engineRows: engineSent.map((i) => i.kind), keeperTx: k.hash, blocked: k.blocked, feedReason: fed?.reason ?? null, userLotsBefore: before.toString(), userLotsAfter: after.toString(),
    };
  }, { needs: ["reopened"] });

  await R.check("the owner's own close still works while detached: 'Stop and close' (one passkey prompt) closes every position onchain, ClosedAll in the feed", page, async () => {
    await page.goto(`${WEB}/leader/${LEADER}`);
    await click(page, "leader.stopFollow", 30_000);
    await visible(page, "stop.sheet");
    await click(page, "stop.option.close");
    const body = await text(page, "stop.option.close.body");
    await R.shot(page, "stops-stop-and-close-sheet");
    const p0 = await prompts();
    await click(page, "stop.confirm");
    const flat = await until("closed onchain", async () => ((await lots()) === 0n ? "0" : null), 60_000, 1000);
    const closedAll = await until("ClosedAll in the feed", async () => (await feedOf(api, A)).find((i) => i.kind === "ClosedAll"), 30_000, 1000);
    // The WebAuthn log lives in the page: count before navigating away.
    const n = (await prompts()) - p0;
    await page.goto(`${WEB}/positions`);
    await until("app shows no positions", async () => (await text(page, "portfolio.positions.count", 3000)) === "0" || null, 30_000, 1000).catch(() => {});
    await R.shot(page, "stops-after-stop-and-close");
    return { ok: n === 1 && flat === "0" && !!closedAll, prompts: n, body, closeTx: closedAll.txHash };
  }, { needs: ["reopened"] });

  await R.check("Follow again (one prompt: ACTION_SET_LEADER_DETACHED false + unpause) and a new leader trade is copied, so the exit flows have a position", page, async () => {
    await page.goto(`${WEB}/leader/${LEADER}`);
    const p0 = await prompts();
    await click(page, "leader.followAgain", 30_000);
    await until("leaderDetached cleared onchain", async () => (await read("leaderDetached", [LEADER])) === false || null, 60_000, 1000);
    await until("engine: following again", async () => { const v = await api("GET", `/v1/accounts/${A}`); return (!(v.detachedLeaders ?? []).includes(LEADER) && v.paused === false) || null; }, 60_000, 1000);
    const status = await until("Following in the app", async () => { const t = await text(page, "follow.status", 3000); return t === "Following" && t; }, 30_000, 1000);
    const n = (await prompts()) - p0;
    const again = (await feedOf(api, A)).find((i) => i.kind === "LeaderDetached" && Number(i.leaderAccountId) === LEADER && i.data?.detached === false);
    const last = maxId(await feedOf(api, A));
    await sleep(1000);
    const tx = await leaderTrade(env.testKeys.demoLeader, 1, 0, 20);
    const copy = await until("user copy", async () => (await feedOf(api, A)).find((i) => Number(i.id) > last && i.kind === "Mirrored" && Number(i.orderType) === 0), 60_000, 700);
    return { ok: n === 1 && !!copy && !!again && again.onchain === true && (await read("paused")) === false && (await lots()) > 0n, prompts: n, status, feedItem: again && { tx: again.txHash, label: again.data?.label }, leaderTx: tx, copyTx: copy.txHash };
  }, { needs: ["userAccount"] });
}
