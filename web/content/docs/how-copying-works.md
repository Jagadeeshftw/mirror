---
title: How copying works
description: The leader watcher, the target rule, several leaders, the entry guard, match now, blocked copies, the copy proof and latency.
---

A copy is a Perpl order placed by your MirrorAccount, sized from the leader's position and checked against your policy in the same transaction. This page follows one copy from the leader's fill to yours.

## 1. The leader watcher

The copy engine subscribes to Perpl Exchange events on Monad through `monadLogs`, Monad's real-time log subscription. It delivers a leader's fill when the block is **Proposed**, before it is Voted or Finalized, which is the earliest moment the fill can be seen.

For each fill by a leader that someone follows, the engine:

1. reads the leader's new position and every follower's current position in that market,
2. plans a copy for each follower whose policy names that leader,
3. pre-checks the copy against the follower's policy with the same arithmetic the contract uses, and prices it from Perpl's order book and mark price,
4. submits `MirrorAccount.mirror(order)` from a registered keeper.

Copies for different followers touch different account state, so they are independent transactions that Monad can execute in parallel.

## 2. The target rule

A copy can never make your position bigger than your share of what the leader holds right now. For each market, side and leader, your contract computes a **target**:

```text
target = ceil(leaderLots × ratioBps / 10000)   if the leader holds that side
       = 0                                      otherwise
```

An opening copy is allowed only if `lotsBefore + copyLots ≤ target`, and the position after the fill is checked again (`lotsAfter ≤ target`). The contract reads the leader's position directly from Perpl's onchain state, so the keeper cannot open exposure the leader does not hold, and cannot open a position on the opposite side of the leader.

Closing copies only reduce your position and can never flip it. They are allowed even when you are paused or your policy has expired. A keeper close must name the leader that holds the market, and it cannot take you below that leader's target: if the leader still holds 300 lots at a 1% ratio, the keeper can close you down to 3 lots, not further. When the leader is flat, the target is 0 and you can be closed fully.

## 3. Several leaders in one account

