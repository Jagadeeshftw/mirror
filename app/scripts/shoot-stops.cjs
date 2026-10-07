#!/usr/bin/env node
// Levels and stops screenshots: position detail with onchain levels, Edit levels, Close position, Stop following
// (keep / close), the halt notice, stop items in the feed, the copy detail of a position a level closed, the leader
// profile and follow sheet entry points. 390 wide and 1440x900, light and dark, from the web export against the dev
// mock (same setup as shoot-web.cjs: `npm run mock` on :8787, `node scripts/serve-web.mjs` on :8790, export built
// with EXPO_PUBLIC_API_BASE=http://localhost:8787 EXPO_PUBLIC_MIRROR_DEV_TOOLS=1 EXPO_PUBLIC_DEV_PASSKEY=1).
//   PLAYWRIGHT=/path/to/node_modules/playwright node scripts/shoot-stops.cjs [filter]
const path = require("node:path");
const fs = require("node:fs");
const { chromium } = require(process.env.PLAYWRIGHT || "playwright");

const WEB = process.env.WEB_URL || "http://localhost:8790/app";
const MOCK = process.env.MOCK_URL || "http://localhost:8787";
const OUT = path.join(__dirname, "..", "screenshots", "stops");
const only = process.argv[2] ? new RegExp(process.argv[2]) : null;
const SIZES = { mobile: { width: 390, height: 1100 }, desktop: { width: 1440, height: 900 } };
fs.mkdirSync(OUT, { recursive: true });

const post = (p, body) => fetch(MOCK + p, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json());
const sw = (b) => post("/__mock/switch", { backend: "ok", rpc: "ok", backtest: "ok", demoQuiet: true, ...b });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const tid = (id) => `[data-testid="${id}"]`;

async function signIn(page) {
  await post("/__mock/scenario", { default: "funded" });
  await page.goto(`${WEB}/welcome`);
  await page.waitForSelector(tid("onboarding.createAccount"), { timeout: 20000 });
  await page.click(tid("onboarding.createAccount"));
  await page.waitForSelector(tid("home.screen"), { timeout: 20000 });
}
/** The newest owner the mock seeded (this browser's passkey account). */
async function me() {
  const s = await fetch(`${MOCK}/__mock/state`).then((r) => r.json());
  const owner = s.owners.at(-1).owner;
  return { owner, accounts: s.accounts.filter((a) => a.owner.toLowerCase() === owner.toLowerCase()) };
}
async function openBtc(p, size) {
  await p.goto(`${WEB}/positions`);
  await wait(2200);
  if (size === "mobile") {
    await p.click(tid("position.BTC.long"));
    await p.waitForSelector(tid("position.detail"));
  } else await p.waitForSelector(tid("position.detail"));
  await wait(900);
}
async function rowWith(p, prefix, re) {
  for (let i = 0; i < 40; i++) {
    const el = p.locator(tid(`${prefix}${i}`)).first();
    if (!(await el.count())) continue;
    if (re.test(await el.innerText())) return el;
  }
  return null;
}

const STATES = [
  { name: "positions", run: async (p) => { await p.goto(`${WEB}/positions`); await wait(2500); } },
  { name: "positions-halted", run: async (p) => { await p.goto(`${WEB}/positions`); await wait(2500); await p.locator(tid("positions.halted")).first().scrollIntoViewIfNeeded(); await wait(300); } },
  { name: "position-detail", run: async (p, size) => openBtc(p, size) },
  { name: "edit-levels", run: async (p, size) => { await openBtc(p, size); await p.click(tid("position.editLevels")); await p.waitForSelector(tid("levels.sheet")); await wait(600); } },
  { name: "edit-levels-price", run: async (p, size) => { await openBtc(p, size); await p.click(tid("position.editLevels")); await p.click(tid("levels.mode.price")); await p.locator(tid("levels.sl.input")).fill("119000"); await wait(600); } },
  { name: "close-position", run: async (p, size) => { await openBtc(p, size); await p.click(tid("position.close")); await p.waitForSelector(tid("position.close.dialog")); await wait(500); } },
  { name: "stop-following", run: async (p, size) => { await openBtc(p, size); await p.click(tid("position.stopFollow")); await p.waitForSelector(tid("stop.sheet")); await wait(500); } },
  { name: "stop-and-close", run: async (p, size) => { await openBtc(p, size); await p.click(tid("position.stopFollow")); await p.click(tid("stop.option.close")); await wait(500); } },
  { name: "feed-stops", run: async (p, size) => { await p.goto(`${WEB}/feed`); await wait(2200); await p.click(tid("feed.filter.closes")); await wait(800); if (size === "desktop") { const r = await rowWith(p, "feed.table.row.", /executed by/); if (r) await r.click(); } await wait(600); } },
  { name: "copy-closed-by-level", run: async (p, size) => { await p.goto(`${WEB}/feed`); await wait(2200); await p.click(tid("feed.filter.copied")); await wait(600); const r = await rowWith(p, size === "mobile" ? "activity.item." : "feed.table.row.", /^(?=[\s\S]*MON)(?=[\s\S]*\b7h\b)/); if (r) await r.click(); await p.waitForSelector(tid("copy.closedBy"), { state: "attached" }); await p.locator(tid("copy.closedBy")).scrollIntoViewIfNeeded(); await wait(600); } },
  { name: "position-closed", run: async (p) => { const { owner, accounts } = await me(); const a = accounts.find((x) => (x.levels ?? []).some((l) => l.perpId === 1)); await post("/__mock/trigger", { owner, perpId: 1 }); await p.goto(`${WEB}/position?account=${a.account}&perp=1&side=long`); await wait(2500); } },
  { name: "leader-stop", run: async (p, size) => { await p.goto(size === "mobile" ? `${WEB}/leader/1043` : `${WEB}/leaders?leader=1043`); await wait(2500); await p.click(tid("leader.stopFollow")); await p.waitForSelector(tid("stop.sheet")); await wait(500); } },
  { name: "follow-levels-hint", run: async (p) => { await p.goto(`${WEB}/follow/1043`); await wait(2500); await p.locator(tid("follow.levels.hint")).scrollIntoViewIfNeeded(); await wait(400); } },
];

(async () => {
  const browser = await chromium.launch({ channel: "chromium" });
  const index = [];
  for (const st of STATES) {
    if (only && !only.test(st.name)) continue;
    for (const [size, vp] of Object.entries(SIZES)) {
      for (const scheme of ["light", "dark"]) {
        await sw({});
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
