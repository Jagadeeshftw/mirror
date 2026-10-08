// Fresh device with Mirror's service (the engine) down: a new browser profile (no cached /v1/config) creates an
// account and must still know the network from the bundle (EXPO_PUBLIC_NETWORK=localnet +
// EXPO_PUBLIC_NETWORK_CONFIG): balance and watch mode read from Monad, Run buttons off with the reason,
// Leaders "not live", Feed names Mirror's service (not Monad), Settings reads the RPC directly, and no
// notification permission prompt after account creation. Called while the engine is stopped.
import { sleep } from "./chain.mjs";
import { calm, click, findCard, isVisible, LAPTOP, openDevice, PHONE, text, tid, until, visible } from "./browser.mjs";

export async function freshDeviceOfflineFlows(ctx) {
  const { R, browser, WEB } = ctx;
  const dev = await openDevice(browser, PHONE);
  const page = dev.page;
  try {
    await R.check("fresh device, Mirror down: create account works (local passkey) and no notification prompt", page, async () => {
      await page.goto(`${WEB}/welcome`);
      await calm(page);
      await visible(page, "onboarding.createAccount", 30_000);
      await click(page, "onboarding.createAccount");
      await until("left Welcome", async () => /\/home/.test(page.url()), 30_000);
      const permission = await page.evaluate(() => (typeof Notification === "undefined" ? "unsupported" : Notification.permission));
      return { ok: permission === "default", notificationPermission: permission };
    });

    await R.check("fresh device, Mirror down: Home fails fast to 'Can't reach Mirror's service' with balance read from Monad", page, async () => {
      const t0 = Date.now();
      await visible(page, "home.offline", 15_000);
      const waitedMs = Date.now() - t0;
      const banner = await text(page, "home.offline");
      const equity = await until("balance read", async () => { const t = await text(page, "home.equity", 3000); return t !== "—" && t; }, 20_000);
      const source = await text(page, "home.balance.source");
      return { ok: waitedMs < 15_000 && /Mirror's service/.test(banner) && /^\d/.test(equity) && /read from Monad/i.test(source), waitedMs, banner, equity, source };
    });

    await R.check("fresh device, Mirror down: watch mode reads the demo follower from Monad; Run buttons off with the reason", page, async () => {
      await visible(page, "watch.demoCard", 20_000);
      const src = await text(page, "watch.source");
      const runDis = await page.locator(tid("watch.runDemo")).getAttribute("aria-disabled");
      const blkDis = await page.locator(tid("watch.runBlocked")).getAttribute("aria-disabled");
      const note = await text(page, "watch.runNote");
      const copies = await until("copies or a plain empty line", async () => {
        const card = (await findCard(page, "watch.feed.", "Copy")) ?? (await findCard(page, "watch.feed.", "Close")) ?? (await findCard(page, "watch.feed.", "Blocked"));
        if (card) return `card ${card.id}`;
        if (await isVisible(page, "watch.empty")) { const t = await text(page, "watch.empty"); return /No copies in the last \d+ minute/.test(t) && t; }
        return null;
      }, 60_000, 1000);
      await R.shot(page, "fresh-offline-home");
      return { ok: /Monad/.test(src) && runDis === "true" && blkDis === "true" && /read straight from Monad/.test(note) && /^card /.test(copies), source: src, note, copies };
    });

    await R.check("fresh device, Mirror down: Leaders says not live / can't reach Mirror's service; demo card explains", page, async () => {
      await page.goto(`${WEB}/leaders`);
      await visible(page, "leaders.down", 30_000);
      const title = await text(page, "leaders.down.title");
      const demo = await text(page, "leaders.demo.down");
      await R.shot(page, "fresh-offline-leaders");
      return { ok: /Mirror's service|not live/i.test(title) && /can't be started/.test(demo), title, demo };
    });

    await R.check("fresh device, Mirror down: Feed says Mirror's service (not Monad) and a plain empty state", page, async () => {
      await page.goto(`${WEB}/feed`);
      await visible(page, "feed.offline", 30_000);
      const banner = await text(page, "feed.offline");
      const monad = await isVisible(page, "feed.monadDown");
      await visible(page, "feed.rpc.noAccount", 30_000);
      await R.shot(page, "fresh-offline-feed");
      return { ok: /Can't reach Mirror's service/.test(banner) && !monad, banner, monadBanner: monad };
    });

    await R.check("fresh device, Mirror down: Settings reads Monad RPC directly, Mirror's service shown separately", page, async () => {
      await page.goto(`${WEB}/settings`);
      const rpc = await until("RPC row", async () => { const t = await text(page, "settings.net.monad.detail", 3000); return /block/.test(t) && t; }, 30_000);
      const mirror = await until("Mirror row", async () => { const t = await text(page, "settings.net.mirror.detail", 3000); return /Can't reach/.test(t) && t; }, 30_000);
      return { rpc, mirror };
    });

    await page.setViewportSize(LAPTOP);
    await R.check("fresh device laptop, Mirror down: watch columns from Monad, Run off", page, async () => {
      await page.goto(`${WEB}/home`);
      await visible(page, "home.offline", 20_000);
      await visible(page, "watch.runDemo", 20_000);
      const runDis = await page.locator(tid("watch.runDemo")).getAttribute("aria-disabled");
      const note = await text(page, "watch.runNote");
      const card = await until("copy card", async () => (await findCard(page, "watch.feed.", "Copy")) ?? (await findCard(page, "watch.feed.", "Close")) ?? (await findCard(page, "watch.feed.", "Blocked")), 60_000, 1000);
      await R.shot(page, "fresh-offline-laptop");
      return { ok: runDis === "true" && /read straight from Monad/.test(note) && !!card, note, card: card?.id };
    });
  } finally {
    await sleep(100);
    await dev.context.close().catch(() => {});
  }
}
