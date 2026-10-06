# Mirror engine

Copy engine, gasless relayer and public API for Mirror, copy trading on [Perpl](https://perpl.xyz) (Monad).
It implements [docs/api.md](../docs/api.md); the design is in [docs/engine.md](../docs/engine.md).

Node 24, TypeScript (strict), Fastify, viem, `node:sqlite`, pino, ws. Standalone package with its own pnpm lockfile.

## Quick start

```bash
cd engine
pnpm install
cp .env.example .env        # fill in keys / addresses as needed
pnpm dev                    # tsx watch, http://localhost:8080
```

With no factory and no keys, the engine runs read-only: `/v1/health`, `/v1/config`, `/v1/markets` (Perpl REST + WS)
and `/v1/leaders` (ranked from Perpl position events) all work against mainnet.

| Command | What it does |
|---|---|
| `pnpm test` | vitest unit tests (planner math vs contract rounding, slippage bounds, nonce manager, x402 signing against a mock 402 server, rate limits, Perpl book, event decoding, push encryption, ranking) |
| `pnpm typecheck` | `tsc --noEmit` over src, scripts and tests |
| `pnpm build` / `pnpm start` | compile to `dist/` and run it |
| `pnpm e2e:fork` | full end-to-end run on a local anvil fork of Monad mainnet (below) |
| `pnpm gen:abi` | regenerate `src/abi/*.ts` from `../shared/abi/*.json` |

## End-to-end test on a mainnet fork

`pnpm e2e:fork` needs `anvil` and `forge` on PATH and free ports 8545 and 8787 (`E2E_API_PORT` changes the second).
Nothing is sent to Monad. It:

1. starts `anvil --fork-url https://rpc.monad.xyz --chain-id 143 --port 8545 --block-time 1`;
2. keeps Perpl's BTC mark fresh on the fork (nobody updates marks there): impersonates the Exchange owner to
   `setIgnOracle(1, true)` and the price admin to re-push the mark every 15 s;
3. deploys with `forge script script/Deploy.s.sol` (keepers = anvil keys 1 and 2). `contracts/deployments/143.json`
   is restored afterwards and broadcast files go to `engine/.e2e/`;
4. funds the demo leader and the follower owner with AUSD by impersonating the Perpl Exchange; the demo leader opens
   its own Perpl account;
5. starts the engine (anvil keys: relayer 3, demo leader 4, team-run follower owner 5);
6. through the API: `POST /v1/relay/create`, `/v1/relay/deposit` (EIP-2612 permit), `/v1/quote/follow`, then
   `/v1/relay/execute` with a signed `ACTION_FOLLOW` (demo leader at 100% plus a live mainnet BTC long, so match now
   fills against the real forked book);
7. `POST /v1/demo/trade` and `POST /v1/demo/blocked`, streaming `/v1/stream?account=demo`;
8. asserts: a Mirrored copy of the open (latency recorded) and of the close, a Blocked event `LeverageTooHigh`
   (limit 300, actual 1000) in its own keeper tx, leader flat, the follower's demo exposure closed, engine
   `targetLots` == contract `targetLots`, `closeAll` through the relayer leaves the follower flat, and `/v1/stats`
   excludes team-run accounts while listing them separately. anvil and the engine are stopped at the end.

Logs: `engine/.e2e/engine.log`, `engine/.e2e/anvil.log`.

## Deploy on Railway (EU region)

Perpl's API geo-blocks the US and UK, so the service must run in an EU region (e.g. `europe-west4`, Amsterdam).
Select the region in the service settings; it is not set in `railway.json`.

1. New service from this repo. Root directory: repository root (the image needs `shared/`). Config-as-code path:
   `engine/railway.json` (builds `engine/Dockerfile`, health check `/v1/health`).
2. Add a volume mounted at `/data` (SQLite at `/data/engine.db`).
3. Keep **one replica**: nonces, rate limits and the demo lock are in process memory.
4. Set variables (see `.env.example`). Minimum for the full product:

| Variable | Notes |
|---|---|
| `FACTORY_ADDRESS`, `KEEPER_REGISTRY_ADDRESS`, `MIRROR_DEPLOY_BLOCK` | from the mainnet deploy (`contracts/deployments/143.json`) |
| `KEEPER_PRIVATE_KEYS` | comma-separated; each address registered in KeeperRegistry, funded with MON |
| `RELAYER_PRIVATE_KEY` | pays relayed gas; funded with MON (defaults to the first keeper key) |
| `DEMO_LEADER_PRIVATE_KEY`, `DEMO_FOLLOWER_ACCOUNT` | team-run demo pair (the follower must follow the demo leader in BTC) |
| `TEAM_RUN_ADDRESSES` | demo follower owner and any other team wallets |
| `INDEXER_GRAPHQL_URL` | `http://<hasura>.railway.internal:8080/v1/graphql` once the Envio indexer runs |
| `NANSEN_ENABLED`, `NANSEN_PAYER_PRIVATE_KEY` | only when the x402 wallet holds USDC on Monad |

`RPC_URL` / `WS_RPC_URL` default to `https://rpc.monad.xyz` / `wss://rpc.monad.xyz`. A private Monad RPC is
recommended for production (the public one rate-limits).

Do not commit keys. The engine never logs private keys.

## Routes

Exactly the routes in [docs/api.md](../docs/api.md), plus `GET /metrics` (Prometheus text) and `GET /`.

## Layout

```
src/
  config.ts          env (zod) + shared/config.json
  app.ts             wiring; index.ts = entry + graceful shutdown
  api/server.ts      Fastify routes, errors, SSE
  chain/             RpcWs, ChainStreams (monad|standard|poll), TxSender + NonceManager, reads, simulation, errors
  domain/            planner (targetLots, slippage bounds, planCopy, classifyOpen), ABI encoding, types
  perpl/             REST client, market-data WebSocket, MarketData service
  services/          registry, watcher, copier, tracker, relayer, quote, demo, leaders, views (stats/accounts), push
  nansen/            x402 client + Nansen enrichment
scripts/             gen-abi.ts, e2e-fork.ts
test/                vitest
```
