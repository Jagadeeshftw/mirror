# Traction plan

This is the plan behind the go-to-market answer in the Metropolis submission (`docs/submission/fields/05-go-to-market.txt`).
Status is updated as the product ships. Targets are targets, not results. Every result is read from onchain data.

## Who the first users are
1. **Active Perpl traders.** Perpl is the fully onchain perpetuals exchange on Monad.
   - 5,406 accounts have been created on its mainnet Exchange contract (`numberOfAccounts()` at block 110,853,526, 5 Oct 2026).
   - About $1.56M of open interest sits across its 11 markets (`getPerpetualInfoV2`, average of long and short open interest at mark).
   - These users already hold AUSD on Monad, Perpl's only collateral, so funding a MirrorAccount needs no bridge and no on-ramp.
2. **Two groups within them:**
   - traders who want exposure while away from the screen;
   - smaller accounts who want to follow proven traders but will not hand keys or custody to a platform.

## Channels that reach them
| Channel | Why it reaches them | Status |
|---|---|---|
| Perpl community (Discord, X) | Where Perpl traders already are; Perpl is a Metropolis sponsor | pending: no posts yet |
| Build in public on X | Each post carries tx links for real copies and real "blocked by your rule" events | pending: no posts yet |
| Leader profiles | Every leaderboard entry is a shareable profile; leaders have a reason to share being followed | pending: profiles and share cards built, not public yet |
| Monad Discord and community | Monad users on Android who already use passkeys | pending |

## From install to first funded action
1. Download the APK from the site.
2. One passkey prompt creates the account (Mera).
3. Pick a leader on the leaderboard, ranked from onchain Perpl data (Nansen enrichment is built but has no live data yet).
4. Open the follow sheet. Defaults are suggested from the leader's history.
5. Fund the account:
   - send AUSD to the shown Monad address;
   - one signed permit moves it into the MirrorAccount, with no MON needed;
   - mainnet: minimum 10 AUSD (Perpl's account minimum), maximum 25 AUSD (beta cap while unaudited);
   - testnet: minimum 100 test AUSD (Perpl's testnet minimum), maximum 200.
6. The first copy lands the next time the leader trades, with a push notification.

Target: under 3 minutes from install to a funded follow, timed in the demo video. Status: pending.

## What we measure (public stats page, read from the Envio indexer)
| Metric | Source | Value now |
|---|---|---|
| MirrorAccounts created | `AccountCreated` events | 0 (testnet contracts deployed 7 Oct 2026; mainnet not deployed) |
| Funded accounts | `Deposited` events | 0 |
| AUSD deposited, net | `Deposited` minus `Withdrawn` | 0 |
| Copies executed | `Mirrored` events | 0 |
| Copies blocked by a rule, per rule | `Blocked` events | 0 |
| Median leader-to-copy latency | leader fill block/time vs `Mirrored` tx | not measured yet |
| Followers active in the last 7 days | accounts with a `Mirrored` event | 0 |

The stats page is built; its numbers need the hosted indexer, which is not live yet. It will be served from the same indexer as the app, so the submission numbers and the page always agree.

## Milestones and targets
| Milestone | Target | Status |
|---|---|---|
| Contracts tested, including against live Perpl on a mainnet fork | done | done: 158 tests passing, 6 of them fork tests |
| Contracts deployed and verified on Monad testnet | before the tester round | done: 7 Oct 2026, 21:56 UTC, verified on Sourcify |
| Hosted testnet engine and indexer | before the tester round | prepared on Railway, not live |
| Testnet tester round | 25 outside testers at 100 test AUSD each (2,500 test AUSD from Perpl) | pending |
| Contracts deployed and verified on Monad mainnet | after the testnet round, on the owner's go | pending |
| Demo leader and demo follower copying | first real copies with tx links (testnet first) | pending |
| Android APK public | download link on the site | pending (testnet APK being published) |
| First external funded follower | 1 | pending |
| External funded followers before judging (13 Oct) | 10 | pending (target) |

Capital we put in ourselves is capped at 30 USD in total (demo leader plus demo follower). External users fund their own accounts.

## Path to a business
- **Revenue:** Mirror is Perpl builder 26, charging 0.02% of the size a copy opens or adds and nothing on closes or stops. Confirmed by Perpl on 7 Oct 2026; live once Mirror's contracts are deployed (it is in the testnet deployment). Perpl's exchange charges the fee on the opening fill and pays it to Mirror; Mirror's contracts never transfer it, and each follower's contract refuses any copy whose fee is above the maximum they signed. Illustration only, not a forecast: $10M of copied opening notional in a month would be $2,000 that month at 0.02%. No fee has accrued onchain yet.
- **Growth:** raise the per-account cap after an audit. Followers bring more capital, and leaders bring their audiences.
- **Expansion:** the same pattern (an owned venue account plus onchain policy checks plus a keeper that cannot withdraw) works on any fully onchain order book, starting with other Monad venues.
