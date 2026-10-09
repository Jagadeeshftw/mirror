#!/usr/bin/env node
// Home in watch mode (signed in, no deposit) in its three states, for the laptop layout review:
//   down   : Mirror's service unreachable (copies read straight from Monad, Run buttons off)
//   empty  : service up, no demo copies yet
//   copies : service up, demo copies landing
// at desktop 1440x900 and phone 390x844 in light and dark, plus 2000x1125 (light and dark).
// Needs the dev mock (`node dev-mock/server.mjs`, :8787), `node scripts/serve-web.mjs` (:8790) and a web export
// built with EXPO_PUBLIC_API_BASE=http://localhost:8787 EXPO_PUBLIC_MIRROR_DEV_TOOLS=1 EXPO_PUBLIC_DEV_PASSKEY=1.
//   node scripts/shoot-laptop-home.cjs [outDir]
const path = require("node:path");
const fs = require("node:fs");
const { chromium } = require(process.env.PLAYWRIGHT || require.resolve("playwright", { paths: [path.join(__dirname, "..", "..", "web")] }));

const WEB = process.env.WEB_URL || "http://localhost:8790/app";
const MOCK = process.env.MOCK_URL || "http://localhost:8787";
const OUT = process.argv[2] || path.join(__dirname, "..", "screenshots", "laptop-home");
const SIZES = { desktop: { width: 1440, height: 900 }, mobile: { width: 390, height: 844 }, wide: { width: 2000, height: 1125 } };
fs.mkdirSync(OUT, { recursive: true });

const post = (p, body) => fetch(MOCK + p, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}) }).then((r) => r.json());
const sw = (b) => post("/__mock/switch", { backend: "ok", rpc: "ok", backtest: "ok", demoQuiet: false, ...b });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const tid = (id) => `[data-testid="${id}"]`;

const STATES = {
  down: async (p) => {
    await sw({});
    await post("/__mock/scenario", { default: "new" });
    await signIn(p);
    await sw({ backend: "down" });
    await p.reload();
    await p.waitForSelector(tid("home.offline"), { timeout: 30000 });
    await wait(6000); // RPC reads of the demo account
  },
  empty: async (p) => {
    await sw({ demoQuiet: true });
    await post("/__mock/scenario", { default: "new" });
    await signIn(p);
    await p.waitForSelector(tid("watch.demoCard"), { timeout: 20000 });
    await wait(1500);
  },
  copies: async (p) => {
    await sw({});
    await post("/__mock/scenario", { default: "new" });
    await post("/v1/demo/trade", {}).catch(() => {});
    await signIn(p);
    await p.waitForSelector(tid("watch.feed.0"), { timeout: 30000 }).catch(() => {});
    await wait(2500);
  },
};

async function signIn(page) {
  await page.goto(`${WEB}/welcome`);
  await page.waitForSelector(tid("onboarding.createAccount"), { timeout: 20000 });
  await page.click(tid("onboarding.createAccount"));
  await page.waitForSelector(tid("home.screen"), { timeout: 20000 });
}

(async () => {
  const browser = await chromium.launch();
  const shots = [];
  for (const [state, run] of Object.entries(STATES)) {
    for (const [size, vp] of Object.entries(SIZES)) {
      for (const scheme of ["light", "dark"]) {
        const ctx = await browser.newContext({ viewport: vp, colorScheme: scheme, deviceScaleFactor: 1 });
        const page = await ctx.newPage();
        const file = `${state}-${size}-${vp.width}-${scheme}.png`;
        try {
          await run(page);
          await page.screenshot({ path: path.join(OUT, file), fullPage: size === "mobile" });
          shots.push(file);
          console.log("ok  ", file);
        } catch (e) {
          console.log("FAIL", file, String(e.message).split("\n")[0]);
        }
        await ctx.close();
      }
    }
  }
  await sw({});
  await browser.close();
  fs.writeFileSync(path.join(OUT, "index.json"), JSON.stringify(shots, null, 2));
})();
