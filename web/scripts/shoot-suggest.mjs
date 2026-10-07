// Friend page screenshots (/p/<id>, design proposal-2 #share 07a / 07b): the form filled in, "Suggestion sent",
// revoked and closed, at 390 and 1440 in both themes, into screenshots/suggest/. Runs against the app's dev mock
// (it serves GET /v1/share/:id and POST /suggest like the engine) and `next dev` pointed at it:
//   (app) MOCK_PORT=8791 node dev-mock/server.mjs
//   (web) NEXT_PUBLIC_API_BASE=http://localhost:8791 npx next dev -p 3418
//   node scripts/shoot-suggest.mjs http://localhost:3418 http://localhost:8791
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const site = process.argv[2] ?? "http://localhost:3418";
const mock = process.argv[3] ?? "http://localhost:8791";
const out = new URL("../screenshots/suggest/", import.meta.url);
mkdirSync(out, { recursive: true });
const OWNER = "0x4b21000000000000000000000000000000009e07";
const post = (p, b) => fetch(mock + p, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) }).then((r) => r.json());
const tid = (id) => `[data-testid="${id}"]`;

await post("/__mock/switch", { backend: "ok", rpc: "ok", demoQuiet: true });
await post("/__mock/scenario", { owner: OWNER, scenario: "funded" });
const link = async () => (await post("/__mock/link", { owner: OWNER, perpId: 1 })).urlId;

const browser = await chromium.launch();
const shots = [];
for (const [w, h] of [[390, 844], [1440, 900]]) {
  for (const theme of ["light", "dark"]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: theme, deviceScaleFactor: w === 390 ? 2 : 1 });
    await ctx.addInitScript((t) => localStorage.setItem("theme", t), theme);
    const page = await ctx.newPage();
    const shot = async (name) => {
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
      const file = `friend-${name}-${w}-${theme}.png`;
      await page.screenshot({ path: new URL(file, out).pathname, fullPage: true });
      shots.push({ file, overflow });
      console.log(overflow ? "OVERFLOW" : "ok", file);
    };
    // 07a: form filled in (live % from entry and the AUSD result if hit).
    const id = await link();
    await page.goto(`${site}/p/${id}`, { waitUntil: "networkidle", timeout: 120_000 });
    await page.waitForSelector(tid("share.form"));
    await page.fill(tid("share.sl"), "112,000.0");
    await page.fill(tid("share.tp"), "135,000.0");
    await page.fill(tid("share.note"), "Funding flipped negative this morning. I'd tighten the stop and take profit earlier.");
    await page.waitForTimeout(300);
    await shot("form");
    // A level the contract would refuse (a long's stop above the mark).
    await page.fill(tid("share.sl"), "125,000.0");
    await page.waitForTimeout(200);
    await shot("invalid");
    await page.fill(tid("share.sl"), "112,000.0");
    // 07b: sent.
    await page.click(tid("share.send"));
    await page.waitForSelector(tid("share.sent"));
    await shot("sent");
    // Revoked and closed.
    for (const status of ["revoked", "closed"]) {
      const x = await link();
      await post("/__mock/endlink", { urlId: x, status });
      await page.goto(`${site}/p/${x}`, { waitUntil: "networkidle" });
      await page.waitForSelector(tid("share.ended"));
      await shot(status);
    }
    await page.goto(`${site}/p/${"A".repeat(43)}`, { waitUntil: "networkidle" });
    await shot("not-found");
    await ctx.close();
  }
}
await browser.close();
console.log(JSON.stringify(shots.filter((s) => s.overflow)));
