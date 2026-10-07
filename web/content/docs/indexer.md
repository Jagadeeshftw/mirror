---
title: Indexer
description: The Envio HyperIndex indexer behind the leaderboard, PnL attribution and public stats.
---

Mirror's read side is an [Envio](https://envio.dev) HyperIndex indexer over Perpl Exchange events and Mirror's own events on Monad mainnet. It powers:

- the leaderboard and leader profiles (PnL, drawdown, win rate, consistency over 7, 30 and 90 days, equity curves),
- each follower's realized PnL **attributed per leader**,
- each account's copy and block feed,
- the [public stats page](/stats).

> Status: in progress. It is not yet serving production data.

## Sources

| Contract | Events |
|---|---|
| Perpl Exchange `0x34B6…2a6F` | Account created, collateral deposits and withdrawals, positions opened, increased, decreased, closed, inverted, liquidated and deleveraged, funding, markets added. |
| MirrorAccountFactory | `AccountCreated`, which registers each new clone dynamically. |
| MirrorAccount (every clone) | `Initialized`, `PerplAccountCreated`, `PolicyUpdated`, `PausedSet`, `Deposited`, `Withdrawn`, `Mirrored`, `Blocked`, `ClosedAll`, `Followed`, `LeaderDetachedSet`. |

Indexing starts at Perpl's mainnet deploy block, **54,773,010**, so leader histories are complete. HyperSync is the primary data source, with Monad RPC as a fallback.

## Main entities

| Entity | What it holds |
|---|---|
| `PerplAccount` | Every Perpl account (leaders and MirrorAccounts alike): balance, deposits, `teamRun` flag. |
| `Position`, `PositionEvent` | Current position per account and market, and the full trade history. |
| `LeaderStats`, `LeaderWindowStats` | All-time and rolling 7d/30d/90d leaderboard figures. |
| `MirrorAccount` | One row per follower account: owner, policy, paused, deposits, copies executed and blocked. |
| `CopyEvent`, `BlockedCopy` | Every `Mirrored` and `Blocked` event with keeper, leader, market, size, price, tx hash, and a match-now flag. |
| `FollowerLeaderPnl` | Realized PnL, funding and fees of one follower attributed to one leader, using FIFO lots. |
| `GlobalStats`, `TeamRunStats` | Public traction totals, with team-run accounts counted separately. |

## Units

`*CNS` fields are AUSD in 6 decimals, `*PNS` are prices in the market's price decimals, `*LNS` are sizes in the market's lot decimals, `*Hdths` are hundredths (leverage 1000 = 10x) and `*Bps` are basis points. Timestamps are unix seconds and days are UTC.

## PnL attribution

A follower may follow up to four leaders in the same market. Each copied open adds a tranche of lots tagged with the leader it copied; reductions consume tranches first in, first out. Realized PnL, funding and fees are attributed to the leader whose tranche was closed, so the app can show what each leader actually made or lost for you.
