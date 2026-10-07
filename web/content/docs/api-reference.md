---
title: API reference
description: The Mirror backend API (engine and relayer) used by the app and the stats page.
---

The app and the public stats page talk only to this API and to Monad RPC, never to Perpl's API directly, so everything works from the US and the UK (Perpl's own API geo-blocks both). The engine runs in an EU region.

> The API is being built. Paths and fields below are the contract the app is written against; the base URL is published here once it is live.

**Base URL:** `API_BASE` (to be announced). All amounts are strings in raw units unless the field name ends in `Usd` or `Display`. Addresses are checksummed. Team-run accounts (demo leader, demo follower) are flagged `teamRun: true` everywhere and are excluded from every user and traction count.

## Read

| Method | Path | Returns |
|---|---|---|
| GET | `/v1/health` | `{ok, chainId, block, keeper:{address, balanceWei}, relayer:{…}, perpl:{wsConnected, lastMarkAt}, indexer:{lagBlocks}}` |
| GET | `/v1/config` | Chain, contract addresses, markets (perpId, symbol, decimals, mark, min order size), deposit cap, Perpl minimum account open, team-run addresses. |
| GET | `/v1/markets` | Per market: mark, oracle, funding, open interest, best bid and ask. |
| GET | `/v1/leaders?window=7d\|30d\|90d&sort=score\|pnl\|drawdown&market=BTC` | Ranked leaders: `{accountId, address, score, pnlUsd, pnlPct, maxDrawdownPct, winRate, avgLeverage, trades, markets[], followers, nansen:{labels[], …}, teamRun}` |
| GET | `/v1/leaders/:accountId` | Profile and due-diligence card: equity curve, stats, open positions, recent trades, Nansen labels and cross-venue notes, risk flags. |
| GET | `/v1/owners/:owner/accounts` | The owner's MirrorAccounts (predicted and deployed), each with balance, equity, policy, positions, PnL attributed per leader, paused, expiry. |
| GET | `/v1/accounts/:account` | One MirrorAccount in full. |
| GET | `/v1/accounts/:account/feed?cursor=` | Mirrored, Blocked, Deposited, Withdrawn, PolicyUpdated, Paused and ClosedAll events, each with `txHash`, `block`, `commitState` (proposed, voted, finalized), `latencyMs` (leader fill to copy tx) and the decoded block reason with limit and actual. |
| GET | `/v1/stats` | Public stats: accounts created, funded accounts, net AUSD deposited, copies executed, copies blocked per rule, median latency, active followers in the last 7 days, and every executed copy with its tx (paginated). Excludes team-run. |
| GET | `/v1/demo` | Demo leader and demo follower state, and recent demo cycles. |
| GET | `/v1/stream?account=…` | Server-Sent Events: feed events for an account (or `demo`) as they happen, including commit-state updates. |

## Quotes

| Method | Path | Body | Returns |
|---|---|---|---|
| POST | `/v1/quote/follow` | `{owner, leaderAccountId, policy}` | Per allowed market where the leader holds a position: `{perpId, orderType, lotLNS, sizeDisplay, markPNS, pricePNS (slippage bound), expectedFillPNS (from Perpl's book), notionalCNS, marginCNS, leverageHdths, wouldBlock: null \| {reason, limit, actual}}`, plus the encoded `MirrorOrder[]` for match now. |

## Relay (gasless)

The relayer pays gas; the user only signs.

| Method | Path | Body |
|---|---|---|
| POST | `/v1/relay/create` | `{owner, salt}` deploys the MirrorAccount clone. |
| POST | `/v1/relay/deposit` | `{account, mode: "permit"\|"auth", amount, deadline \| validAfter+validBefore+nonce, v, r, s}` |
| POST | `/v1/relay/execute` | `{account, action:{kind, data, nonce, deadline}, signature}`: follow, match now, set policy, pause, close all, withdraw, sweep. |
| POST | `/v1/relay/transfer` | ERC-3009 `transferWithAuthorization` for sending AUSD from the user's address. |

Every relay call simulates first (`eth_call`), submits with an explicit gas limit (estimate × 1.2, because Monad charges the gas limit), and returns `{txHash, status, block, gasUsed}` after `eth_sendRawTransactionSync`. Relay calls are rate-limited per owner and per IP.

## Demo (team-run, rate-limited)

| Method | Path | Effect |
|---|---|---|
| POST | `/v1/demo/trade` | The demo leader opens 1 lot of BTC on Perpl mainnet; the engine copies it into the demo follower; after about 20 s the leader closes and the copy close follows. Returns a cycle id; progress streams on `/v1/stream?account=demo`. |
| POST | `/v1/demo/blocked` | The demo leader opens 1 lot at a leverage above the demo follower's max; the copy is blocked onchain (a `Blocked` event in its own tx); the leader position is closed again. |

One cycle runs at a time globally, with a per-IP hourly limit and a global daily cap.

## Push

| Method | Path | Body |
|---|---|---|
| GET | `/v1/push/config` | Which alert channels the server delivers on: `{webPush: {vapidPublicKey} or null, expo, sse}`. |
| POST | `/v1/push/register` | `{owner, notifyPublicKey, expoPushToken?, webPush?}`. Alerts are sealed to `notifyPublicKey`, an X25519 key the device derives from its passkey's second PRF namespace (`mirror.prf.ns.notify.v1`), so the server and the push service only relay ciphertext. `webPush` is the browser's push subscription (Web Push with VAPID, no Firebase). |
| POST | `/v1/push/unregister` | `{owner, target}`: stop sending to a Web Push endpoint or Expo token. |

Alerts cover copies (with the Mirror fee), blocked copies (the rule and its numbers), stops (which stop, and who triggered it), a leader's loss stop, low equity, deposits and withdrawals, for your own accounts only. The notification itself always reads "Mirror: new activity"; the app decrypts the details on your device. In a browser the details are decrypted when you open Mirror, because the service worker can't read the key.
