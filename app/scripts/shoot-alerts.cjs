#!/usr/bin/env node
// Alerts screenshots: the new and changed alert screens at 390 wide and 1440x900, light and dark, from the web export
// against the dev mock (same setup as shoot-web.cjs: `npm run mock` on :8787, `node scripts/serve-web.mjs` on :8790,
// export built with EXPO_PUBLIC_API_BASE=http://localhost:8787 EXPO_PUBLIC_MIRROR_DEV_TOOLS=1 EXPO_PUBLIC_DEV_PASSKEY=1).
// The alerts on the Alerts screen are real: the mock seals them to the browser's notification key and sends them over
// SSE (/__mock/push), and the app decrypts them.
//   PLAYWRIGHT=/path/to/node_modules/playwright node scripts/shoot-alerts.cjs [filter]
const path = require("node:path");
const fs = require("node:fs");
const { chromium } = require(process.env.PLAYWRIGHT || "playwright");

const WEB = process.env.WEB_URL || "http://localhost:8790/app";
const MOCK = process.env.MOCK_URL || "http://localhost:8787";
const OUT = path.join(__dirname, "..", "screenshots", "alerts");
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

/** The owner this browser registered (its notification key is on the mock). */
async function owner() {
  const s = await fetch(`${MOCK}/__mock/state`).then((r) => r.json());
  return [...s.owners].reverse().find((o) => o.notifyPub)?.owner;
}

async function toFollowDone(p, size) {
  await p.goto(`${WEB}/follow/1043`);
  await wait(2500);
  if (size === "mobile") { await p.click(tid("follow.seeWhatIf")); await wait(800); }
  await p.click(tid("follow.review"));
  await wait(2500);
  await p.click(tid("follow.confirm"));
  await p.waitForSelector(tid("follow.alerts"), { timeout: 30000 });
}

const STATES = [
  { name: "follow-alerts-card", scenario: "funded", run: async (p, size) => { await toFollowDone(p, size); await p.locator(tid("follow.alerts")).scrollIntoViewIfNeeded(); await wait(600); } },
  { name: "follow-alerts-on", scenario: "funded", run: async (p, size) => { await toFollowDone(p, size); await p.click(tid("follow.alerts.enable")); await p.waitForSelector(tid("follow.alerts.on.done"), { timeout: 15000 }); await p.locator(tid("follow.alerts.on.done")).scrollIntoViewIfNeeded(); await wait(600); } },
  { name: "settings-alerts", scenario: "funded", run: async (p) => { await p.goto(`${WEB}/settings`); await wait(2500); await p.click(tid("settings.alerts.toggle")); await wait(1500); await p.locator(tid("settings.alerts.privacy")).scrollIntoViewIfNeeded(); await wait(400); } },
  {
    name: "alerts-list", scenario: "funded",
    run: async (p) => {
      await p.goto(`${WEB}/settings`);
      await wait(2000);
      await p.click(tid("settings.alerts.toggle"));
      await p.goto(`${WEB}/alerts`);
      await p.waitForSelector(tid("alerts.screen"));
      await wait(2500); // SSE connected
      const o = await owner();
      for (const kind of ["Deposited", "Mirrored", "Blocked"]) { await post("/__mock/push", { owner: o, kind }).catch(() => {}); await wait(600); }
      await p.waitForSelector(tid("alerts.item.2"), { timeout: 15000 });
      await wait(500);
    },
  },
  { name: "alerts-empty", scenario: "new", run: async (p) => { await p.goto(`${WEB}/alerts`); await p.waitForSelector(tid("alerts.empty")); await wait(800); } },
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
        await ctx.grantPermissions(["notifications"], { origin: new URL(WEB).origin });
        const page = await ctx.newPage();
        const file = `${st.name}-${size}-${scheme}.png`;
        try {
          if (st.scenario) await signIn(page, st.scenario);
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
  await sw({ demoQuiet: false });
  await browser.close();
  fs.writeFileSync(path.join(OUT, "index.json"), JSON.stringify(index, null, 1));
})();
