## Agora: Best Mobile Trading App on Monad (Agora Onchain Trading Bounty)

### Q1. Describe the core features of your trading app.
<!--answer-->
Mirror is a copy-trading app for Perpl. A follower picks a leader, signs limits once with a passkey, and every leader trade is copied into the follower's own contract account, with the limits checked onchain on every order.

How the three integrations work together:
- Mera is the account. One passkey prompt creates the follower's key, which owns their MirrorAccount and signs every owner action; a second PRF namespace of the same passkey derives the key that decrypts alerts.
- AUSD is the balance. The follower's AUSD, Perpl's collateral, sits in their own MirrorAccount and is shown on every screen; deposits are gasless permits.
- Perpl is the venue. Every copy is an immediate-or-cancel order on Perpl's onchain order book, placed by the follower's contract.

What makes it more than a trading front end:
- The follower's own contract enforces their rules on every copy: per-leader ratio, budget and loss stop for up to four leaders, max leverage, markets, notional caps, slippage, an entry filter against the leader's onchain entry, loss stops, expiry.
- A rule hit is recorded onchain as a Blocked event with the numbers; every copy carries its price proof (leader fill, your fill, deviation, fee).
- Stop-loss and take-profit levels the owner signs can be executed by anyone once true onchain, so stops work even if Mirror is down.
- Watch mode: real copies land on a labelled team-run account before a new user deposits; "Run demo trade" makes one happen on demand.
- Match now: the follower's signed follow places the Perpl order at once.
- Android app and a web app for iPhone and laptop, the same passkey account.

Business model: Mirror is Perpl builder 26, 0.02% of the size a copy opens, nothing on closes or stops; confirmed by Perpl on 7 Oct 2026, live once deployed. The fee is shown before the passkey prompt and on every copy, and the follower's contract caps it at the maximum they sign.

Tested: 144 contract tests including fork tests against live Perpl and AUSD; the full stack passes 21 of 21 checks on a local network running Perpl's real exchange.
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
PENDING (video). The copy engine is built and tested (mainnet fork, and a local network running Perpl's real exchange); it is not deployed yet. The video will show:
- a leader fill arriving at Monad's Proposed stage
- the policy pre-check and the thin-book check against Perpl's order book
- the copied order landing on Perpl, attributed to builder 26 (0.02% on the opening size, shown in Perpl's fill event and in Mirror's proof), with latency and tx links
- a copy blocked by a rule, and a stop executed once it is true onchain
<!--/answer-->

### Q2. Link to your trading bot or automation system on Perpl with demonstrated real on-chain activity.
<!--answer-->
PENDING (link). Planned: the public stats page listing every copy the engine has executed, with MonadVision links and the keeper address.

Built: the engine uses Perpl's public REST context (market config, minimum sizes) and WebSocket market data (marks, best bid and ask, recent trades) to price, size and pre-check every copy and every match-now quote, and exposes them at /v1/markets. It executes onchain through each follower's MirrorAccount, attributing every opening order to Mirror's builder code (builder 26, 0.02% of opening size; confirmed by Perpl on 7 Oct 2026), and every closing order without one.
<!--/answer-->

## Monad Foundation: Best Mera-Powered UX on Monad

### Q1. Describe how your project meaningfully integrates Mera as the entire account layer
<!--answer-->
The Mera-derived EOA is the only owner of each MirrorAccount. Nothing else can withdraw, change the policy, pause or close all:
- no custody backend
- no other login (no Privy, no Dynamic)
- no seed phrase or extension

The keeper can trade within the policy but cannot withdraw. This is enforced in the contract and covered by invariant tests. Every owner action is an EIP-712 signature that anyone can relay, and deposits use AUSD permit or ERC-3009, so the user never needs MON.

Verified on Android emulators signed in to Google, with rpId mirror.0xo.in (assetlinks.json live and confirmed by Google's Digital Asset Links API):
- one fingerprint prompt creates the passkey and derives the account through Mera's PRF output
- on a second device with the same Google account, the synced passkey restores the same account address
- PRF-to-key derivation and EIP-712 signing work on device

PENDING:
- the same flows inside the Mirror app against the deployed contracts (verified so far in a release-signed probe app with the same package and rpId)
- scoped signing sessions in the live app and the fresh-device restore demo video
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
Verified on device, not yet in the live app. A second PRF namespace, separate from the account salt, derives an X25519 key that never signs transactions. Google Password Manager returns both PRF outputs in the same single passkey prompt, and the namespace key is identical when restored on a second device. In Mirror it encrypts the follower's push-notification payloads and private follow notes end to end, so the backend relays only ciphertext.

PENDING: the app currently derives this key with HKDF from the account PRF output; switching it to the separate PRF namespace verified here is the next app change.
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