One account can follow up to 4 leaders. Each has its own ratio, a margin budget (`budgetCNS`) and an optional loss stop (`lossStopBps`, a share of the budget). See [Policy reference](/docs/policy-reference#leaders-and-markets).

Perpl keeps one position per market per account. So a market belongs to the leader whose copy opened it, until the position is flat again (closed or liquidated). While it is held, another leader's copy into that market is blocked with `MarketHeldByOtherLeader`, and only the holding leader's exits are copied. Every position, budget and loss figure therefore belongs to exactly one leader.

- **Budget.** Before an open, the contract adds Perpl's margin (position deposit) of that leader's open positions to the margin the new order needs. If the sum is above `budgetCNS`, the copy is blocked (`LeaderBudgetExceeded`).
- **Loss stop.** The contract books each leader's realised PnL, net of fees, from the change in the account's balance and position deposit around every order in that leader's markets. Realised since the leader was added, plus unrealised on its open positions, is the leader's PnL. Below `-lossStopBps × budgetCNS` the leader is stopped (`LeaderLossStop`) and stays stopped until you set a policy again. Other leaders keep copying.
- **Stop following, keep my positions.** `setLeaderDetached(leader, true)` (signed action 11) stops copying one leader while its positions stay open. Your contract refuses every copy naming that leader, opens and closes, keeper or match now (`LeaderDetached`). The positions stay attributed to the leader, so its budget, its loss stop and your levels keep working, and you can still close them with `closeMarket`, `closeAll` or a level. Other leaders keep copying. To follow again, sign `setLeaderDetached(leader, false)` or follow the leader again (`follow()` clears the flag).
- **Removing a leader** leaves its positions open and untouched. They are no longer mirrored: the keeper cannot copy that leader's exits (`LeaderNotAllowed`). You close them with `closeMarket`, `closeAll` or a level.

## 4. The entry guard

A leader who bought BTC at 67,000 and is still holding at 85,000 is in profit. Copying that position today means buying at 85,000, which is a different trade. `maxEntryDeviationBps` lets you refuse it.

For an opening copy, the contract reads the leader's **onchain average entry price** for the position from Perpl, then computes a bound:

```text
long:  bound = leaderEntry × (1 + maxEntryDeviationBps / 10000); blocked if limit > bound or mark > bound
short: bound = leaderEntry × (1 − maxEntryDeviationBps / 10000); blocked if limit < bound or mark < bound
```

Both the copy's limit price and Perpl's current mark must be within the bound. A blocked copy emits `Blocked` with reason `EntryTooFar`, `limit` = the bound and `actual` = the price that broke it. The guard applies to keeper copies and to match now. Closes are never entry-guarded. Set it to 0 to turn it off.

In one run on a fork of Monad mainnet (7 Oct 2026), `test_fork_newRulesAgainstLivePerpl` picked a live BTC leader with entry 67,467.9 and mark 85,551.6; a tight guard blocked the copy ("mark is 2680 bps above the leader's entry").

## 5. Match now

When you follow a leader who already has open positions, waiting for their next trade could take days. **Match now** brings you to your share of their current positions immediately:

- In the app it is on by default in the follow sheet, which shows each match order's expected size, price and slippage bound before you approve.
- Onchain it is the `follow(policy, matches)` action: set the policy, resume copying and place up to 16 opening orders in one transaction.
- Each match order runs through exactly the same `_copy` path and the same checks as a keeper copy, including the entry guard, so it can never exceed `ratio × the leader's current same-side position`.
- Match orders are tagged with `leaderRef = keccak256("MIRROR_MATCH_NOW")` so indexers can tell them apart from keeper copies.

`matchNow(matches)` is also available on its own, under the existing policy.

## 6. Blocked by your rule

Before any copy, opening or closing, the contract first checks that you have not stopped following its leader (`LeaderDetached`). Then, before an opening copy is sent to Perpl, it checks, in order:

| # | Check | Block reason |
|---|---|---|
| 1 | Account is not paused | `Paused` |
| 2 | Policy has not expired | `Expired` |
| 3 | Market is in your allowed markets | `MarketNotAllowed` |
| 4 | No stop-loss or take-profit has fired in this market since your last policy | `MarketHalted` |
| 5 | Leader is in your policy | `LeaderNotAllowed` |
| 6 | Leader's loss stop has not been hit | `LeaderLossStop` |
| 7 | Leverage is at least 1x | `LeverageTooLow` |
| 8 | Leverage is at most your max | `LeverageTooHigh` |
| 9 | The copy would not flip an existing position | `FlipNotAllowed` |
| 10 | The market is not held for another leader | `MarketHeldByOtherLeader` |
| 11 | Perpl's mark price is valid | `StaleMark` |
| 12 | Limit price is within your max slippage of mark | `SlippageTooHigh` |
| 13 | The leader holds a position on that side | `LeaderSideMismatch` |
| 14 | Limit and mark are within the entry guard | `EntryTooFar` |
| 15 | Size stays within the target | `ExceedsLeaderTarget` |
| 16 | Notional stays within the market's cap | `ExceedsMaxNotional` |
| 17 | Leader's margin stays within its budget | `LeaderBudgetExceeded` |
| 18 | Leader's PnL is above its loss stop | `LeaderLossStop` |
| 19 | Equity is above the daily loss floor | `DailyLossStop` |
| 20 | Equity is above the drawdown floor | `DrawdownStop` |

A keeper close is checked for: leader not detached (`LeaderDetached`), leader in your policy (`LeaderNotAllowed`), market held for that leader (`MarketHeldByOtherLeader`), not below that leader's target (`CloseBelowTarget`), valid mark (`StaleMark`) and slippage (`SlippageTooHigh`).

If a check fails, the contract **does not trade and does not revert**. It emits:

```solidity
event Blocked(address indexed keeper, uint32 indexed leaderAccountId, uint32 indexed perpId,
              BlockReason reason, uint8 orderType, uint64 lotLNS,
              uint256 limit, uint256 actual, bytes32 leaderRef,
              uint64 leaderFillPNS, uint64 markPNS);
```

`limit` and `actual` carry the numbers, so the app can say, for example, "Leader opened 12x BTC long. Your max leverage is 5x. Not copied." (`limit = 500`, `actual = 1200`, leverage in hundredths). `leaderFillPNS` is the leader's fill price as reported by the keeper, and `markPNS` is Perpl's mark at that moment. Because the event is in a mined transaction, every block has its own tx hash on MonadVision.

After the order executes, the contract checks the result again (no flip, within target, within notional cap) and **reverts** with `PostTradeViolation` if anything is off. That is defence in depth: a fill that would break a rule never stands.

## 7. The copy proof

Every executed copy emits `Mirrored` with a `CopyProof`, so copy quality can be checked from events alone:

| Field | Source | Meaning |
|---|---|---|
| `leaderFillPNS` | keeper-reported | The leader's fill price. Used for statistics only; no rule trusts it. It can be checked against Perpl's fill events in the leader transaction named by `leaderRef`. |
| `leaderEntryPNS` | onchain | The leader's average entry price on the copied side at copy time (0 for closes). |
| `markPNS` | onchain | Perpl's mark price at copy time. |
| `fillPNS` | onchain | Your average fill for an opening copy, derived from Perpl's average entry price for your position before and after the order (0 if nothing filled, and for closes, where Perpl's own fill events carry the price). |
| `entryDeviationBps` | onchain | `fillPNS` against `leaderEntryPNS`, in basis points, positive when you paid worse. |

`test_fork_newRulesAgainstLivePerpl` confirmed on live Perpl that a position's entry price is the average entry, so the follower fill is derived exactly (in the same run: follower fill 85,568.8, position entry 85,568.8).

## 8. Latency and commit states

Every copy in the app and on the [public stats page](/stats) carries its **latency**: the time from the engine observing the leader's fill to the copy transaction being included, in milliseconds.

Monad blocks move through three commit states, and the app shows each copy's state as it advances:

| State | Meaning |
|---|---|
| Proposed | The block containing the copy has been proposed. |
| Voted | A quorum has voted on it. |
| Finalized | It is final. We measured this at about 550 ms after Proposed. |

With blocks at about 300 ms, a copy can land within a couple of blocks of the leader's fill. Measured figures are on [Why Monad](/docs/why-monad).

Stops that close positions are covered in [Safety model](/docs/safety-model#stops-anyone-can-trigger).
