#!/usr/bin/env node
// Stage-A local network: an anvil chain configured like Perpl's dex-sdk test kit (`perpl_sdk::testing`),
// running Perpl's real exchange implementation, with Mirror deployed on top.
//
//   cd localnet && npm install && npm run fetch && npm start
//
// Follows TestExchange::deploy from the kit: same anvil settings (0.4 s blocks, 128 KiB code size, 200M gas
// limit, 100 gwei base fee, FIFO ordering), exchange implementation behind an ERC-1967 proxy initialised with
// the collateral token, whitelisting off, an administrator and a price administrator, markets added with the
// oracle ignored and marks set by the price administrator. One deliberate difference: the collateral is an
// AUSD-like token with ERC-2612 permit and ERC-3009 (Mirror's gasless deposits need them; the kit's TestToken
// has neither). Market ids and decimals match Perpl mainnet (BTC 1, ETH 20).
//
// While running it keeps marks fresh (Perpl rejects stale marks), keeps two market makers quoting around the
// mark so IOC copies can fill, and serves a small faucet. Everything uses anvil's public test keys; nothing
// here touches a real network. Writes out/env.json for the engine, indexer, app and tests.

import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  encodeFunctionData,
  getAddress,
  http,
  parseEther,
} from "viem";
import { mnemonicToAccount } from "viem/accounts";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const PORT = Number(process.env.LOCALNET_PORT ?? 8546);
const FAUCET_PORT = Number(process.env.LOCALNET_FAUCET_PORT ?? 8547);
const CHAIN_ID = 1337; // the kit's chain id
const RPC = `http://127.0.0.1:${PORT}`;
const MNEMONIC = "test test test test test test test test test test test junk"; // anvil default, test only

const ROLES = ["owner", "admin", "priceAdmin", "mmBid", "mmAsk", "demoLeader", "ops", "demoFollowerOwner", "testUserOwner"];
const acct = Object.fromEntries(ROLES.map((r, i) => [r, mnemonicToAccount(MNEMONIC, { addressIndex: i })]));
const keyOf = (r) => `0x${Buffer.from(acct[r].getHdKey().privateKey).toString("hex")}`;

const MARKETS = [
  { perpId: 1, symbol: "BTC", priceDecimals: 1, lotDecimals: 5, base: 5000, mark: 85500, tick: 0.0005, lots: 200 },
  { perpId: 20, symbol: "ETH", priceDecimals: 2, lotDecimals: 3, base: 1, mark: 2700, tick: 0.0005, lots: 2000 },
];

const art = (p) => JSON.parse(readFileSync(p, "utf8"));
const vendor = (n) => {
  const p = join(HERE, "vendor", "perpl", n);
  if (!existsSync(p)) throw new Error(`missing ${p}; run npm run fetch`);
  return art(p);
};
const mirrorArt = (name, file = name) => {
  const p = join(ROOT, "contracts", "out", `${file}.sol`, `${name}.json`);
  if (!existsSync(p)) throw new Error(`missing ${p}; run forge build in contracts/`);
  return art(p);
};
const Exchange = vendor("Exchange.json");
const Proxy = vendor("ERC1967Proxy.json");
const Token = mirrorArt("MockAUSD");

// ---- anvil -------------------------------------------------------------------------------------------

