#!/usr/bin/env node
// Engine for the Android Stage-A run: the localnet engine on E2E_ENGINE_PORT (default 8828) with
// PUBLIC_RPC_URL=http://10.0.2.2:8546 (the localnet RPC as the emulator sees it), then the team-run demo
// follower. Runs until SIGTERM/SIGINT.   node stage-a-engine.mjs <evidence-dir>
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { apiClient, setupDemoFollower, startEngine } from "./e2e-web/chain.mjs";
import { startSite } from "./e2e-web/share-card.mjs";

const PORT = Number(process.env.E2E_ENGINE_PORT ?? 8828);
const dir = process.argv[2] ?? ".";
mkdirSync(dir, { recursive: true });
const eng = await startEngine({ port: PORT, dbPath: join(dir, "engine.db"), logFile: join(dir, "engine.log"), publicRpcUrl: process.env.PUBLIC_RPC_URL ?? "http://10.0.2.2:8546" });
const flush = setInterval(() => eng.flush(), 5000);
// The website (web/, next dev) renders share cards and the friend page /p/<id>; the APK's share base points here.
const SITE_PORT = Number(process.env.STAGEA_SITE_PORT ?? 8819);
let site = null;
const stop = async () => { clearInterval(flush); site?.stop(); await eng.stop(); process.exit(0); };
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
const api = apiClient(`http://127.0.0.1:${PORT}`);
console.log(`engine up on ${PORT}; config ${JSON.stringify(await api("GET", "/v1/config").then((c) => ({ rpc: c.rpc, chainId: c.chainId })))}; push ${JSON.stringify(await api("GET", "/v1/push/config").then((c) => ({ fcm: c.fcm, sse: c.sse })))}`);
if (process.env.STAGEA_SITE !== "0") {
  site = await startSite({ port: SITE_PORT, api: `http://127.0.0.1:${PORT}`, logFile: join(dir, "site.log") }).catch((e) => { console.log(`website did not start: ${e.message}`); return null; });
  if (site) console.log(`website up on ${site.url}`);
}
try {
  console.log(`demo follower ${JSON.stringify(await setupDemoFollower(api))}`);
  console.log("stage-a engine ready");
} catch (e) {
  console.log(`demo follower setup failed: ${e.message}`);
  await stop();
}
setInterval(() => {}, 1 << 30);
