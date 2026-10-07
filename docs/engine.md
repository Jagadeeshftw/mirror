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
accounts, policy (including `maxEntryDeviationBps`, `stopSlippageBps`, `flattenOnStop`, `maxBuilderFeePer100K`), leaders (ratio, budget,
loss stop, stopped), markets (halted), owner levels and the feed (Mirrored with its copy proof, Blocked,
Deposited, Withdrawn, PolicyUpdated, Paused, ClosedAll, LevelSet, StopTriggered, LeaderStopped, MarketClosed) in
SQLite, with a persisted cursor so restarts resume. New columns are added to an existing database on open.

### Watcher and copier

For a position event of a followed leader, the watcher records the fill (`leader_fills`: tx hash, block,
time observed) and coalesces events of one transaction per (leader, market). Every Perpl position event
is also stored in `perpl_events` for the engine's leader ranking.

The copier re-reads the leader's position on chain, retrying briefly until it matches the event, since a
Proposed log can be ahead of `latest`. Followers run in parallel and each follower's orders run strictly in
sequence. Per follower (`domain/planner.ts`):

- **One leader per market.** An account follows up to four leaders, but Perpl nets each market into one
  position, so a market belongs to the leader whose copy opened it (`marketLeader(perpId)`) until it is flat.
  Targets are per leader: `targetLots(perp, leader, side) = ceil(leaderLots × ratio / 1e4)` on the leader's
  side, 0 otherwise; there is no netting across leaders. It is cross-checked against a literal Solidity
  transcription in the unit tests and against the contract's `targetLots` view in the e2e test.
- **Closes** happen only for the leader holding the market, and only down to that leader's target, never below
  (the contract blocks `CloseBelowTarget`): close size = followerLots − targetLots(perp, holder, side) when
  positive. A change by any other leader never resizes the market. A position whose holder was removed from the
  policy cannot be closed by a keeper (the contract requires the holder to be followed); the owner closes it with
  `closeMarket` or `closeAll`.
- **Opens**: if the event increased the leader's exposure, the shortfall is opened on the leader's side **at the
  leader's order leverage**, from flat (any followed leader) or on top of the holder's own position. Another
  leader's same-side open into a held market is still planned, so the contract records
  `MarketHeldByOtherLeader`; nothing is opened against an opposite position. Opens never happen on reductions.
- **Prices**: closes use the onchain mark ± (policy `maxSlippageBps` − `SLIPPAGE_SAFETY_BPS`, default 5 bps).
  Opens use the tighter of that and the **entry guard** bound: with `maxEntryDeviationBps` set, a long may pay
  at most `leaderEntry × (1 + dev)` and a short must get at least `leaderEntry × (1 − dev)`, where leaderEntry is
  the leader's onchain average entry (`PositionInfoV2.pricePNS`), rounded as the contract does. If the mark is
  already beyond the bound the copy is still submitted and the contract records `EntryTooFar` (below).
- Every order carries `leaderFillPNS`: the leader's fill price from the Perpl event (Opened/Increased/Inverted/
  Closed; 0 for a decrease, liquidation or deleverage). It is statistics only; no rule trusts it.
- **Paused accounts still get the leader's closes**: the contract refuses only opens while paused, and the keeper
  keeps mirroring exits so a paused follower is not left holding a position the leader has left.
- **Detached accounts get no copies at all** (opens and closes). See "Stop following, keep my positions" below.
- Deltas under one lot are skipped. Budget (`budgetCNS`) and leader loss stop (`lossStopBps`) are left to the
  contract; the engine replays them only to name a block.

Each order is pre-simulated with `eth_simulateV1` (returns the Blocked event and reason). Where that is
unavailable it falls back to `eth_call` plus an off-chain replay of `_checkOpen` (`classifyOpen`), so the
reason is still named. Outcomes:

