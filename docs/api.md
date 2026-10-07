# Mirror backend API (engine + relayer)

The engine runs on Railway (EU region, so Perpl's API is reachable; Perpl geo-blocks US and GB).
The app and the web stats page talk only to this API and to Monad RPC, never to Perpl's API directly,
so judges in the US and UK can use everything.

Base URL: `API_BASE` (Railway domain until a custom domain is added). All amounts are strings in raw
units unless the field name ends in `Usd`/`Display`. Addresses are checksummed.

Team-run accounts (demo leader, demo follower) are flagged `teamRun: true` everywhere and are excluded
from every user and traction count.

## Read

| Method | Path | Returns |
|---|---|---|
| GET | `/v1/health` | `{ok, chainId, block, keeper:{address, balanceWei}, relayer:{...}, perpl:{wsConnected, lastMarkAt}, indexer:{lagBlocks}}` |
| GET | `/v1/config` | chain, contract addresses, markets (perpId, symbol, decimals, mark, min order size from Perpl context), deposit cap, Perpl min account open, team-run addresses, `builder: {id, feePer100K, appliesTo: "opening size only"}` (the Perpl builder attribution every account is deployed with; null without a factory) |
| GET | `/v1/markets` | per market: mark, oracle, funding, OI, best bid/ask (from Perpl REST/WS) |
| GET | `/v1/leaders?window=7d\|30d\|90d&sort=score\|pnl\|drawdown&market=BTC` | ranked leaders: `{accountId, address, score, pnlUsd, pnlPct, maxDrawdownPct, winRate, avgLeverage, trades, markets[], followers, nansen:{labels[], ...}, teamRun, adversarial}` |
| GET | `/v1/leaders/:accountId` | profile + due-diligence card: equity curve points, stats, open positions, recent trades, Nansen labels and cross-venue notes, risk flags, `adversarial` |
| GET | `/v1/leaders/:accountId/copy-quality?period=all\|7d\|30d` | copy quality of this leader's copies (same shape as `/v1/stats/copy-quality`) |
| GET | `/v1/stats/copy-quality?period=all\|7d\|30d` | per copy leader fill vs follower fill, deviation, latency (ms and blocks); aggregates (including `builderFeesCNS`); blocks by reason; team-run in a separate `teamRun` block |
| GET | `/v1/owners/:owner/accounts` | the owner's MirrorAccounts (predicted + deployed), each with balance, equity, policy (including `maxBuilderFeePer100K`), `builderFeesCNS` (sum of the builder fee on its copies), positions, PnL attributed per leader, paused, expiry |
| GET | `/v1/accounts/:account` | one MirrorAccount in full |
| GET | `/v1/accounts/:account/feed?cursor=` | Mirrored / Blocked / Deposited / Withdrawn / PolicyUpdated / Paused / ClosedAll events, each with `txHash`, `block`, `commitState` (proposed/voted/finalized), `latencyMs` (leader fill to copy tx), decoded block reason with limit/actual, Mirrored `proof` `{leaderFillPNS, leaderEntryPNS, markPNS, fillPNS, entryDeviationBps, builderFeeCNS}` (`builderFeeCNS` = builder fee Perpl charged on that copy, 0 for closes); plus engine-side `EngineShrunk` / `EngineSkipped` items (see below). Every item has `onchain` |
| GET | `/v1/stats` | public stats: accounts created, funded accounts, net AUSD deposited, copies executed, copies blocked per rule, median latency, active followers 7d, builder fees (`builderFeesCNS` = `builderFeesCopiesCNS` + `builderFeesMatchNowCNS`, from Mirrored proofs), every executed copy with tx link (paginated); all exclude team-run (team-run totals, builder fees included, under `teamRun`) |
| GET | `/v1/demo` | demo leader and demo follower state, recent demo cycles |
| GET | `/v1/stream?account=...` | Server-Sent Events: feed events for an account (or `demo`) as they happen, including commit-state updates |

### Leader `adversarial` block

```json
"adversarial": { "exitsIntoFollowers": 2, "bookMoving": 1, "lastSeen": 1791380000, "score": 38, "flagged": true, "copiedFills": 8 }
```

`exitsIntoFollowers`: leader exits within `ADVERSARIAL_EXIT_BLOCKS` blocks of followers' opening fills at a price at
or beyond those fills on the followers' side. `bookMoving`: copied leader fills that moved the last price by more
than `ADVERSARIAL_MOVE_BPS` while followers filled more than `ADVERSARIAL_WORSE_BPS` worse than the leader. `score`
0..100 = incidents / copied leader fills. `lastSeen` unix seconds. With `ADVERSARIAL_REFUSE_FOLLOWS=1`, quotes and
relayed follow / set-policy actions that add a flagged leader return 409.

### Engine-side feed items (thin-book guard)

Not onchain, no transaction; never confuse with `Blocked`:

```json
{ "id": 812, "kind": "EngineShrunk", "onchain": false, "label": "Shrunk: thin book", "txHash": null, "txUrl": null,
  "commitState": "offchain", "leaderAccountId": 4638, "perpId": 16, "orderType": 0, "lotLNS": "4", "pricePNS": "1005",
  "reason": "ThinBook", "limit": "10", "actual": "9",
  "data": { "onchain": false, "label": "Shrunk: thin book", "source": "keeper", "reason": "thin_book", "requestedLots": "5",
            "finalLots": "4", "depthLots": "9", "requiredLots": "10", "multiple": 2, "limitPNS": "1005", "bookSource": "ws", "bookAgeMs": 180 } }
```

`EngineSkipped` has `label` "Skipped: thin book" (`reason: ThinBook`) or "Skipped: book unavailable"
(`reason: BookUnavailable`, `actual: null`). Quote lines carry `thinBook` (same numbers) and `engineSkip`.

### Copy quality

`GET /v1/stats/copy-quality?period=30d` (abridged):

```json
{ "source": "engine", "period": "30d", "since": 1788800000, "leaderAccountId": null, "excludesTeamRun": true,
  "definitions": { "deviationBps": "follower fill vs leader fill, positive = follower got the worse price", "...": "..." },
  "aggregates": { "copies": 42, "matchNowCopies": 5, "opens": 25, "closes": 17, "blocked": 9,
    "deviationBps": { "samples": 40, "median": 3, "p90": 11, "avg": 4, "worseThanLeader": 27 },
    "latencyMs": { "samples": 38, "median": 1180, "p90": 2140 },
    "latencyBlocks": { "samples": 40, "median": 3, "p90": 5 }, "builderFeesCNS": "84200" },
  "blockedByReason": { "LeverageTooHigh": 4, "EntryTooFar": 3, "LeaderBudgetExceeded": 2 },
  "copies": [ { "txHash": "0x…", "account": "0x…", "leaderAccountId": 4638, "perpId": 16, "orderType": 0, "lotLNS": "2",
    "leaderRef": "0x…", "leaderFillPNS": "1004210", "followerFillPNS": "1004530", "deviationBps": 3, "latencyMs": 1210,
    "latencyBlocks": 3, "block": 41234567, "timestamp": 1791380000, "matchNow": false, "builderFeeCNS": "402" } ],
  "teamRun": { "label": "team-run (demo leader / demo follower); excluded from every number above", "aggregates": { "...": "..." },
    "blockedByReason": { "LeverageTooHigh": 6 }, "copies": [] } }
```

`source` is `indexer` when `INDEXER_GRAPHQL_URL` is set and answers (then `aggregates` also has `latencySeconds`
for `period=all`), else `engine`. `builderFeesCNS` sums the builder fee on every copy in scope (keeper and match
now, opening size only); per copy `builderFeeCNS` is Perpl's exact `TakerOrderFilledV2` figure when the indexer
linked it, else the copy proof's. Percentiles are nearest rank over keeper copies (match-now has no leader fill).

## Backtest ("what if I had followed")

| Method | Path | Body |
|---|---|---|
| POST | `/v1/leaders/:accountId/backtest` | `{ratioBps, maxLeverageHdths, maxSlippageBps?=100, markets:[{perpId, maxNotionalCNS}], maxEntryDeviationBps?=0, budgetCNS, lossStopBps?=0, dailyLossBps?=0, drawdownBps?=0, stopLossPct?, takeProfitPct?, flattenOnStop?=false, depositCNS, period: 7\|30\|90 (or "7d"...), slippageBps?, maxBuilderFeePer100K?}` |

Opening fills pay the deployment's builder fee (rounded up; closes never do); the response has `builderFee` and
`builderFeesCNS` (also included in `feesCNS`), and `maxBuilderFeePer100K` below the fee blocks opens with
`BuilderFeeTooHigh`. Needs the indexer (`PositionEvent` history); without it: `503 {"error": "history unavailable: ..."}`. Rate limit:
`QUOTE_IP_MINUTE` per IP. Response (abridged):

```json
{ "leaderAccountId": 4638, "period": "30d", "from": 1788800000, "to": 1791392000, "source": "indexer",
  "slippage": { "bps": 3, "source": "median copy deviation measured on 40 real copies of this leader (indexer), floored at 0" },
  "takerFeeBps": 3.5, "simulation": true,
  "depositCNS": "1000000000", "finalEquityCNS": "1043120500", "pnlCNS": "43120500", "pnlPct": 4.312, "feesCNS": "1210400",
  "maxDrawdownCNS": "18200000", "maxDrawdownBps": 176, "tradesCopied": 31,
  "tradesBlocked": { "EntryTooFar": 4, "LeaderBudgetExceeded": 2 }, "tradesBlockedTotal": 6,
  "skipped": { "LeaderSizeOrPriceUnknown": 1 }, "stops": [ { "t": 1790000000, "kind": "TakeProfit", "perpId": 16 } ],
  "equityCurve": [ { "day": 20705, "date": "2026-09-07", "equityCNS": "1000000000" } ],
  "openPositions": [], "trades": [ { "t": 1789000000, "perpId": 16, "action": "open", "side": "long", "lots": "2",
    "fillPNS": "1004530", "feeCNS": "70317", "pnlCNS": "-70317" } ], "eventsReplayed": 64,
  "assumptions": [ "This is a simulation of past trades, not a record of real copies. ...", "..." ] }
```

## Quotes (follow sheet)

| Method | Path | Body | Returns |
|---|---|---|---|
| POST | `/v1/quote/follow` | `{owner, leaderAccountId, policy}` | per allowed market where the leader holds a position: `{perpId, orderType, lotLNS, sizeDisplay, markPNS, pricePNS (slippage bound), expectedFillPNS (from Perpl book), notionalCNS, marginCNS, builderFeeCNS, leverageHdths, wouldBlock: null \| {reason, limit, actual}}`, `builderFee: {id, feePer100K, estimateCNS, appliesTo: "opening size only"}` (estimate = notional x fee / 100,000 rounded up, over the lines that would execute) plus the encoded `MirrorOrder[]` for match now. `policy.maxBuilderFeePer100K` defaults to 20 (max 1000); below the fee, lines get `wouldBlock` `BuilderFeeTooHigh` |

## Relay (gasless; the relayer pays gas, the user only signs)

| Method | Path | Body |
|---|---|---|
| POST | `/v1/relay/create` | `{owner, salt}` → deploys the MirrorAccount clone |
| POST | `/v1/relay/deposit` | `{account, mode: "permit"\|"auth", amount, deadline\|validAfter+validBefore+nonce, v, r, s}` |
| POST | `/v1/relay/execute` | `{account, action:{kind, data, nonce, deadline}, signature}` (follow, match now, set policy, pause, close all, withdraw, sweep) |
| POST | `/v1/relay/transfer` | ERC-3009 `transferWithAuthorization` for sending AUSD from the user's EOA |

Every relay call simulates first (`eth_call`), submits with an explicit gas limit (estimate x 1.2,
because Monad charges the gas limit), and returns `{txHash, status, block, gasUsed}` after
`eth_sendRawTransactionSync`. Rate-limited per owner and per IP.

## Demo (judge path, team-run, rate-limited)

| Method | Path | Effect |
|---|---|---|
| POST | `/v1/demo/trade` | demo leader opens 1 lot BTC on Perpl mainnet; the engine copies it into the demo follower; after ~20 s the leader closes and the copy close follows. Returns a cycle id; progress streams on `/v1/stream?account=demo` |
| POST | `/v1/demo/blocked` | demo leader opens 1 lot at a leverage above the demo follower's max; the copy is blocked onchain (Blocked event, own tx); the leader position is closed again |

Limits: one cycle at a time globally, at most N per IP per hour, global daily cap.

## Push

| Method | Path | Body |
|---|---|---|
| POST | `/v1/push/register` | `{owner, expoPushToken, notifyPublicKey}`; payloads are encrypted to `notifyPublicKey` (derived on device from a separate Mera PRF namespace) so the server only relays ciphertext |
