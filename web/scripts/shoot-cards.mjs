// Share card screenshots: every card image (both themes, its design size plus the other size) and the share
// landing pages at 390 and 1440 in both themes, into screenshots/cards/.
//   node scripts/shoot-cards.mjs <siteBase> <apiBase>      e.g. http://localhost:3417 http://localhost:8797
// The ids come from the API itself (first leader, the demo follower, a Blocked item, a funded account).
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";

const site = process.argv[2] ?? "http://localhost:3000";
const api = process.argv[3] ?? "http://localhost:8787";
const out = new URL("../screenshots/cards/", import.meta.url);
mkdirSync(out, { recursive: true });
const get = (p) => fetch(api + p).then((r) => r.json());

const leaders = await get("/v1/leaders?window=30d");
const leader = (leaders.leaders ?? leaders)[0].accountId;
const demo = await get("/v1/demo");
const owner = process.env.CARD_OWNER ?? "0x0000000000000000000000000000000000000001";
const acct = (await get(`/v1/owners/${owner}/accounts`)).accounts?.[0]?.address;
const blockedIn = async (a) => ((await get(`/v1/accounts/${a}/feed`)).items ?? []).find((i) => i.kind === "Blocked");
const teamBlocked = await blockedIn(demo.follower.account);
const myBlocked = acct ? await blockedIn(acct) : null;
const sim = `d=4000000&b=4000000&r=1000&l=500&e=100&m=1:4000000,31:4000000&p=30&ls=1500`;

const cards = [
  ["leader", `/c/leader/${leader}`],
  ["follower", acct && `/c/follower/${acct}`],
  ["blocked-team", teamBlocked && `/c/blocked/${teamBlocked.txHash}?a=${demo.follower.account}`],
  ["blocked-mine", myBlocked && `/c/blocked/${myBlocked.txHash}?a=${acct}`],
  ["sim", `/c/sim/${leader}?${sim}`],
  ["unavailable", `/c/leader/999999999`],
].filter(([, p]) => p);

const withQ = (p, q) => (p.includes("?") ? `${p}&${q}` : `${p}?${q}`);
const imageOf = (p) => p.replace(/(\/c\/[^/]+\/[^/?]+)/, "$1/image");
for (const [name, path] of cards) {
  for (const theme of ["light", "dark"]) {
    // The card at its design size, then the other size ("-og" / "-sq").
    const def = /sim|blocked/.test(name) ? "sq" : "og";
    for (const f of ["", def === "og" ? "sq" : "og"]) {
      if (f && name === "unavailable") continue;
      const url = site + withQ(imageOf(path), `t=${theme}${f ? `&f=${f}` : ""}`);
      const res = await fetch(url);
      const buf = Buffer.from(await res.arrayBuffer());
      const file = `card-${name}${f ? `-${f}` : ""}-${theme}.png`;
      writeFileSync(new URL(file, out), buf);
      console.log(res.status, res.headers.get("content-type"), file);
    }
  }
}

const browser = await chromium.launch();
for (const [w, h] of [[390, 844], [1440, 900]]) {
  for (const theme of ["light", "dark"]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: theme, deviceScaleFactor: w === 390 ? 2 : 1 });
    await ctx.addInitScript((t) => localStorage.setItem("theme", t), theme);
    const page = await ctx.newPage();
    for (const [name, path] of cards.filter(([n]) => ["leader", "blocked-team", "sim"].includes(n))) {
      await page.goto(site + path, { waitUntil: "networkidle", timeout: 120_000 });
      await page.waitForTimeout(500);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
      if (overflow) console.log("horizontal overflow:", name, w, theme);
      await page.screenshot({ path: new URL(`page-${name}-${w}-${theme}.png`, out).pathname, fullPage: true });
      console.log("page", name, w, theme);
    }
    await ctx.close();
  }
}
await browser.close();
