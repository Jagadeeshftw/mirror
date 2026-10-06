# Mirror engine: design

The engine (`engine/`) watches Perpl leaders, copies their trades into followers' MirrorAccounts through
`mirror()`, relays users' signed actions without gas, and serves the API in [api.md](./api.md). How to run
and deploy it: [engine/README.md](../engine/README.md).

## Pipeline

```
Perpl Exchange position events ──monadLogs (Proposed)──> LeaderWatcher ──> Copier ──> TxSender pool ──> MirrorAccount.mirror()
MirrorAccountFactory + MirrorAccount events ──getLogs per head──> Registry (accounts, policy, feed)
monadNewHeads (Proposed/Voted/Finalized) ──> Tracker (commit states, base fee)
Perpl REST /v1/pub/context + WS market-state/order-book/trades ──> MarketData (marks, book, expected fills)
```

### Streams (`chain/streams.ts`)

One abstraction over three sources, picked at start (`LOG_SUBSCRIPTION=auto`):

- **monad**: `eth_subscribe monadNewHeads` and `monadLogs` on the Monad WS RPC. Logs arrive at the Proposed
  state, once per commit state; consumers act on the first and dedupe by `txHash:logIndex`.
- **standard**: `newHeads` / `logs` (anvil, generic nodes). Commit state is derived from depth.
- **poll**: `eth_blockNumber` + `eth_getLogs`.

`eth_getLogs` is always chunked to 100 blocks (Monad's limit). After a WS reconnect the gap is backfilled.

### Registry (`services/registry.ts`)

Backfills from `MIRROR_DEPLOY_BLOCK` in 100-block chunks, then catches up on every head. One topic-only
filter covers `AccountCreated` (accepted only from the factory) and the MirrorAccount events (accepted only
from known clones), so a clone created in the same chunk is known before its first event. It stores
accounts, policy, leaders, markets and the feed (Mirrored, Blocked, Deposited, Withdrawn, PolicyUpdated,
Paused, ClosedAll) in SQLite, with a persisted cursor so restarts resume.

### Watcher and copier

For a position event of a followed leader, the watcher records the fill (`leader_fills`: tx hash, block,
time observed) and coalesces events of one transaction per (leader, market). Every Perpl position event
is also stored in `perpl_events` for the engine's leader ranking.

The copier re-reads the leader's position on chain, retrying briefly until it matches the event, since a
Proposed log can be ahead of `latest`. It reads the positions of every leader the affected followers follow
in that market, then fans out: followers run in parallel and each follower's orders run strictly in
sequence. Per follower (`domain/planner.ts`):

- `targetLots` is the contract's formula: per leader `ceil(lots*ratio/1e4)` on the side, minus `floor` on the
  opposite side, floored at 0. It is cross-checked against a literal Solidity transcription in the unit tests
  and against the deployed contract's `targetLots` view in the e2e test.
- If the follower holds more than its target on its side, the excess is closed. When the leader reduces,
  closes or flips, the copy shrinks with the target, i.e. in proportion to the leader. A follower that was
  under-filled stays at its smaller size until the leader goes below it.
- If the event increased the leader's exposure (open, increase, invert), the shortfall is opened on the
  leader's side **at the leader's order leverage** taken from the event, so a 10x leader order is a 10x copy.
  The contract then blocks it if the follower's max is lower. Opens never happen on reductions, and a
  follower on the opposite side is closed first.
- The limit price is the onchain mark ± (policy `maxSlippageBps` − `SLIPPAGE_SAFETY_BPS`, default 5 bps),
  always inside the contract's bound. Deltas under one lot are skipped.

Each order is pre-simulated with `eth_simulateV1` (returns the Blocked event and reason). Where that is
unavailable it falls back to `eth_call` plus an off-chain replay of `_checkOpen` (`classifyOpen`), so the
reason is still named. Outcomes:

- `mirror()` returns true: submit.
- Returns false (blocked): an opening copy is still submitted once per leader fill, so the rule hit is
  recorded onchain, when the reason is in `BLOCKED_SUBMIT_REASONS` (risk rules: leverage, slippage,
  notional, target, loss stops, stale mark). Paused/expired/market-or-leader-not-allowed are the user's own
  settings and are not submitted on every leader fill. Blocked closes are not submitted.
- Simulation reverts (e.g. `NothingToClose`): skipped and logged.

Dedupe key: `account:leaderTx:perp:orderType` (unique in `copies`), so duplicate log deliveries never
double-submit. Receipt logs go straight into the feed, so the SSE stream and the demo do not wait for the
indexer.

**Latency** = time the copy tx's receipt arrived minus the time the leader's log was first observed, both
on the engine's clock. On Monad with `monadLogs` that is from the leader's Proposed block to our tx's
inclusion. On anvil with 1 s blocks it is about 1000 ms.

### Perpl API use (`perpl/`)

- REST `/v1/pub/context`: market list, decimals, open/closed, minimum posting amount, fees, slippage cap,
  min account open. Refreshed every 5 minutes; drives `/v1/config` and `/v1/markets`.
- WS `market-data`, one subscription frame within the 16-subscription / 10-request-per-minute limits:
  `market-state@143` for every market, `heartbeat@143`, and `order-book@id` + `trades@id` for 7 markets. A
  local L2 book applies snapshots and updates (`o:0` removes a level).
- Used for: `/v1/markets` (mark, oracle, best bid/ask, OI, volume, funding, recent trades); quote expected
  fill (book walk within the limit); the copier's expected fill per copy (logged); a drift check of the
  Perpl mark against the onchain mark the contract checks; and the demo leader's log lines. A market
  snapshot is logged every minute.
- Fallbacks: REST ticker/book, then `getPerpetualInfoV2` on the Exchange.

### Submission (`chain/sender.ts`, `chain/nonce.ts`)

One `TxSender` per key (several roles may share a key and then share a nonce manager). Behaviour:

- Nonces are pipelined: allocated locally without waiting for earlier receipts. A nonce whose tx was never
  broadcast is released and reused first. If later nonces are already in flight, the gap is filled with a
  0-value self-transfer.
- Gas limit = `eth_estimateGas` × 1.2, always explicit, because Monad charges the gas limit.
- Fees: EIP-1559, `maxFee = 2 × baseFee + priority`, priority `PRIORITY_FEE_GWEI` (2). The base fee comes
  from heads.
- Sending uses `eth_sendRawTransactionSync`, falling back to `eth_sendRawTransaction` + receipt polling when
  the node does not support it.
- Retries: nonce too low (resync, new nonce); underpriced (bump 25%); timeout or already known (look up the
  receipt, else bump and resend the same nonce). Reverts are decoded by replaying the call.
- Circuit breaker: `CIRCUIT_FAILURES` consecutive failures open it for `CIRCUIT_COOLDOWN_MS`. The keeper
  pool routes to the least-busy signer whose circuit is closed.

### Commit states (`services/tracker.ts`)

With `monadNewHeads`, feed rows follow each block's Proposed → Voted → Finalized exactly (a finalized block
also finalizes older rows). With standard heads: head−1 voted, head−2 finalized. Every change is published
on SSE.

