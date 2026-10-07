#!/usr/bin/env node
// Several leaders in one account: Home with leaders, budgets, margin used, PnL and loss stops; the Budgets
// screen; a leader stopped by its loss stop with Re-arm; the follow sheet's "Split your deposit" (limits and
// review); feed items for MarketHeldByOtherLeader / LeaderBudgetExceeded / LeaderLossStop / LeaderStopped.
// 390 wide and 1440x900, light and dark, from the web export against the dev mock (same setup as
// shoot-stops.cjs: `npm run mock` on :8787, `node scripts/serve-web.mjs` on :8790, export built with
// EXPO_PUBLIC_API_BASE=http://localhost:8787 EXPO_PUBLIC_MIRROR_DEV_TOOLS=1 EXPO_PUBLIC_DEV_PASSKEY=1).
//   PLAYWRIGHT=/path/to/node_modules/playwright node scripts/shoot-budgets.cjs [filter]
const path = require("node:path");
const fs = require("node:fs");
const { chromium } = require(process.env.PLAYWRIGHT || "playwright");

const WEB = process.env.WEB_URL || "http://localhost:8790/app";
const MOCK = process.env.MOCK_URL || "http://localhost:8787";
const OUT = path.join(__dirname, "..", "screenshots", "budgets");
const only = process.argv[2] ? new RegExp(process.argv[2]) : null;
const SIZES = { mobile: { width: 390, height: 1100 }, desktop: { width: 1440, height: 900 } };
fs.mkdirSync(OUT, { recursive: true });

const post = (p, body) => fetch(MOCK + p, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json());
const sw = (b) => post("/__mock/switch", { backend: "ok", rpc: "ok", backtest: "ok", demoQuiet: true, ...b });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const tid = (id) => `[data-testid="${id}"]`;

async function signIn(page, scenario) {
  await post("/__mock/scenario", { default: scenario });
  await page.goto(`${WEB}/welcome`);
  await page.waitForSelector(tid("onboarding.createAccount"), { timeout: 20000 });
  await page.click(tid("onboarding.createAccount"));
  await page.waitForSelector(tid("home.screen"), { timeout: 20000 });
}
async function rowWith(p, prefix, re) {
  for (let i = 0; i < 40; i++) {
    const el = p.locator(tid(`${prefix}${i}`)).first();
    if (!(await el.count())) continue;
    if (re.test(await el.innerText())) return el;
  }
  return null;
}
async function followSplit(p) {
  await p.goto(`${WEB}/follow/877`);
  await p.waitForSelector(tid("follow.section.split"), { timeout: 20000 });
  await wait(1500);
}

const STATES = [
  { name: "home-leaders", scenario: "multi", run: async (p, size) => { await p.goto(`${WEB}/home`); await p.waitForSelector(tid(size === "mobile" ? "home.leader.877" : "home.laptop.split"), { timeout: 20000 }); await wait(1500); if (size === "mobile") { await p.locator(tid("home.following.count")).scrollIntoViewIfNeeded(); await wait(300); } } },
  { name: "budgets", scenario: "multi", run: async (p) => { await p.goto(`${WEB}/budgets`); await p.waitForSelector(tid("budgets.split"), { timeout: 20000 }); await wait(1200); } },
  { name: "budgets-over", scenario: "multi", run: async (p) => { await p.goto(`${WEB}/budgets`); await p.waitForSelector(tid("budgets.split")); await p.locator(tid("budgets.split.budget.877.input")).fill("13.00"); await wait(400); await p.locator(tid("budgets.split.error")).scrollIntoViewIfNeeded(); await wait(400); } },
  { name: "budgets-rearm", scenario: "multi", run: async (p) => { await p.goto(`${WEB}/budgets`); await p.waitForSelector(tid("budgets.split")); await p.click(tid("budgets.leader.1588.rearm")); await wait(400); await p.locator(tid("budgets.leader.1588")).scrollIntoViewIfNeeded(); await wait(300); } },
  { name: "leader-stopped", scenario: "multi", run: async (p, size) => { await p.goto(size === "mobile" ? `${WEB}/leader/1588` : `${WEB}/leaders?leader=1588`); await p.waitForSelector(tid("leader.stopped"), { timeout: 20000 }); await wait(1500); } },
  { name: "follow-split", scenario: "funded", run: async (p) => { await followSplit(p); } },
  { name: "follow-split-ownership", scenario: "funded", run: async (p) => { await followSplit(p); await p.locator(tid("follow.section.leaderLoss")).scrollIntoViewIfNeeded(); await wait(500); } },
  { name: "follow-split-over", scenario: "funded", run: async (p) => { await followSplit(p); await p.locator(tid("follow.split.budget.877.input")).fill("12.00"); await wait(500); await p.locator(tid("follow.split.error")).scrollIntoViewIfNeeded(); await wait(400); } },
  { name: "follow-split-review", scenario: "funded", run: async (p, size) => { await followSplit(p); if (size === "mobile") { await p.click(tid("follow.seeWhatIf")); await p.waitForSelector(tid("follow.whatif")); await wait(800); } await p.click(tid("follow.review")); await p.waitForSelector(tid("follow.review.split")); await wait(1500); } },
  { name: "feed-blocks", scenario: "multi", run: async (p, size) => { await p.goto(`${WEB}/feed`); await wait(2200); if (size === "desktop") { const r = await rowWith(p, "feed.table.row.", /Market held by/); if (r) await r.click(); } await wait(800); } },
  { name: "feed-leader-stop", scenario: "multi", run: async (p, size) => { await p.goto(`${WEB}/feed`); await wait(2000); await p.click(tid("feed.filter.closes")); await wait(800); if (size === "desktop") { const r = await rowWith(p, "feed.table.row.", /Leader loss stop for/); if (r) await r.click(); } await wait(600); } },
  { name: "blocked-held", scenario: "multi", run: async (p, size) => { await p.goto(`${WEB}/feed`); await wait(2200); const r = await rowWith(p, size === "mobile" ? "activity.item." : "feed.table.row.", /market held by/i); if (r) await r.click(); await p.waitForSelector(tid("blocked.sentence"), { timeout: 10000 }); await wait(600); } },
];

(async () => {
  const browser = await chromium.launch({ channel: "chromium" });
  const index = [];
  for (const st of STATES) {
    if (only && !only.test(st.name)) continue;
    for (const [size, vp] of Object.entries(SIZES)) {
      if (st.mobileOnly && size !== "mobile") continue;
      for (const scheme of ["light", "dark"]) {
        await sw({});
        const ctx = await browser.newContext({ viewport: vp, colorScheme: scheme, deviceScaleFactor: 1, serviceWorkers: "block" });
        const page = await ctx.newPage();
        const errors = [];
        page.on("pageerror", (e) => errors.push(String(e.message)));
        const file = `${st.name}-${size}-${scheme}.png`;
        try {
          await signIn(page, st.scenario);
          await st.run(page, size);
          await page.screenshot({ path: path.join(OUT, file) });
          index.push({ file, state: st.name, size, scheme, pageErrors: errors });
          console.log("ok", file, errors.length ? `pageerrors ${errors.length}` : "");
        } catch (e) {
          await page.screenshot({ path: path.join(OUT, file) }).catch(() => {});
          index.push({ file, state: st.name, size, scheme, error: String(e.message).slice(0, 200), pageErrors: errors });
          console.log("FAIL", file, String(e.message).split("\n")[0]);
        }
        await ctx.close();
      }
    }
  }
  await browser.close();
  fs.writeFileSync(path.join(OUT, "index.json"), JSON.stringify(index, null, 2));
})();