const anvil = spawn(
  "anvil",
  [
    "--port", String(PORT),
    "--chain-id", String(CHAIN_ID),
    "--block-time", "0.4",
    "--code-size-limit", "131072",
    "--gas-limit", "200000000",
    "--base-fee", "100000000000",
    "--order", "fifo",
    "--accounts", "12",
    "--silent",
  ],
  { stdio: ["ignore", "inherit", "inherit"] },
);
const stop = () => {
  anvil.kill("SIGTERM");
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
anvil.on("exit", (code) => {
  console.error(`anvil exited (${code})`);
  process.exit(1);
});

const chain = defineChain({
  id: CHAIN_ID,
  name: "mirror-localnet",
  nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
});
const pub = createPublicClient({ chain, transport: http(RPC), pollingInterval: 100 });
const wallet = (role) => createWalletClient({ chain, account: acct[role], transport: http(RPC) });

for (let i = 0; ; i++) {
  try {
    await pub.getBlockNumber();
    break;
  } catch {
    if (i > 100) throw new Error("anvil did not start");
    await new Promise((r) => setTimeout(r, 100));
  }
}

async function send(role, to, abi, functionName, args = []) {
  const hash = await wallet(role).writeContract({ address: to, abi, functionName, args });
  const r = await pub.waitForTransactionReceipt({ hash });
  if (r.status !== "success") throw new Error(`${functionName} reverted: ${hash}`);
  return r;
}
async function deploy(role, abi, bytecode, args = []) {
  const hash = await wallet(role).deployContract({ abi, bytecode, args });
  const r = await pub.waitForTransactionReceipt({ hash });
  if (r.status !== "success" || !r.contractAddress) throw new Error(`deploy failed: ${hash}`);
  return getAddress(r.contractAddress);
}

// ---- Perpl exchange, as the kit deploys it -----------------------------------------------------------

const token = await deploy("owner", Token.abi, Token.bytecode.object);
const impl = await deploy("owner", Exchange.abi, Exchange.bytecode.object);
const init = encodeFunctionData({ abi: Exchange.abi, functionName: "initialize", args: [token] });
const exchange = await deploy("owner", Proxy.abi, Proxy.bytecode.object, [impl, init]);
const X = Exchange.abi;
await send("owner", exchange, X, "setWhitelistingEnabled", [false]);
await send("owner", exchange, X, "setAdministrator", [acct.admin.address, true]);
await send("owner", exchange, X, "setPriceAdministrator", [acct.priceAdmin.address, true]);
// Perpl mainnet: 10 AUSD minimum account opening; taker 0.035%, maker 0 (fee schedule in ppm).
await send("owner", exchange, X, "setMinAccountOpenAmount", [10_000_000n]);
await send("owner", exchange, X, "setDefaultPerpFeeSchedValues", [Array(8).fill(350n), Array(8).fill(0n)]);

const pns = (m, price) => BigInt(Math.round(price * 10 ** m.priceDecimals));
for (const m of MARKETS) {
  await send("owner", exchange, X, "addContract", [m.symbol, m.symbol, BigInt(m.perpId), pns(m, m.base), BigInt(m.priceDecimals), BigInt(m.lotDecimals), 1000n, 2000n]);
  await send("owner", exchange, X, "setIgnOracle", [BigInt(m.perpId), true]);
  await send("priceAdmin", exchange, X, "updateMarkPricePNS", [BigInt(m.perpId), Number(pns(m, m.mark))]);
  await send("owner", exchange, X, "setContractPaused", [BigInt(m.perpId), false]);
}

// ---- funded Perpl accounts ---------------------------------------------------------------------------

const T = Token.abi;
async function openPerplAccount(role, ausd) {
  const amount = BigInt(ausd) * 1_000_000n;
  await send("owner", token, T, "mint", [acct[role].address, amount]);
  await send(role, token, T, "approve", [exchange, amount]);
  const r = await send(role, exchange, X, "createAccount", [amount]);
  const info = await pub.readContract({ address: exchange, abi: X, functionName: "getAccountByAddr", args: [acct[role].address] });
  return Number(info.accountId);
}
const ids = {
  mmBid: await openPerplAccount("mmBid", 5_000_000),
  mmAsk: await openPerplAccount("mmAsk", 5_000_000),
  demoLeader: await openPerplAccount("demoLeader", 1_000),
};
// Owner wallets of the demo follower and test user hold AUSD (they deposit into their MirrorAccounts by permit).
for (const r of ["demoFollowerOwner", "testUserOwner"]) await send("owner", token, T, "mint", [acct[r].address, 200_000_000n]);

// ---- Mirror (same deployer and gas rule as testnet/mainnet: estimates from the chain itself) ----------

await new Promise((resolve, reject) => {
  const p = spawn(
    "node",
    [join(ROOT, "scripts", "deploy-contracts.mjs"), "--network", "local", "--rpc", RPC, "--exchange", exchange, "--collateral", token, "--cap", "200", "--keepers", acct.ops.address, "--send", "--expect-nonce", "0"],
    { stdio: ["ignore", "inherit", "inherit"], env: { ...process.env, OPS_PRIVATE_KEY: keyOf("ops") } },
  );
  p.on("exit", (c) => (c === 0 ? resolve() : reject(new Error(`deploy-contracts exited ${c}`))));
});
const deployment = art(join(ROOT, "contracts", "deployments", `local-${CHAIN_ID}.json`));

// ---- env ---------------------------------------------------------------------------------------------

const env = {
  network: "localnet",
  chainId: CHAIN_ID,
  rpcUrl: RPC,
  wsUrl: `ws://127.0.0.1:${PORT}`,
  faucetUrl: `http://127.0.0.1:${FAUCET_PORT}`,
  perplExchange: exchange,
  perplImplementation: impl,
  perplSource: "PerplFoundation/dex-sdk@01b9910 (MIT), deployed as in perpl_sdk::testing::TestExchange",
  collateral: token,
  minAccountOpenCNS: "10000000",
  mirror: {
    factory: deployment.factory,
    keeperRegistry: deployment.keeperRegistry,
    implementation: deployment.implementation,
    deployBlock: deployment.block,
    depositCap: deployment.depositCap,
  },
  teamRun: { demoLeaderAddress: acct.demoLeader.address, demoLeaderAccountId: ids.demoLeader },
  perplAccounts: ids,
  addresses: Object.fromEntries(ROLES.map((r) => [r, acct[r].address])),
  // anvil's public test keys: never use them anywhere but this local chain
  testKeys: Object.fromEntries(ROLES.map((r) => [r, keyOf(r)])),
  markets: MARKETS.map(({ perpId, symbol, lotDecimals, priceDecimals }) => ({ perpId, symbol, lotDecimals, priceDecimals })),
};
mkdirSync(join(HERE, "out"), { recursive: true });
writeFileSync(join(HERE, "out", "env.json"), JSON.stringify(env, null, 2) + "\n");
console.log(`\nlocalnet ready: ${RPC} (chain ${CHAIN_ID})`);
console.log(`  perpl exchange ${exchange}  collateral ${token}`);
console.log(`  mirror factory ${deployment.factory}  keeper/relayer ${acct.ops.address}`);
console.log(`  demo leader Perpl account ${ids.demoLeader}  faucet ${env.faucetUrl}`);
console.log(`  env written to localnet/out/env.json`);

// ---- marks and market makers ---------------------------------------------------------------------------

let orderId = 1n;
const marks = Object.fromEntries(MARKETS.map((m) => [m.perpId, m.mark]));
async function quote(m) {
  const block = await pub.getBlockNumber();
  const mark = marks[m.perpId];
  for (const [role, type, sign] of [["mmBid", 0, -1], ["mmAsk", 1, 1]]) {
    for (const level of [1, 2, 4]) {
      const price = pns(m, mark * (1 + sign * m.tick * level));
      try {
        await send(role, exchange, X, "execOrder", [{
          orderDescId: orderId++, perpId: BigInt(m.perpId), orderType: type, orderId: 0n, pricePNS: price,
          lotLNS: BigInt(m.lots * level), expiryBlock: block + 100n, postOnly: true, fillOrKill: false,
          immediateOrCancel: false, maxMatches: 0n, leverageHdths: 1000n, lastExecutionBlock: 0n, amountCNS: 0n,
          maxNegPnlCollatBPS: 1000n,
        }]);
      } catch (err) {
        console.error(`quote ${m.symbol} ${role} L${level}: ${String(err.shortMessage ?? err.message).slice(0, 120)}`);
      }
    }
  }
}
async function tick() {
  for (const m of MARKETS) {
    if (!process.env.LOCALNET_FREEZE_MARKS) marks[m.perpId] *= 1 + (Math.random() - 0.5) * 0.001;
    try {
      await send("priceAdmin", exchange, X, "updateMarkPricePNS", [BigInt(m.perpId), Number(pns(m, marks[m.perpId]))]);
    } catch (err) {
      console.error(`mark ${m.symbol}: ${String(err.shortMessage ?? err.message).slice(0, 120)}`);
    }
  }
}
let n = 0;
for (const m of MARKETS) await quote(m);
setInterval(async () => {
  await tick();
  if (++n % 5 === 0) for (const m of MARKETS) await quote(m);
}, 4000);

// ---- faucet and test controls ----------------------------------------------------------------------------

createServer(async (req, res) => {
  const reply = (code, body) => {
    res.writeHead(code, { "content-type": "application/json", "access-control-allow-origin": "*" });
    res.end(JSON.stringify(body));
  };
  try {
    if (req.method === "GET" && req.url === "/env") return reply(200, env);
    let body = "";
    for await (const c of req) body += c;
    const j = body ? JSON.parse(body) : {};
    if (req.method === "POST" && req.url === "/fund") {
      const to = getAddress(j.address);
      const ausd = BigInt(Math.round(Number(j.ausd ?? 200) * 1e6));
      await send("owner", token, T, "mint", [to, ausd]);
      const h = await wallet("owner").sendTransaction({ to, value: parseEther(String(j.mon ?? 10)) });
      await pub.waitForTransactionReceipt({ hash: h });
      return reply(200, { address: to, ausd: Number(ausd) / 1e6, mon: j.mon ?? 10 });
    }
    if (req.method === "POST" && req.url === "/mark") {
      // Test control: move a market's mark (e.g. to trip a stop) and freeze it until the next call.
      const m = MARKETS.find((x) => x.perpId === Number(j.perpId));
      if (!m) return reply(400, { error: "unknown perpId" });
      marks[m.perpId] = Number(j.price);
      await send("priceAdmin", exchange, X, "updateMarkPricePNS", [BigInt(m.perpId), Number(pns(m, marks[m.perpId]))]);
      await quote(m);
      return reply(200, { perpId: m.perpId, mark: marks[m.perpId] });
    }
    return reply(404, { error: "not found" });
  } catch (err) {
    return reply(500, { error: String(err.shortMessage ?? err.message) });
  }
}).listen(FAUCET_PORT, "127.0.0.1");