### Relayer (`services/relayer.ts`)

`create` (`factory.createAccount`; returns `exists` if already deployed), `deposit` (`depositWithPermit` or
`depositWithAuthorization`), `execute` (EIP-712 `Action`), `transfer` (AUSD `transferWithAuthorization`).
Every call is checked with `eth_call` from the relayer first; a revert returns 400 with the decoded error and
nothing is sent. Then it is submitted, returning `{txHash, status, block, gasUsed, gasLimit}`. Rate limits are
per IP and per owner (owner from the body, or the account's onchain owner).

### Quote (`services/quote.ts`)

For each policy market where the leader holds a position: lots = target − current, at a price bound and
leverage `min(leader effective leverage, policy max)`. Match now has no leader order leverage to copy;
keeper copies always use the leader's order leverage. Also returned: the expected fill from the Perpl book,
notional and margin. `wouldBlock` comes from simulating `follow(policy, orders)` from the owner when the
account is funded, otherwise from the off-chain replay. Returned: per-market lines, `matchOrders` (the
passing ones), `encodedMatchOrders` (`abi.encode(MirrorOrder[])`) and `followActionData`
(`abi.encode(Policy, MirrorOrder[])`, ready to sign as `ACTION_FOLLOW`).

### Demo (`services/demo.ts`)

The team-run leader EOA sends IOC `execOrder`s on the Exchange: 1 lot BTC at 2x (`trade`) or 10x
(`blocked`). The engine copies into the team-run follower, which must follow the demo leader in BTC with max
leverage below 10x. After `DEMO_HOLD_MS` (20 s) the leader closes and the close is copied. Limits: one cycle
at a time, `DEMO_IP_HOURLY` per IP, `DEMO_DAILY_CAP` per 24 h. Steps stream on `/v1/stream?account=demo`.
If a cycle fails, the leader's position is closed best-effort.

### Leaders (`services/leaders.ts`)

- With `INDEXER_GRAPHQL_URL`: runs the `Leaderboard` and `LeaderProfile` operations from
  `indexer/queries/engine.graphql` against Hasura. Score =
  `clamp(pnlBps/(1+ddBps/1000)) × min(1, closingTrades/20) × min(1, activeDays/(days/3))`, halved above 20x
  average leverage, plus the Nansen adjustment. Response `source: "indexer"`.
- Without it (or if the query fails): ranks on the fly from `perpl_events`: the watcher's live feed since
  start plus `LEADER_BACKFILL_BLOCKS` of history (default 20,000 blocks, about 2 h). Realized PnL is
  `deltaPnlCNS`; equity comes from the Exchange's account balance; drawdown is measured on the realized
  curve. Score = `pnl% − 0.5·dd% + 20·(winRate − 0.5) + log2(1 + trades) + nansen`.
  Response `source: "engine"`. This is a basic ranking over a short window; the indexer is the real source.

### Nansen (`nansen/`)

The x402 client handles v2 (`PAYMENT-REQUIRED` header in, `PAYMENT-SIGNATURE` out; Nansen accepts only v2)
and v1 (body / `X-PAYMENT`). It picks the `exact` option on `eip155:143`, signs an ERC-3009
`TransferWithAuthorization` for the USDC in the requirement (domain name and version from `extra`), and
retries once. Every payment is guarded by a per-call cap (`NANSEN_MAX_PER_CALL`, $0.05) and a daily budget.

Enrichment per leader address uses `profiler/address/pnl-summary` on Monad ($0.01) and
`profiler/perp-positions` (Hyperliquid book as cross-venue context, $0.01). Labels need `NANSEN_API_KEY`
because Nansen excludes the labels endpoint from x402. Results are cached for 24 h; the ranking never waits on
a paid call. Labels and PnL change the score (+5 for smart-money labels, −50 and a risk flag for
exploit/scam labels, +2/+2 for positive PnL and a good win rate). Disabled unless `NANSEN_ENABLED=1`.
Tested against a mock 402 server built from a real Nansen 402; no paid call has been made.

### Push (`services/push.ts`)

`POST /v1/push/register` stores `{owner, expoPushToken, notifyPublicKey}`. On every feed event of an owner's
account the payload is encrypted to the device: ephemeral X25519, then HKDF-SHA256 (salt = ephemeral public
key, info `mirror-push-v1`), then AES-256-GCM. The result `{v, alg, epk, iv, ct}` (base64url; `ct` includes
the 16-byte tag) is sent as `data.enc` to the Expo push API. The server never sees plaintext on the device
side. `notifyPublicKey` is the raw 32-byte X25519 key as hex or base64url. Off unless `PUSH_ENABLED=1`.

### Stats

From the engine's own DB. Team-run accounts (`TEAM_RUN_ADDRESSES`, the demo leader and the demo follower)
are excluded from every top-level number and reported under `teamRun`. Executed copies exclude match-now
orders (counted as `matchNowOrders`). Median latency is computed over keeper copies.

## Monitoring

`/v1/health` reports the head block, stream mode, keeper and relayer balances, Perpl WS state, registry lag
and the Envio indexer status. `/metrics` exposes copies (by outcome and block reason), latency quantiles, tx
errors by kind, circuit state, signer balances, head, indexer lag, Perpl WS state and message counts, relay,
demo and Nansen calls. Logs are structured JSON (pino); key lines are `leader fill`, `copy plan`,
`copy included`, `perpl market snapshot (WS)`, `relayed` and `demo step`. SIGTERM drains the copy queues and
then closes.

## Known limits

- A single instance: nonces, rate limits and the demo lock are in memory (Railway: one replica).
- Copies act on Proposed logs; a reorged leader block could produce a copy of a fill that did not happen.
  The contract still caps the copy at ratio × the leader's current onchain position.
- The engine's own leader ranking covers only the backfill window plus live events; use the indexer for
  7d/30d/90d.
- Per-leader PnL in `/v1/accounts/:account` is an approximation: unrealized PnL is split by the net lots each
  leader's copies added. The indexer's FIFO attribution is exact.
