#!/usr/bin/env node
// Shared position and suggested levels screenshots (design proposal-2 #share, 07c-07e): Share position -> link
// sheet, the Suggestions card on the position, the review sheet, after Accept ("suggested by a friend, accepted by
// you"), Alerts with the suggestion, and the laptop bell badge. 390 wide and 1440x900, light and dark, from the web
// export against the dev mock (as shoot-stops.cjs, on other ports so a running :8787 mock is left alone):
//   MOCK_PORT=8791 node dev-mock/server.mjs; node scripts/serve-web.mjs (dist-web on :8790) — export built with
//   EXPO_PUBLIC_API_BASE=http://localhost:8791 EXPO_PUBLIC_MIRROR_DEV_TOOLS=1 EXPO_PUBLIC_DEV_PASSKEY=1
//   WEB_URL=http://localhost:8792/app MOCK_URL=http://localhost:8791 node scripts/shoot-suggest.cjs [filter]
const path = require("node:path");
const fs = require("node:fs");
const { chromium } = require(process.env.PLAYWRIGHT || "playwright");

const WEB = process.env.WEB_URL || "http://localhost:8792/app";
const MOCK = process.env.MOCK_URL || "http://localhost:8791";
const OUT = path.join(__dirname, "..", "screenshots", "suggest");
const only = process.argv[2] ? new RegExp(process.argv[2]) : null;
const SIZES = { mobile: { width: 390, height: 1100 }, desktop: { width: 1440, height: 900 } };
fs.mkdirSync(OUT, { recursive: true });

const post = (p, body) => fetch(MOCK + p, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json());
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const tid = (id) => `[data-testid="${id}"]`;

async function signIn(page) {
  await post("/__mock/switch", { backend: "ok", rpc: "ok", backtest: "ok", demoQuiet: true });
  await post("/__mock/scenario", { default: "funded" });
  await page.goto(`${WEB}/welcome`);
  await page.waitForSelector(tid("onboarding.createAccount"), { timeout: 20000 });
  await page.click(tid("onboarding.createAccount"));
  await page.waitForSelector(tid("home.screen"), { timeout: 20000 });
}
const owner = async () => (await fetch(`${MOCK}/__mock/state`).then((r) => r.json())).owners.at(-1).owner;
/** A friend's suggestion through a link on the BTC position (the mock makes the link). */
const suggest = async () =>
  post("/__mock/suggest", { owner: await owner(), create: true, perpId: 1, stopLossPNS: "1120000", takeProfitPNS: "1350000", note: "Funding flipped negative this morning. I'd tighten the stop and take profit earlier.", createdMs: Date.now() - 4 * 60_000 });
async function openBtc(p, size) {
  await p.goto(`${WEB}/positions`);
  await wait(2200);
  if (size === "mobile") {
    await p.click(tid("position.BTC.long"));
    await p.waitForSelector(tid("position.detail"));
  } else await p.waitForSelector(tid("position.detail"));
  await wait(1500);
}
const review = async (p, size) => {
  await suggest();
  await openBtc(p, size);
  await p.waitForSelector(tid("position.suggestions"), { timeout: 30000 });
  await p.locator('[data-testid^="position.suggestions.item."]').first().click();
  await p.waitForSelector(tid("suggest.sheet"));
  await wait(500);
};

const STATES = [
  { name: "share-position-sheet", run: async (p, size) => { await openBtc(p, size); await p.click(tid("position.share")); await p.waitForSelector(tid("shareLink.sheet"), { timeout: 30000 }); await wait(500); } },
  { name: "position-suggestion", run: async (p, size) => { await suggest(); await openBtc(p, size); await p.waitForSelector(tid("position.suggestions"), { timeout: 30000 }); await p.locator(tid("position.suggestions")).scrollIntoViewIfNeeded(); await wait(400); } },
  { name: "suggest-review", run: review },
  { name: "suggest-accepted", run: async (p, size) => { await review(p, size); await p.click(tid("suggest.accept")); await p.waitForSelector(tid("position.suggestion.accepted"), { timeout: 30000 }); await p.waitForFunction(() => /accepted by you/.test(document.querySelector('[data-testid="position.levels.onchain"]')?.textContent ?? ""), null, { timeout: 30000 }); await p.locator(tid("position.levels")).scrollIntoViewIfNeeded(); await wait(500); } },
  { name: "alerts-suggestion", run: async (p) => { await suggest(); await p.goto(`${WEB}/alerts`); await p.waitForSelector(tid("alerts.suggestions"), { timeout: 30000 }); await wait(500); } },
  { name: "share-revoked", run: async (p, size) => { await openBtc(p, size); await p.click(tid("position.share")); await p.waitForSelector(tid("shareLink.sheet"), { timeout: 30000 }); await p.click(tid("shareLink.revoke")); await p.waitForSelector(tid("shareLink.status"), { timeout: 30000 }); await wait(400); } },
];

(async () => {
  const browser = await chromium.launch({ channel: "chromium" });
  const index = [];
  for (const st of STATES) {
    if (only && !only.test(st.name)) continue;
    for (const [size, vp] of Object.entries(SIZES)) {
      for (const scheme of ["light", "dark"]) {
        const ctx = await browser.newContext({ viewport: vp, colorScheme: scheme, deviceScaleFactor: 1, serviceWorkers: "block" });
        const page = await ctx.newPage();
        const file = `${st.name}-${size}-${scheme}.png`;
        try {
          await signIn(page);
          await st.run(page, size);
          await page.screenshot({ path: path.join(OUT, file) });
          index.push({ file, state: st.name, size, scheme });
          console.log("ok", file);
        } catch (e) {
          await page.screenshot({ path: path.join(OUT, file) }).catch(() => {});
          index.push({ file, state: st.name, size, scheme, error: String(e.message).slice(0, 200) });
          console.log("FAIL", file, String(e.message).split("\n")[0]);
        }
        await ctx.close();
      }
    }
  }
  await browser.close();
  fs.writeFileSync(path.join(OUT, "index.json"), JSON.stringify(index, null, 2));
})();
