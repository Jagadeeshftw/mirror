---
title: How copying works
description: The leader watcher, the target rule, match now, blocked copies and latency.
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

A copy can never make your position bigger than your share of what the leader holds right now. For each market and side, your contract computes a **target**:

```text
target(side) = Σ over your leaders on that side   ceil(leaderLots × ratioBps / 10000)
             − Σ over your leaders on the other side floor(leaderLots × ratioBps / 10000)
             (floored at 0)
```

An opening copy is allowed only if `lotsBefore + copyLots ≤ target`, and the position after the fill is checked again (`lotsAfter ≤ target`). The contract reads the leader's position directly from Perpl's onchain state, so the keeper cannot open exposure the leader does not hold, and cannot open a position on the opposite side of the leader.

Closing copies only reduce your position and can never flip it. They are allowed even when you are paused or your policy has expired.

## 3. Match now

When you follow a leader who already has open positions, waiting for their next trade could take days. **Match now** brings you to your share of their current positions immediately:

- In the app it is on by default in the follow sheet, which shows each match order's expected size, price and slippage bound before you approve.
- Onchain it is the `follow(policy, matches)` action: set the policy, resume copying and place up to 16 opening orders in one transaction.
- Each match order runs through exactly the same `_copy` path and the same checks as a keeper copy, so it can never exceed `ratio × the leader's current same-side position`.
- Match orders are tagged with `leaderRef = keccak256("MIRROR_MATCH_NOW")` so indexers can tell them apart from keeper copies.

`matchNow(matches)` is also available on its own, under the existing policy.

## 4. Blocked by your rule

Before an opening copy is sent to Perpl, the contract checks, in order:

| # | Check | Block reason |
|---|---|---|
| 1 | Account is not paused | `Paused` |
| 2 | Policy has not expired | `Expired` |
| 3 | Market is in your allowed markets | `MarketNotAllowed` |
| 4 | Leader is in your policy | `LeaderNotAllowed` |
| 5 | Leverage is at least 1x | `LeverageTooLow` |
| 6 | Leverage is at most your max | `LeverageTooHigh` |
| 7 | The copy would not flip an existing position | `FlipNotAllowed` |
| 8 | Perpl's mark price is fresh | `StaleMark` |
| 9 | Limit price is within your max slippage of mark | `SlippageTooHigh` |
| 10 | The leader holds a position on that side | `LeaderSideMismatch` |
| 11 | Size stays within the target | `ExceedsLeaderTarget` |
| 12 | Notional stays within the market's cap | `ExceedsMaxNotional` |
| 13 | Equity is above the daily loss floor | `DailyLossStop` |
| 14 | Equity is above the drawdown floor | `DrawdownStop` |

If a check fails, the contract **does not trade and does not revert**. It emits:

```solidity
event Blocked(address indexed keeper, uint32 indexed leaderAccountId, uint32 indexed perpId,
              BlockReason reason, uint8 orderType, uint64 lotLNS,
              uint256 limit, uint256 actual, bytes32 leaderRef);
```

`limit` and `actual` carry the numbers, so the app can say, for example, "Leader opened 20x BTC long. Your max leverage is 5x. Not copied." (`limit = 500`, `actual = 2000`, leverage in hundredths). Because the event is in a mined transaction, every block has its own tx hash on MonadVision.

After the order executes, the contract checks the result again (no flip, within target, within notional cap) and **reverts** with `PostTradeViolation` if anything is off. That is defence in depth: a fill that would break a rule never stands.

## 5. Latency and commit states

Every copy in the app and on the [public stats page](/stats) carries its **latency**: the time from the engine observing the leader's fill to the copy transaction being included, in milliseconds.

Monad blocks move through three commit states, and the app shows each copy's state as it advances:

| State | Meaning |
|---|---|
| Proposed | The block containing the copy has been proposed. |
| Voted | A quorum has voted on it. |
| Finalized | It is final. We measured this at about 550 ms after Proposed. |

With blocks at about 290 ms, a copy can land within a couple of blocks of the leader's fill. Measured figures are on [Why Monad](/docs/why-monad).
