## Agora: Best Mobile Trading App on Monad (Agora Onchain Trading Bounty)

### Q1. Describe the core features of your trading app.
<!--answer-->
Mirror is a copy-trading app for Perpl. A follower picks a leader, signs limits once with a passkey, and every leader trade is copied into the follower's own contract account, with the limits checked onchain on every order.

How the three integrations work together:
- Mera is the account. One passkey prompt creates the follower's key, which owns their MirrorAccount and signs every owner action; a second PRF namespace of the same passkey derives the key that decrypts alerts.
- AUSD is the balance. The follower's AUSD, Perpl's collateral, sits in their own MirrorAccount and is shown in the app bar on every main screen; deposits are gasless permits.
- Perpl is the venue. Every copy is an immediate-or-cancel order on Perpl's onchain order book, placed by the follower's contract.

What makes it more than a trading front end:
- The follower's own contract enforces their rules on every copy: per-leader ratio, budget and loss stop for up to four leaders, max leverage, markets, notional caps, slippage, an entry filter against the leader's onchain entry, loss stops, expiry.
- A rule hit is recorded onchain as a Blocked event with the numbers; every copy carries its price proof (leader fill, your fill, deviation, fee).
- Stop-loss and take-profit levels the owner signs can be executed by anyone once true onchain, so stops work even if Mirror is down.
- Stop following, keep my positions: enforced by the contract per leader, which then refuses that leader's copies while the follower's own stops and closes keep working.
- Watch mode: real copies land on a labelled team-run account before a new user deposits; "Run demo trade" makes one happen on demand.
- Match now: the follower's signed follow places the Perpl order at once.
- Android app and a web app for laptop browsers, the same passkey account.

Business model: Mirror is Perpl builder 26, 0.02% of the size a copy opens, nothing on closes or stops; confirmed by Perpl on 7 Oct 2026, live once deployed and set in the testnet deployment. The fee is shown before the passkey prompt and on every copy, and the follower's contract caps it at the maximum they sign. No revenue yet: on testnet builder 26 has only been charged in test AUSD (test funds), and nothing is deployed on mainnet.

