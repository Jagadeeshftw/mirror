# Mirror indexer

Envio HyperIndex (V3) indexer for Mirror on Monad mainnet (chain 143). It indexes the Perpl Exchange
(every trader's positions, trade history, performance) and the Mirror contracts (follower accounts,
copies, blocked copies, per-leader PnL), and serves them over GraphQL to the engine.

Full entity reference, derivations, engine queries and hosting: [`../docs/indexer.md`](../docs/indexer.md).

## Layout

```
config.yaml              contracts, events, chain 143 (HyperSync primary, RPC fallback or RPC-only)
schema.graphql           entities (Perpl, leader stats/windows/equity, Mirror, global stats)
src/handlers/            PerplExchange.ts, Mirror.ts (factory + clones), Rollover.ts (hourly window roll)
src/lib/                 math.ts (bigint fixed point), fifo.ts (lot attribution), windows.ts,
                         positions.ts (single path for all position events), store.ts, env.ts, constants.ts
queries/engine.graphql   the GraphQL operations the engine uses
scripts/export-samples.mjs  runs those operations against a live indexer, writes samples/
test/                    vitest: pure math/FIFO/window tests + createTestIndexer handler tests
samples/                 output of a live mainnet sync
Dockerfile               self-hosting (Railway)
```

## Commands

```bash
pnpm install
pnpm codegen          # after editing config.yaml or schema.graphql
pnpm typecheck
pnpm test             # 24 tests, no network
pnpm dev              # local Postgres + Hasura via Docker, HyperSync (needs ENVIO_API_TOKEN)
pnpm dev:rpc          # same, historical sync over RPC (no token)
pnpm start            # production: uses ENVIO_PG_* and HASURA_GRAPHQL_* from the environment
```

`pnpm dev` / `pnpm dev:rpc` start containers named `envio-postgres` / `envio-hasura` on ports 5433 /
8080. GraphQL is at `http://localhost:8080/v1/graphql` (Hasura console password `testing`).

A quick RPC-only proof over recent blocks (no token):

```bash
ENVIO_START_BLOCK=$(( $(cast block-number --rpc-url https://rpc.monad.xyz) - 5000 )) pnpm dev:rpc
GRAPHQL_URL=http://localhost:8080/v1/graphql pnpm sample
```

## Environment

See [`.env.example`](./.env.example). The main ones are `ENVIO_API_TOKEN` (HyperSync),
`ENVIO_MIRROR_FACTORY_ADDRESS` and `ENVIO_MIRROR_START_BLOCK` (after the Mirror deploy; until then the
zero address keeps Mirror indexing off), and `ENVIO_TEAM_RUN_ADDRESSES` / `ENVIO_TEAM_RUN_ACCOUNT_IDS`
(team-run accounts excluded from public stats).

## Live sync proof

An RPC-only sync of 6000 recent mainnet blocks decoded real Perpl events into entities. The engine
queries were then run against Hasura: see `samples/`. `samples/derived-price-check.json` compares
derived execution prices with the on-chain maker fills of the same transactions.
