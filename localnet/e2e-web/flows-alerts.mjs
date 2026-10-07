// Encrypted alerts (Web Push with VAPID, no Firebase): opt in after the first follow, a demo trade, the engine's Web
// Push request captured by the push sink (PUSH_WEBPUSH_ENDPOINT_OVERRIDE), then the real service worker receives
// that push (CDP ServiceWorker.deliverPushMessage), shows the generic text, and the app decrypts it on the Alerts screen.
import { env, leaderTrade, sleep } from "./chain.mjs";
import { click, isVisible, text, tid, until, visible } from "./browser.mjs";

/** Stands in for PushManager.subscribe: headless Chrome has no push service, so the subscription's keys come from the sink. */
const FAKE_SUBSCRIPTION = (sub) => {
  const P = globalThis.PushManager?.prototype;
  if (!P || P.__mirrorFake) return;
  P.__mirrorFake = true;
  const fake = { endpoint: sub.endpoint, expirationTime: null, options: { userVisibleOnly: true, applicationServerKey: null }, toJSON: () => ({ endpoint: sub.endpoint, expirationTime: null, keys: sub.keys }), unsubscribe: async () => true, getKey: () => null };
  let current = null;
  P.subscribe = async function () { current = fake; return fake; };
  P.getSubscription = async function () { return current; };
};

export async function installPushDouble(ctx) {
  const { dev, page, push } = ctx;
  if (push.installed) return;
  push.installed = true;
  await dev.context.grantPermissions(["notifications"], { origin: new URL(ctx.WEB).origin });
  await dev.context.addInitScript(FAKE_SUBSCRIPTION, push.sub);
  await page.evaluate(FAKE_SUBSCRIPTION, push.sub);
}

/** Called by the follow flow while the result screen shows "Get alerts for this follow?". */
export async function optInAfterFirstFollow(ctx) {
  const { R, page, state, dev } = ctx;
  await R.check("after the first follow: Turn on alerts (permission asked only now) -> Web Push subscription registered", page, async () => {
    await visible(page, "follow.alerts", 20_000);
    const before = await page.evaluate(() => Notification.permission);
    await installPushDouble(ctx);
    await click(page, "follow.alerts.enable");
    await visible(page, "follow.alerts.on.done", 20_000);
    const swScope = await until("service worker", () => page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.scope ?? null), 20_000);
    state.alertsOn = true;
    const after = await page.evaluate(() => Notification.permission);
    return { ok: !!swScope && after === "granted", permissionBefore: before, permissionAfter: after, swScope, note: await text(page, "follow.alerts.on.done"), prompts: (await dev.webauthnLog()).length };
  });
}

const swRegistrationId = async (cdp, scopePrefix) => {
  const seen = [];
  const on = (e) => seen.push(...e.registrations);
  cdp.on("ServiceWorker.workerRegistrationUpdated", on);
  await cdp.send("ServiceWorker.enable");
  await until("SW registration via CDP", () => seen.find((r) => !r.isDeleted && r.scopeURL.startsWith(scopePrefix)), 15_000, 300);
  cdp.off("ServiceWorker.workerRegistrationUpdated", on);
  return seen.find((r) => !r.isDeleted && r.scopeURL.startsWith(scopePrefix)).registrationId;
};

const LEAKS = (state) => [/BTC|ETH|AUSD|Copied|Blocked|leader/i, ...[state.address, state.userAccount].filter(Boolean).map((a) => new RegExp(a.slice(2), "i"))];

