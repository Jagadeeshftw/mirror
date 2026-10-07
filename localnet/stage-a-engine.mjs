#!/usr/bin/env node
// Engine for the Android Stage-A run: the localnet engine on E2E_ENGINE_PORT (default 8828) with
// PUBLIC_RPC_URL=http://10.0.2.2:8546 (the localnet RPC as the emulator sees it), then the team-run demo
// follower. Runs until SIGTERM/SIGINT.   node stage-a-engine.mjs <evidence-dir>
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { apiClient, setupDemoFollower, startEngine } from "./e2e-web/chain.mjs";

const PORT = Number(process.env.E2E_ENGINE_PORT ?? 8828);
const dir = process.argv[2] ?? ".";
mkdirSync(dir, { recursive: true });
const eng = await startEngine({ port: PORT, dbPath: join(dir, "engine.db"), logFile: join(dir, "engine.log"), publicRpcUrl: process.env.PUBLIC_RPC_URL ?? "http://10.0.2.2:8546" });
const flush = setInterval(() => eng.flush(), 5000);
const stop = async () => { clearInterval(flush); await eng.stop(); process.exit(0); };
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
const api = apiClient(`http://127.0.0.1:${PORT}`);
console.log(`engine up on ${PORT}; config ${JSON.stringify(await api("GET", "/v1/config").then((c) => ({ rpc: c.rpc, chainId: c.chainId })))}`);
try {
  console.log(`demo follower ${JSON.stringify(await setupDemoFollower(api))}`);
  console.log("stage-a engine ready");
} catch (e) {
  console.log(`demo follower setup failed: ${e.message}`);
  await stop();
}
setInterval(() => {}, 1 << 30);
