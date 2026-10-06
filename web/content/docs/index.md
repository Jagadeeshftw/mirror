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

| Component | Status |
|---|---|
| Contracts (MirrorAccount, factory, KeeperRegistry) | Built. 91 passing tests, including fork tests against the live Perpl Exchange and AUSD. |
| Mainnet deployment | Coming. Addresses will be listed on [Contracts](/docs/contracts). |
| Copy engine, relayer, API | In progress. |
| Envio indexer | In progress. |
| Android app | In progress. See [Download](/download). |
| Nansen wallet intelligence in the ranking | Coming. |

Deposits are capped at **25 AUSD per account** while the contracts are unaudited.

## Where to go next

- New here: [Quickstart](/docs/quickstart).
- Want the details: [How copying works](/docs/how-copying-works) and [Safety model](/docs/safety-model).
- Judging the project: [Judges guide](/docs/judges-guide).
- Building against it: [Contracts](/docs/contracts) and [API reference](/docs/api-reference).
