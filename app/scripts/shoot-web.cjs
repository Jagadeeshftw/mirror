#!/usr/bin/env node
// Stage A web screenshots: every changed screen at 390 wide (phone layout) and 1440x900 (laptop),
// light and dark, from the web export against the dev mock. Needs `npm run mock` (:8787) and
// `node scripts/serve-web.mjs` (:8790) running, and a web export built with
// EXPO_PUBLIC_API_BASE=http://localhost:8787 EXPO_PUBLIC_MIRROR_DEV_TOOLS=1 EXPO_PUBLIC_DEV_PASSKEY=1.
//   PLAYWRIGHT=/path/to/node_modules/playwright node scripts/shoot-web.cjs [filter]
const path = require("node:path");
const fs = require("node:fs");
const { chromium } = require(process.env.PLAYWRIGHT || "playwright");

const WEB = process.env.WEB_URL || "http://localhost:8790/app";
const MOCK = process.env.MOCK_URL || "http://localhost:8787";
const OUT = path.join(__dirname, "..", "screenshots", "stage-a");
const only = process.argv[2] ? new RegExp(process.argv[2]) : null;
const SIZES = { mobile: { width: 390, height: 1200 }, desktop: { width: 1440, height: 900 } };
fs.mkdirSync(OUT, { recursive: true });

const post = (p, body) => fetch(MOCK + p, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json());
const sw = (b) => post("/__mock/switch", { backend: "ok", rpc: "ok", backtest: "ok", demoQuiet: false, ...b });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const tid = (id) => `[data-testid="${id}"]`;

async function signIn(page, scenario) {
  await post("/__mock/scenario", { default: scenario });
  await page.goto(`${WEB}/welcome`);
  await page.waitForSelector(tid("onboarding.createAccount"), { timeout: 20000 });
  await page.click(tid("onboarding.createAccount"));
  await page.waitForSelector(tid("home.screen"), { timeout: 20000 });
}

