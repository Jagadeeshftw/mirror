---
title: Overview
description: What Mirror is, what it guarantees, and what is live today.
---

Mirror lets you copy the best traders on [Perpl](https://perpl.xyz), the fully onchain perpetuals exchange on Monad, from an Android phone, without handing your money or your keys to a copy-trading platform.

Every follower gets their own smart contract account, a **MirrorAccount**. It owns its own Perpl account and holds your AUSD collateral. You set a policy once and the contract checks it on **every** copied order. A keeper watches the leaders you follow and submits the copies. The keeper can trade through your account. It can never withdraw.

## The three guarantees

1. **Your limits are enforced onchain.** Leverage, markets, size, slippage, loss stops and expiry are checked by your contract before an order reaches Perpl. Nothing is enforced by "trust our server".
2. **Nobody but you can move your money.** There is no code path that sends collateral to anyone except the owner, which is your passkey. No admin, no upgrade, no keeper withdrawal.
3. **"Blocked by your rule" is provable.** When a copy would break a rule the contract does not trade; it emits a `Blocked` event with the rule and the numbers, in its own transaction.

## How the pieces fit

| Piece | Role |
|---|---|
| Mera passkey | Your account. One fingerprint or face prompt creates it; it signs every owner action. No seed phrase. |
| MirrorAccount | Your contract. Holds AUSD, owns a Perpl account, enforces your policy. |
| Keeper | Watches leader fills and submits copies through `mirror()`. Bounded by your policy. |
| Relayer | Pays gas for your signed actions and deposits, so you never need MON. |
| Indexer | Envio HyperIndex over Perpl and Mirror events: leaderboard, PnL per leader, public stats. |
| Perpl | The venue. Every copy is an immediate-or-cancel order on its onchain order book. |

## Status

Mirror is in beta and is being built in the open for Monad's Metropolis hackathon.

| Component | Status (8 Oct 2026) |
|---|---|
| Contracts (MirrorAccount, factory, KeeperRegistry) | Built. 158 passing tests, including fork tests against the live Perpl Exchange and AUSD. Slither report in the repository. |
| Testnet deployment | Deployed and verified on Monad testnet on 7 Oct 2026. Addresses on [Contracts](/docs/contracts). |
| Mainnet deployment | Not deployed. After testnet, on the owner's go. |
| Team-run demo accounts | Testnet: demo leader Perpl account 1000 and demo follower `0x634BFE3c2E4c483e8F7F4f3F3b6B2B7383A74896`. Mainnet: demo leader Perpl account 5416, 10.00 AUSD. See [Team-run accounts](/docs/team-run-accounts). |
| Copy engine, relayer, API | Built, 218 tests. Run against public testnet from the developer's machine; not hosted yet. |
| Envio indexer | Built, with per-copy quality, 44 tests. Not hosted yet. |
| Web app | Live at [/app](/app) since 8 Oct 2026 (testnet). Until the hosted engine is live, it shows the demo account's copies read from Monad and says when an action needs the service. |
| Android app | APK 1.0.1 (testnet beta) published on 8 Oct 2026. Tested on Android emulators only. See [Download](/download). |
| Nansen wallet intelligence in the ranking | Built behind an interface; live data needs an API key. |

Deposits are capped while the contracts are unaudited: **25 AUSD per account** planned for mainnet, 200 test AUSD on testnet.

## Where to go next

- New here: [Quickstart](/docs/quickstart).
- Want the details: [How copying works](/docs/how-copying-works) and [Safety model](/docs/safety-model).
- Judging the project: [Judges guide](/docs/judges-guide).
- Building against it: [Contracts](/docs/contracts) and [API reference](/docs/api-reference).
- Checking a claim yourself: [Run the tests](/docs/run-the-tests).

## Links

- Source: [github.com/Jagadeeshftw/mirror](https://github.com/Jagadeeshftw/mirror) (MIT)
- X: [@MirrorOnMonad](https://x.com/MirrorOnMonad)
- Public stats: [mirror.0xo.in/stats](/stats)
