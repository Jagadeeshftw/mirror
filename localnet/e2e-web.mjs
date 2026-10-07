#!/usr/bin/env node
// Stage-A web end-to-end: the Mirror web export (real WebAuthn, rpId localhost) driven by Playwright with a
// Chrome virtual authenticator (PRF), against the engine and Perpl's exchange on the localnet.
//
//   cd localnet && npm start                     (another shell; or: ./run-stage-a.sh --web)
//   node e2e-web.mjs [--no-build]                (engine on 8807, web on 8818, site on 8819, push sink on 8817;
//                                                E2E_ENGINE_PORT / E2E_WEB_PORT / E2E_SITE_PORT / E2E_PUSH_PORT)
//
// Builds the web export (EXPO_BASE_URL=/app, EXPO_PUBLIC_API_BASE=engine, MERA_RP_ID=localhost) into a temp
// dir unless --no-build with E2E_WEB_DIST=<dir>. Evidence: devices/evidence/stage-a/<run>/web/ (a screenshot
// per step, report.json, index.html contact sheet, engine.log, build.log).
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join, normalize } from "node:path";
import { ROOT, apiClient, env, setupDemoFollower, startEngine } from "./e2e-web/chain.mjs";
import { chromium, openDevice, PHONE } from "./e2e-web/browser.mjs";
import { createReport } from "./e2e-web/report.mjs";
import { phoneFlows } from "./e2e-web/flows-watch.mjs";
import { followFlows } from "./e2e-web/flows-follow.mjs";
import { exitFlows } from "./e2e-web/flows-exit.mjs";
import { startSite } from "./e2e-web/share-card.mjs";
import { alertsFlows } from "./e2e-web/flows-alerts.mjs";
import { startPushSink, subscriptionKeys, vapidKeys } from "./e2e-web/push-sink.mjs";

const ENGINE_PORT = Number(process.env.E2E_ENGINE_PORT ?? 8807);
const WEB_PORT = Number(process.env.E2E_WEB_PORT ?? 8818);
// The website (web/, next dev) that renders the share cards; the app's share sheet points at it.
const SITE_PORT = Number(process.env.E2E_SITE_PORT ?? 8819);
// Stand-in push service: the engine's Web Push requests go here (PUSH_WEBPUSH_ENDPOINT_OVERRIDE).
const PUSH_PORT = Number(process.env.E2E_PUSH_PORT ?? 8817);
const API = `http://127.0.0.1:${ENGINE_PORT}`;
const WEB = `http://localhost:${WEB_PORT}/app`;
const RUN = process.env.E2E_RUN ?? new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const OUT = join(ROOT, "devices", "evidence", "stage-a", RUN, "web");
mkdirSync(OUT, { recursive: true });
const R = createReport(OUT, { run: RUN, network: "localnet", web: WEB, engine: API, perpl: env.perplSource, rpId: "localhost", authenticator: "CDP virtual authenticator ctap2/internal/resident/UV/PRF" });

const cleanups = [];
let exiting = false;
async function cleanup() {
  if (exiting) return;
  exiting = true;
  for (const f of cleanups.reverse()) await Promise.resolve().then(f).catch(() => {});
}
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => cleanup().then(() => process.exit(130)));

function run(cmd, args, opts, logFile) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const p = spawn(cmd, args, { ...opts, stdio: ["ignore", "pipe", "pipe"], detached: true });
    cleanups.push(() => { try { process.kill(-p.pid, "SIGKILL"); } catch {} });
    p.stdout.on("data", (d) => chunks.push(d));
    p.stderr.on("data", (d) => chunks.push(d));
    p.on("exit", (code) => { writeFileSync(logFile, Buffer.concat(chunks)); code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}; see ${logFile}`)); });
  });
}

async function buildWeb() {
  if (process.argv.includes("--no-build")) {
    if (!process.env.E2E_WEB_DIST) throw new Error("--no-build needs E2E_WEB_DIST=<exported dir>");
    return process.env.E2E_WEB_DIST;
  }
  const dir = mkdtempSync(join(tmpdir(), "mirror-web-e2e-"));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  const dist = join(dir, "dist");
  console.log(`building the web export into ${dist} (1-3 min)`);
  const buildEnv = { ...process.env, EXPO_BASE_URL: "/app", EXPO_PUBLIC_API_BASE: API, EXPO_PUBLIC_SHARE_BASE: `http://localhost:${SITE_PORT}`, MERA_RP_ID: "localhost", CI: "1" };
  delete buildEnv.EXPO_PUBLIC_DEV_PASSKEY;
  delete buildEnv.EXPO_PUBLIC_MIRROR_DEV_TOOLS;
  await run("npx", ["expo", "export", "-p", "web", "--clear", "--output-dir", dist], { cwd: join(ROOT, "app"), env: buildEnv }, join(OUT, "build.log"));
  return dist;
}

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".ttf": "font/ttf", ".ico": "image/x-icon", ".webmanifest": "application/manifest+json" };
function serve(dist) {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, "http://x");
    if (url.pathname === "/") { res.writeHead(302, { Location: "/app/" }); return res.end(); }
    if (!url.pathname.startsWith("/app")) { res.writeHead(404); return res.end(); }
    let file = join(dist, normalize(decodeURIComponent(url.pathname.slice(4))).replace(/^(\.\.[/\\])+/, ""));
    try { if ((await stat(file)).isDirectory()) file = join(file, "index.html"); } catch { file = join(dist, "index.html"); }
    try {
      const body = await readFile(file);
      res.writeHead(200, { "Content-Type": TYPES[extname(file)] ?? "application/octet-stream", "Cache-Control": "no-cache" });
      res.end(body);
    } catch { res.writeHead(404); res.end(); }
  });
  return new Promise((resolve, reject) => server.once("error", reject).listen(WEB_PORT, "127.0.0.1", () => resolve(server)));
}

