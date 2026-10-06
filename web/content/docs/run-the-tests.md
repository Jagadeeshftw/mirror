---
title: Run the tests
description: One command for each claim we make: blocked by your rule on a mainnet fork, the keeper-cannot-withdraw invariants, and the measured Monad numbers.
---

Everything here runs from the public repository, [github.com/Jagadeeshftw/mirror](https://github.com/Jagadeeshftw/mirror). You need [Foundry](https://getfoundry.sh) and git; the measurement script needs Node 22 or later. No wallet, no keys and no funds: fork tests run against a local copy of Monad mainnet state.

```bash
git clone --recursive https://github.com/Jagadeeshftw/mirror
cd mirror/contracts
```

## Blocked by your rule, then a real fill (mainnet fork)

```bash
MONAD_RPC_URL=https://rpc.monad.xyz forge test --mc PerplMainnetFork --mt test_fork_fullLifecycleAgainstLivePerpl -vv
```

The test forks Monad mainnet, opens a MirrorAccount with a gasless AUSD permit (it gets its own account on Perpl's live Exchange), and sets a policy with a 3x leverage limit. Then:

```text
10x copy vs a 3x rule: BLOCKED onchain (LeverageTooHigh), position still 0 lots
2x copy, 1 lot BTC: FILLED on Perpl's live order book, position now 1 lot
keeper tries to withdraw: REVERTED (NotOwner)
```

It finishes with a signed close-all relayed by a third party and the owner withdrawing everything.

## The keeper cannot withdraw (invariants)

```bash
forge test --mc MirrorInvariantTest -vv
```

Foundry drives a funded account through 256 random sequences of 64 calls: keeper copies, leader trades, price moves, owner deposits, withdrawals and pauses, plus hostile calls from the keeper and a stranger (owner-only functions, forged signatures, arbitrary calldata). After every call, these 8 properties must hold:

| Invariant | Property |
|---|---|
| `keeperNeverReceivesCollateral` | The keeper, a stranger, the relayer and the test handler never receive any collateral. |
| `hostileCallsAlwaysFail` | Every owner-only call and forged signature from a non-owner fails. |
| `noPolicyViolation` | Every executed copy was within the policy when it executed; blocked copies changed nothing. |
| `noExposureIncreaseWhilePaused` | No copy increases exposure while the account is paused. |
| `depositsWithinCap` | Net deposits never exceed the per-account cap. |
| `ownerIsFixed` | The owner never changes. |
| `collateralConserved` | All collateral sits with the owner, the account or the exchange. |
| `onlyOwnerChangesPolicy` | The policy and the pause flag are exactly what the owner last set. |

`invariant_callSummary` also runs; it only logs how many copies executed and were blocked.

## Measured Monad numbers

From the repository root:

```bash
node scripts/measure-monad.mjs
```

It samples public Monad mainnet RPC for 30 seconds and prints the average block time and how long after a block is first seen as Proposed it is reported Voted and Finalized. On 6 October 2026: 307 ms average block time over 60 seconds, Finalized about 550 ms after Proposed.

Gas for one fully checked copied open on the mainnet fork:

```bash
cd contracts
MONAD_RPC_URL=https://rpc.monad.xyz forge test --mc PerplMainnetFork --mt test_fork_keeperCopyGasProfile -vv
```

On 6 October 2026: 279,014 gas. At 102 gwei and MON at about $0.029 that is about $0.0008, roughly $0.001 once the 1.2x gas limit Monad charges is included.

## Everything

```bash
forge test
```

91 tests: 73 unit tests, 6 fuzz tests (1,000 runs each), the invariant suite above, and 3 fork tests (they return early unless `MONAD_RPC_URL` is set).
