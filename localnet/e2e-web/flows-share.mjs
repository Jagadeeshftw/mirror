// Shared position and suggested levels (item 11): the owner shares the BTC position (one passkey signature), a
// friend in a second browser context with no passkey opens /p/<id> on the website (next dev on this engine),
// suggests a take-profit with a note; the owner gets the encrypted alert, sees the suggestion, accepts it (one passkey
// prompt, ACTION_SET_LEVELS); the level is read from the contract, then executes when the mark passes it (a stranger
// calls triggerLevel); the link is closed with the position. Then decline and revoke on a second link.
import { keccak256, toHex } from "viem";
import { acct, ausdOf, env, faucet, leaderTrade, MA, position, pub, sleep, walletOf } from "./chain.mjs";
import { click, PHONE, text, tid, until, visible } from "./browser.mjs";

const short = (a) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const px = (pns) => (Number(pns) / 10).toFixed(1);
const feedOf = async (api, a) => (await api("GET", `/v1/accounts/${a}/feed`)).items ?? [];
const maxId = (items) => Math.max(0, ...items.map((i) => Number(i.id) || 0));

export async function shareFlows(ctx) {
  const { R, page, dev, WEB, api, API, state, site, browser, push, RUN } = ctx;
  const A = state.userAccount;
  const prompts = async () => (await dev.webauthnLog()).length;
  const read = (fn, args = []) => pub.readContract({ address: A, abi: MA, functionName: fn, args });
  const perplId = A ? Number(await read("perplAccountId")) : 0;
  const lots = async () => (await position(1, perplId)).lots;
  const posUrl = `${WEB}/position?account=${A}&perp=1&side=long`;
  let friend = null;
  const friendPage = async () => {
    if (!friend) {
      const context = await browser.newContext({ viewport: PHONE, deviceScaleFactor: 1, colorScheme: "light" });
      const hosts = new Set();
      context.on("request", (r) => hosts.add(new URL(r.url()).host));
      friend = { context, page: await context.newPage(), hosts };
    }
    return friend.page;
  };
  const suggestRaw = (urlId, body) => fetch(`${API}/v1/share/${urlId}/suggest`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const shareFromApp = async (label) => {
    await page.goto(posUrl);
    await visible(page, "position.detail", 30_000);
    const p0 = await prompts();
    await click(page, "position.share");
    await visible(page, "shareLink.sheet", 30_000);
    const url = await text(page, "shareLink.url");
    await R.shot(page, `share-${label}-sheet`);
    return { url, urlId: url.split("/p/")[1], prompts: (await prompts()) - p0 };
  };

  await R.check("owner: Share position (one passkey signature) -> ShareLink accepted by the engine; share sheet shows /p/<id>", page, async () => {
    if (!site) throw new Error("website not started");
    await until("user holds BTC", async () => (await lots()) > 0n, 60_000, 1000);
    const s = await shareFromApp("link");
    const card = await api("GET", `/v1/share/${s.urlId}`);
    state.share = { urlId: s.urlId };
    await click(page, "shareLink.close");
    return { ok: s.prompts === 1 && /^[A-Za-z0-9_-]{43}$/.test(s.urlId) && card.status === "open" && card.side === "long", prompts: s.prompts, url: s.url, card: { status: card.status, symbol: card.symbol, side: card.side, sharedBy: card.sharedBy } };
  }, { needs: ["userAccount"] });

  await R.check("friend (second browser context, no passkey, no login): /p/<id> read-only card + suggests a take-profit with a note -> 'Suggestion sent'", null, async () => {
    const fp = await friendPage();
    const card = await api("GET", `/v1/share/${state.share.urlId}`);
    await fp.goto(`${site.url}/p/${state.share.urlId}`, { waitUntil: "networkidle", timeout: 120_000 });
    await visible(fp, "share.card", 60_000);
    const html = (await fp.content()).toLowerCase();
    const sharedBy = await text(fp, "share.card.sharedBy");
    const owner = state.address;
    const tp = (BigInt(card.markPNS) * 1006n) / 1000n;
    await fp.locator(tid("share.tp")).fill(px(tp));
    await fp.locator(tid("share.note")).fill("Funding flipped negative this morning. I'd take profit a bit earlier.");
    const hint = await text(fp, "share.tp.hint");
    const result = await text(fp, "share.tp.result");
    const count = await text(fp, "share.note.count");
    await R.shot(fp, "share-friend-form");
    state.shareFrom = push.sink.requests.length;
    await click(fp, "share.send");
    await visible(fp, "share.sent", 30_000);
    const sentTp = await text(fp, "share.sent.tp");
    const status = await text(fp, "share.sent.status");
    await R.shot(fp, "share-friend-sent");
    state.shareTp = tp;
    const cookies = await friend.context.cookies();
    const hosts = [...friend.hosts];
    const leak = html.includes(owner.slice(2).toLowerCase()) || html.includes(A.slice(2).toLowerCase());
    return { ok: sharedBy.toLowerCase() === short(owner).toLowerCase() && !leak && /from entry/.test(hint) && /AUSD/.test(result) && sentTp.endsWith(Number(px(tp)).toLocaleString("en-US", { minimumFractionDigits: 1 })) && status === "Waiting for the owner" && cookies.length === 0 && hosts.every((h) => /^(localhost|127\.0\.0\.1)(:|$)/.test(h)), sharedBy, ownerOrAccountInPage: leak, takeProfit: px(tp), hint, result, noteCount: count, sentTp, status, cookies: cookies.length, hostsContacted: hosts };
  }, { needs: ["share"] });

  await R.check("same friend, same link, within the hour: a second suggestion is refused (429, one per link per hour)", null, async () => {
    const r = await suggestRaw(state.share.urlId, { takeProfitPNS: String(state.shareTp + 10n) });
    const b = await r.json();
    return { ok: r.status === 429, status: r.status, error: b.error };
  }, { needs: ["shareTp"] });

  await R.check("owner: encrypted alert (Web Push sealed, no plaintext); Suggestions on the position and in Alerts", page, async () => {
    const reqs = await until("web push for the suggestion", () => { const x = push.sink.requests.slice(state.shareFrom).filter((r) => r.endpoint === push.sub.endpoint); return x.length ? x : null; }, 30_000, 500).catch(() => []);
    const sealed = reqs.length > 0 && reqs.every((r) => { const e = JSON.parse(r.plaintext ?? "{}").mirror; return e?.v === 1 && e.ct.length > 40; });
    const leak = reqs.some((r) => /Funding|take-profit|BTC/i.test(r.plaintext ?? ""));
    await page.goto(posUrl);
    const title = await until("Suggestions card", async () => text(page, "position.suggestions.title", 3000), 60_000, 1500);
    await page.locator(tid("position.suggestions")).scrollIntoViewIfNeeded();
    await R.shot(page, "share-owner-position-suggestion");
    await page.goto(`${WEB}/alerts`);
    await visible(page, "alerts.suggestions", 30_000);
    const row = await page.locator('[data-testid^="alerts.suggestion."]').first().innerText();
    await R.shot(page, "share-owner-alerts");
    return { ok: sealed && !leak && /Suggestions · 1 new/.test(title) && /Suggested levels for BTC long/.test(row), webPushes: reqs.length, sealed, plaintextLeak: leak, title, alertsRow: row.replace(/\s+/g, " ") };
  }, { needs: ["shareTp"] });

  await R.check("owner reviews (now vs suggested) and Accepts: one passkey prompt, ACTION_SET_LEVELS; take-profit read from the contract; 'suggested by a friend, accepted by you' with the tx", page, async () => {
    await page.goto(posUrl);
    await click(page, "position.suggestions.title", 30_000).catch(() => {});
    await page.locator('[data-testid^="position.suggestions.item."]').first().click();
    await visible(page, "suggest.sheet");
    const now = await text(page, "suggest.tp.now");
    const next = await text(page, "suggest.tp.new");
    const note = await text(page, "suggest.note");
    await R.shot(page, "share-owner-review");
    const p0 = await prompts();
    await click(page, "suggest.accept");
    const lv = await until("level onchain", async () => { const l = await read("level", [1n]); return l.takeProfitPNS === state.shareTp && l; }, 60_000, 1000);
    const onchain = await until("accepted label", async () => { const t = await text(page, "position.levels.onchain", 3000); return /accepted by you/.test(t) && t; }, 60_000, 1000);
    const tx = await text(page, "position.levels.tx").catch(() => null);
    const n = (await prompts()) - p0;
    const banner = await text(page, "position.suggestion.accepted").catch(() => null);
    const setTx = (await feedOf(api, A)).find((i) => i.kind === "LevelSet")?.txHash ?? null;
    await R.shot(page, "share-owner-accepted");
    state.shareAccepted = true;
    return { ok: n === 1 && lv.side === 0 && /suggested by a friend, accepted by you/.test(onchain) && !!setTx && !!tx && setTx.toLowerCase().startsWith(tx.split("…")[0].toLowerCase()), prompts: n, now, suggested: next, note, onchain: { takeProfitPNS: lv.takeProfitPNS.toString(), stopLossPNS: lv.stopLossPNS.toString(), slippageBps: lv.slippageBps }, label: onchain, txShown: tx, levelSetTx: setTx, banner };
  }, { needs: ["shareTp"] });

  await R.check("mark passes the friend's take-profit; a STRANGER calls triggerLevel -> the position closes", null, async () => {
    state.shareMarkBefore = (await position(1, 0)).mark;
    const stranger = acct(keccak256(toHex(`share-stranger-${RUN}`)));
    await faucet("/fund", { address: stranger.address, ausd: 0, mon: 1 });
    const target = (Number(state.shareTp) * 1.004) / 10;
    await until("mark past the take-profit", async () => { const m = (await position(1, perplId)).mark; if (m >= state.shareTp) return m; await faucet("/mark", { perpId: 1, price: target }); return null; }, 45_000, 1500);
    await until("triggerLevel simulates", async () => {
      try { await pub.simulateContract({ account: stranger, address: A, abi: MA, functionName: "triggerLevel", args: [1n] }); return true; } catch (e) { if ((await position(1, perplId)).mark < state.shareTp) await faucet("/mark", { perpId: 1, price: target }); throw e; }
    }, 30_000, 1500);
    const hash = await walletOf(stranger).writeContract({ address: A, abi: MA, functionName: "triggerLevel", args: [1n] });
    const r = await pub.waitForTransactionReceipt({ hash });
    state.shareClosed = (await lots()) === 0n || null;
    return { ok: r.status === "success" && !!state.shareClosed && (await ausdOf(stranger.address)) === 0n, tx: hash, stranger: stranger.address, lotsAfter: (await lots()).toString() };
  }, { needs: ["shareAccepted"] });

  await R.check("link closed with the position: the friend page says 'Position closed' (no numbers) and suggestions get 410", null, async () => {
    const card = await until("engine closes the link", async () => { const c = await api("GET", `/v1/share/${state.share.urlId}`); return c.status === "closed" && c; }, 60_000, 1500);
    const fp = await friendPage();
    await fp.goto(`${site.url}/p/${state.share.urlId}`, { waitUntil: "networkidle", timeout: 120_000 });
    const t = await text(fp, "share.ended.title", 30_000);
    const numbers = await fp.locator(tid("share.card.entry")).count();
    await R.shot(fp, "share-friend-closed");
    const r = await suggestRaw(state.share.urlId, { takeProfitPNS: "1" });
    return { ok: t === "Position closed" && numbers === 0 && r.status === 410 && card.endedReason === "position_closed", title: t, endedReason: card.endedReason, suggestStatus: r.status };
  }, { needs: ["shareClosed"] });

  await R.check("'Save limits again' lifts the halt and the leader re-opens -> the user holds BTC again", page, async () => {
    await faucet("/mark", { perpId: 1, price: Number(state.shareMarkBefore) / 10 });
    await page.goto(posUrl);
    await click(page, "position.halted.resume", 30_000);
    await until("market resumed onchain", async () => ((await read("markets", [1n]))[1] === false ? "no" : null), 60_000, 1000);
    const last = maxId(await feedOf(api, A));
    await sleep(1000);
    const tx = await leaderTrade(env.testKeys.demoLeader, 1, 0, 20);
    const copy = await until("user copy", async () => (await feedOf(api, A)).find((i) => Number(i.id) > last && i.kind === "Mirrored" && Number(i.orderType) === 0), 60_000, 700);
    state.shareReopened = await until("open onchain", async () => { const l = await lots(); return l > 0n && l; }, 30_000, 500);
    return { ok: !!copy, leaderTx: tx, copyTx: copy.txHash, lots: state.shareReopened.toString() };
  }, { needs: ["shareClosed"] });

  await R.check("decline: a new link (one passkey), the friend suggests a stop-loss, the owner declines (one passkey signature); the level onchain is unchanged", page, async () => {
    const s = await shareFromApp("link2");
    state.share2 = { urlId: s.urlId };
    await click(page, "shareLink.close");
    const card = await api("GET", `/v1/share/${s.urlId}`);
    const fp = await friendPage();
    await fp.goto(`${site.url}/p/${s.urlId}`, { waitUntil: "networkidle", timeout: 120_000 });
    await fp.locator(tid("share.sl")).fill(px((BigInt(card.markPNS) * 970n) / 1000n));
    await click(fp, "share.send");
    await visible(fp, "share.sent", 30_000);
    const before = await read("level", [1n]);
    await page.goto(posUrl);
    await until("Suggestions card", async () => text(page, "position.suggestions.title", 3000), 60_000, 1500);
    await page.locator('[data-testid^="position.suggestions.item."]').first().click();
    await visible(page, "suggest.sheet");
    const p0 = await prompts();
    await click(page, "suggest.decline");
    await until("suggestion gone", async () => (await page.locator(tid("position.suggestions")).count()) === 0 || null, 60_000, 1000);
    const n = (await prompts()) - p0;
    const after = await read("level", [1n]);
    await R.shot(page, "share-owner-declined");
    return { ok: s.prompts === 1 && n === 1 && after.stopLossPNS === before.stopLossPNS && after.takeProfitPNS === before.takeProfitPNS, createPrompts: s.prompts, declinePrompts: n, levelBefore: { sl: before.stopLossPNS.toString(), tp: before.takeProfitPNS.toString() }, levelAfter: { sl: after.stopLossPNS.toString(), tp: after.takeProfitPNS.toString() } };
  }, { needs: ["shareReopened"] });

  await R.check("revoke: the owner revokes the link from the share sheet (one passkey signature); the friend page says 'Link revoked'; suggestions get 410", page, async () => {
    await page.goto(posUrl);
    await visible(page, "position.detail", 30_000);
    const p0 = await prompts();
    await click(page, "position.share");
    await visible(page, "shareLink.sheet", 30_000);
    const reused = (await prompts()) - p0 === 0;
    await click(page, "shareLink.revoke");
    const status = await text(page, "shareLink.status", 30_000);
    const n = (await prompts()) - p0;
    await R.shot(page, "share-owner-revoked");
    await click(page, "shareLink.close").catch(() => {});
    const fp = await friendPage();
    await fp.goto(`${site.url}/p/${state.share2.urlId}`, { waitUntil: "networkidle", timeout: 120_000 });
    const t = await text(fp, "share.ended.title", 30_000);
    await R.shot(fp, "share-friend-revoked");
    const r = await suggestRaw(state.share2.urlId, { stopLossPNS: "1" });
    await friend.context.close().catch(() => {});
    friend = null;
    return { ok: reused && n === 1 && /revoked/i.test(status) && t === "Link revoked" && r.status === 410, openLinkReused: reused, prompts: n, status, friendTitle: t, suggestStatus: r.status };
  }, { needs: ["share2"] });
}
