---
title: Team-run accounts
description: Which accounts the Mirror team runs, and how they are kept out of every count.
---

To let anyone see a real copy happen on demand, the Mirror team runs two accounts on Monad mainnet. This page discloses them.

## The accounts

| Account | What it is | Address |
|---|---|---|
| Demo leader | A Perpl account run by the Mirror team. It opens and closes small BTC positions when someone presses **Run demo trade** or **Run blocked trade**. | pending |
| Demo follower | A real MirrorAccount, run by the Mirror team, that follows the demo leader with a deliberately low max leverage so a blocked copy can be shown. | pending |

Addresses are published here and on [Contracts](/docs/contracts) once the contracts are deployed.

## How they are excluded

- Both accounts are flagged `teamRun: true` in the API and in the indexer.
- They are excluded from every user and traction figure: accounts created, funded accounts, net AUSD deposited, copies executed, copies blocked, median latency and active followers.
- The [public stats page](/stats) shows them in a separate section labelled **Team-run (excluded from counts)**.
- The demo leader is never shown in the leaderboard as an organic leader.

## Funding

The team's own capital across all team-run accounts is capped at **30 USD** in total. External users fund their own accounts; Mirror never deposits on a user's behalf.

## Demo limits

Demo cycles are rate-limited: one cycle at a time globally, a per-IP hourly limit and a global daily cap. Demo positions are 1 lot of BTC and are closed again automatically.
