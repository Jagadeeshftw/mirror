---
title: Why Monad
description: Measured block time, finality and gas cost, and why they matter for copy trading.
---

Copy trading has one enemy: delay. Every millisecond between the leader's fill and yours is a chance for the price to move against you. And a copy-trading account is only safe if its rules are checked on every order, which only works when checking is cheap. Monad makes both practical.

## Measured numbers

| Metric | Measured | Why it matters |
|---|---|---|
| Block time | **~300 ms** on Monad mainnet (307 ms average over 60 s on 6 Oct 2026) | A copy can land within a couple of blocks of the leader's fill. |
| Finality | **~550 ms** from Proposed to Finalized | Copies are final in about half a second, and the app shows each state. |
| Gas per copied open | **~278k gas**, about **$0.001** at current prices | Every policy check runs onchain on every order, instead of being trusted offchain. |
| Perpl fees for a 1-lot BTC copy round trip | 0.0006 AUSD, on the mainnet fork | Small copies stay worth making. |

The block-time and finality figures were measured on Monad mainnet; the gas and fee figures come from the fork tests against the live Perpl Exchange and AUSD.

## Seeing fills early

Monad's real-time `monadLogs` subscription delivers logs when a block is **Proposed**, before it is Voted or Finalized. The copy engine watches Perpl through it, so it sees a leader's fill at the earliest possible moment and can submit the copy right away. Commit-state updates (Proposed, Voted, Finalized) flow through to the app's feed.

## Parallel execution

Each follower's copy touches only that follower's MirrorAccount and Perpl account. When 100 followers mirror one leader trade, that is 100 independent transactions, which Monad's parallel execution can run side by side instead of queueing them behind each other.

## A fully onchain venue

Perpl's order book and positions are onchain. That is what lets a contract read the leader's current position and enforce the [target rule](/docs/how-copying-works#2-the-target-rule): no copy can exceed your share of what the leader actually holds.

## Gas is charged on the limit

Monad charges the gas limit rather than the gas used, so the relayer simulates every transaction first and submits it with the estimate × 1.2. That keeps the cost per copy predictable.
