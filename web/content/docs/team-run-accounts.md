---
title: Team-run accounts
description: Which accounts the Mirror team runs, and how they are kept out of every count.
---

To let anyone see a real copy happen on demand, the Mirror team runs two accounts: first on Monad testnet, where Mirror's contracts are deployed, and on Monad mainnet once they are deployed there. This page discloses them.

## The accounts

| Account | What it is | Address |
|---|---|---|
| Demo leader | A Perpl account run by the Mirror team. It opens and closes small BTC positions when someone presses **Run demo trade** or **Run blocked trade**. | Mainnet: Perpl account 5416 (no trades). Testnet: pending |
| Demo follower | A real MirrorAccount, run by the Mirror team, that follows the demo leader with a deliberately low max leverage so a blocked copy can be shown. | Testnet: `0x634BFE3c2E4c483e8F7F4f3F3b6B2B7383A74896` (the factory's predicted address; created when the hosted service goes live). Mainnet: pending |

The demo leader's mainnet Perpl account is 5416 (opened 7 Oct 2026 with 10.00 AUSD, no trades); its testnet account is opened from the ops wallet `0x299E77E58DD37607e4890C761924D829F8ACe82C` when the hosted service goes live. Addresses are also on [Contracts](/docs/contracts).

## How they are excluded

- Both accounts are flagged `teamRun: true` in the API and in the indexer.
- They are excluded from every user and traction figure: accounts created, funded accounts, net AUSD deposited, copies executed, copies blocked, median latency and active followers.
- The [public stats page](/stats) shows them in a separate section labelled **Team-run (excluded from counts)**.
- The demo leader is never shown in the leaderboard as an organic leader.

## Funding

The team's own capital across all team-run accounts is capped at **30 USD** in total. External users fund their own accounts; Mirror never deposits on a user's behalf.

## Demo limits

Demo cycles are rate-limited: one cycle at a time globally, a per-IP hourly limit and a global daily cap. Demo positions are 1 lot of BTC and are closed again automatically.
