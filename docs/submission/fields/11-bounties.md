## Agora: Best Mobile Trading App on Monad (Agora Onchain Trading Bounty)

### Q1. Describe the core features of your trading app.
<!--answer-->
Mirror is a copy-trading app for Perpl. A follower picks a leader, sets limits once, and every leader trade is copied into the follower's own contract account, with the limits checked onchain on every order.

How the three integrations work together:
- Mera is the account. One passkey prompt creates the follower's key, which owns their MirrorAccount and signs every owner action.
- AUSD is the balance. The follower's AUSD, which is Perpl's collateral, sits in their own MirrorAccount.
- Perpl is the venue. Every copy is an immediate-or-cancel order on Perpl's onchain order book.

Built and tested (90 tests, including fork tests against live Perpl and AUSD on Monad mainnet):
- per-follower contract that owns its own Perpl account
- onchain policy: leaders, sizing ratio, max leverage, allowed markets, max notional per market, max slippage, daily loss stop, drawdown stop, expiry
- "blocked by your rule" recorded as an onchain event
- keeper can trade but never withdraw
- gasless AUSD deposits (permit, ERC-3009) and gasless signed owner actions (pause, close all, withdraw)
- match now: the follower's own passkey-signed follow places a Perpl order at once, bringing the account to the leader's current position at the sizing ratio, under the same onchain checks (fork-tested on the live book)

PENDING:
- the Android app: passkey onboarding, AUSD balance on every screen, leaderboard, leader profiles, follow sheet, live copy feed, positions and PnL
- mainnet deployment
- the copy engine
<!--/answer-->

### Q2. Submit a demo video (up to 2 mins) showing a user logging in via passkey, funding or viewing an AUSD balance, and placing at least one trade on Perpl in your app
<!--answer-->
PENDING. Needs the app and the mainnet contracts. The planned cut shows exactly these three steps in order:
1. passkey login
2. a 10 AUSD gasless deposit, with the balance shown
3. a follow with match now that places a Perpl trade at once, with its tx link
<!--/answer-->

## Perpl: Best use of Perpl's API

### Q1. Submit a demo video (up to 2 mins) showing your trading bot or automation system on Perpl with demonstrated real on-chain activity.
<!--answer-->
PENDING (video). The copy engine is built and passes an end-to-end run on a local fork of Monad mainnet; it is not deployed yet. The video will show:
- a leader fill arriving
- the policy pre-check
- the copied order landing on Perpl mainnet, with latency and tx links
- a copy blocked by a rule
<!--/answer-->

### Q2. Link to your trading bot or automation system on Perpl with demonstrated real on-chain activity.
<!--answer-->
PENDING (link). Planned: the public stats page listing every copy the engine has executed, with MonadVision links and the keeper address.

Built: the engine uses Perpl's public REST context (market config, minimum sizes) and WebSocket market data (marks, best bid and ask, recent trades) to price, size and pre-check every copy and every match-now quote, and exposes them at /v1/markets. It executes onchain through each follower's MirrorAccount.

Open question for Perpl: does this hybrid count as API use? Not yet asked.
<!--/answer-->

## Monad Foundation: Best Mera-Powered UX on Monad

### Q1. Describe how your project meaningfully integrates Mera as the entire account layer
<!--answer-->
The Mera-derived EOA is the only owner of each MirrorAccount. Nothing else can withdraw, change the policy, pause or close all:
- no custody backend
- no other login (no Privy, no Dynamic)
- no seed phrase or extension

The keeper can trade within the policy but cannot withdraw. This is enforced in the contract and covered by invariant tests. Every owner action is an EIP-712 signature that anyone can relay, and deposits use AUSD permit or ERC-3009, so the user never needs MON.

Verified so far:
- Mera 0.2.0 builds into an Expo Android app.
- PRF-to-key derivation and EIP-712 signing work on device.

PENDING:
- passkey create and restore on a real device. This needs the rpId domain's assetlinks.json to be hosted and a Google-signed-in phone.
- one-prompt onboarding
- scoped signing sessions
- the fresh-device restore demo
<!--/answer-->

### Q2. Submit an optional demo video (up to 2 mins) showing how Mera is integrated into your app, focusing on UX elements
<!--answer-->
PENDING. Planned:
- one-prompt onboarding
- a signed follow
- a gasless withdrawal
- restore on a second phone
<!--/answer-->

## Monad Foundation: Mera - One Passkey, Many Keys

### Q1. Describe how your project meaningfully utilizes Mera in non-account work.
<!--answer-->
PENDING. Not built. The plan is a second PRF namespace, separate from the account key, that never signs transactions. Its derived key would encrypt the follower's push-notification payloads and private follow notes end to end, so our backend relays only ciphertext. The exact use will be fixed once the app design is approved.
<!--/answer-->

### Q2. Submit an optional demo video (up to 2 mins) showing how Mera is used where at least one PRF namespace does non-account work
<!--answer-->
PENDING.
<!--/answer-->

## Nansen AI: Best use of Nansen

### Q1. Describe how your project meaningfully integrates Nansen API endpoint, MCP tool, and/or the Nansen CLI
<!--answer-->
PENDING (live data). The engine's Nansen module is built: an x402 client that pays per call in USDC on Monad, and leader enrichment (Monad PnL summary and Hyperliquid positions for the same address) that adjusts the leaderboard's ranking score rather than only being displayed. It is tested against a mock 402 server; no paid calls have been made yet.

Nansen's coverage of Monad wallets has not been verified yet. The first paid call is waiting on wallet funding.
<!--/answer-->

### Q2. Submit an optional demo video (up to 2 mins) showing how Nansen API endpoint, MCP tool, and/or the Nansen CLI are meaningfully integrated in your app.
<!--answer-->
PENDING.
<!--/answer-->

## Envio: Best Use of Envio

### Q1. Describe how your project meaningfully uses Envio's HyperIndex, HyperSync or HyperRPC to power real on-chain data in your app — not just installed, but actually driving a feature.
<!--answer-->
Built, not deployed yet. A HyperIndex indexer over Perpl Exchange position events and Mirror events, from Perpl's mainnet deploy block 54,773,010, with Mirror accounts registered dynamically from the factory. It derives leader stats with 7d, 30d and 90d windows, equity curves, decoded blocked copies and follower PnL attributed to each leader by FIFO. 24 handler tests pass, and a live sync of recent mainnet blocks decoded 1,700 real Perpl position events. In the app it powers:
- the leaderboard
- leader profiles, with derived PnL, drawdown, win rate and consistency
- follower PnL attributed per leader
- the public stats page
<!--/answer-->

### Q2. Submit an optional demo video (up to 2 mins) showing the data flowing end to end through Envio's HyperIndex, HyperSync or HyperRPC.
<!--answer-->
PENDING.
<!--/answer-->