- `mirror()` returns true: submit.
- Returns false (blocked): an opening copy is still submitted once per leader fill, so the rule hit is
  recorded onchain, when the reason is in `BLOCKED_SUBMIT_REASONS` (risk rules: leverage, slippage,
  notional, target, account loss stops, stale mark, `EntryTooFar`, `MarketHeldByOtherLeader`,
  `LeaderBudgetExceeded`, `LeaderLossStop`, `BuilderFeeTooHigh`; a submitted `LeaderLossStop` also latches `leaderStopped`).
  Paused/expired/market-or-leader-not-allowed/`MarketHalted` are the user's own settings and are not submitted
  on every leader fill. Blocked closes are not submitted.
- Simulation reverts (e.g. `NothingToClose`): skipped and logged.

**Copy proof.** Every `Mirrored` event carries `CopyProof {leaderFillPNS, leaderEntryPNS, markPNS, fillPNS,
entryDeviationBps, builderFeeCNS}` (follower fill derived onchain from the position before and after; deviation
positive when the follower paid worse than the leader's entry; `builderFeeCNS` = the builder fee Perpl charged on
the added lots, notional at the fill x `BUILDER_FEE_PER_100K` / 100,000 rounded up, 0 for closes). The registry
stores it in the feed row (and `builder_fee_cns` for the totals) and the API returns it as `proof` on Mirrored
items.

**Builder attribution.** Every MirrorAccount is deployed with immutables `BUILDER_ID` (26) and
`BUILDER_FEE_PER_100K` (20 = 0.02%), passed to `MirrorAccountFactory`. Opening orders (keeper copies and owner
match now) go through Perpl's `execOrderV2` with the builder extension; every reducing path uses `execOrder` and
never pays a builder fee. The owner signs `Policy.maxBuilderFeePer100K` (0..1000); an opening copy whose fee is
above it is `Blocked(BuilderFeeTooHigh)` (index 21, limit = signed max, actual = fee), checked right after
`LeaderLossStop` and before `LeverageTooLow`, and the planner's `classifyOpen` replays it in the same place. The
engine reads the builder id and fee once (`Reads.builder()`: the factory's `builderId` / `builderFeePer100K`, else
any account's immutables) and caches them. `BuilderFeeTooHigh` is in the default `BLOCKED_SUBMIT_REASONS`, so the
rule hit is recorded onchain. Revenue is readable from chain data: `/v1/stats` and `/v1/stats/copy-quality` sum
`proof.builderFeeCNS` (team-run separately), and the indexer also records Perpl's exact
`TakerOrderFilledV2.builderFeeCNS` for builder 26. `Blocked` carries `leaderFillPNS` and `markPNS` (in `data`).

Dedupe key: `account:leaderTx:perp:orderType` (unique in `copies`), so duplicate log deliveries never
double-submit. Receipt logs go straight into the feed, so the SSE stream and the demo do not wait for the
indexer.

**Latency** = time the copy tx's receipt arrived minus the time the leader's log was first observed, both
on the engine's clock. On Monad with `monadLogs` that is from the leader's Proposed block to our tx's
inclusion. On anvil with 1 s blocks it is about 1000 ms.

### Thin-book guard (`domain/thinbook.ts`, `services/guard.ts`)

A leader can trade into an empty book so that followers' copies fill against the leader's own resting orders.
Before an opening copy is sent, the engine measures the depth on Perpl's book on the taking side (asks for a buy,
bids for a sell) at or better than the order's limit price:

- **Keeper copies**: only copies that would execute (a copy the simulation says is blocked does not trade and is
  still submitted as before). **Match now**: every quote line.
- Book source: the WS L2 book while fresh (30 s), else Perpl's REST book (the same book, polled). The Exchange
  contract exposes only best prices without sizes (`maxBidPriceONS` / `minAskPriceONS`), so there is no onchain
  depth fallback: with neither book the order is skipped with reason `book_unavailable`.
