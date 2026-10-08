#!/usr/bin/env node
// Post-deploy check against the PUBLIC URL, run after every deploy (scripts/deploy.sh, and the GitHub workflow
// .github/workflows/postdeploy.yml). Local checks alone once let a blank web app ship, so this loads the live
// pages the way a first-time visitor does:
//
//   - desktop Chrome (real Google Chrome via Playwright), 1440x900
//   - Chrome at phone width (390x844, touch, iPhone user agent)
//   - desktop Safari (real Safari via safaridriver; needs Develop > "Allow Remote Automation")
//   - Safari at phone width (window sized to 390 CSS px wide)
//
// Every run uses a clean profile with the cache disabled (Chrome: new context, CDP cache off, service workers
// blocked; Safari: automation sessions start with empty, isolated storage and cache). A page fails on any
// console error, uncaught exception, or failed request (network error or HTTP >= 400) from our own origin(s),
// and if it renders blank. Safari's automation exposes no console or network, so the pages carry a tiny inline
// recorder (lib/diag-snippet.mjs) and every same-origin resource the page loaded is re-requested uncached.
//
//   node scripts/postdeploy-check.mjs --url https://mirror.0xo.in [--own https://api.example] [--only chrome]
//
// Exit code 0 only if every page passes in every browser. Evidence (screenshots, report.json) goes to --out.
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
const arg = (k, d) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 ? args[i + 1] : d;
};
const all = (k) => args.flatMap((a, i) => (a === `--${k}` ? [args[i + 1]] : []));
const BASE = (arg("url", process.env.POSTDEPLOY_URL ?? "https://mirror.0xo.in")).replace(/\/$/, "");
const OWN = [new URL(BASE).origin, ...all("own").map((u) => new URL(u).origin)];
const ONLY = arg("only", "");
// --down <origin>: a backend known to be down (the engine before its first deploy). Console errors and failed
// requests naming that origin are listed as expected, not failures; everything else is still checked.
const DOWN = all("down").map((u) => new URL(u).origin);
const isDown = (text) => DOWN.some((o) => String(text).includes(o));
const OUT = arg("out", join(process.cwd(), "postdeploy-evidence", new Date().toISOString().replace(/[:.]/g, "-")));
const DEFAULT_PAGES = ["/", "/docs", "/docs/fees", "/stats", "/perpl", "/download", "/c/leader/1000", "/app", "/app/welcome"];
const PAGES = all("page").length ? all("page") : DEFAULT_PAGES;
const SETTLE_MS = Number(arg("settle", 4000));
const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1";

mkdirSync(OUT, { recursive: true });
const results = [];
const isOwn = (u) => {
  try {
    return OWN.includes(new URL(u, BASE).origin);
  } catch {
    return false;
  }
};
const slug = (s) => s.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "root";

// In-page: what rendered, what the recorder saw, and the status of every same-origin resource (refetched uncached).
const COLLECT = `
  const done = arguments[arguments.length - 1];
  (async () => {
    const own = ${JSON.stringify(OWN)};
    const d = window.__mirrorDiag || null;
    const text = (document.body && document.body.innerText || "").trim();
    const urls = [...new Set(performance.getEntriesByType("resource").map((e) => e.name).concat([location.href]))]
      .filter((u) => { try { return own.includes(new URL(u).origin); } catch { return false; } });
    const statuses = [];
    for (const u of urls) {
      try { const r = await fetch(u, { cache: "no-store", credentials: "same-origin" }); statuses.push({ url: u, status: r.status }); }
      catch (e) { statuses.push({ url: u, status: 0, error: String(e) }); }
    }
    done({ recorder: !!d, errors: d ? d.errors : [], failed: d ? d.failed : [], textLength: text.length,
      textStart: text.slice(0, 80), width: innerWidth, statuses, title: document.title });
  })();`;

function verdict(name, page, r) {
  const problems = [];
  const expected = [];
  if (!r.loaded) problems.push(`did not load: ${r.loadError}`);
  if (r.textLength !== undefined && r.textLength < 20) problems.push(`renders blank (${r.textLength} chars of text)`);
  for (const e of r.consoleErrors ?? []) (isDown(e) ? expected : problems).push(`console error: ${e}`);
  for (const e of r.pageErrors ?? []) problems.push(`uncaught: ${e}`);
  for (const f of r.failedRequests ?? []) if (isDown(f.url)) expected.push(`failed request (backend down): ${f.url}`); else if (isOwn(f.url) || f.kind === "font") problems.push(`failed request: ${f.status ?? ""} ${f.kind ?? ""} ${f.url}${f.error ? ` (${f.error})` : ""}`.replace(/\s+/g, " "));
  for (const s of r.statuses ?? []) if (s.status === 0 || s.status >= 400) problems.push(`own resource ${s.status}: ${s.url}`);
  if (r.recorder === false) problems.push("error recorder missing from the page (deploy predates it?)");
  if (r.width !== undefined && r.expectWidth && Math.abs(r.width - r.expectWidth) > 40) problems.push(`viewport ${r.width}px, expected ~${r.expectWidth}px`);
  const res = { browser: name, page, ok: problems.length === 0, problems: [...new Set(problems)], expectedWhileDown: [...new Set(expected)], screenshot: r.screenshot, textStart: r.textStart };
  results.push(res);
  console.log(`${res.ok ? "PASS" : "FAIL"}  ${name.padEnd(15)} ${page}${res.ok ? "" : "\n      " + res.problems.join("\n      ")}`);
}

// ---- Chrome (Playwright, real Google Chrome) ---------------------------------------------------------------

