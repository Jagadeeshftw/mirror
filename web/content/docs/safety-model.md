---
title: Safety model
description: What the keeper can and cannot do, the tested invariants, the deposit cap, audit status and the escape hatch.
---

Mirror is designed so that the worst a compromised keeper or backend can do is place copies that already pass your policy. It cannot take your money.

## Roles

| Role | Who | Can |
|---|---|---|
| Owner | Your passkey-derived address (Mera) | Everything: deposit, set policy, follow, match now, pause, close all, withdraw, sweep, exchange call. |
| Relayer | Anyone, in practice the Mirror relayer | Submit actions the owner has **signed** (EIP-712) and gasless deposits the owner has signed. Cannot change what was signed. |
| Keeper | Addresses in the KeeperRegistry | Call `mirror(order)` only. |
| Registry owner | Mirror team | Add or remove keepers. No access to any account's funds or policy. |

There is no admin, no upgrade path and no pause switch outside the owner. Accounts are non-upgradeable EIP-1167 clones of one implementation.

## The keeper can trade, never withdraw

- The only keeper entry point is `mirror(MirrorOrder)`. It builds an **immediate-or-cancel** Perpl order inside the contract. The keeper cannot post resting orders and cannot choose how much collateral is moved.
- Every opening order passes the full policy check described in [How copying works](/docs/how-copying-works), plus post-trade checks that revert on any violation.
- `withdraw` always pays the **owner**, whoever submits it. `sweep(token)` also pays the owner. There is no function that sends collateral anywhere else.
- A keeper calling `withdraw` reverts with `NotOwner`. This is covered by unit tests, invariant tests and a fork test against the live Perpl Exchange.

## Invariants under test

The contracts ship with 91 passing tests: 73 unit tests, 6 fuzz tests (1,000 runs each), 8 invariant properties plus a call summary, and 3 fork tests against the live Perpl Exchange and AUSD on Monad mainnet. The invariants assert that:

- keepers and strangers never receive collateral,
- hostile calls from keepers and strangers always fail,
- no exposure increases while the account is paused,
- deposits stay within the cap,
- collateral is conserved.

On the mainnet fork, the tests run a gasless permit deposit, a 10x copy blocked by a 3x rule, a compliant 1-lot BTC copy that fills on Perpl's live order book, a keeper withdrawal that reverts, a third-party-relayed close-all followed by an owner withdrawal, and a relayed follow with match now.

## Deposit cap

The contracts are **unaudited**. Each account's net deposits are capped at **25 AUSD** (`DEPOSIT_CAP`, an immutable of the implementation). A deposit that would exceed the cap reverts with `DepositCapExceeded`. The first deposit must be at least Perpl's account minimum (10 AUSD) because it opens the account's Perpl account.

## Audit status

No external audit yet. The cap will only be raised after one. Until then, deposit only what you are prepared to lose; copy trading leveraged perpetuals is risky regardless of the contract.

## Loss stops reset correctly

The daily loss stop and the high-water-mark stop compare equity with a baseline. Deposits lift both baselines by the deposited amount and withdrawals lower them, so moving money in or out is never mistaken for performance.

## Exits are always open

- **Pause** (`setPaused(true)`) stops new opening copies immediately. Closing copies still go through, so the keeper can follow the leader out of a position.
- **Close all** (`closeAll(slippageBps)`, up to 20%) pauses and closes every open position with IOC orders bounded at mark ± slippage.
- **Withdraw** pulls collateral from Perpl as needed and sends it to the owner.
- **Expiry**: after your policy's expiry the account only reduces exposure.

Each is a signed action anyone can relay, so they work without MON and without the Mirror backend: any third party, or you from any wallet, can submit your signature.

## Escape hatch

`exchangeCall(bytes)` lets the **owner** make any call to the Perpl Exchange as the account, for example if Perpl changes its ABI or a position needs a manual action. Keepers and the registry owner have no equivalent.

## Signatures

Owner actions are EIP-712 typed data with a per-account nonce and a deadline. A signature is valid for exactly one action on one account on one chain, once. See [Contracts](/docs/contracts#eip-712-domain).
