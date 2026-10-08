// Phone flows before any deposit: create account (one passkey, two PRF outputs), watch mode, Run demo trade
// with the copy proof and builder fee, Run blocked trade, faucet funding, and "Can't reach Mirror".
import { decodeEventLog } from "viem";
import { faucet, pub, sleep, X } from "./chain.mjs";
import { calm, click, findCard, isVisible, LAPTOP, PHONE, text, tid, until, visible } from "./browser.mjs";
import { shareCardCheck } from "./share-card.mjs";
import { freshDeviceOfflineFlows } from "./flows-offline.mjs";

/** Builder id and fee Perpl charged on a copy, from its TakerOrderFilledV2 log. */
export async function takerBuilder(hash) {
  const r = await pub.getTransactionReceipt({ hash });
  for (const l of r.logs) {
    try {
      const e = decodeEventLog({ abi: X, data: l.data, topics: l.topics });
      if (e.eventName === "TakerOrderFilledV2") return { builderId: Number(e.args.builderId), builderFeeCNS: e.args.builderFeeCNS.toString() };
    } catch {}
  }
  return { builderId: 0, builderFeeCNS: "0" };
}

export const shortHash = (h) => `${h.slice(0, 6)}…${h.slice(-4)}`;
export const feeNumber = (s) => Number((s.match(/(\d+\.\d+)\s*AUSD/) ?? [])[1] ?? NaN);

/** Copy-detail proof fields as shown, then closes the sheet/panel. */
export async function readProof(page) {
  await visible(page, "copy.detail", 15_000);
  const f = {};
  for (const k of ["leaderFill", "yourFill", "deviation", "latencyMs", "leaderTx", "yourTx", "fee"]) f[k] = await text(page, `copy.proof.${k}`, 5_000).catch(() => null);
  return f;
}

export async function readBlocked(page) {
  await visible(page, "blocked.detail", 15_000);
  const f = {};
  for (const k of ["blocked.detail.reason", "blocked.title", "blocked.sentence", "blocked.detail.actual", "blocked.detail.limit", "blocked.tx"]) f[k.replace(/^blocked\.(detail\.)?/, "")] = await text(page, k, 4_000).catch(() => null);
  return f;
}

const demoIdle = (api) => until("demo idle", async () => { const d = await api("GET", "/v1/demo"); return !d.busy && !(d.cycles ?? []).some((c) => c.status === "running"); }, 90_000, 1000);

