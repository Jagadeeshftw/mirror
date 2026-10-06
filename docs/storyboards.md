# Storyboards

The four videos the submission needs, built around the group 1 flows. Nothing is recorded yet. Each scene is filmed only once the thing in it is real: testnet first, mainnet for the final cut. Every on-screen number and transaction link comes from a real run; nothing is mocked.

Recording setup:
- Phone: the release APK on a signed-in Android emulator (mirror-a), or a real device if available, at 1080×2340, both themes.
- Laptop: the web app at 1440×900.
- Links: MonadVision in a browser tab for transaction links.
- Voice-over: recorded separately and kept short; captions burned in.
- No music under the voice.

Status keys used below: **[ready]** works today on the localnet and the mainnet fork; **[testnet]** needs the testnet deployment; **[mainnet]** needs the mainnet go.

---

## 1. Technical demo (3:00)

For: technical judges. It shows the whole loop and the onchain proof behind each claim.

| # | Time | Screen | What happens | Voice-over (short) | Proof on screen | Needs |
|---|---|---|---|---|---|---|
| 1 | 0:00 | Phone: install, welcome | Open the APK, tap Create account, one fingerprint prompt | "One passkey. No seed phrase, no extension." | Address appears; Settings shows the second PRF namespace key | [ready] |
| 2 | 0:15 | Phone: Home in watch mode | No deposit yet. Live copies land on the team-run demo follower, labelled Team-run | "Before you deposit, watch real copies land." | Feed rows with tx links | [testnet] |
| 3 | 0:30 | Phone: Run demo trade | Tap "Run demo trade". The demo leader trades on Perpl, then the copy lands | "The leader trades on Perpl's book. The copy lands about a second later." | Copy detail: leader fill vs follower fill, deviation in bps, Proposed→copy ms and blocks, two tx links | [testnet] |
| 4 | 0:50 | Phone: Run blocked trade | The demo leader opens 10x; the follower's rule is 5x | "A rule hit doesn't trade. It's recorded onchain with the numbers." | Blocked detail: rule, limit 5x, actual 10x, tx link | [testnet] |
| 5 | 1:05 | Phone: Leader profile, look back | Open a real leader, set limits, see "What if I had followed" for 30 days | "Before you follow, see what your own limits would have done." | Equity curve, copied vs blocked by rule, labelled "Simulation" | [testnet] |
| 6 | 1:25 | Phone: Follow sheet | Entry filter 1%, leverage cap 3x, take-profit and stop-loss, "anyone can execute my stops" on. Deposit 20 AUSD with a permit. Follow with match now | "Your limits live in your own contract, checked on every order." | Policy tx and the match-now fills | [testnet] |
| 7 | 1:50 | Laptop: web app, two leaders | The same account on a laptop: split the budget between two leaders, each with its own loss stop | "One deposit, two leaders, separate budgets and stops." | Per-leader margin and PnL from `leaderBook` | [testnet] |
| 8 | 2:10 | Laptop: terminal | Kill the engine. Move the mark past the stop on the localnet; a stranger's wallet executes the stop | "If our servers go down, your stops still work. Anyone can execute them, and only when they're true onchain." | `StopTriggered` event, position closed, the caller received nothing | [ready] on the localnet; [testnet] for the cut |
| 9 | 2:30 | Phone: Positions, withdraw | Close all and withdraw, gasless | "Only you can withdraw. The keeper can't." | Withdraw tx to the owner | [testnet] |
| 10 | 2:45 | Stats page | Copy quality from onchain events: deviation distribution, latency, blocks by reason, team-run excluded | "Every number here is recomputable from chain data." | Public stats URL | [testnet] |

---

## 2. Pitch (2:00)

For: VC and Monad judges. Founder and market readiness.

| # | Time | Visual | Voice-over |
|---|---|---|---|
| 1 | 0:00 | Founder on camera | Who I am, and that I built this solo in the hackathon window. |
| 2 | 0:12 | Headlines: 3Commas API keys leaked; Telegram bots drained; copy-trading leaderboards gamed | Copy trading today means handing your money or your keys to a platform, and its risk settings live on its servers. |
| 3 | 0:30 | Phone: follow sheet, then a Blocked detail | Mirror: your own contract account. Your limits are checked onchain on every order, and the keeper can trade but never withdraw. |
| 4 | 0:50 | The stop executed by a stranger (scene 8 above) | Stops that work even if we're down. |
| 5 | 1:05 | Stats page, copy quality | Every copy's quality is public and recomputable from chain data, which the incumbents can't offer. |
| 6 | 1:20 | Why Monad: measured blocks ~300 ms, finality ~550 ms, checked copy ~0.4M gas | Copies land in about a second, cheaply enough to check every rule on every order. |
| 7 | 1:35 | Real numbers only: testers, copies, leaders followed | Traction so far, stated plainly. |
| 8 | 1:48 | Roadmap card | Next: audit, then raise the deposit cap; leader opt-in profiles. Business model: pending Perpl's answer on onchain builder codes. Never a fee out of follower collateral. |

The traction and business lines get filled in with real numbers on the day. Builder fees are mentioned only as pending.

---

## 3. Agora video (≤ 2:00; "PWAs are accepted")

The required beats, in this order: a passkey login, an AUSD balance, and at least one trade on Perpl from the app.

| # | Time | Screen | Beat |
|---|---|---|---|
| 1 | 0:00 | Phone: create account, one prompt | Authenticates via Mera |
| 2 | 0:15 | Phone header | The AUSD balance, always visible |
| 3 | 0:25 | Phone: deposit by permit | AUSD into the user's own account, gasless |
| 4 | 0:45 | Phone: follow with match now | The trade executes through Perpl: the fill and its tx |
| 5 | 1:10 | Phone: a copy lands, then a Blocked one | Creative part: trading that the user's own contract rules over |
| 6 | 1:35 | Laptop: the same account in the web app | Works as a PWA on laptop and iPhone too |
| 7 | 1:50 | End card | Mirror, mirror.0xo.in, @MirrorOnMonad |

---

## 4. Perpl automation video (≤ 2:00; "real onchain activity")

| # | Time | Screen | Beat |
|---|---|---|---|
| 1 | 0:00 | Diagram | Perpl WebSocket fill → engine (REST context, book depth) → keeper → MirrorAccount → Perpl |
| 2 | 0:15 | Terminal: engine logs | A leader fill arrives at Proposed; the plan, then the send |
| 3 | 0:35 | MonadVision | The leader's tx, then the copy's tx; ~1 s apart |
| 4 | 0:50 | Terminal: thin-book guard | A copy shrunk or skipped because Perpl's book was too thin, and why |
| 5 | 1:05 | Stats page | Every copy with leader vs follower price and latency, and every block with its reason |
| 6 | 1:25 | Stop executor | A take-profit simulated, then sent only because it's true onchain |
| 7 | 1:45 | End card | Public link to the stats page and the keeper address |

---

## What still has to exist before recording

- Testnet: contracts deployed, engine and indexer hosted, public APK and web app (scenes 2–7, 9, 10; all of the Agora and Perpl videos).
- The design-approved screens: watch mode, copy detail, look back, multi-leader, web app layouts.
- Mainnet for the final cut, on the owner's go.