- `required = ceil(lots × THIN_BOOK_DEPTH_MULTIPLE)` (default 2). Depth ≥ required: unchanged. Otherwise the order
  is shrunk to `floor(depth / multiple)` lots when that is ≥ 1 lot (a keeper copy is then re-simulated with the new
  size), else skipped (`thin_book`).
- Every shrink and skip is stored in `guard_events` (requested / final lots, depth, required, multiple, limit,
  book source and age) and written to the account feed as an **engine-side event**: kind `EngineShrunk` or
  `EngineSkipped`, `onchain: false`, `txHash: null`, `label` "Shrunk: thin book" / "Skipped: thin book" /
  "Skipped: book unavailable", `reason` `ThinBook` / `BookUnavailable`, `limit` = required lots, `actual` = depth.
  Onchain `Blocked` events have `onchain: true` and a transaction. Quote events are written to the feed only for
  deployed accounts and are de-duplicated for 60 s. Quote lines carry `thinBook` and `engineSkip`; skipped lines
  are left out of `matchOrders`.
- `THIN_BOOK_GUARD_ENABLED=0` turns it off (e.g. on anvil, where Perpl's book is not reachable).

### Adversarial leader flags (`domain/adversarial.ts`, `services/adversarial.ts`)

Computed per leader from the engine's own records (feed + copy proof, `leader_fills`, `perpl_events`),
recomputed at most once a minute:

- **Exits into followers**: the leader decreases, closes or inverts out of the same market within
  `ADVERSARIAL_EXIT_BLOCKS` (20) blocks after a follower's opening copy filled, at a price at or beyond that fill
  on the follower's side (long: exit ≥ follower's buy price; short: exit ≤ follower's sell price). One incident per
  leader exit transaction. Decreases carry no price in Perpl's event and are not evaluated.
- **Moves the book**: the leader's own fill moved the last price (the last priced Perpl event in that market in
  the 200 blocks before the leader's transaction) by more than `ADVERSARIAL_MOVE_BPS` (30) in the leader's trade
  direction, and the followers' copies of that fill filled worse than the leader by more than
  `ADVERSARIAL_WORSE_BPS` (20) bps (median over the copies). One incident per copied leader fill.
- `score` = 100 × incidents / copied leader fills (capped at 100); `flagged` when score ≥ `ADVERSARIAL_FLAG_SCORE`
  (25) and incidents ≥ `ADVERSARIAL_MIN_INCIDENTS` (2). `/v1/leaders` and `/v1/leaders/:id` return
  `adversarial: {exitsIntoFollowers, bookMoving, lastSeen, score, flagged, copiedFills}`.
- `ADVERSARIAL_REFUSE_FOLLOWS=1` (default 0: only flag) makes `/v1/quote/follow` answer 409 for a flagged leader
  and `/v1/relay/execute` refuse an `ACTION_FOLLOW` / `ACTION_SET_POLICY` that adds a flagged leader the account
  does not follow yet. The owner can still call the contract directly; existing follows keep being copied (so
  closes still follow the leader).

### Copy quality (`domain/quality.ts`, `services/quality*.ts`)

`GET /v1/stats/copy-quality` and `GET /v1/leaders/:id/copy-quality` (period `all` | `7d` | `30d`):

- With `INDEXER_GRAPHQL_URL`: `period=all` reads `CopyQualityStats` (scope `global` and `teamRun`),
  `BlockReasonStats` and the latest 50 `CopyEvent` rows per scope; `7d`/`30d` read `CopyEvent` and `BlockedCopy`
  rows since the start of the period and aggregate them like the engine does. If the indexer query fails, the
  engine DB is used.
- Without it: `feed` (Mirrored / Blocked) joined with `copies` (engine latency), `leader_fills` (leader block and
  fill) and `perpl_events` (the follower's own fill in the copy tx, which prices closes; opens are priced by the
  copy proof's `fillPNS`).
- Per copy: leader fill, follower fill, deviation (bps, positive = follower worse), latency in ms (engine clock,
  leader log first seen at Proposed to copy receipt; joined by tx hash in indexer mode) and in blocks.
  Aggregates: copies, match-now copies, opens, closes, blocked, deviation median / p90 / avg / worse-than-leader,
  latency ms and blocks median / p90 (nearest rank, keeper copies only), blocks by reason, `builderFeesCNS` (sum of
the builder fee on every copy in scope, keeper and match now; indexer `CopyQualityStats.builderFeesCNS`, per copy
Perpl's exact `builderFeePerplCNS` when linked, else the proof's). Team-run copies (team-run
  follower or demo leader) are only in the separate `teamRun` block.

### Backtest (`domain/backtest*.ts`, `services/backtest.ts`)

`POST /v1/leaders/:id/backtest` replays the leader's `PositionEvent` history (indexer, `LeaderTradeHistory` from
`indexer/queries/simulation.graphql`, paged by 1000 up to `BACKTEST_MAX_EVENTS`) through the follower's rules.
Without an indexer it returns 503 "history unavailable" (the engine has no Perpl REST history client, and its own
`perpl_events` only cover the backfill window). Each event goes through the planner itself: `planCopy` (targets,
close-to-target, opens at the leader's order leverage, entry-guard limit), then `classifyOpen` / `classifyClose`
(the off-chain replay of the contract checks, including budget, leader loss stop with its latch, daily loss and
drawdown with the contract's day-start / high-water bookkeeping, halted markets after a level). Fills are the
leader's price moved against the follower by the leader's measured median copy deviation (≥ 3 samples, floored at
0) or `BACKTEST_DEFAULT_SLIPPAGE_BPS` (5), never past the limit; taker fee `BACKTEST_TAKER_FEE_BPS` (3.5); the
builder fee (`BUILDER_FEE_PER_100K` read from chain, rounded up) on opening fills only, and `BuilderFeeTooHigh`
when the request's optional `maxBuilderFeePer100K` is below it (`builderFeesCNS` in the result, also in
`feesCNS`); funding ignored. Optional stop-loss / take-profit percentages from the follower's entry behave like owner levels (close and
halt the market); `flattenOnStop` lets loss stops close everything. The result is labelled `simulation: true`,
is deterministic (pure function of events and inputs) and returns the daily equity curve, PnL, max drawdown,
trades copied, blocks by reason, skipped events and an `assumptions` list.

### Perpl API use (`perpl/`)

- REST `/v1/pub/context`: market list, decimals, open/closed, minimum posting amount, fees, slippage cap,
  min account open. Refreshed every 5 minutes; drives `/v1/config` and `/v1/markets`.
- WS `market-data`, one subscription frame within the 16-subscription / 10-request-per-minute limits:
  `market-state@143` for every market, `heartbeat@143`, and `order-book@id` + `trades@id` for 7 markets. A
  local L2 book applies snapshots and updates (`o:0` removes a level).
- Used for: `/v1/markets` (mark, oracle, best bid/ask, OI, volume, funding, recent trades); quote expected
  fill (book walk within the limit); the thin-book guard's depth; the copier's expected fill per copy (logged); a drift check of the
  Perpl mark against the onchain mark the contract checks; and the demo leader's log lines. A market
  snapshot is logged every minute.
- Fallbacks: REST ticker/book, then `getPerpetualInfoV2` on the Exchange.

### Submission (`chain/sender.ts`, `chain/nonce.ts`)

One `TxSender` per key (several roles may share a key and then share a nonce manager). Behaviour:

- Nonces are pipelined: allocated locally without waiting for earlier receipts. A nonce whose tx was never
  broadcast is released and reused first. If later nonces are already in flight, the gap is filled with a
  0-value self-transfer.
- **Gas limits (hard rule).** Monad charges the full gas limit, so every limit is Monad's own `eth_estimateGas`
  on the configured RPC, from the signing address, times headroom, and nothing else: no third-party quote, no
  fixed number, no forge simulation (a real mainnet transaction failed that way). `SendRequest` has no gas field;
  `TxSender.send` always estimates, and so does the nonce gap fill. Headroom is `GAS_LIMIT_MULTIPLIER` (1.2) for
  ordinary calls and `BOOK_GAS_LIMIT_MULTIPLIER` (1.3) for calls whose gas depends on the book or prices (keeper
  copies, stop triggers, match now / follow / close actions, demo orders), because the book can change between
  estimate and inclusion. Multipliers below 1 are refused. `test/sender.test.ts` proves with a fake RPC that the
  signed limit is exactly `withHeadroom(estimate)` (including the gap fill), and `test/gas-scan.test.ts` fails on
  any hard-coded limit (`gas: 123n`, `gasLimit: 1`, `--gas-limit`, `--gas-estimate-multiplier`) in
  `engine/src`, `engine/scripts`, `scripts/` and `contracts/script` (allowlist: the estimator module, tests).
  Contracts are deployed to Monad with `scripts/deploy-contracts.mjs`, not `forge script --broadcast`.
- Fees: EIP-1559, `maxFee = 2 × baseFee + priority`, priority `PRIORITY_FEE_GWEI` (2). The base fee comes
  from heads.
- Sending uses `eth_sendRawTransactionSync`, falling back to `eth_sendRawTransaction` + receipt polling when
  the node does not support it.
- Retries: nonce too low (resync, new nonce); underpriced (bump 25%); timeout or already known (look up the
  receipt, else bump and resend the same nonce). Reverts are decoded by replaying the call.
- Circuit breaker: `CIRCUIT_FAILURES` consecutive failures open it for `CIRCUIT_COOLDOWN_MS`. The keeper
  pool routes to the least-busy signer whose circuit is closed.

### Stop executor (`services/stops.ts`)

Anyone may call MirrorAccount's stop triggers, but only when the condition is true onchain. The executor scans
every funded account at most every `STOP_CHECK_MS` (3 s) on new heads:

- owner levels (from `LevelSet`): `triggerLevel(perpId)` when the account holds the level's side and the mark
  (and a fresh Chainlink price, which must agree within 2%) has reached the stop-loss or take-profit;
- with `flattenOnStop`: `triggerAccountStop()` when the daily-loss or drawdown floor is breached (skipped once
  the account is paused and flat), and `triggerLeaderStop(leader)` when the leader's realised-since-added plus
  unrealised PnL (`leaderBook`) is below −`lossStopBps` × budget (latched once, then only while positions are
  still held for that leader).

Each candidate is pre-checked with the contract's own formulas (`domain/stops.ts`), then **simulated with
`eth_call` on Monad from the signer that would send it**. Only a successful simulation is sent (and the send
itself estimates gas, which reverts before anything is signed if the state changed). A trigger whose simulation
reverts is never sent; the attempt is recorded in `stop_triggers` and retried after `STOP_RETRY_MS` (15 s). The
signer is `STOP_EXECUTOR_PRIVATE_KEY`, or the keeper pool. Attempts: `GET /v1/accounts/:account/stops`; results
also arrive as `StopTriggered` feed items. A fired level halts the market for opening copies until the owner
sets a policy again. `STOP_EXECUTOR_ENABLED=0` turns it off.

### Commit states (`services/tracker.ts`)

With `monadNewHeads`, feed rows follow each block's Proposed → Voted → Finalized exactly (a finalized block
also finalizes older rows). With standard heads: head−1 voted, head−2 finalized. Every change is published
on SSE.

