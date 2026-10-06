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
| GET | `/v1/config` | chain, contract addresses, markets (perpId, symbol, decimals, mark, min order size from Perpl context), deposit cap, Perpl min account open, team-run addresses |
| GET | `/v1/markets` | per market: mark, oracle, funding, OI, best bid/ask (from Perpl REST/WS) |
| GET | `/v1/leaders?window=7d\|30d\|90d&sort=score\|pnl\|drawdown&market=BTC` | ranked leaders: `{accountId, address, score, pnlUsd, pnlPct, maxDrawdownPct, winRate, avgLeverage, trades, markets[], followers, nansen:{labels[], ...}, teamRun}` |
| GET | `/v1/leaders/:accountId` | profile + due-diligence card: equity curve points, stats, open positions, recent trades, Nansen labels and cross-venue notes, risk flags |
| GET | `/v1/owners/:owner/accounts` | the owner's MirrorAccounts (predicted + deployed), each with balance, equity, policy, positions, PnL attributed per leader, paused, expiry |
| GET | `/v1/accounts/:account` | one MirrorAccount in full |
| GET | `/v1/accounts/:account/feed?cursor=` | Mirrored / Blocked / Deposited / Withdrawn / PolicyUpdated / Paused / ClosedAll events, each with `txHash`, `block`, `commitState` (proposed/voted/finalized), `latencyMs` (leader fill to copy tx), decoded block reason with limit/actual |
| GET | `/v1/stats` | public stats: accounts created, funded accounts, net AUSD deposited, copies executed, copies blocked per rule, median latency, active followers 7d, every executed copy with tx link (paginated); all exclude team-run |
| GET | `/v1/demo` | demo leader and demo follower state, recent demo cycles |
| GET | `/v1/stream?account=...` | Server-Sent Events: feed events for an account (or `demo`) as they happen, including commit-state updates |

## Quotes (follow sheet)

| Method | Path | Body | Returns |
|---|---|---|---|
| POST | `/v1/quote/follow` | `{owner, leaderAccountId, policy}` | per allowed market where the leader holds a position: `{perpId, orderType, lotLNS, sizeDisplay, markPNS, pricePNS (slippage bound), expectedFillPNS (from Perpl book), notionalCNS, marginCNS, leverageHdths, wouldBlock: null \| {reason, limit, actual}}` plus the encoded `MirrorOrder[]` for match now |

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