Status (8 Oct 2026): contracts deployed and verified on Monad testnet; Android APK 1.0.1 (testnet beta, https://mirror.0xo.in/download) and the web app (https://mirror.0xo.in/app) published on 8 Oct 2026; hosted engine not live yet; not on mainnet.

Tested: 158 contract tests, including 6 fork tests against live Perpl and AUSD. On a local network running Perpl's real exchange code, the Android app passes 34 of 34 end-to-end steps on two Android emulators with real Google passkeys, and the web app 64 of 64. On public Monad testnet, with the engine run on the developer's machine, the Android app passes 11 of 11 steps on emulators: passkey restore, a gasless deposit and follow, a copied Perpl testnet trade (https://testnet.monadvision.com/tx/0xc14cd15a3d3243263fc3b43cd2b7d1ae349c407622bf7479dc788ef7c873aa9b), close all and withdraw.
<!--/answer-->

### Q2. Submit a demo video (up to 2 mins) showing a user logging in via passkey, funding or viewing an AUSD balance, and placing at least one trade on Perpl in your app
<!--answer-->
PENDING. Not recorded yet; it needs the hosted testnet engine. The final cut (docs/storyboards.md, video 3), on an Android emulator against Mirror's testnet contracts and Perpl testnet, shows in order:
1. passkey login (one prompt)
2. the AUSD balance, and a gasless deposit into the user's own account
3. a follow with match now that places a Perpl trade at once, with its tx link
<!--/answer-->

## Perpl: Best use of Perpl's API

### Q1. Submit a demo video (up to 2 mins) showing your trading bot or automation system on Perpl with demonstrated real on-chain activity.
<!--answer-->
PENDING (video). The copy engine is built and tested (218 tests; a mainnet fork; a local network running Perpl's real exchange code). Mirror's contracts are deployed on Monad testnet; the hosted engine is not live yet, but the engine has copied Perpl testnet trades from the developer's machine (tx links in the next answer). The video (docs/storyboards.md, video 4), on Perpl testnet, will show:
- a leader fill arriving at Monad's Proposed stage
- the policy pre-check and the thin-book check against Perpl's order book
- the copied order landing on Perpl, attributed to builder 26 (0.02% on the opening size, in Perpl's fill event and in Mirror's proof), with latency and tx links
- a copy blocked by a rule, and a stop executed once it is true onchain
<!--/answer-->

### Q2. Link to your trading bot or automation system on Perpl with demonstrated real on-chain activity.
<!--answer-->
PENDING (link). Planned: the public stats page listing every copy the engine executes, with MonadVision links and the keeper address, once the hosted engine and indexer are live.

On public Monad testnet, the engine run from the developer's machine has already copied the team-run demo leader (Perpl testnet account 1000) into the demo follower's MirrorAccount:
- open copied, builder 26 charged 166 units (0.000166 test AUSD; test funds, not revenue): https://testnet.monadvision.com/tx/0xc14cd15a3d3243263fc3b43cd2b7d1ae349c407622bf7479dc788ef7c873aa9b
- close copied with fee 0: https://testnet.monadvision.com/tx/0x83922244bd82b863b07e8e7c771d39757d631d61327459afb89054ee04bfe373
- a 10x copy blocked onchain by the follower's 2x rule: https://testnet.monadvision.com/tx/0xcfeeda062c5a5590e051c892d7c379c0019d93548f5f66f13043718f7a6d80aa

Built: the engine uses Perpl's public REST context (market config, minimum sizes) and WebSocket market data (marks, best bid and ask, recent trades, order book) to price, size and pre-check every copy and every match-now quote, and exposes them at /v1/markets. It executes onchain through each follower's MirrorAccount, attributing every opening order to Mirror's builder code (builder 26, 0.02% of opening size; confirmed by Perpl on 7 Oct 2026), and every closing order without one. Before an opening copy it measures Perpl's book: below 2x the order's size within the limit price the copy is shrunk, and skipped if not even one lot fits.
<!--/answer-->

## Monad Foundation: Best Mera-Powered UX on Monad

### Q1. Describe how your project meaningfully integrates Mera as the entire account layer
<!--answer-->
The Mera-derived EOA is the only owner of each MirrorAccount. Nothing else can withdraw, change the policy, pause, stop following a leader or close all:
- no custody backend
- no other login (no Privy, no Dynamic)
- no seed phrase or extension (an optional recovery phrase export exists in Settings)

The keeper can trade within the policy but cannot withdraw. This is enforced in the contract and covered by invariant tests. Every owner action is an EIP-712 signature that anyone can relay, and deposits use AUSD permit or ERC-3009, so the user never needs MON.

Signing: each owner action opens a Mera secp256k1 signing session scoped to that action, one passkey prompt, and ends it (key zeroed) as soon as the action is signed.

Verified on Android emulators signed in to Google, with rpId mirror.0xo.in (assetlinks.json live):
- in the Mirror app (release-signed build, real Google passkeys), 34 of 34 end-to-end steps against Perpl's real exchange code on a local network: one prompt creates the account; follow, levels, stop following, close all and withdraw each take one prompt; on a second emulator signed in to the same Google account, the synced passkey restores the same account address
- the web app runs the same flows in Chrome, 64 of 64

On public Monad testnet (Mirror's testnet contracts, Perpl testnet, the engine run from the developer's machine), 11 of 11 steps on Android emulators: restore from the passkey, create, deposit and follow with one prompt, stop following, close all and withdraw. Not yet: the same flows against the hosted testnet service (pending). Android testing so far is on Android emulators only.
<!--/answer-->

### Q2. Submit an optional demo video (up to 2 mins) showing how Mera is integrated into your app, focusing on UX elements
<!--answer-->
PENDING. Planned on Android emulators: one-prompt onboarding, a signed follow, a gasless withdrawal, and restore on a second emulator.
<!--/answer-->

## Monad Foundation: Mera - One Passkey, Many Keys

### Q1. Describe how your project meaningfully utilizes Mera in non-account work.
<!--answer-->
In the app (Android and web) and tested end to end. A second PRF namespace of the same passkey, "mirror.prf.ns.notify.v1", separate from the account salt, derives an X25519 key that never signs transactions (key agreement only). Google Password Manager returns both PRF outputs in the same single passkey prompt (on the web, one navigator.credentials ceremony with prf.eval.first and .second), and the namespace key is identical when restored on a second device.

Mirror uses it to encrypt alerts end to end: the engine holds only the public key and seals each alert (copies with their fee, blocks with the rule and numbers, stops and who executed them, a detached leader) with X25519 + ChaCha20-Poly1305. The push provider (Web Push, or FCM on Android) only ever sees "Mirror: new activity"; the app decrypts the real text on the device. Push registration is signed by the owner, so nobody else can register a device for an account.

Tested: a shared test vector checked by both the engine and the app; the local web run captures the engine's push request and checks it is still sealed, then shows the alert decrypted on the Alerts screen; the Android run on emulators receives the alert through FCM with the app in the background and shows it decrypted.
<!--/answer-->

### Q2. Submit an optional demo video (up to 2 mins) showing how Mera is used where at least one PRF namespace does non-account work
<!--answer-->
PENDING.
<!--/answer-->

## Nansen AI: Best use of Nansen

### Q1. Describe how your project meaningfully integrates Nansen API endpoint, MCP tool, and/or the Nansen CLI
<!--answer-->
PENDING (live data). The engine's Nansen module is built: an x402 client that pays per call in USDC on Monad (or an API key), and leader enrichment (Monad PnL summary and Hyperliquid positions for the same address) that adjusts the leaderboard's ranking score rather than only being displayed. It is tested against a mock 402 server; no live or paid calls have been made yet.

Nansen's coverage of Monad wallets has not been verified yet. The first live call is waiting on access.
<!--/answer-->

### Q2. Submit an optional demo video (up to 2 mins) showing how Nansen API endpoint, MCP tool, and/or the Nansen CLI are meaningfully integrated in your app.
<!--answer-->
PENDING.
<!--/answer-->

## Envio: Best Use of Envio

### Q1. Describe how your project meaningfully uses Envio's HyperIndex, HyperSync or HyperRPC to power real on-chain data in your app — not just installed, but actually driving a feature.
<!--answer-->
Built, not hosted yet. A HyperIndex indexer over Perpl Exchange position, liquidation and deleverage events and Mirror's own events, with Mirror accounts registered dynamically from the factory. One config for mainnet, from Perpl's deploy block 54,773,010, and one for testnet, where Mirror's contracts are deployed. It derives leader stats with 7d, 30d and 90d windows, equity curves, decoded blocked copies, per-copy quality (leader price against follower price, delay in blocks and seconds, fees) and follower PnL attributed to each leader by FIFO. 44 tests pass, and a live sync of recent mainnet blocks decoded 1,700 real Perpl position events. Both indexers share one rate-limited HyperSync proxy. In the app and site it powers:
- the leaderboard
- leader profiles, with derived PnL, drawdown, win rate and consistency
- follower PnL attributed per leader
- the public stats page
- the Perpl-wide analytics and risk view (/perpl)
<!--/answer-->

### Q2. Submit an optional demo video (up to 2 mins) showing the data flowing end to end through Envio's HyperIndex, HyperSync or HyperRPC.
<!--answer-->
PENDING.
<!--/answer-->