### Relayer (`services/relayer.ts`)

`create` (`factory.createAccount`; returns `exists` if already deployed), `deposit` (`depositWithPermit` or
`depositWithAuthorization`), `execute` (EIP-712 `Action`, kinds 1-10 including `ACTION_SET_LEVELS` = 9 with
`abi.encode(Level[])` and `ACTION_CLOSE_MARKET` = 10 with `abi.encode(uint32 perpId, uint16 slippageBps)`;
`domain/encode.ts` has the encoders), `transfer` (AUSD `transferWithAuthorization`).
Every call is checked with `eth_call` from the relayer first; a revert returns 400 with the decoded error and
nothing is sent. Then it is submitted, returning `{txHash, status, block, gasUsed, gasLimit}`. Rate limits are
per IP and per owner (owner from the body, or the account's onchain owner).

### Quote (`services/quote.ts`)

The policy body takes the new fields: `maxEntryDeviationBps` (default 0), `stopSlippageBps` (required,
1..2000), `flattenOnStop` (default false), `maxBuilderFeePer100K` (default 20, max 1000) and per leader `budgetCNS` (required, > 0) and `lossStopBps` (default
0). For each policy market where the leader holds a position: lots = that leader's target − what the follower
holds for it (a market held by another leader is quoted as `MarketHeldByOtherLeader`), at the open price above
(slippage and entry bound; `leaderEntryPNS` and `entryBoundPNS` are returned) and leverage
`min(leader effective leverage, policy max)`. The replay accumulates the leader's margin across lines for the
budget check. Match now has no leader order leverage to copy;
keeper copies always use the leader's order leverage. Also returned: the expected fill from the Perpl book,
notional, margin and `builderFeeCNS` per line, and `builderFee: {id, feePer100K, estimateCNS, appliesTo}` where
`estimateCNS` sums the lines that would execute (notional at mark x fee / 100,000, rounded up), so the follow sheet
can show it before the passkey prompt. A policy whose max is below the fee gets `wouldBlock` `BuilderFeeTooHigh`. `wouldBlock` comes from simulating `follow(policy, orders)` from the owner when the
account is funded, otherwise from the off-chain replay. Returned: per-market lines, `matchOrders` (the
passing ones), `encodedMatchOrders` (`abi.encode(MirrorOrder[])`) and `followActionData`
(`abi.encode(Policy, MirrorOrder[])`, ready to sign as `ACTION_FOLLOW`).

### Demo (`services/demo.ts`)

The team-run leader EOA sends IOC `execOrder`s on the Exchange: 1 lot BTC at 2x (`trade`) or 10x
(`blocked`). The engine copies into the team-run follower, which must follow the demo leader in BTC with max
leverage below 10x, a budget for it, and a BTC position that is flat or held by the demo leader (otherwise the
cycle is refused with 409, since the copy would be `MarketHeldByOtherLeader`; also refused while a level has
halted BTC). After `DEMO_HOLD_MS` (20 s) the leader closes and the close is copied. Limits: one cycle
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
exploit/scam labels, +2/+2 for positive PnL and a good win rate). The ranking depends only on the `NansenSignal` interface (`get(address)` returning a cached profile or
null), chosen by `createNansenSignal`: with `NANSEN_API_KEY` set it is on immediately and every call carries the
key (labels included); if the key is refused (401/402/403) and `NANSEN_PAYER_PRIVATE_KEY` is set, that call falls
back to x402; with only a payer key it uses x402; with neither (or `NANSEN_ENABLED=0`) it is `noNansen` and the
score simply has no Nansen term. `/v1/leaders` reports the source as `nansenSource` (`api_key` | `x402` | `off`).
Tested against a mock 402 server built from a real Nansen 402; no paid call has been made.

