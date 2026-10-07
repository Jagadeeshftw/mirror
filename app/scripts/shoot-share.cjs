#!/usr/bin/env node
// Share sheet screenshots (design proposal-2 #cards, 08e) at 390 (phone) and 1440x900 (laptop), light and dark:
// Blocked detail, leader profile and Home (follower result). Needs the dev mock, the website (web/, next dev, with
// NEXT_PUBLIC_API_BASE=<mock>) for the card previews, and a web export built with EXPO_PUBLIC_API_BASE=<mock>
// EXPO_PUBLIC_SHARE_BASE=<site> EXPO_PUBLIC_MIRROR_DEV_TOOLS=1 EXPO_PUBLIC_DEV_PASSKEY=1, served under /app.
//   WEB_URL=http://localhost:8796/app MOCK_URL=http://localhost:8797 PLAYWRIGHT=../web/node_modules/playwright node scripts/shoot-share.cjs
const path = require("node:path");
const fs = require("node:fs");
const { chromium } = require(process.env.PLAYWRIGHT || "playwright");

const WEB = process.env.WEB_URL || "http://localhost:8790/app";
const MOCK = process.env.MOCK_URL || "http://localhost:8787";
const OUT = path.join(__dirname, "..", "screenshots", "cards");
const SIZES = { "390": { width: 390, height: 900 }, "1440": { width: 1440, height: 900 } };
fs.mkdirSync(OUT, { recursive: true });
const post = (p, body) => fetch(MOCK + p, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json());
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const tid = (id) => `[data-testid="${id}"]`;

async function previewLoaded(p) {
  await p.waitForSelector(tid("share.sheet"), { timeout: 15000 });
  await p.waitForFunction(() => {
    const el = document.querySelector('[data-testid="share.preview.image"] img');
    return (el && el.complete && el.naturalWidth > 0) || document.querySelector('[data-testid="share.preview.unavailable"]');
  }, null, { timeout: 90000 }).catch(() => {});
  await wait(500);
}

const STATES = [
  {
    name: "share-blocked",
    run: async (p, size) => {
      await p.goto(`${WEB}/feed?filter=blocked`);
      await wait(2000);
      if (size === "390") await p.click(tid("activity.item.1"));
      else await p.click(tid("feed.filter.blocked")).then(() => p.click(tid("feed.table.row.1")));
      await p.click(tid("blocked.share"), { timeout: 15000 });
    },
  },
  {
    name: "share-leader",
    run: async (p, size) => {
      await p.goto(size === "390" ? `${WEB}/leader/1043` : `${WEB}/leaders?leader=1043`);
      await p.click(tid("leader.share"), { timeout: 20000 });
    },
  },
  {
    name: "share-follower",
    run: async (p) => {
      await p.goto(`${WEB}/home`);
      await p.click(tid("home.share"), { timeout: 20000 });
    },
  },
];

(async () => {
  const browser = await chromium.launch();
  for (const st of STATES)
    for (const [size, vp] of Object.entries(SIZES))
      for (const scheme of ["light", "dark"]) {
        const ctx = await browser.newContext({ viewport: vp, colorScheme: scheme, deviceScaleFactor: size === "390" ? 2 : 1 });
        const page = await ctx.newPage();
        const file = `${st.name}-${size}-${scheme}.png`;
        try {
          await post("/__mock/scenario", { default: "funded" });
          await page.goto(`${WEB}/welcome`);
          await page.click(tid("onboarding.createAccount"), { timeout: 20000 });
          await page.waitForSelector(tid("home.screen"), { timeout: 20000 });
          await st.run(page, size);
          await previewLoaded(page);
          console.log("ok", file);
        } catch (e) {
          console.log("FAIL", file, String(e.message).split("\n")[0]);
        }
        await page.screenshot({ path: path.join(OUT, file) }).catch(() => {});
        await ctx.close();
      }
  await browser.close();
})();
