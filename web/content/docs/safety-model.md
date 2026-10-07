---
title: Safety model
description: What the keeper can and cannot do, stops anyone can trigger, the tested invariants, the deposit cap, audit status and the escape hatch.
---

Mirror is designed so that the worst a compromised keeper or backend can do is place copies that already pass your policy. It cannot take your money.

## Roles

| Role | Who | Can |
|---|---|---|
| Owner | Your passkey-derived address (Mera) | Everything: deposit, set policy, set levels, follow, match now, pause, close a market, close all, withdraw, sweep, exchange call. |
| Relayer | Anyone, in practice the Mirror relayer | Submit actions the owner has **signed** (EIP-712) and gasless deposits the owner has signed. Cannot change what was signed. |
| Keeper | Addresses in the KeeperRegistry | Call `mirror(order)` only. |
| Anyone | Any address | Call `triggerLevel`, `triggerAccountStop` and `triggerLeaderStop`, which only succeed when the stop's condition is true onchain and only send reduce-only closes. |
| Registry owner | Mirror team | Add or remove keepers. No access to any account's funds or policy. |

There is no admin and no upgrade path, and no Mirror contract has a code path that sends collateral to anyone but you. Accounts are non-upgradeable EIP-1167 clones of one implementation.

Mirror's fee is a Perpl builder fee: 0.02% of the size a copy opens, charged by Perpl's exchange on the fill, like its trading fee, never transferred by Mirror's contracts. Your contract attaches it only to opening orders and refuses any copy whose fee is above the maximum you signed. See [Fees](/docs/fees).

## The keeper can trade, never withdraw

- The only keeper entry point is `mirror(MirrorOrder)`. It builds an **immediate-or-cancel** Perpl order inside the contract. The keeper cannot post resting orders and cannot choose how much collateral is moved.
- Every opening order passes the full policy check described in [How copying works](/docs/how-copying-works), plus post-trade checks that revert on any violation.
- A keeper close must name the leader that holds the market and cannot go below that leader's target, so a keeper cannot close your positions early.
- `withdraw` always pays the **owner**, whoever submits it. `sweep(token)` also pays the owner. There is no function that sends collateral anywhere else. Withdrawals only ever go to the owner.
- A keeper calling `withdraw` reverts with `NotOwner`. This is covered by unit tests, invariant tests and a fork test against the live Perpl Exchange.

## Stops anyone can trigger

A stop that only works while Mirror's servers are up is not much of a stop. So the stops are public functions: anyone can execute them, but only when the condition is true onchain, and they can only close.

| Stop | Set by | Function | Condition | Needs `flattenOnStop` |
|---|---|---|---|---|
| Stop-loss / take-profit | `setLevels` (signed action 9), per market | `triggerLevel(perpId)` | The price has reached the level (see below) | No |
| Daily loss | `dailyLossBps` | `triggerAccountStop()` | Equity below the day's starting equity minus the bound | Yes |
| Drawdown | `drawdownBps` | `triggerAccountStop()` | Equity below the high-water mark minus the bound | Yes |
| Leader loss | `leaders[].lossStopBps` | `triggerLeaderStop(leader)` | That leader's realised (since added) plus unrealised PnL below `-lossStopBps × budgetCNS` | Yes |

What each one does:

- **Level**: closes the whole position in that market and **halts** the market: no new copies into it until you set a policy again. Other markets are untouched.
- **Account stop**: pauses copying and closes every open position.
- **Leader stop**: marks the leader stopped and closes only the positions held for that leader. Other leaders keep copying.

Every close is a reduce-only IOC order bounded at mark ± slippage: the level's own `slippageBps`, or the policy's `stopSlippageBps` for account and leader stops. A thin book can only make it fill less, never at a worse price. After a partial fill the level stays, so it can be triggered again. The caller receives nothing; the closes cannot move collateral out of the account.

Without `flattenOnStop`, the account and leader loss stops still block new opening copies; they just do not close anything.

### Which price a stop trusts

The condition reads **Perpl's mark price**. Perpl's operators post it, and Perpl keeps it within 5% of its Chainlink oracle price, so trades on a thin order book do not move it. On top of that:

- When Perpl's Chainlink price is **fresh** (within Perpl's own maximum age), it must also be past the level, and mark and oracle must agree within **2%** (`MAX_MARK_ORACLE_GAP_BPS = 200`). Otherwise the trigger is refused (`StopNotTriggered` or `UntrustedPrice`).
- When the Chainlink price is stale, the mark alone decides, but the mark must be valid.
- Account and leader stops compute equity from marks, so they require a trusted mark in every market involved.