### Push (`services/push.ts`, `pushauth.ts`, `alerts.ts`, `pushcrypto.ts`, `webpush.ts`, `fcm.ts`)

Encrypted alerts for an owner's accounts. `alerts.ts` picks the feed events that alert and writes their text;
`pushcrypto.ts` seals each alert to every registered device's notification public key (envelope v1: X25519 →
HKDF-SHA256 → ChaCha20-Poly1305, byte-identical to the app's `notifyKey.ts`, checked against
`shared/test-vectors/push-envelope-v1.json`); `push.ts` dedupes, rate-limits and fans out over SSE (`event: push`),
Web Push (VAPID, `webpush.ts`), FCM HTTP v1 (`fcm.ts`, Android) and, as a fallback, Expo push. Every registration is
owner-signed EIP-712 (`pushauth.ts`: `PushRegister` / `PushUnregister`, deadline at most an hour ahead, each digest
used once via `push_sig_used`). Targets live in `push_subs` with `signed_ms`; unsigned rows (from before signatures
were required, and the old `push_tokens` table) are never used and are deleted at startup. The sealed share list uses
the same signed keys only (`PushService.ownerKeys`). The visible push text is always the generic "Mirror / New
activity". Team-run accounts never alert. Triggers, payload, channels: [api.md, Push](api.md#push).