export async function phoneFlows(ctx) {
  const { R, page, dev, WEB, api, engineCtl, state } = ctx;

  await R.check("create account: one passkey ceremony returns two PRF outputs (real WebAuthn, rpId localhost)", page, async () => {
    await page.goto(`${WEB}/welcome`);
    await calm(page);
    await visible(page, "onboarding.createAccount", 30_000);
    const footer = await page.locator(tid("onboarding.screen")).innerText();
    await R.shot(page, "welcome");
    await click(page, "onboarding.createAccount");
    await until("ceremony finished and the app left Welcome", async () => (await dev.webauthnLog()).some((x) => x.ok !== undefined) && /\/home/.test(page.url()), 30_000);
    const log = await dev.webauthnLog();
    const creds = await dev.credentials();
    const creates = log.filter((x) => x.op === "create");
    const c = creates[0] ?? {};
    return { ok: creates.length === 1 && log.length === 1 && c.gotFirst && c.gotSecond && c.rpId === "localhost" && creds.length === 1 && !footer.includes("passkey simulator"), ceremonies: log, credentials: creds.map((x) => ({ rpId: x.rpId, resident: x.isResidentCredential })) };
  });

  await R.check("watch mode on Home with the team-run label", page, async () => {
    await visible(page, "home.watch", 20_000);
    await visible(page, "watch.teamRun", 20_000);
    const badge = await text(page, "watch.teamRun");
    await page.goto(`${WEB}/funds`);
    state.address = (await text(page, "funds.address", 20_000)).replace(/\s+/g, "");
    await page.goto(`${WEB}/home`);
    await visible(page, "watch.demoCard", 20_000);
    return { ok: /team/i.test(badge) && /^0x[0-9a-fA-F]{40}$/.test(state.address), badge, address: state.address };
  });

  const demoFeed = async () => { const f = await api("GET", `/v1/accounts/${(await api("GET", "/v1/demo")).follower.account}/feed`); return f.items ?? f.events ?? []; };
  const lastId = async () => Math.max(0, ...(await demoFeed()).map((i) => Number(i.id) || 0));
  /** The demo follower's next feed item matching pred (after id `after`), and its card in watch mode. */
  async function nextDemoItem(label, after, pred, type) {
    const item = await until(`${label} (API)`, async () => (await demoFeed()).find((i) => Number(i.id) > after && pred(i)), 60_000, 700);
    const card = await until(`${label} card`, () => findCard(page, "watch.feed.", type, { contains: shortHash(item.txHash) }), 30_000, 700);
    return { item, card };
  }

  await R.check("Run demo trade: the copy lands in watch mode", page, async () => {
    await until("Run demo enabled", async () => (await page.locator(tid("watch.runDemo")).getAttribute("aria-disabled")) !== "true", 30_000);
    state.demoAfter = await lastId();
    await click(page, "watch.runDemo");
    const { item, card } = await nextDemoItem("demo copy", state.demoAfter, (i) => i.kind === "Mirrored" && Number(i.orderType) <= 1, "Copy");
    state.demoCopyCard = card.id;
    state.demoOpen = item;
    return { card: card.id, tx: item.txHash, row: (await card.card.innerText()).replace(/\s+/g, " ").slice(0, 160) };
  });

  await R.check("demo copy detail: leader fill, your fill, deviation, latency, both txs, builder 26 fee > 0", page, async () => {
    const card = await findCard(page, "watch.feed.", "Copy", { contains: shortHash(state.demoOpen.txHash) });
    await card.card.click();
    const f = await readProof(page);
    const chain = await takerBuilder(state.demoOpen.txHash);
    const fee = feeNumber(f.fee ?? "");
    const ok = !!f.leaderFill && f.leaderFill !== "—" && !!f.yourFill && f.yourFill !== "—" && /bps/.test(f.deviation ?? "") && /\d s/.test(f.latencyMs ?? "") && !!f.leaderTx && f.yourTx === shortHash(state.demoOpen.txHash) && /builder 26/.test(f.fee ?? "") && fee > 0 && chain.builderId === 26 && BigInt(chain.builderFeeCNS) > 0n;
    return { ok, shown: f, onchain: chain, proofBuilderFeeCNS: state.demoOpen.proof?.builderFeeCNS };
  }, { needs: ["demoCopyCard"] });

  await R.check("demo close copy: builder fee row shows 0 (no builder on the close)", page, async () => {
    if (await isVisible(page, "copy.detail.close")) await click(page, "copy.detail.close");
    const { item, card } = await nextDemoItem("demo close", state.demoAfter, (i) => i.kind === "Mirrored" && Number(i.orderType) >= 2, "Close");
    await card.card.click();
    const f = await readProof(page);
    const chain = await takerBuilder(item.txHash);
    return { ok: feeNumber(f.fee ?? "") === 0 && /builder 26/.test(f.fee ?? "") && chain.builderFeeCNS === "0" && chain.builderId === 0, shown: f, onchain: chain };
  }, { needs: ["demoCopyCard"] });

  await R.check("Run blocked trade: Blocked card with the rule and numbers, and its detail", page, async () => {
    if (await isVisible(page, "copy.detail.close")) await click(page, "copy.detail.close");
    await demoIdle(api);
    await until("Run blocked enabled", async () => (await page.locator(tid("watch.runBlocked")).getAttribute("aria-disabled")) !== "true", 30_000);
    const after = await lastId();
    await click(page, "watch.runBlocked");
    const { item, card } = await nextDemoItem("blocked", after, (i) => i.kind === "Blocked", "Blocked");
    const banner = (await card.card.locator(tid("activity.blocked.banner")).innerText()).trim();
    await R.shot(page, "blocked-card");
    await card.card.click();
    const f = await readBlocked(page);
    await click(page, "blocked.done").catch(() => {});
    return { ok: /Not copied/.test(banner) && /leverage/i.test(banner) && /5x/.test(banner) && /5x/.test(f.limit ?? "") && /10x/.test(f.actual ?? "") && !!f.tx, banner, detail: f, reason: item.reason, limit: item.limit, actual: item.actual };
  });

  await shareCardCheck(ctx, { demoFeed, shortHash });

  await R.check("faucet funds the wallet (POST :8547/fund); the AUSD balance chip updates", page, async () => {
    const before = await text(page, "home.balance.ausd").catch(() => null);
    await faucet("/fund", { address: state.address, ausd: 100 });
    const after = await until("balance chip 100", async () => { const t = await text(page, "home.balance.ausd", 3000); return /^100(\.00)?$/.test(t.replace(/,/g, "")) && t; }, 60_000, 1000)
      .catch(async () => { await page.reload(); return until("balance chip 100 after reload", async () => { const t = await text(page, "home.balance.ausd", 3000); return /^100(\.00)?$/.test(t) && t; }, 30_000, 1000); });
    return { before, after };
  }, { needs: ["address"] });

  await R.check("Can't reach Mirror: engine stopped; watch mode reads Monad; Run buttons disabled", page, async () => {
    await engineCtl.stop();
    await page.reload();
    await visible(page, "home.offline", 60_000);
    await visible(page, "watch.runDemo", 30_000);
    const runDis = await page.locator(tid("watch.runDemo")).getAttribute("aria-disabled");
    const blkDis = await page.locator(tid("watch.runBlocked")).getAttribute("aria-disabled");
    const fromMonad = await until("watch feed read from Monad", () => findCard(page, "watch.feed.", "Copy").then(async (c) => c ?? (await findCard(page, "watch.feed.", "Close")) ?? findCard(page, "watch.feed.", "Blocked")), 60_000).then(() => true).catch(() => false);
    const cards = await page.locator('[data-testid^="watch.feed."]').evaluateAll((els) => els.map((e) => `${e.getAttribute("data-testid")}: ${e.innerText.replace(/\s+/g, " ").slice(0, 80)}`)).catch((e) => [String(e)]);
    await page.locator(tid("watch.runNote")).scrollIntoViewIfNeeded().catch(() => {});
    const watchText = await page.locator(tid("home.watch")).innerText();
    const balance = await text(page, "home.balance.ausd").catch(() => null);
    const walletShown = await text(page, "home.equity", 5000).catch(() => null);
    return { ok: runDis === "true" && blkDis === "true" && fromMonad && /read from Monad/i.test(watchText) && /^100(\.00)?$/.test(walletShown ?? ""), walletFromMonad: walletShown, cards: cards.slice(0, 6), runDemoDisabled: runDis, runBlockedDisabled: blkDis, copiesFromMonad: fromMonad, balance };
  });

  // Still down: a fresh device (no cached config) must work from the bundled network config.
  await freshDeviceOfflineFlows(ctx);

  await R.check("engine restarted: the app recovers (offline banner gone, Run buttons enabled)", page, async () => {
    await engineCtl.start();
    if (await isVisible(page, "home.offline.retry")) await click(page, "home.offline.retry").catch(() => {});
    await until("offline gone", async () => !(await isVisible(page, "home.offline")), 60_000, 1000);
    await until("Run enabled", async () => (await page.locator(tid("watch.runDemo")).getAttribute("aria-disabled")) !== "true", 30_000);
    return {};
  });

  // Laptop layout, same account and authenticator: the window is resized past 1024 px.
  await page.setViewportSize(LAPTOP);
  await R.check("laptop: watch mode Home with sidebar and team-run label", page, async () => {
    await page.goto(`${WEB}/home`);
    await visible(page, "layout.laptop.sidebar", 20_000);
    await visible(page, "watch.teamRun", 20_000);
    return {};
  });
  await R.check("laptop: demo copy detail with the builder fee row", page, async () => {
    const card = await until("Copy card", () => findCard(page, "watch.feed.", "Copy", { contains: shortHash(state.demoOpen.txHash) }), 30_000);
    await card.card.click();
    const f = await readProof(page);
    return { ok: /builder 26/.test(f.fee ?? "") && feeNumber(f.fee ?? "") > 0, shown: f };
  }, { needs: ["demoCopyCard"] });
  await page.setViewportSize(PHONE);
  await sleep(300);
}
