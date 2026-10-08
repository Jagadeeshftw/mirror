---
title: Team-run accounts
description: Which accounts the Mirror team runs, and how they are kept out of every count.
---

To let anyone see a real copy happen on demand, the Mirror team runs two accounts: first on Monad testnet, where Mirror's contracts are deployed, and on Monad mainnet once they are deployed there. This page discloses them.

## The accounts

| Account | What it is | Address |
|---|---|---|
| Demo leader | A Perpl account run by the Mirror team. It opens and closes small BTC positions when someone presses **Run demo trade** or **Run blocked trade**. | Testnet: Perpl account 1000, from the ops wallet, with 200 test AUSD. Mainnet: Perpl account 5416 (no trades). |
| Demo follower | A real MirrorAccount, run by the Mirror team, that follows the demo leader with a deliberately low max leverage so a blocked copy can be shown. | Testnet: `0x634BFE3c2E4c483e8F7F4f3F3b6B2B7383A74896`, created on 8 Oct 2026 ([tx](https://testnet.monadvision.com/tx/0x64cb1e2e64a0f36f5876b1c8b66851dd7ea0349299ece130a7c5efbc77930d59)), funded with 150 test AUSD and following the demo leader with max 2x leverage, BTC and ETH, 1% of the leader's size. Mainnet: pending |

The demo leader's mainnet Perpl account is 5416 (opened 7 Oct 2026 with 10.00 AUSD, no trades); its testnet account is Perpl account 1000, opened from the ops wallet `0x299E77E58DD37607e4890C761924D829F8ACe82C` with 200 test AUSD ([approve](https://testnet.monadvision.com/tx/0x962d18c07a46ebffccd0f3a1acfe5c6448c81594cf210257525c952a8bf91325), [create account](https://testnet.monadvision.com/tx/0x0af345a35258ee44f3d15b48df3efb1999c3a1578636f79a0aa090b7021b4b87)). The demo follower was created and funded through the app on an Android emulator ([deposit](https://testnet.monadvision.com/tx/0xd4afdf05e36ed5d9f3a5fc86dda98bd25f20134164a801bf82c4f3447dc27833), [follow](https://testnet.monadvision.com/tx/0xe172e09112d5f3074d23b4b6233e10863d05e0b4ec001adb4f8a282106ea3987)). Addresses are also on [Contracts](/docs/contracts).

## How they are excluded

- Both accounts are flagged `teamRun: true` in the API and in the indexer.
- They are excluded from every user and traction figure: accounts created, funded accounts, net AUSD deposited, copies executed, copies blocked, median latency and active followers.
- The [public stats page](/stats) shows them in a separate section labelled **Team-run (excluded from counts)**.
- The demo leader is never shown in the leaderboard as an organic leader.

## Funding

The team's own capital across all team-run accounts is capped at **30 USD** in total. External users fund their own accounts; Mirror never deposits on a user's behalf.

## Demo limits

Demo cycles are rate-limited: one cycle at a time globally, a per-IP hourly limit and a global daily cap. Demo positions are 1 lot of BTC and are closed again automatically.