const STATES = [
  { name: "welcome", run: async (p) => { await sw({}); await p.goto(`${WEB}/welcome`); await p.waitForSelector(tid("onboarding.latestCopy"), { timeout: 10000 }).catch(() => {}); } },
  { name: "welcome-example", run: async (p) => { await sw({ demoQuiet: true, backend: "down" }); await p.goto(`${WEB}/welcome`); await wait(1500); } },
  { name: "watch-home", scenario: "new", run: async (p) => { await p.waitForSelector(tid("watch.demoCard")); await wait(800); } },
  { name: "watch-running", scenario: "new", run: async (p) => { await p.waitForSelector(tid("watch.runDemo")); await wait(2000); await p.click(tid("watch.runDemo")); await wait(2500); } },
  { name: "watch-quiet", scenario: "new", pre: { demoQuiet: true }, run: async (p) => { await p.waitForSelector(tid("watch.quiet"), { timeout: 10000 }); } },
  { name: "skeleton", scenario: "new", run: async (p) => { await sw({ backend: "slow" }); await p.reload(); await p.waitForSelector(tid("home.skeleton"), { timeout: 10000 }); await wait(1500); } },
  { name: "slow", scenario: "new", run: async (p) => { await sw({ backend: "slow" }); await p.reload(); await p.waitForSelector(tid("home.slow"), { timeout: 15000 }); await wait(800); } },
  { name: "mirror-down", scenario: "new", run: async (p) => { await post("/v1/demo/trade", {}).catch(() => {}); await wait(1800); await sw({ backend: "down" }); await p.reload(); await p.waitForSelector(tid("home.offline"), { timeout: 20000 }); await wait(2500); } },
  { name: "home-funded", scenario: "funded", run: async (p) => { await wait(1500); } },
  { name: "funded-mirror-down", scenario: "funded", run: async (p) => { await wait(1500); await sw({ backend: "down" }); await p.waitForSelector(tid("home.offline"), { timeout: 30000 }); await wait(500); } },
  { name: "feed", scenario: "funded", run: async (p) => { await p.goto(`${WEB}/feed`); await p.waitForSelector(tid("activity.item.0"), { timeout: 15000 }).catch(() => {}); await wait(1200); } },
  { name: "copy-detail", scenario: "funded", run: async (p, size) => { await p.goto(`${WEB}/feed?filter=copied`); await wait(2000); await p.click(tid(size === "mobile" ? "feed.filter.copied" : "feed.filter.copied")); await wait(400); if (size === "mobile") await p.click(tid("activity.item.0")); else await p.click(tid("feed.table.row.0")); await p.waitForSelector(tid("copy.detail")); await wait(1200); } },
  { name: "blocked-detail", scenario: "funded", run: async (p, size) => { await p.goto(`${WEB}/feed?filter=blocked`); await wait(2000); if (size === "mobile") await p.click(tid("activity.item.1")); else await p.click(tid("feed.filter.blocked")).then(() => p.click(tid("feed.table.row.1"))); await wait(1000); } },
  { name: "engine-item", scenario: "funded", run: async (p, size) => { await p.goto(`${WEB}/feed`); await wait(2000); const el = await p.$(size === "mobile" ? '[data-testid$=".engine"]' : tid("feed.table")); if (el) await el.scrollIntoViewIfNeeded(); if (size === "desktop") { const rows = await p.$$('[data-testid^="feed.table.row."]'); for (const r of rows) { if ((await r.innerText()).includes("thin book")) { await r.click(); break; } } } await wait(600); } },
  { name: "leaders", scenario: "funded", run: async (p) => { await p.goto(`${WEB}/leaders?leader=1588`); await wait(2200); } },
  { name: "leader-adversarial", scenario: "funded", run: async (p) => { await p.goto(`${WEB}/leader/1588`); await wait(2200); } },
  { name: "follow-whatif", scenario: "funded", run: async (p, size) => { await p.goto(`${WEB}/follow/1043`); await wait(2500); if (size === "mobile") { await p.click(tid("follow.seeWhatIf")); } await p.waitForSelector(tid("follow.whatif.pnl"), { timeout: 15000 }).catch(() => {}); await wait(800); } },
  { name: "follow-whatif-503", scenario: "funded", pre: { backtest: "unavailable" }, run: async (p, size) => { await p.goto(`${WEB}/follow/1043`); await wait(2500); if (size === "mobile") await p.click(tid("follow.seeWhatIf")); await p.waitForSelector(tid("follow.whatif.unavailable"), { timeout: 15000 }).catch(() => {}); await wait(500); } },
  { name: "follow-review-fee", scenario: "funded", run: async (p, size) => { await p.goto(`${WEB}/follow/1043`); await wait(2500); if (size === "mobile") { await p.click(tid("follow.seeWhatIf")); await wait(800); } await p.click(tid("follow.review")); await p.waitForSelector(tid("follow.review.fee"), { timeout: 15000 }); await wait(1500); } },
  { name: "follow-done-alerts", scenario: "funded", run: async (p, size) => { await p.goto(`${WEB}/follow/1043`); await wait(2500); if (size === "mobile") { await p.click(tid("follow.seeWhatIf")); await wait(800); } await p.click(tid("follow.review")); await wait(2500); await p.click(tid("follow.confirm")); await p.waitForSelector(tid("follow.alerts"), { timeout: 30000 }); await wait(800); } },
  { name: "settings-fees", scenario: "funded", run: async (p) => { await p.goto(`${WEB}/settings`); await wait(2500); const el = await p.$(tid("settings.fees")); if (el) await el.scrollIntoViewIfNeeded(); await wait(300); } },
  { name: "positions", scenario: "funded", run: async (p) => { await p.goto(`${WEB}/positions`); await wait(2000); } },
  { name: "settings-network", scenario: "funded", run: async (p) => { await p.goto(`${WEB}/settings`); await wait(2500); const el = await p.$(tid("settings.net.monad")); if (el) await el.scrollIntoViewIfNeeded(); await wait(300); } },
  { name: "monad-down", scenario: "funded", run: async (p) => { await sw({ rpc: "down" }); await p.goto(`${WEB}/feed`); await p.waitForSelector(tid("feed.monadDown"), { timeout: 30000 }).catch(() => {}); await wait(800); } },
];

(async () => {
  const browser = await chromium.launch();
  const index = [];
  for (const st of STATES) {
    if (only && !only.test(st.name)) continue;
    for (const [size, vp] of Object.entries(SIZES)) {
      for (const scheme of ["light", "dark"]) {
        await sw(st.pre ?? {});
        const ctx = await browser.newContext({ viewport: vp, colorScheme: scheme, deviceScaleFactor: 1 });
        const page = await ctx.newPage();
        const file = `${st.name}-${size}-${scheme}.png`;
        try {
          if (st.scenario) await signIn(page, st.scenario);
          await sw(st.pre ?? {});
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
  await sw({});
  await browser.close();
  const prev = fs.existsSync(path.join(OUT, "index.json")) ? JSON.parse(fs.readFileSync(path.join(OUT, "index.json"), "utf8")) : [];
  const merged = [...prev.filter((x) => !index.some((y) => y.file === x.file)), ...index];
  fs.writeFileSync(path.join(OUT, "index.json"), JSON.stringify(merged, null, 1));
})();