async function chromeRun(label, contextOpts, expectWidth) {
  const { chromium } = await import("playwright");
  let browser;
  try {
    browser = await chromium.launch({ channel: "chrome", headless: true });
  } catch (e) {
    for (const p of PAGES) verdict(label, p, { loaded: false, loadError: `Chrome not available: ${String(e.message).split("\n")[0]}` });
    return;
  }
  try {
    for (const p of PAGES) {
      const context = await browser.newContext({ ...contextOpts, serviceWorkers: "block", bypassCSP: false });
      const page = await context.newPage();
      const cdp = await context.newCDPSession(page);
      await cdp.send("Network.enable");
      await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
      const consoleErrors = [];
      const pageErrors = [];
      const failedRequests = [];
      page.on("console", (m) => m.type() === "error" && consoleErrors.push(`${m.text().slice(0, 300)}${m.location()?.url ? ` @ ${m.location().url}` : ""}`));
      page.on("pageerror", (e) => pageErrors.push(String(e.message).slice(0, 300)));
      page.on("requestfailed", (r) => failedRequests.push({ url: r.url(), kind: r.resourceType(), error: r.failure()?.errorText }));
      page.on("response", (r) => r.status() >= 400 && failedRequests.push({ url: r.url(), status: r.status(), kind: r.request().resourceType() }));
      const r = { consoleErrors, pageErrors, failedRequests, expectWidth };
      try {
        await page.goto(BASE + p, { waitUntil: "load", timeout: 45_000 });
        r.loaded = true;
        await page.waitForTimeout(SETTLE_MS);
        Object.assign(r, await page.evaluate(`new Promise((resolve) => { const arguments = [resolve]; ${COLLECT} })`));
        // Playwright already saw every request; the in-page refetch is only needed for Safari.
        delete r.statuses;
        delete r.recorder;
        r.screenshot = `${slug(label)}-${slug(p)}.png`;
        await page.screenshot({ path: join(OUT, r.screenshot), fullPage: false });
      } catch (e) {
        r.loaded = r.loaded ?? false;
        r.loadError = String(e.message).split("\n")[0];
      }
      verdict(label, p, r);
      await context.close();
    }
  } finally {
    await browser.close();
  }
}

// ---- Safari (safaridriver, W3C WebDriver over HTTP) ---------------------------------------------------------

async function safariRun() {
  const port = 4444 + Math.floor(Math.random() * 1000);
  const drv = spawn("/usr/bin/safaridriver", ["--port", String(port)], { stdio: "ignore" });
  const W = `http://127.0.0.1:${port}`;
  const call = async (method, path, body) => {
    const res = await fetch(W + path, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`${path}: ${j.value?.error ?? res.status} ${j.value?.message ?? ""}`.trim());
    return j.value;
  };
  try {
    let up = false;
    for (let i = 0; i < 50 && !up; i++) {
      await new Promise((r) => setTimeout(r, 200));
      up = await fetch(W + "/status").then((r) => r.ok, () => false);
    }
    if (!up) throw new Error("safaridriver did not start");
    for (const [label, width, height] of [["Safari desktop", 1440, 900], ["Safari phone", 390, 844]]) {
      for (const p of PAGES) {
        // A new session per page: clean, isolated storage and cache every time.
        let sid;
        const r = { expectWidth: width };
        try {
          sid = (await call("POST", "/session", { capabilities: { alwaysMatch: { browserName: "safari" } } })).sessionId;
          await call("POST", `/session/${sid}/timeouts`, { pageLoad: 45_000, script: 60_000 });
          await call("POST", `/session/${sid}/window/rect`, { x: 0, y: 0, width, height });
          // Correct for window chrome so the page itself is `width` CSS px wide (or as close as Safari allows).
          const inner = await call("POST", `/session/${sid}/execute/sync`, { script: "return innerWidth", args: [] });
          if (inner !== width) await call("POST", `/session/${sid}/window/rect`, { width: width + (width - inner), height });
          await call("POST", `/session/${sid}/url`, { url: BASE + p });
          r.loaded = true;
          await new Promise((res) => setTimeout(res, SETTLE_MS));
          Object.assign(r, await call("POST", `/session/${sid}/execute/async`, { script: COLLECT, args: [] }));
          r.failedRequests = r.failed;
          r.consoleErrors = r.errors;
          const png = await call("GET", `/session/${sid}/screenshot`);
          r.screenshot = `${slug(label)}-${slug(p)}.png`;
          writeFileSync(join(OUT, r.screenshot), Buffer.from(png, "base64"));
        } catch (e) {
          r.loaded = r.loaded ?? false;
          r.loadError = String(e.message).split("\n")[0];
        } finally {
          if (sid) await call("DELETE", `/session/${sid}`).catch(() => {});
        }
        verdict(label, p, r);
      }
    }
  } catch (e) {
    for (const p of PAGES) verdict("Safari", p, { loaded: false, loadError: String(e.message) });
  } finally {
    drv.kill();
  }
}

console.log(`post-deploy check: ${BASE} · own origins ${OWN.join(", ")}${DOWN.length ? ` · known down ${DOWN.join(", ")}` : ""} · ${PAGES.length} pages · evidence ${OUT}`);
if (!ONLY || ONLY === "chrome") {
  await chromeRun("Chrome desktop", { viewport: { width: 1440, height: 900 } }, 1440);
  await chromeRun("Chrome phone", { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: IPHONE_UA }, 390);
}
if (!ONLY || ONLY === "safari") await safariRun();

const failed = results.filter((r) => !r.ok);
writeFileSync(join(OUT, "report.json"), JSON.stringify({ url: BASE, own: OWN, at: new Date().toISOString(), passed: results.length - failed.length, failed: failed.length, results }, null, 2));
console.log(`\n${results.length - failed.length}/${results.length} passed${failed.length ? `, ${failed.length} FAILED` : ""} · ${join(OUT, "report.json")}`);
process.exit(failed.length ? 1 : 0);