| Env | Meaning |
|---|---|
| `FCM_SERVICE_ACCOUNT_PATH` | path to the Firebase Admin SDK service-account JSON (secret; keep it outside the repo, e.g. `keys/firebase-adminsdk.json`, gitignored). Turns FCM on |
| `FCM_SERVICE_ACCOUNT_JSON` | the same JSON as one value, for hosting secrets; wins over the path |
| `FCM_PROJECT_ID` | overrides the service account's `project_id` in the send URL (Mirror: `mirror-c8061`) |
| `FCM_ENDPOINT_OVERRIDE` | test hook, refused unless `NETWORK=localnet`: FCM send URL; the OAuth token is minted at `<origin>/token` |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | Web Push (`pnpm gen:vapid`); the private key is a secret |
| `PUSH_WEBPUSH_ENDPOINT_OVERRIDE` | test hook, refused unless `NETWORK=localnet` |
| `PUSH_ENABLED`, `EXPO_ACCESS_TOKEN` | Expo push fallback for earlier Expo tokens; off unless set |
| `PUSH_RATE_PER_MIN`, `PUSH_MAX_AGE_SEC`, `PUSH_LOW_EQUITY_PCT` | 20 alerts per owner per minute, 900 s max event age, low-equity threshold 50% |

The engine logs only the FCM project id, never anything from the key; key load errors name the variable, not the
content. Access tokens are minted with a hand-rolled RS256 JWT (`node:crypto`, no Google SDK) and cached until a minute
before expiry.

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
- Per-leader PnL in `/v1/accounts/:account` comes from the contract's `leaderBook` (margin, unrealised,
  realised since added, stopped), exact because each market belongs to one leader.
