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
| GET | `/v1/leaders?window=7d\|30d\|90d&sort=score\|pnl\|drawdown&market=BTC` | ranked leaders: `{accountId, address, score, pnlUsd, pnlPct, maxDrawdownPct, winRate, avgLeverage, trades, markets[], followers, nansen:{labels[], ...}, teamRun, adversarial}`. Never lists a Perpl account owned by a MirrorAccount (by `perplAccountId` or address) or a team-run account; the team-run demo leader is the one exception and is listed with `teamRun: true` |
| GET | `/v1/leaders/:accountId` | profile + due-diligence card: equity curve points, stats, open positions, recent trades, Nansen labels and cross-venue notes, risk flags, `adversarial`. `stats` includes `profitFactor` (gross realised profit / gross realised loss, null without a loss), `largestLossCNS` (most negative single realised PnL, "0" without one), `avgHoldSec` (mean flat-to-flat time per market, null without a round trip), `roundTrips`, `grossProfitCNS`, `grossLossCNS`, from the leader's position events in the window (the engine's stored Perpl events, or the indexer's last 1000 PositionEvents when configured; indexer stats keep their own fields next to these) |
| GET | `/v1/leaders/:accountId/copy-quality?period=all\|7d\|30d` | copy quality of this leader's copies (same shape as `/v1/stats/copy-quality`) |
| GET | `/v1/stats/copy-quality?period=all\|7d\|30d` | per copy leader fill vs follower fill, deviation, latency (ms and blocks); aggregates (including `builderFeesCNS`); blocks by reason; team-run in a separate `teamRun` block |
| GET | `/v1/owners/:owner/accounts` | `{owner, walletCNS, accounts}`: `walletCNS` is the owner's own AUSD balance read from the collateral token (null if the read fails); `accounts` are the owner's MirrorAccounts (predicted + deployed), each as `/v1/accounts/:account` |
| GET | `/v1/accounts/:account` | one MirrorAccount in full: balance, equity, policy (including `maxBuilderFeePer100K`), `builderFeesCNS` (sum of the builder fee on its copies), positions, PnL attributed per leader, paused (no new copies opened; the leader's closes are still mirrored), `detached` (see `/detach`), expiry, `levels` (owner stop-loss / take-profit per market, side `long`/`short`), `policy.markets[].halted` (a level fired there: opening copies refused until the next policy), plus the fields below |
| GET | `/v1/accounts/:account/feed?cursor=` | Mirrored / Blocked / Deposited / Withdrawn / PolicyUpdated / Paused / ClosedAll events, each with `txHash`, `block`, `commitState` (proposed/voted/finalized), `latencyMs` (leader fill to copy tx), decoded block reason with limit/actual, Mirrored `proof` `{leaderFillPNS, leaderEntryPNS, markPNS, fillPNS, entryDeviationBps, builderFeeCNS}` (`builderFeeCNS` = builder fee Perpl charged on that copy, 0 for closes); plus engine-side `EngineShrunk` / `EngineSkipped` items (see below). Every item has `onchain` |
| POST | `/v1/accounts/:account/detach` | "Stop following, keep my positions". Body `{detached: bool, deadline: unix s (string or number), signature}`: the account owner's EIP-712 signature over `Detach(bool detached,uint256 deadline)`, domain `{name: "Mirror Account", version: "1", chainId, verifyingContract: account}`. Checked against the account's onchain `owner()`; deadline at most 3600 s ahead and later than the last accepted one (single use). → `{account, detached, block}`; errors 400 `expired` / `deadline_too_far` / `bad_signature`, 401 `not_owner`, 404 `unknown_account`, 409 `replayed`. While `detached` the keeper sends the account **no copies, opens or closes**. This is keeper behaviour, not enforced by the contract: the owner keeps full control onchain (levels and stops anyone can trigger, closeMarket, closeAll, withdraw). Engine-side feed items `Detached` (`onchain: false`, `label` "Stopped following; positions kept" / "Following again", `data.detached`). A new policy (setPolicy / follow) or a signed `detached: false` clears it. 30 per IP per hour |
| GET | `/v1/stats` | public stats: accounts created, funded accounts, net AUSD deposited, copies executed, copies blocked per rule, median latency, active followers 7d, builder fees (`builderFeesCNS` = `builderFeesCopiesCNS` + `builderFeesMatchNowCNS`, from Mirrored proofs), every executed copy with tx link (paginated); all exclude team-run (team-run totals, builder fees included, under `teamRun`) |
| GET | `/v1/demo` | demo leader and demo follower state, recent demo cycles; each cycle has `holdMs` (how long the leader holds before closing: `DEMO_HOLD_MS` for `trade`, 2000 for `blocked`), and `holdMsByKind` gives both |
| GET | `/v1/stream?account=...` | Server-Sent Events: feed events for an account (or `demo`) as they happen, including commit-state updates |

### Account equity, today's PnL and loss stops

Extra fields on every MirrorAccount (`/v1/accounts/:account` and each item of `/v1/owners/:owner/accounts`):

```json
{ "createdAt": 1791375125, "todayPnlCNS": "-152", "dailyLossHit": false, "drawdownHit": false,
  "equityHistory": [ { "t": 1791375128, "equityCNS": "20000000" }, { "t": 1791375129, "equityCNS": "20000178" } ],
  "risk": { "dailyLossHit": false, "drawdownHit": false, "dailyLossFloorCNS": "18000000", "drawdownFloorCNS": "16000000",
            "dayStartEquityCNS": "20000000", "highWaterEquityCNS": "20000178" } }
```

- `equityHistory`: the last 30 days of equity snapshots, oldest first, `t` in unix seconds (thinned evenly to at most
  720 points). The engine stores a snapshot per account at most every `EQUITY_SNAPSHOT_MS` (default 5 min; a periodic
  sweep, or an account view that read equity anyway) and one on every copy (`Mirrored`), deposit, withdrawal and close
  all, in its DB (`equity_snapshots`, kept 35 days).
- `todayPnlCNS`: equity now minus the first snapshot of the UTC day (the last one before today when there is none
  yet), net of deposits and withdrawals since (each snapshot stores the contract's `netDeposits`). Null without a
  snapshot or without a chain read.
- `dailyLossHit` / `drawdownHit`: the contract's loss stops (`MirrorAccount._checkLossStops`) against current equity:
  a new UTC day restarts the day at current equity, the high-water mark rises with equity, and a stop holds when
  equity is below `dayStart x (1 - dailyLossBps)` or `highWater x (1 - drawdownBps)`. `risk` has the floors (null
  when the rule is 0). False and `risk: null` when the chain read fails.
- `createdAt`: unix seconds of the `AccountCreated` block.

### Copy facts on feed items

```json
{ "kind": "Mirrored", "orderType": 2, "block": 127, "leaderBlock": 126, "latencyBlocks": 1, "realisedPnlCNS": "-855",
  "leaderLotLNS": null, "leaderLeverageHdths": null }
{ "kind": "Blocked", "reason": "LeverageTooHigh", "block": 135, "leaderBlock": 134, "latencyBlocks": 1,
  "leaderLotLNS": "1", "leaderLeverageHdths": 1000 }
```

- `leaderBlock` (Mirrored and Blocked keeper copies): block of the leader fill named by `leaderRef`;
  `latencyBlocks` = copy block - leader block. Null for match-now orders and when the leader fill is unknown.
- `realisedPnlCNS` (Mirrored closes, order types 2 and 3): the follower's own Perpl close event in the copy
  transaction (sum of `deltaPnlCNS`); when that event is not stored, the change the contract booked in
  `leaderRealizedCNS(leader)` over the copy's block. Null for opens.
- `leaderLotLNS` / `leaderLeverageHdths` (Blocked): lots the leader traded and the leader's leverage on the fill that
  triggered the copy (from the leader's Perpl events). Null on other kinds.

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
| POST | `/v1/demo/trade` | demo leader opens 1 lot BTC on Perpl mainnet; the engine copies it into the demo follower; after `holdMs` (`DEMO_HOLD_MS`, default 20 s) the leader closes and the copy close follows. Returns `{cycleId, kind, status, stream, holdMs}`; progress streams on `/v1/stream?account=demo` (the `leader_opening` step carries `holdMs`) |
| POST | `/v1/demo/blocked` | demo leader opens 1 lot at a leverage above the demo follower's max; the copy is blocked onchain (Blocked event, own tx); the leader position is closed again |

Limits: one cycle at a time globally, at most N per IP per hour, global daily cap.

## Shared positions and suggested levels

The owner shares one open position as a link (`https://mirror.0xo.in/p/<urlId>`). Anyone with the link sees a
read-only card and may suggest a stop-loss and/or take-profit with a short note. No login, no friend list, no chat;
nothing about the friend is stored (rate limits are in memory). The owner decides in the app: **Accept** is their own
`setLevels` (`ACTION_SET_LEVELS`, one passkey prompt, relayed as usual); the engine only records which transaction
carried it. Links are revocable and close for good when the position closes or flips side.

Owner signatures are EIP-712 in the account's domain `{name: "Mirror Account", version: "1", chainId,
verifyingContract: account}`, checked against the account's onchain `owner()`, deadline at most 3600 s ahead:
`ShareLink(uint32 perpId,bytes32 linkId,uint256 deadline)`, `ShareRevoke(bytes32 linkId,uint256 deadline)`,
`ShareDecline(uint256 suggestionId,uint256 deadline)`. `linkId` is 32 random bytes made by the app; `urlId` is its
43-character base64url form. Every `:id` below accepts either.

| Method | Path | Effect |
|---|---|---|
| POST | `/v1/share` | `{account, perpId, linkId, deadline, signature}` (ShareLink) → `{linkId, urlId, status: "open", perpId, side}`. The account must hold a position in `perpId`; its side is recorded. Errors 400 `weak_link_id` / `expired` / `deadline_too_far` / `bad_signature`, 401 `not_owner`, 404 `unknown_account`, 409 `link_exists` / `no_position`, 429 `too_many_links` (`SHARE_MAX_OPEN_LINKS`, 10 open per account). 60 per IP per hour |
| GET | `/v1/share/:id` | the friend's card. Open: `{status: "open", perpId, symbol, side, sharedBy (short owner address, the only owner detail), copiedFrom (short leader address or null), lotLNS, entryPNS, markPNS, depositCNS, pnlCNS, stopLossPNS, takeProfitPNS ("0" = none), lotDecimals, priceDecimals, block}`. Ended: `{status: "revoked" \| "closed", endedReason: "revoked" \| "position_closed" \| "side_flipped", symbol, side, sharedBy}` and no numbers. The position is re-read on every call, so a closed position closes the link here too. 404 `unknown_link` |
| POST | `/v1/share/:id/suggest` | `{stopLossPNS?, takeProfitPNS?, note?}` (integer prices as strings; omitted = keep the current level) → `{id, status: "pending", stopLossPNS, takeProfitPNS, prevStopLossPNS, prevTakeProfitPNS, note}`. Checked like the contract checks a level for the position's side, merged with the current level: a long's stop below its take-profit, a short's above (400 `level_order`); plus a level already reached at the mark (400 `level_reached`, it would fire at once), a price more than 10x from the mark (400 `level_far`), neither given (400 `level_empty`), not a positive uint64 (400 `bad_level`). `field` names the offending input. The note is plain text: control, zero-width and bidi characters and `<` `>` removed, whitespace collapsed, at most 140 characters, no links (400 `bad_note`). 410 `revoked` / `closed`. Limits (counted only for a valid suggestion): one per link per IP per hour (`SHARE_SUGGEST_LINK_IP_HOURLY`), 10 per link per hour, 20 per IP per hour, 20 pending per link (429). Sends the owner an encrypted alert (`kind: suggestion`) and a content-free `share` event on the account's stream |
| GET | `/v1/accounts/:account/share?key=<notifyPublicKey>` | the owner's links and suggestions, sealed (envelope v1, as alerts) to `key`, which must be a notification key the account's owner registered with a valid owner signature (signed `/v1/push/register`; any other key, including rows from before signatures were required, gets 403 `unknown_key`). → `{pending, sealed}`; `sealed` opens to `{v: 1, account, links: [{linkId, urlId, perpId, side, status, createdMs, endedMs, endedReason}], suggestions: [{id, linkId, perpId, side, stopLossPNS, takeProfitPNS (null = not suggested), prevStopLossPNS, prevTakeProfitPNS, entryPNS, markPNS, note, status: pending \| accepted \| declined \| expired, createdMs, decidedMs, txHash}]}` (last 50 links, 100 suggestions). Like alerts, the owner's device opens it with the key from the passkey's notify PRF namespace; the server answers no one in clear |
| POST | `/v1/share/:id/revoke` | `{deadline, signature}` (ShareRevoke) → `{linkId, status: "revoked"}`; pending suggestions expire. Idempotent |
| POST | `/v1/share/suggestions/:sid/decline` | `{deadline, signature}` (ShareDecline) → `{id, status: "declined"}`. 409 when already accepted or expired |
| POST | `/v1/share/suggestions/:sid/accept` | `{txHash}` → `{id, status: "accepted", txHash}`. No signature: the transaction is the proof. It must have succeeded and carry the account's `LevelSet` for the link's market and side with every suggested level (404 `unknown_tx`, 409 `tx_reverted` / `levels_mismatch`) |

Links also close when the account's feed shows a close (`Mirrored` close, `StopTriggered`, `MarketClosed`,
`ClosedAll`) and on a sweep every minute; pending suggestions of an ended link become `expired`.

## Push

| Method | Path | Body |
|---|---|---|
| GET | `/v1/push/config` | `{webPush: {vapidPublicKey} \| null, fcm: bool, expo: bool, sse: true, chainId}`: which channels this server delivers on (`webPush` is null without VAPID keys, `fcm` false without a Firebase service account) and the chain id for the signatures below |
| POST | `/v1/push/register` | `{owner, notifyPublicKey, webPush?: {endpoint, keys: {p256dh, auth}}, fcmToken?, expoPushToken?, deadline, signature}` → `{ok, owner, channels}`. Owner-signed (below). `notifyPublicKey` is the device's X25519 public key (32 bytes, base64 or hex), derived on the device from the passkey's second PRF namespace `mirror.prf.ns.notify.v1`; the server never holds the private half. At most one remote channel per call: `webPush` is a browser `PushSubscription.toJSON()` whose endpoint must be a known browser push service (FCM, Mozilla, Apple, Windows); `fcmToken` is the app's native FCM registration token (Android); `expoPushToken` (`ExponentPushToken[…]`, fallback only; other values such as `unavailable:no-fcm-config` are ignored). The in-app (SSE) channel is registered with every call. At most 10 targets per owner; 30 calls per IP per hour. Errors: 400 invalid body / `expired` / `deadline_too_far` / `bad_signature`, 401 `signature_required` / `not_owner`, 409 `replayed` |
| POST | `/v1/push/unregister` | `{owner, channel: "webpush" \| "fcm" \| "expo", target, deadline, signature}` (PushUnregister) → `{ok, removed}`. Same errors |

**Owner signature.** A registration decides who can read the owner's alerts and sealed share list, so the owner EOA
(the passkey-derived key) signs EIP-712 typed data in the domain `{name: "Mirror Push", version: "1", chainId}` (no
verifyingContract):

```
PushRegister(address owner,bytes32 notifyPublicKey,bytes32 channelHash,uint256 deadline)
PushUnregister(address owner,bytes32 channelHash,uint256 deadline)
channelHash = keccak256(utf8("<channel>:<target>"))   // "webpush:<endpoint>", "fcm:<token>", "expo:<token>", "app:"
```

`notifyPublicKey` is the raw 32-byte key. `channelHash` commits to the Web Push endpoint or device token in the body
(`"app:"` when no remote channel is sent), so a signature cannot be moved to another key or channel. `deadline` is
unix seconds, not in the past and at most 3600 s ahead; each signature (its EIP-712 digest) is accepted once. The
signer must be `owner`. Only rows registered this way are ever used: alerts are sealed only to them and the share list
(`?key=`) only answers for them; unsigned rows from before this rule are deleted at startup. The app signs in the
passkey prompt of "Turn on alerts" (and, if this device is not registered yet, inside the share-link prompt), and
remembers the registration so app starts never prompt. Test vector shared by the engine and app tests:
`shared/test-vectors/push-register-v1.json`.

**What is alerted** (owner's own MirrorAccounts only; team-run accounts and the `demo` channel never alert):
`Mirrored` open (copy with size, notional and the Mirror fee) and close (realised PnL when known); `Blocked` (the rule
and its numbers, e.g. "leader 10.0x, your max 5.0x"); a `Blocked` for `DailyLossStop` / `DrawdownStop` /
`LeaderLossStop` (stop hit, with equity and floor); `EngineSkipped` (thin book); `StopTriggered` (which stop, and
who triggered it: you, Mirror's keeper, or another address); `LeaderStopped`; `Deposited` / `Withdrawn`; low equity
(equity under `PUSH_LOW_EQUITY_PCT`% of net deposits, once per account per UTC day). Events older than
`PUSH_MAX_AGE_SEC` (900) are never alerted, so a backfill sends no history. Each event is alerted once (deduped by
account + feed id) and at most `PUSH_RATE_PER_MIN` (20) alerts per owner per minute. A new suggestion on a shared
position link alerts too (`kind: suggestion`, `eventId: suggestion:<id>`, see "Shared positions").

**Payload.** The alert JSON `{v: 1, kind, title, body, account, eventId, txHash, timestamp}` (`kind`: `copied`,
`closed`, `blocked`, `stop`, `leader_stop`, `low_equity`, `deposit`, `withdraw`, `suggestion`) is sealed to each registered
`notifyPublicKey` as envelope v1 `{v: 1, epk, nonce, ct}` (standard base64): ephemeral X25519 → HKDF-SHA256(salt =
`epk || recipientPub`, info `mirror.v1.push.chacha20poly1305`) → ChaCha20-Poly1305 (AAD `mirror.v1`, tag appended).
Test vector shared by the engine and app tests: `shared/test-vectors/push-envelope-v1.json`.

**Delivery** (every channel relays the same ciphertext; the visible text is always generic):

| Channel | How | Visible text |
|---|---|---|
| In-app (SSE) | `event: push` on `/v1/stream?account=<account>`, one envelope per registered device key; a device skips envelopes it can't open | none (the app adds the decrypted alert to Alerts) |
| Web Push | VAPID (RFC 8292) + aes128gcm (RFC 8291) via the `web-push` package, body `{"mirror": envelope}`, TTL 3600, urgency high. 404/410 removes the subscription; 20 failures in a row remove it too. On when `VAPID_PUBLIC_KEY` + `VAPID_PRIVATE_KEY` are set (`pnpm gen:vapid` in `engine/`; `VAPID_SUBJECT` defaults to `https://mirror.0xo.in`) | the service worker shows "Mirror / New activity" |
| FCM (Android) | FCM HTTP v1 `POST https://fcm.googleapis.com/v1/projects/<project>/messages:send` with an OAuth2 token minted from the Firebase service account (JWT RS256, scope `firebase.messaging`, cached until a minute before expiry). One data message per token: `{token, data: {title: "Mirror", message: "New activity", channelId: "copies", mirror: "<envelope JSON>", body: "{\"mirror\": …}"}, android: {priority: HIGH, ttl: 3600s}}`; no `notification` block, expo-notifications presents the generic text from `data`. `UNREGISTERED` / 404 removes the token; a 401 mints a new token once; other errors count towards the 20 failures. On when `FCM_SERVICE_ACCOUNT_PATH` or `FCM_SERVICE_ACCOUNT_JSON` is set (docs/engine.md) | "Mirror / New activity" |
| Expo (fallback) | `https://exp.host/--/api/v2/push/send`, `{to, title: "Mirror", body: "New activity", data: {mirror: "<envelope JSON>"}, channelId: "copies"}`. `DeviceNotRegistered` removes the token. Only for Expo tokens registered earlier, with `PUSH_ENABLED=1` (+ `EXPO_ACCESS_TOKEN` if the Expo project enforces push security); the app now registers FCM tokens | "Mirror / New activity" |

`PUSH_WEBPUSH_ENDPOINT_OVERRIDE` (Stage-A test hook, refused unless `NETWORK=localnet`) sends every Web Push request
to one URL instead of the subscription endpoint, with the original endpoint in `x-mirror-endpoint`.
`FCM_ENDPOINT_OVERRIDE` (test hook, refused unless `NETWORK=localnet`) does the same for FCM: messages go to that URL
and the access token is minted at `<origin>/token` of the same server.
