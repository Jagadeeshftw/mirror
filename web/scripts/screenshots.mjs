// Full-page screenshots of every page at desktop 1440 and mobile 390, light and dark.
// Usage: node scripts/screenshots.mjs [baseUrl]   (needs `npx playwright install chromium` once)
import { chromium } from "playwright";
import { readdirSync, mkdirSync } from "node:fs";

const base = process.argv[2] ?? "https://mirror-mu-six.vercel.app";
const docs = readdirSync(new URL("../content/docs/", import.meta.url))
  .filter((f) => f.endsWith(".md"))
  .map((f) => (f === "index.md" ? "/docs" : `/docs/${f.replace(/\.md$/, "")}`));
const pages = ["/", ...docs, "/stats", "/download"];
const sizes = { desktop: { width: 1440, height: 900 }, mobile: { width: 390, height: 844 } };
mkdirSync(new URL("../screenshots/", import.meta.url), { recursive: true });

const browser = await chromium.launch();
for (const [device, viewport] of Object.entries(sizes)) {
  for (const theme of ["light", "dark"]) {
    const ctx = await browser.newContext({ viewport, colorScheme: theme, deviceScaleFactor: device === "mobile" ? 2 : 1, reducedMotion: "reduce" });
    await ctx.addInitScript((t) => localStorage.setItem("theme", t), theme);
    const page = await ctx.newPage();
    for (const p of pages) {
      await page.goto(base + p, { waitUntil: "networkidle" });
      await page.waitForTimeout(600);
      const name = p === "/" ? "landing" : p.slice(1).replace(/\//g, "-");
      await page.screenshot({ path: new URL(`../screenshots/${name}-${device}-${theme}.png`, import.meta.url).pathname, fullPage: true });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
      if (overflow) console.log("horizontal overflow:", name, device, theme);
    }
    await ctx.close();
  }
}
await browser.close();
console.log("done", pages.length * 4, "screenshots");
