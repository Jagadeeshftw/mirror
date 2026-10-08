---
title: Run the tests
description: One command for each claim we make: the full suite, the mainnet-fork tests, the invariants, Slither, the localnet smoke test, the deploy plan and the measured Monad numbers.
---

Everything here runs from the public repository, [github.com/Jagadeeshftw/mirror](https://github.com/Jagadeeshftw/mirror). You need [Foundry](https://getfoundry.sh) and git; the scripts need Node 22 or later. No wallet, no keys and no funds: fork tests run against a local copy of Monad mainnet state.

```bash
git clone --recursive https://github.com/Jagadeeshftw/mirror
cd mirror/contracts
```

## Everything

```bash
forge test
```

```text
Ran ... test suites ...: 158 tests passed, 0 failed, 0 skipped (158 total tests)
```

158 Foundry tests: unit tests, fuzz tests at 1,000 runs each, 12 invariant properties plus a call summary, and 6 fork tests. Without `MONAD_RPC_URL` the fork tests return early and pass without touching the network; the next section runs them for real.

## Against live Perpl and AUSD (mainnet fork)

```bash
MONAD_RPC_URL=https://rpc.monad.xyz forge test --mc PerplMainnetFork -vv
```

```text
Ran 6 tests for test/fork/PerplMainnetFork.t.sol:PerplMainnetForkTest
[PASS] test_fork_builderFeeOnLivePerpl()
[PASS] test_fork_detachAgainstLivePerpl()
[PASS] test_fork_followMatchNowAndGasProfile()
[PASS] test_fork_fullLifecycleAgainstLivePerpl()
[PASS] test_fork_keeperCopyGasProfile()
[PASS] test_fork_newRulesAgainstLivePerpl()
```

The tests fork Monad mainnet and pick a live BTC leader on Perpl. Numbers in the logs depend on the live order book at the block you fork.

### Blocked by your rule, then a real fill

`test_fork_fullLifecycleAgainstLivePerpl` opens a MirrorAccount with a gasless AUSD permit (it gets its own account on Perpl's live Exchange) and sets a policy with a 3x leverage limit. Its log:

```text
10x copy vs a 3x rule: BLOCKED onchain (LeverageTooHigh), position still 0 lots
2x copy, 1 lot BTC: FILLED on Perpl's live order book, position now 1 lot
keeper tries to withdraw: REVERTED (NotOwner)
```

It finishes with a signed close-all relayed by a third party and the owner withdrawing everything.

### The new rules on live Perpl

`test_fork_newRulesAgainstLivePerpl` checks what the entry guard, copy proof, leader budget and stops rely on. A run on 7 Oct 2026 logged:

```text
leader entry 674679 mark 855516
entry guard: copy BLOCKED, mark is 2680 bps above the leader's entry
follower fill (from Perpl avg entry) 855688 position entry 855688
leader margin (Perpl position deposit) 428016
take-profit triggered by a stranger: closed 1 lots; left 0
```

That confirms three things on Perpl's real contract: a position's entry price is the average entry, so the follower's fill is derived exactly; the position deposit is the margin the leader budget counts; and a stranger can execute a take-profit that has been reached. The test also checks that the leader loss stop cannot be triggered before it is hit, and that the market is halted after the level fires. If the leader picked is at or above the mark, the entry-guard block case is skipped on that block and the log says so.

### Follow with match now

`test_fork_followMatchNowAndGasProfile` runs a relayed follow with match now (`lots after match now 3 of 3`), a blocked copy, a keeper close, a relayed close-all and withdrawal, and logs the gas of each transaction type.

## The keeper cannot withdraw (invariants)

```bash
forge test --mc MirrorInvariantTest -vv
```

```text
Suite result: ok. 13 passed; 0 failed; 0 skipped
```

Foundry drives a funded account that follows two leaders through 256 random sequences of 64 calls: keeper copies and closes, owner match now, leader trades, price moves, liquidations, owner deposits, withdrawals, pauses and levels, stop triggers by a stranger, time jumps, plus hostile calls from the keeper and a stranger (owner-only functions, forged signatures, arbitrary calldata). After every call, these 12 properties must hold:

| Invariant | Property |
|---|---|
| `keeperNeverReceivesCollateral` | The keeper, a stranger, the relayer and the test handler never receive any collateral. |
| `hostileCallsAlwaysFail` | Every owner-only call and forged signature from a non-owner fails. |
| `noPolicyViolation` | Every executed copy was within the policy when it executed (leverage, side, per-leader target, notional cap, market ownership, leader budget, entry guard, close floor); blocked copies changed nothing. |
| `noExposureIncreaseWhilePaused` | No copy increases exposure while the account is paused. |
| `triggersOnlyReduce` | Stop triggers called by a stranger only reduce positions. |
| `depositsWithinCap` | Net deposits never exceed the per-account cap. |
| `ownerIsFixed` | The owner never changes. |
| `collateralConserved` | All collateral sits with the owner, the account or the exchange. |
| `onlyOwnerChangesPolicy` | Every rule is exactly what the owner last set; the pause flag changes only by the owner or a triggered account stop. |
| `openPositionsHaveAHolder` | Every open position is held for a followed leader. |
| `builderFeeOnlyOnOpensAtTheFixedRate` | No reducing order carries builder attribution; attributed orders go to builder 26 only, at 20 per 100,000 and never above the owner's signed maximum. |
| `detachedLeaderNeverCopied` | A detached leader's copies never trade (opens, keeper reductions, match now), and only the owner changes which leaders are detached. |

`invariant_callSummary` also runs; it logs how many copies executed and were blocked (by reason), and how many triggers executed.

## The new rules (unit and fuzz)

```bash
forge test --mc 'EntryGuardTest|CopyProofTest|MultiLeaderTest|StopTriggerTest|NewRulesFuzzTest' -vv
```

All 33 tests pass (`33 tests passed, 0 failed`). A few to read:

- Entry guard: `test_long_blockedWhenMarkAlreadyBeyondBound`, `test_appliesToMatchNow`, `test_closesAreNeverEntryGuarded`, `testFuzz_entryGuardBoundsEveryOpen`.
- Several leaders: `test_marketBelongsToTheLeaderWhoOpenedIt`, `test_budgetCapsMarginPerLeader`, `test_leaderLossStopLatchesAndOnlyStopsThatLeader`, `testFuzz_budgetNeverExceeded`.
- Stops: `test_level_stopLossByAnyoneWhenMarkCrosses`, `test_level_freshOracleMustAgree`, `test_level_haltedMarketBlocksCopiesUntilNewPolicy`, `test_accountStop_flattensAndPausesOnlyWhenHit`, `test_leaderStop_closesOnlyThatLeadersMarkets`, `testFuzz_levelFiresOnlyWhenReached`.
- Keeper closes: `test_close_cannotGoBelowLeaderTarget`, `test_close_removedLeaderNoLongerManagesPosition` (in `MirrorTest`).

## The permit fix

```bash
forge test --mt 'test_depositWithPermit_' -vv
```

Six tests pass. They include `test_depositWithPermit_junkSignatureCannotUseStandingAllowance`, `test_depositWithPermit_frontRunPermitHonouredOnlyOnce` and `test_depositWithPermit_frontRunPermitForAnotherAmountRejected`, the tests for the Slither finding fixed in `depositWithPermit`.

## Static analysis (Slither)

Needs [Slither](https://github.com/crytic/slither) (we used 0.11.6). From `contracts/`:

```bash
slither . --filter-paths "lib/|test/|script/" --exclude-dependencies
```

```text
. analyzed (32 contracts with 102 detectors), 126 result(s) found
```

Every finding is explained, one by one, in [`docs/security/static-analysis.md`](https://github.com/Jagadeeshftw/mirror/blob/main/docs/security/static-analysis.md). The one real issue (in `depositWithPermit`) is fixed; the detector still matches the pattern, so it stays in the count as a false positive.

## Localnet smoke test (Perpl's real exchange)

A local chain with Perpl's real exchange implementation, deployed the way Perpl's own test kit in [dex-sdk](https://github.com/PerplFoundation/dex-sdk) deploys it, with Mirror deployed on top by `scripts/deploy-contracts.mjs`. Needs anvil (part of Foundry). From the repository root:

```bash
cd contracts && forge build && cd ..
cd scripts && npm install && cd ..
cd localnet && npm install && npm run fetch && npm start      # keeps running; Ctrl-C stops it
node smoke.mjs                                                  # in another shell, from localnet/
```

Wait a few seconds after `localnet ready` so the market makers have quoted, then run the smoke test:

```text
PASS  factory created the follower's MirrorAccount
PASS  relayed permit deposit opened a Perpl account owned by the contract
PASS  owner set the policy
PASS  leader filled on the local Perpl book
PASS  keeper copy filled at the leader's size
PASS  Mirrored carries the proof  leader entry ..., follower fill ..., deviation ... bps
PASS  10x copy against a 5x rule is Blocked onchain  reason 6 limit 500 actual 2000
PASS  stranger executed the take-profit; position closed
PASS  stranger received no collateral

all checks passed
```

9 of 9 checks. Details of the chain settings are in `localnet/README.md`.

## Deployment plan (nothing is sent)

```bash
cd contracts && forge build && cd ../scripts && npm install
OPS_PRIVATE_KEY=0x$(openssl rand -hex 32) node deploy-contracts.mjs --network mainnet --cap 25
```

Any key works for a plan; without `--send` nothing is signed or sent. It prints the predicted addresses, `runtime    MirrorAccount 36321 bytes`, and for each step Monad's own `eth_estimateGas`, the gas limit and the expected fee. On 7 Oct 2026 it printed `total limit 10095158: expected 1.029706 MON` at a 100 gwei base fee (about 1.04 MON once a keeper is registered with `--keepers`). That the 36 KB contract deploys at all shows Monad accepts code above EIP-170's 24 KB limit.

## Measured Monad numbers

From the repository root:

```bash
node scripts/measure-monad.mjs
```

It samples public Monad mainnet RPC for 30 seconds and prints the average block time and how long after a block is first seen as Proposed it is reported Voted and Finalized. On 6 October 2026: 302 to 311 ms average block time across runs (307 ms over 60 seconds), Finalized 548 to 563 ms after Proposed.

Gas for one fully checked copied open on the mainnet fork:

```bash
cd contracts
MONAD_RPC_URL=https://rpc.monad.xyz forge test --mc PerplMainnetFork --mt test_fork_keeperCopyGasProfile -vv
```

On 7 October 2026, with the new rules, it ranged from 389,598 to 425,501 gas between runs (it depends on the live order book): about 400k. At 102 gwei and MON at about $0.029 that is about $0.0013, roughly $0.0015 once the 1.2x gas limit Monad charges is included.
