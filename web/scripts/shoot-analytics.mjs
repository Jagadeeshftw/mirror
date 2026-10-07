// Perpl analytics screenshots: /perpl and /perpl/wallet/<id> at 1440 and 390, light and dark, full page,
// into screenshots/analytics/. Usage: SITE=http://localhost:3417 node scripts/shoot-analytics.mjs <walletId> [more ids]
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const site = (process.env.SITE ?? "http://localhost:3000").replace(/\/$/, "");
const wallets = process.argv.slice(2);
const out = new URL("../screenshots/analytics/", import.meta.url);
mkdirSync(out, { recursive: true });

const pages = [["overview", "/perpl"], ...wallets.map((id, i) => [i ? `wallet-${id}` : "wallet", `/perpl/wallet/${id}`])];
const browser = await chromium.launch();
try {
  for (const [w, h] of [
    [1440, 900],
    [390, 844],
  ]) {
    for (const theme of ["light", "dark"]) {
      const ctx = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: theme, deviceScaleFactor: w === 390 ? 2 : 1 });
      await ctx.addInitScript((t) => localStorage.setItem("theme", t), theme);
      const page = await ctx.newPage();
      for (const [name, path] of pages) {
        await page.goto(site + path, { waitUntil: "networkidle", timeout: 120_000 });
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
        if (overflow) console.log("horizontal overflow:", name, w, theme);
        const file = `${name}-${w}-${theme}.png`;
        await page.screenshot({ path: new URL(file, out).pathname, fullPage: true });
        console.log("wrote", file);
      }
      await ctx.close();
    }
  }
} finally {
  await browser.close();
}
