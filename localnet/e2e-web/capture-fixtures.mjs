#!/usr/bin/env node
// Captures real engine responses on the localnet as app test fixtures (app/__tests__/fixtures/engine/).
// Needs a running localnet (npm start). Starts its own engine on E2E_ENGINE_PORT (default 8807).
//   node e2e-web/capture-fixtures.mjs
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { encodeAbiParameters, keccak256, toHex, zeroHash } from "viem";
import {
  ROOT, acct, apiClient, env, execute, faucet, fnInputs, leaderTrade, permitDeposit, position, pub, setupDemoFollower, sleep, startEngine, waitFor,
} from "./chain.mjs";

const PORT = Number(process.env.E2E_ENGINE_PORT ?? 8807);
const BASE = `http://127.0.0.1:${PORT}`;
const OUT = join(ROOT, "app", "__tests__", "fixtures", "engine");
mkdirSync(OUT, { recursive: true });
const tmp = mkdtempSync(join(tmpdir(), "mirror-capture-"));
const save = (name, v) => { writeFileSync(join(OUT, `${name}.json`), JSON.stringify(v, null, 1) + "\n"); console.log("saved", name); };
const api = apiClient(BASE);

// SSE capture: raw `event:` / `data:` frames as the engine writes them.
function sse(channel, sink) {
  const ctrl = new AbortController();
  (async () => {
    try {
      const res = await fetch(`${BASE}/v1/stream?account=${channel}`, { signal: ctrl.signal });
      const dec = new TextDecoder();
      let buf = "";
      for await (const chunk of res.body) {
        buf += dec.decode(chunk, { stream: true });
        const parts = buf.split("\n\n");
        buf = parts.pop();
        for (const p of parts) {
          const ev = /^event: (.*)$/m.exec(p)?.[1];
          const data = /^data: (.*)$/m.exec(p)?.[1];
          if (ev && data) sink.push({ event: ev, data: JSON.parse(data) });
        }
      }
    } catch {}
  })();
  return () => ctrl.abort();
}

const engine = await startEngine({ port: PORT, dbPath: join(tmp, "engine.db"), logFile: join(tmp, "engine.log") });
try {
  const demo = await setupDemoFollower(api);
  save("config", await api("GET", "/v1/config"));
  save("health", await api("GET", "/v1/health"));
  save("markets", await api("GET", "/v1/markets").catch((e) => ({ error: e.message })));
  const fresh = acct(keccak256(toHex(`fixture-new-user-${Date.now()}`))).address;
  save("owner-accounts-new-user", await api("GET", `/v1/owners/${fresh}/accounts`));
  save("demo-idle", await api("GET", "/v1/demo"));

  const demoFrames = [];
  const stopDemo = sse("demo", demoFrames);
  await sleep(500);
  await api("POST", "/v1/demo/trade");
  await sleep(2500);
  save("demo-running", await api("GET", "/v1/demo"));
  await waitFor("demo done", async () => { const d = await api("GET", "/v1/demo"); return !d.running && d; }, 90_000, 1000);
  await sleep(2000);
  await api("POST", "/v1/demo/blocked");
  await waitFor("blocked done", async () => { const d = await api("GET", "/v1/demo"); return !d.running && d; }, 90_000, 1000);
  await sleep(1500);
  stopDemo();
  save("stream-demo", demoFrames);
  save("demo-after", await api("GET", "/v1/demo"));
  save("feed-demo-follower", await api("GET", `/v1/accounts/${demo.demoAccount}/feed`));
  save("leaders", await api("GET", "/v1/leaders?window=30d&sort=score"));
  save("leader-profile", await api("GET", `/v1/leaders/${env.teamRun.demoLeaderAccountId}?window=30d`));

  // A user following the demo leader: 20 AUSD, sizing 10%, entry filter 1%, BTC only.
  const owner = acct(env.testKeys.testUserOwner);
  const c = await api("POST", "/v1/relay/create", { owner: owner.address, salt: zeroHash });
  const account = c.account;
  await permitDeposit(api, owner, account, 20_000_000n);
  const policy = {
    maxLeverageHdths: 500, maxSlippageBps: 50, dailyLossBps: 1000, drawdownBps: 2000, expiry: Math.floor(Date.now() / 1000) + 90 * 86400,
    maxEntryDeviationBps: 100, stopSlippageBps: 300, flattenOnStop: true, maxBuilderFeePer100K: 20,
    leaders: [{ accountId: env.teamRun.demoLeaderAccountId, ratioBps: 1000, budgetCNS: 20_000_000n, lossStopBps: 0 }],
    markets: [{ perpId: 1, maxNotionalCNS: 20_000_000n }],
  };
  save("quote-follow", await api("POST", "/v1/quote/follow", { owner: owner.address, leaderAccountId: env.teamRun.demoLeaderAccountId, policy: { ...policy, allocationCNS: "20000000" } }).catch((e) => ({ error: e.message })));
  save("backtest", await api("POST", `/v1/leaders/${env.teamRun.demoLeaderAccountId}/backtest`, { ratioBps: 1000, maxLeverageHdths: 500, maxEntryDeviationBps: 100, budgetCNS: "20000000", depositCNS: "20000000", period: 7, markets: [{ perpId: 1, maxNotionalCNS: "20000000" }] }).catch((e) => ({ error: e.message })));
  await execute(api, owner, account, 7, encodeAbiParameters(fnInputs("follow"), [policy, []]));
  await waitFor("indexed", async () => (await api("GET", `/v1/accounts/${account}`)).policy, 30_000);
  const userFrames = [];
  const stopUser = sse(account, userFrames);
  await sleep(500);
  await leaderTrade(env.testKeys.demoLeader, 1, 0, 20);
  await waitFor("copy", async () => (await api("GET", `/v1/accounts/${account}/feed`)).items.find((i) => i.kind === "Mirrored"), 60_000);
  const { mark } = await position(1, 0);
  await faucet("/mark", { perpId: 1, price: (Number(mark) * 1.03) / 10 });
  await sleep(1500);
  await leaderTrade(env.testKeys.demoLeader, 1, 0, 10);
  await waitFor("entry block", async () => (await api("GET", `/v1/accounts/${account}/feed`)).items.find((i) => i.kind === "Blocked"), 60_000);
  await faucet("/mark", { perpId: 1, price: Number(mark) / 10 });
  await sleep(3000);
  stopUser();
  save("stream-user", userFrames);
  save("owner-accounts-following", await api("GET", `/v1/owners/${owner.address}/accounts`));
  save("account-following", await api("GET", `/v1/accounts/${account}`));
  save("feed-user", await api("GET", `/v1/accounts/${account}/feed`));
  save("copy-quality", await api("GET", "/v1/stats/copy-quality?period=all"));
  // Close all and withdraw: the funded-then-empty account shape and its feed items.
  await execute(api, owner, account, 3, encodeAbiParameters([{ type: "uint16" }], [300]));
  const eq = await pub.readContract({ address: account, abi: (await import("./chain.mjs")).MA, functionName: "equity" });
  await execute(api, owner, account, 4, encodeAbiParameters([{ type: "uint256" }], [eq]));
  await sleep(3000);
  save("account-withdrawn", await api("GET", `/v1/accounts/${account}`));
  save("feed-user-withdrawn", await api("GET", `/v1/accounts/${account}/feed`));
} finally {
  await engine.stop();
}
process.exit(0);
