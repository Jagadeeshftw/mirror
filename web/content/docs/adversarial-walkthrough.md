---
title: Adversarial walk-through
description: Each way someone could try to hurt a Mirror follower, and what stops it.
---

Each entry names an attack, what stops it, and where that check lives:
- **Contract:** enforced onchain on every order, and holds even if Mirror's servers misbehave.
- **Engine:** Mirror's copy engine adds the check on top. It protects you while Mirror runs, but nothing is guaranteed onchain.

Test names refer to `contracts/test` and `engine/test` in the [repository](https://github.com/Jagadeeshftw/mirror).

## The leader works against followers

**1. The leader buys, followers' copies push the price up, the leader sells into them.**
- **Contract:**
  - The entry filter refuses a copy whose limit, or the current mark, is further than your bound from the leader's onchain average entry. You never buy far above where the leader bought.
  - The slippage bound caps every fill at mark ± your limit.
  - The ratio caps your size at your share of the leader's current position.
- **Engine:** an "exits into followers" incident is a leader reducing or closing a market within 20 blocks after followers' opening copies filled there, at a price at or beyond their fills (selling into their buying). Each leader gets a score: incidents per copied fill, 0 to 100. A leader with a score of 25 or more and at least 2 incidents is flagged on their profile and in the leaderboard. Recomputed at most once a minute from the engine's own records of executed copies and Perpl's events (`engine/src/services/adversarial.ts`).
- Tests: `EntryGuardTest`, `testFuzz_entryGuardBoundsEveryOpen`, `adversarial.test.ts`.

**2. The leader trades a thin market so the copies fill badly.**
- **Contract:** the slippage bound and entry filter cap the price, and per-market notional caps limit the size.
- **Engine:** before every opening copy, and every match-now quote, the thin-book guard reads Perpl's order book on the taking side up to your limit price (`engine/src/services/guard.ts`, `engine/src/domain/thinbook.ts`).
  - Depth of at least 2× the copy's size: the copy goes out unchanged.
  - Less: the copy is shrunk to half the depth, rounded down to whole lots.
  - Not even one lot after that, or the book can't be read: the copy is skipped.
  - Shrinks and skips appear in your feed as engine events ("Shrunk: thin book", "Skipped: thin book", "Skipped: book unavailable") with no transaction, never as onchain blocks. Closes are never held back by the guard.
- Tests: `thinbook.test.ts`.

**3. The leader's own trade moves the price, and followers fill worse.**
- **Contract:** the same price bounds as in 1.
- **Engine:** a "moves the book" incident is a leader fill that moved the last traded price by more than 30 bps in its direction, while followers' copies of it filled a median of more than 20 bps worse than the leader. These count toward the same score and flag as in 1. The engine can be configured to refuse new follows of flagged leaders; that setting is off by default, so today flagged leaders are only labelled.

**4. The leader flips or nets positions across leaders to confuse sizing.**
- **Contract:**
  - A copy can never flip your position.
  - With several leaders, each market belongs to the leader whose copy opened it, and another leader's copy into it is blocked.
  - Each leader has its own margin budget and loss stop, so one bad leader can't spend another's budget.
- Tests: `MultiLeaderTest`, `invariant_noPolicyViolation`.

**4a. You want out of one leader, but not out of your positions.**
- **Contract:** "Stop following, keep my positions" is one signed action, `setLeaderDetached(leader, true)`. From then on your contract refuses every keeper copy from that leader, opens and closes, and records each as `Blocked` with reason 22 (`LeaderDetached`), so a leader can't exit through your account after you left. Your stop-loss, take-profit, close a market and close all keep working. Following the leader again, or removing them from your policy, clears it; changing other limits keeps it.
- Tests: `DetachTest`, `testFuzz_detachedLeaderNeverTrades`, `invariant_detachedLeaderNeverCopied`, `test_fork_detachAgainstLivePerpl`.

## Mirror itself misbehaves

**5. The keeper tries to withdraw or redirect your money.**
- **Contract:** there is no code path that sends collateral to anyone but you. The keeper can only call `mirror()`, which builds a reduce-or-copy IOC order inside your rules.
- Tests: `invariant_keeperNeverReceivesCollateral`, `testFuzz_keeperArbitraryCalldataNeverExtracts`.

**6. The keeper sends copies at bad moments or the wrong size.**
- **Contract:**
  - Every copy is checked against your leverage, markets, notional caps, slippage, entry filter, budget, loss stops and expiry.
  - Size can never exceed your ratio of the leader's current position.
  - A keeper close can only bring you down toward that target, never below it, so the keeper can't dump your position early either.
- Tests: `test_close_cannotGoBelowLeaderTarget`, `testFuzz_mirrorOutcomeAlwaysWithinPolicy`.

**7. Mirror's servers go down while a position is losing.**
- **Contract:** your stop-loss, take-profit and loss stops can be executed by anyone once they are true onchain: you, any bot, any stranger. They only ever reduce your position, and the caller gets nothing.
- **Fallback:** owner actions (close a market, close all, withdraw) are signed by your passkey and can be relayed by anyone.
- Tests: `StopTriggerTest`, `invariant_triggersOnlyReduce`.

**8. The relayer changes or replays what you signed.**
- **Contract:** every owner action is an EIP-712 signature over its exact data, with a nonce and a deadline. A changed byte or a replay is rejected.
- **Permits:** a front-run permit is honoured only if it is exactly your permit for that account and amount, and only once. A junk signature can't pull in an allowance you left standing.
- Tests: `test_execute_rejectsReplayWrongSignerAndExpiry`, `test_depositWithPermit_junkSignatureCannotUseStandingAllowance`.

**8a. Mirror raises its fee, routes it elsewhere, or charges it on closes.**
- **Contract:**
  - The builder id (26) and the fee (0.02%, 20 per 100,000) are fixed in the contract when it is deployed. Perpl confirmed the builder id on 7 Oct 2026; both values are in the testnet deployment (`contracts/deployments/10143.json`). A keeper order has no builder field, so it can't choose either.
  - Each copy is checked against the maximum builder fee you signed. Above it, the copy is refused (`BuilderFeeTooHigh`) with both numbers.
  - Only opening orders carry the builder attribution. Keeper closes, stops, close a market and close all go to Perpl without it. Perpl would charge an attributed order's fee on a close too, so this is enforced by your contract, not left to Perpl.
- **Worst case:** your signed maximum times the notional of each opening fill. With the default that is 0.02% of what each copy opens. The fee is charged by Perpl's exchange on the fill; Mirror's contracts never transfer collateral to anyone but you.
- Tests: `BuilderFeeTest`, `invariant_builderFeeOnlyOnOpensAtTheFixedRate`, `test_fork_builderFeeOnLivePerpl`.

## Market and oracle tricks

**9. Someone pushes the price to set off your stops.**
- **Contract:** stops read Perpl's mark price, which Perpl's operators post and keep within 5% of its Chainlink oracle. Trades on a thin book don't move it.
  - When the Chainlink price is fresh, it must also be past your level, and the two must agree within 2%. Otherwise the trigger is refused.
  - The close is an IOC order bounded at mark ± your slippage, so a drained book makes it fill less, never worse.
- Tests: `test_level_freshOracleMustAgree`, `testFuzz_levelFiresOnlyWhenReached`.

**10. A stale or invalid mark.**
- **Contract:** copies are blocked on a stale mark (`StaleMark`). Triggers refuse an invalid mark (`UntrustedPrice`).

**11. Front-running your copy (MEV).**
- **Contract:** a copy is an IOC order with a hard limit price, so the worst a front-runner can do is make it fill at that limit or not at all. The entry filter caps how far that limit can be from the leader's entry.
- **Honest limit:** a copy follows a public leader fill, so the signal itself is public. Monad's planned encrypted ordering would narrow this further.

## Fake track records

**12. A leader fakes a good record, or Mirror inflates its own numbers.**
- Leader stats come from Perpl's onchain events, indexed by Envio. Copy quality (leader price vs your price, delay) is recomputable from chain data alone.
- Team-run accounts are labelled and excluded from every traction number.
- The leader fill a keeper reports is checked against the leader's own Perpl event in that transaction, and mismatches are flagged.

## What is not protected

- **Market risk:** if the leader loses money, so do you, within your limits.
- **The contracts are not audited:** deposits are capped per account while they're in beta: 200 test AUSD on testnet, and 25 AUSD planned for mainnet.
- **Perpl itself:** Mirror trades on Perpl's exchange and inherits its risks.