- The stop executor reads each funded account every scan (levels, equity, leader books): fine for the current
  number of accounts; batch it with multicall before it grows large.
- MirrorAccount's runtime is ~35 KB, above EIP-170. Monad accepts it; a local anvil must run with
  `--disable-code-size-limit` (and forge scripts on anvil too).

## Stop following, keep my positions (detach)

An owner-signed, **engine-side** state. `POST /v1/accounts/:account/detach` takes an EIP-712 signature over
`Detach(bool detached, uint256 deadline)` in the domain `{name: "Mirror Account", version: "1", chainId,
verifyingContract: <the account>}` (the same domain as owner actions). The engine reads the account's onchain
`owner()` and accepts the signature only from it, with a deadline at most 3600 s ahead and later than the last
accepted one (single use). It stores `accounts.detached` (plus the head block and the deadline) and records an
engine-side feed item `Detached` ("Stopped following; positions kept" / "Following again").

While detached the copier sends the account no copies, opens or closes, so its positions stay exactly as they
are. **This is keeper behaviour, not enforced by the contract**: the policy still allows the keeper to copy the
leader, and nothing onchain changes when an account detaches. The owner keeps full control onchain: levels
(`setLevels`, executable by anyone when hit), loss stops anyone can trigger, `closeMarket`, `closeAll`, `withdraw`.
The app also pauses the account onchain in the same passkey prompt, so no new exposure can open even through
match-now. A new policy (`PolicyUpdated` from setPolicy or follow, in a block after the detach) or a signed
`detached: false` clears it (feed item "Following again").