This means a stop can be refused while the two prices disagree. That is deliberate: a stop that fires on one bad price closes positions you wanted to keep.

The fork test `test_fork_newRulesAgainstLivePerpl` set a take-profit that was already reached on live Perpl and had a stranger execute it: the position closed, reduce-only.

## Invariants under test

The contracts ship with 132 passing Foundry tests: unit tests, fuzz tests at 1,000 runs each, 10 invariant properties plus a call summary, and 4 fork tests against the live Perpl Exchange and AUSD on Monad mainnet. The invariants run random sequences with two leaders, price moves, liquidations, levels and stop triggers, and assert that:

- keepers, strangers and the relayer never receive collateral,
- hostile calls and forged signatures always fail,
- every executed copy was within policy: leverage, side, per-leader target, notional cap, market ownership, leader budget, entry guard, close floor,
- no exposure increases while the account is paused,
- stop triggers called by a stranger only reduce positions,
- deposits stay within the cap and the owner never changes,
- only the owner changes the policy,
- collateral is conserved,
- every open position is held for a followed leader.

On the mainnet fork, the tests run a gasless permit deposit, a 10x copy blocked by a 3x rule, a compliant 1-lot BTC copy that fills on Perpl's live order book, a keeper withdrawal that reverts, a third-party-relayed close-all followed by an owner withdrawal, a relayed follow with match now, and the new rules (entry guard, copy proof, leader margin, a take-profit executed by a stranger). See [Run the tests](/docs/run-the-tests).

Slither's findings are explained one by one in `docs/security/static-analysis.md` in the repository. The one real issue it pointed at is fixed (next section).

## Deposits by permit

`depositWithPermit` tolerates a failed `permit` call, because someone may have front-run the owner's permit; the allowance is then already in place. Slither flagged this, and it hid a real weakness: if the owner had ever approved the account directly, anyone could pull that allowance in with a junk signature. Nothing could be stolen, but money the owner had not committed would start being copy-traded.

Now a failed permit is accepted only if the signature is the owner's own permit for exactly this account, amount and deadline, at the nonce just used, and only once (`frontRunPermitUsed`). Tests: `test_depositWithPermit_junkSignatureCannotUseStandingAllowance`, `test_depositWithPermit_frontRunPermitHonouredOnlyOnce`, `test_depositWithPermit_frontRunPermitForAnotherAmountRejected`.

## Deposit cap

The contracts are **unaudited**. Each account's net deposits are capped at **25 AUSD** (`DEPOSIT_CAP`, an immutable of the implementation). A deposit that would exceed the cap reverts with `DepositCapExceeded`. The first deposit must be at least Perpl's account minimum (10 AUSD) because it opens the account's Perpl account.

## Audit status

No external audit yet. The cap will only be raised after one. Until then, deposit only what you are prepared to lose; copy trading leveraged perpetuals is risky regardless of the contract.

## Loss stops reset correctly

The daily loss stop and the high-water-mark stop compare equity with a baseline. Deposits lift both baselines by the deposited amount and withdrawals lower them, so moving money in or out is never mistaken for performance. A leader's loss record starts at zero when the leader is added, and again when you re-arm a stopped leader by setting a policy.

## Exits are always open

- **Pause** (`setPaused(true)`) stops new opening copies immediately. Closing copies still go through, so the keeper can follow the leader out of a position.
- **Close a market** (`closeMarket(perpId, slippageBps)`, signed action 10, up to 20%) closes the whole position in one market with an IOC order bounded at mark ± slippage.
- **Close all** (`closeAll(slippageBps)`, up to 20%) pauses and closes every open position the same way.
- **Remove a leader**: its positions stay open and are no longer mirrored, so you decide when to close them.
- **Withdraw** pulls collateral from Perpl as needed and sends it to the owner.
- **Expiry**: after your policy's expiry the account only reduces exposure.

Each is a signed action anyone can relay, so they work without MON and without the Mirror backend: any third party, or you from any wallet, can submit your signature. The stops above need no signature at all once their condition is true.

## Escape hatch

`exchangeCall(bytes)` lets the **owner** make any call to the Perpl Exchange as the account, for example if Perpl changes its ABI or a position needs a manual action. Keepers, stop triggers and the registry owner have no equivalent.

## Signatures

Owner actions are EIP-712 typed data with a per-account nonce and a deadline. A signature is valid for exactly one action on one account on one chain, once. See [Contracts](/docs/contracts#eip-712-domain).