// One engine handle the flows can stop and restart (the "Can't reach Mirror" check).
const VAPID = vapidKeys();
const PUSH_ENV = { VAPID_PUBLIC_KEY: VAPID.publicKey, VAPID_PRIVATE_KEY: VAPID.privateKey, VAPID_SUBJECT: "https://mirror.0xo.in", PUSH_WEBPUSH_ENDPOINT_OVERRIDE: `http://127.0.0.1:${PUSH_PORT}/push` };
const engineCtl = {
  handle: null,
  dbPath: join(OUT, "engine.db"),
  async start() {
    this.handle = await startEngine({ port: ENGINE_PORT, dbPath: this.dbPath, logFile: join(OUT, `engine-${Date.now()}.log`), extraEnv: PUSH_ENV });
  },
  async stop() { if (this.handle) await this.handle.stop(); this.handle = null; },
};
cleanups.push(() => engineCtl.stop());

let browser;
try {
  const dist = await buildWeb();
  const server = await serve(dist);
  cleanups.push(() => new Promise((r) => server.close(r)));
  const sink = await startPushSink({ port: PUSH_PORT });
  cleanups.push(() => sink.stop());
  const sub = subscriptionKeys();
  const push = { sink, sub: { endpoint: `https://fcm.googleapis.com/fcm/send/mirror-e2e-${RUN}`, keys: sub.keys } };
  sink.subs.set(push.sub.endpoint, sub);
  await engineCtl.start();
  const api = apiClient(API);
  const site = await startSite({ port: SITE_PORT, api: API, logFile: join(OUT, "site.log") }).catch((e) => { console.log(`website did not start: ${e.message}`); return null; });
  if (site) cleanups.push(() => site.stop());
  await R.check("engine up on the localnet (NETWORK=localnet, PUBLIC_RPC_URL, CORS *)", null, async () => {
    const h = await api("GET", "/v1/health");
    const cfg = await api("GET", "/v1/config");
    return { ok: h.chainId === env.chainId && cfg.rpc === env.rpcUrl, chainId: h.chainId, rpc: cfg.rpc };
  });
  await R.check("team-run demo follower set up through the relay API (as e2e-api)", null, async () => setupDemoFollower(api));

  // Full Chromium in new headless mode: the old headless shell reports Notification.permission "denied" even after
  // the permission is granted, so the alerts opt-in could not be tested there.
  browser = await chromium.launch({ headless: process.env.HEADED !== "1", channel: process.env.E2E_CHROMIUM_CHANNEL ?? "chromium" });
  cleanups.push(() => browser.close());
  // Service workers on: the web app's sw.js receives the encrypted alerts.
  const dev = await openDevice(browser, PHONE, { serviceWorkers: "allow" });
  R.pageErrors = () => dev.consoleLog.filter((l) => l.startsWith("pageerror"));
  const ctx = { R, api, WEB, API, env, engineCtl, browser, dev, page: dev.page, state: R.state, site, push };
  const only = process.env.E2E_FLOWS ? process.env.E2E_FLOWS.split(",") : null;
  for (const flows of [phoneFlows, followFlows, alertsFlows, exitFlows]) {
    if (only && !only.includes(flows.name)) continue;
    try { await flows(ctx); } catch (e) { if (e.bail) break; await R.check(`${flows.name} completed`, dev.page, async () => { throw e; }); }
  }
  writeFileSync(join(OUT, "browser-console.log"), dev.consoleLog.join("\n"));
} catch (e) {
  await R.check("run completed", null, async () => { throw e; });
} finally {
  await cleanup();
  const rep = R.finish();
  console.log(`\n${rep.passed} passed, ${rep.failed} failed. Evidence: ${OUT}/index.html`);
  process.exit(rep.failed ? 1 : 0);
}