export async function alertsFlows(ctx) {
  const { R, page, dev, WEB, api, state, push } = ctx;

  await R.check("Settings: alerts on, Web Push channel, namespace and 'server only relays ciphertext' shown", page, async () => {
    await page.goto(`${WEB}/settings`);
    const channel = await until("channel", async () => { const t = await text(page, "settings.alerts.channel", 5000); return /Registered/.test(t) && t; }, 30_000, 1000);
    const privacy = await text(page, "settings.alerts.privacy");
    await page.locator(tid("settings.alerts.privacy")).scrollIntoViewIfNeeded();
    return { ok: /Web Push/.test(channel) && /mirror\.prf\.ns\.notify\.v1/.test(privacy) && /relays ciphertext/.test(privacy), channel, privacy };
  }, { needs: ["alertsOn"] });

  await R.check("demo trade with the app closed -> engine sends Web Push to the subscription: VAPID, aes128gcm, Mirror envelope still sealed", null, async () => {
    await page.goto("about:blank");
    const from = push.sink.requests.length;
    state.alertsFrom = from;
    await until("demo idle", async () => { const d = await api("GET", "/v1/demo"); return !d.busy && !(d.cycles ?? []).some((c) => c.status === "running"); }, 90_000, 1000);
    const { cycleId } = await api("POST", "/v1/demo/trade", {});
    await until("demo cycle done", async () => { const d = await api("GET", "/v1/demo"); return !(d.cycles ?? []).some((c) => c.status === "running") && !d.busy; }, 120_000, 1000);
    const got = await until("web push for the user's copy", () => push.sink.requests.slice(from).filter((r) => r.endpoint === push.sub.endpoint).length || null, 30_000, 500);
    const reqs = push.sink.requests.slice(from).filter((r) => r.endpoint === push.sub.endpoint);
    state.alertPushes = reqs;
    const envs = reqs.map((r) => JSON.parse(r.plaintext ?? "{}").mirror);
    const sealed = envs.every((e) => e && e.v === 1 && Buffer.from(e.epk, "base64").length === 32 && Buffer.from(e.nonce, "base64").length === 12 && e.ct.length > 40);
    const leaks = reqs.filter((r) => LEAKS(state).some((re) => re.test(r.plaintext ?? "")));
    const h = reqs[0].headers;
    return {
      ok: sealed && !leaks.length && reqs.every((r) => !r.error) && h["content-encoding"] === "aes128gcm" && /^vapid t=.+, k=/.test(h.authorization ?? "") && h.ttl === "3600",
      cycleId, pushes: got, sizes: reqs.map((r) => r.size), encoding: h["content-encoding"], vapid: (h.authorization ?? "").slice(0, 12) + "…", urgency: h.urgency, envelope: envs[0] && { v: envs[0].v, epkBytes: 32, ctChars: envs[0].ct.length },
    };
  }, { needs: ["alertsOn"] });

  await R.check("service worker shows the generic 'Mirror / New activity'; the Alerts screen shows the alert decrypted on device", page, async () => {
    await page.goto(`${WEB}/alerts`);
    await visible(page, "alerts.screen", 20_000);
    const titles = async () => page.locator('[data-testid^="alerts.item."][data-testid$=".title"]').allInnerTexts();
    const before = await titles();
    const regId = await swRegistrationId(dev.cdp, `${new URL(WEB).origin}/app/`);
    for (const r of state.alertPushes) await dev.cdp.send("ServiceWorker.deliverPushMessage", { origin: new URL(WEB).origin, registrationId: regId, data: r.plaintext });
    const after = await until("decrypted alerts", async () => { const t = await titles(); return t.length >= before.length + state.alertPushes.length && t; }, 30_000, 500);
    const notes = await page.evaluate(async () => (await (await navigator.serviceWorker.getRegistration()).getNotifications()).map((n) => ({ title: n.title, body: n.body })));
    const feed = (await api("GET", `/v1/accounts/${state.userAccount}/feed`)).items ?? [];
    const top = { title: await text(page, "alerts.item.0.title"), body: await text(page, "alerts.item.0.body") };
    const newest = feed.find((i) => ["Mirrored", "Blocked"].includes(i.kind));
    await R.shot(page, "alerts-decrypted");
    return {
      ok: /^(Copied|Closed|Blocked by your rule|Not copied)/.test(top.title) && notes.every((n) => n.title === "Mirror" && n.body === "New activity") && (await isVisible(page, "alerts.privacy")),
      before: before.length, after: after.length, top, systemNotifications: notes, latestFeedKind: newest?.kind,
    };
  }, { needs: ["alertPushes"] });

  // The demo cycle's close flattens the leader, and with it the user's copy. The exit flows close a live position,
  // so the leader opens again and the user's copy follows (as in the follow flow).
  await R.check("leader re-opens (anvil key) so the user holds a copy again for the exit flows", null, async () => {
    const feed = async () => (await api("GET", `/v1/accounts/${state.userAccount}/feed`)).items ?? [];
    const last = Math.max(0, ...(await feed()).map((i) => Number(i.id) || 0));
    await sleep(1000);
    const tx = await leaderTrade(env.testKeys.demoLeader, 1, 0, 20);
    const copy = await until("user copy", async () => (await feed()).find((i) => Number(i.id) > last && i.kind === "Mirrored" && Number(i.orderType) === 0), 60_000, 700);
    const alerted = await until("its web push", () => push.sink.requests.slice(state.alertsFrom).length > state.alertPushes.length || null, 20_000, 500).catch(() => false);
    return { ok: !!copy, leaderTx: tx, copyTx: copy.txHash, alertedAgain: !!alerted };
  }, { needs: ["userAccount"] });
}
