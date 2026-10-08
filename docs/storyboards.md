# Storyboards (final)

Final shot lists for the four submission videos. Nothing is recorded yet. Every on-screen number and transaction link comes from a real run; nothing is mocked, and nothing is typed into a screen by hand.

testIDs are from `app/TESTIDS.md` (on the web build they are `data-testid`). Step numbers ("A-13") refer to the Stage A Android flows that already run each sequence end to end on the localnet: `devices/e2e/flows/stage-a.flow` (steps 01-18) and `stage-a-g2.flow` (steps 19-34). Rehearse a video by running those flows first.

## Recording setup

- **Phone:** the testnet release APK (`app/scripts/build-apk.sh`, bundled network `testnet`) on the Android emulators `mirror-a` and `mirror-b` (android-35 Google Play image, Pixel 7 profile), both signed in to the same Google account, screen lock set. Record with `adb shell screenrecord` or the emulator's recorder at the native resolution. Light theme for videos 1, 3 and 4, dark for video 2 (`settings.theme.<light|dark>`).
- **Laptop:** the web app at `https://mirror.0xo.in/app` in Chrome at 1440×900 (laptop layout from 1024 px).
- **Explorer:** `https://testnet.monadvision.com` in a second tab for every tx link shown.
- **Terminal** (videos 1 and 4 only): the engine's logs from the hosted service, or a local engine pointed at testnet.
- **Network:** Monad testnet (chain 10143) with Mirror's deployed contracts (`contracts/deployments/10143.json`) and Perpl's testnet exchange. Caption every video once: "Monad testnet · test funds".
- **Wording:** in captions and voice-over, the recording device is "an Android emulator", never a phone; or show the app without naming the device. Mirror has only run on Android emulators.
- **Voice-over:** recorded separately and kept short; captions burned in; no music under the voice.

### Before recording (all four videos)

| Needed | Why | Status (8 Oct 2026) |
|---|---|---|
| Hosted testnet engine and relayer | Account creation, deposits, follows, Run demo trade, copies, the feed | prepared on Railway (`mirror-testnet`), not live |
| Hosted testnet indexer | Leaderboard, stats page, per-copy quality | prepared, not live |
| Team-run demo leader's Perpl testnet account and the demo follower (`0x634BFE3c2E4c483e8F7F4f3F3b6B2B7383A74896`, counterfactual today) | Watch mode, Run demo trade, Run blocked trade | not created yet |
| Testnet APK and web app published | Every app shot | being published |
| Test AUSD for the recording account: 100 from the tester pool | Perpl's testnet minimum to open an account is 100 test AUSD | in the ops wallet |
| A second wallet with a little test MON (the "stranger") | Executing someone else's take-profit | to create |

**Fallback, labelled.** If a shot cannot be made on testnet by the recording day (for example, the mark never reaches a take-profit), record it on the localnet that runs Perpl's real exchange code (`localnet/run-stage-a.sh` or `devices/run-stage-a-android.sh`) and burn in the caption "Local network running Perpl's exchange code, not testnet". Never cut localnet footage into a testnet shot without that caption.

---

## 1. Technical demo (3:00)

For technical judges: the whole loop, and the onchain proof behind each claim.

| # | Time | Screen and exact flow | On-screen caption | Voice-over | Claim shown | How to verify |
|---|---|---|---|---|---|---|
| 1 | 0:00 | mirror-a, Welcome (`onboarding.screen`) → tap **Create account** (`onboarding.createAccount`) → one system passkey sheet → Home (`home.screen`). (A-01) | "One passkey prompt. No seed phrase, no extension." | "One passkey. That's the whole account." | The account is derived from the passkey through Mera's PRF | `app/src/lib/derive.ts`, `wallet.ts`; Stage A step 01 |
| 2 | 0:15 | Home in watch mode (`home.watch`): `watch.teamRun` reads "Team-run", `home.equity` 0.00, `watch.source` "Live". (A-02) | "Before you deposit: a real team-run account, labelled." | "Before you deposit, you watch real copies land." | Team-run accounts are labelled and excluded from counts | `web/content/docs/team-run-accounts.md`; `watch.teamRun` |
| 3 | 0:25 | Tap **Run demo trade** (`watch.runDemo`). The cycle steps fill in (`watch.step.<key>.<status>`); the copy card appears in `watch.feed.<n>` with its fee. Tap it → `copy.detail`: `copy.proof.leaderFill`, `copy.proof.yourFill`, `copy.proof.deviation`, `copy.proof.latencyMs`, `copy.proof.fee`, `copy.proof.leaderTx`, `copy.proof.yourTx`. Tap **Verify on MonadVision** (`copy.verify`) → explorer tab. (A-04, A-05) | "Leader fill vs your fill, in bps. Latency in seconds and blocks. Mirror fee: builder 26." | "The leader trades on Perpl. The copy lands, and its proof is onchain." | Every copy event carries leader fill, follower fill, deviation and fee | The `Mirrored` event in the copy tx on MonadVision; `CopyProofTest` |
| 4 | 0:50 | Close the sheet (`copy.detail.close`). Open the demo's close card → `copy.proof.fee` reads 0. (A-06) | "Closes pay no Mirror fee." | (none) | Builder fee only on opening size | `BuilderFeeTest`, `invariant_builderFeeOnlyOnOpensAtTheFixedRate` |
| 5 | 0:58 | Tap **Run blocked trade** (`watch.runBlocked`). Card banner "Not copied. Your rule: Max leverage 5x" → `blocked.detail`: `blocked.title`, `blocked.sentence` (10x vs 5x), `blocked.tx`. (A-07) | "A rule hit doesn't trade. It's recorded onchain, with the numbers." | "Break a rule and nothing trades. You get a transaction that says why." | Blocked event with the rule, limit and actual value | The `Blocked` event in `blocked.tx`; `MirrorTest` |
| 6 | 1:15 | Leaders tab (`home.tab.leaders`) → a leader (`leaders.item.<n>`) → **Follow** (`leader.follow`) → follow sheet: `follow.amount.input` 100, `follow.ratio.slider`, `follow.entryFilter.1`, `follow.leverage.slider` → **What if** (`follow.seeWhatIf`): `follow.whatif.sim` "Simulation", `follow.whatif.pnl`, `follow.whatif.blockedTotal`. (A-10, A-11) | "What would your own limits have done? A simulation, labelled as one." | "Before you follow, see what your own limits would have done." | The backtest replays the leader's history through the follower's limits | `engine/src/services/backtest.ts`; `follow.whatif.sim` |
| 7 | 1:35 | **Review** (`follow.review`): `follow.review.fee` "Mirror fee: 0.02% of opening size (builder 26)" → **Approve with passkey** (`follow.confirm`), one prompt; `follow.matchNow.toggle` on; progress `step.<sign|create|deposit|follow|policy>.<state>`; `follow.status` "Matched". Open the follow tx on MonadVision. (A-12, A-13) | "One prompt: account, deposit by permit, policy and the first Perpl order. No MON." | "One signature creates the account, deposits by permit, signs the limits and matches the leader." | Gasless deposit; match now through the same checks | `MatchNowTest`; the follow tx on MonadVision |
| 8 | 1:55 | Positions (`home.tab.portfolio`) → `position.<SYM>.<side>` → **Edit levels** (`position.editLevels`) → `levels.mode.pct`, `levels.tp.input` → `levels.save`, one prompt → `position.levels.onchain`. Then the stranger wallet calls the trigger once the mark passes the level; the feed card reads "Take-profit executed by 0x…" and `copy.closedBy.title` names the stranger. (A-24, A-25) | "Stops live in your contract. Anyone can execute them, only once they're true onchain." | "If our servers go down, your stops still work." | Permissionless, reduce-only triggers checked against the mark and a fresh Chainlink price | `StopTriggerTest`, `invariant_triggersOnlyReduce`, `test_level_freshOracleMustAgree`; the trigger tx's `from` is the stranger |
| 9 | 2:20 | Leader profile → **Stop following** (`leader.stopFollow`) → `stop.sheet` → `stop.option.keep` → `stop.confirm`, one prompt → `follow.status` "Stopped, positions kept", `leader.detached`. When the leader next trades, the feed shows "Blocked: you stopped following …". (A-28) | "Stop following, keep my positions. Enforced by your contract." | "Stop following a leader and your contract refuses their trades. Your positions and stops stay." | `setLeaderDetached`; Blocked reason 22 (`LeaderDetached`) | `DetachTest`, `testFuzz_detachedLeaderNeverTrades`, `invariant_detachedLeaderNeverCopied`, `test_fork_detachAgainstLivePerpl` |
| 10 | 2:40 | Positions → **Close all positions** (`portfolio.closeAll`) → `portfolio.closeAll.confirm`, one prompt → `portfolio.positions.count` 0. Home → **Withdraw** (`home.withdraw`) → `withdraw.max` → `withdraw.continue` → `withdraw.confirm`, one prompt → `withdraw.status` "Confirmed". (A-16, A-17) | "Only you can withdraw. The keeper can't." | "Close everything, withdraw, no gas. Only to you." | No code path sends collateral to anyone but the owner | `invariant_keeperNeverReceivesCollateral`, `testFuzz_keeperArbitraryCalldataNeverExtracts`; withdraw tx recipient |
| 11 | 2:52 | mirror-b: Welcome → `onboarding.restore` → passkey picker → `restore.welcome.back` "Welcome back" → `restore.go.home`; the same address. (A-18) | "Second Android emulator, same Google account: same account back." | (none) | Restore from the synced passkey | Stage A step 18 |

Cut 9 or 11 first if the edit runs long.

---

## 2. Pitch (2:00)

For VC and Monad judges: founder and market readiness. Dark theme.

| # | Time | Visual | On-screen text | Voice-over | Claim | How to verify |
|---|---|---|---|---|---|---|
| 1 | 0:00 | Founder on camera | "Jagadeesh · solo builder" | Who I am, and that I built Mirror solo in the hackathon window. | Solo build in the window | Git history; README "Pre-existing code" |
| 2 | 0:12 | Two or three dated headlines about copy-trading or trading-bot platforms losing user funds or keys, each with its source URL on screen | The source of each headline | Copy trading today means handing your money or your keys to a platform, and its risk settings live on its servers. | Custodial and key-holding platforms have lost user funds | Only headlines with a linked, dated source; drop any without one |
| 3 | 0:30 | Android emulator: follow sheet Review (`follow.review.fee`), then a Blocked detail (`blocked.sentence`) | "Your contract. Your limits. Checked on every order." | Mirror gives each follower their own contract account. Their limits are checked onchain on every order, and the keeper can trade but never withdraw. | Keeper cannot withdraw | `invariant_keeperNeverReceivesCollateral` |
| 4 | 0:50 | Video 1 shot 8 (take-profit executed by a stranger) | "Stops work even if we're down." | Stops anyone can execute, so they work even if we're down. | Permissionless triggers | `StopTriggerTest` |
| 5 | 1:02 | Video 1 shot 9 (Stop following, keep my positions) | "Leave a leader. Keep your positions." | Leave a leader at any time; your contract enforces it. | Onchain detach | `DetachTest` |
| 6 | 1:12 | Stats page, copy quality section (once the indexer is live; otherwise the copy detail proof from video 1 shot 3) | "Every copy's quality is public." | Every copy's quality is public and recomputable from chain data. | Proof in every copy event | `CopyProofTest`; indexer quality entities |
| 7 | 1:25 | Why Monad card | "Blocks ≈300 ms · Finalized ≈550 ms after Proposed · every rule checked onchain" | Copies follow within moments, cheaply enough to check every rule on every order. | Measured on mainnet 6 Oct 2026 | `node scripts/measure-monad.mjs`; gas from `test_fork_keeperCopyGasProfile` (print the number from the recording day's run, not an older one) |
| 8 | 1:38 | Business model card | "Perpl builder 26 · 0.02% of opening size · nothing on closes · confirmed by Perpl 7 Oct 2026 · no revenue yet" | Mirror earns 0.02% of the size a copy opens, as Perpl builder 26. Nothing on closes, capped by each follower's contract, shown on every copy. No fee has accrued yet. | Fee model only; no revenue claimed | `contracts/deployments/10143.json` (`builderId` 26, `builderFeePer100K` 20); `docs/bounties/perpl-api.md` |
| 9 | 1:48 | Traction card | Real counts on the recording day: testers, funded accounts, copies, blocks (team-run excluded). If an illustration of revenue is shown, label it "Illustration, not a forecast". | Traction so far, stated plainly. Next: audit, then raise the deposit cap. | Only measured numbers | Stats page / indexer on the day; `docs/funding-ledger.md` |

---

## 3. Agora video (≤ 2:00; "PWAs are accepted")

The required beats, in this order: passkey login, an AUSD balance, at least one trade on Perpl from the app. Android emulator, light theme.

| # | Time | Screen and exact flow | On-screen caption | Claim | How to verify |
|---|---|---|---|---|---|
| 1 | 0:00 | Welcome → `onboarding.createAccount` → one passkey prompt → Home | "Log in with a passkey (Mera). No seed phrase." | Authenticates via Mera | `app/src/lib/derive.ts`; A-01 |
| 2 | 0:15 | Balance chip in the app bar (`home.balance.ausd`) after 100 test AUSD arrive in the wallet; zoom on the chip | "Your AUSD balance, on every screen." | Holds and displays AUSD | `home.balance.ausd`; the AUSD transfer on MonadVision |
| 3 | 0:30 | Account → **Add funds** (`account.addFunds`) → `funds.step.deposit` → `funds.amount.input` → `funds.confirm`, one prompt → `funds.status` "Deposited". (A-21) | "Into your own contract account, by permit. No MON needed." | Gasless AUSD deposit | `test_depositWithPermit_*`; the deposit tx |
| 4 | 0:50 | Leaders → leader → `leader.follow` → follow sheet with `follow.matchNow.toggle` on → `follow.seeWhatIf` → `follow.review` (`follow.review.fee`) → `follow.confirm` → `follow.status` "Matched" → feed card `activity.item.0` → `copy.detail` → `copy.verify` opens the Perpl fill on MonadVision | "A trade on Perpl, placed by your contract." | Executes trades through Perpl | The order fill event from Perpl's Exchange in the tx |
| 5 | 1:20 | The leader trades: a `COPY` card lands; then a `BLOCKED` card with its banner (`activity.blocked.banner`) | "Your rules decide what gets copied." | Onchain rules over every copy | `Blocked` event in the tx |
| 6 | 1:40 | Laptop: the web app (`/app`), same passkey, same balance (`nav.balance`) | "The same account in the browser." | One passkey account on Android and web | Web Stage A run (`localnet/e2e-web.mjs`) |
| 7 | 1:52 | End card | "Mirror · mirror.0xo.in · @MirrorOnMonad · Monad testnet" | | |

---

## 4. Perpl automation video (≤ 2:00; "real onchain activity")

Must show real onchain activity, so it is recorded on testnet only (no localnet fallback for shots 2-6).

| # | Time | Screen | On-screen caption | Claim | How to verify |
|---|---|---|---|---|---|
| 1 | 0:00 | Diagram: Perpl fill (monadLogs at Proposed) → engine (REST context, WebSocket marks and book) → policy pre-check → thin-book guard → keeper → MirrorAccount → Perpl | "Perpl's API in, Perpl's exchange out." | Engine reads Perpl REST and WebSocket | `engine/src/perpl/` (REST `/v1/pub/context`, WS `market-state`, `order-book`, `trades`) |
| 2 | 0:15 | Terminal: engine logs as a leader fill arrives, the plan, then the send | "Leader fill seen at Proposed → copy sent." | Fill seen at Proposed | `engine/src/services/watcher.ts`, `engine/src/chain/streams.ts` (monadLogs); the log line's block number vs the leader tx's block |
| 3 | 0:35 | MonadVision: the leader's tx, then the copy's tx; their blocks | "Leader → copy: N blocks." (N read from the two txs) | Copy latency | Both tx pages; `copy.proof.latencyMs` |
| 4 | 0:50 | The copy tx's logs: Perpl's fill event with builder 26 and its fee, and Mirror's proof event with the same fee | "Builder 26: 0.02% of opening size, in Perpl's own fill event." | Builder attribution on opens only | `test_fork_builderFeeOnLivePerpl`; the tx logs |
| 5 | 1:05 | Optional (cut if none occurred): app feed with an engine card "Shrunk: thin book" or "Skipped: thin book" (`activity.item.<n>.label`, `.engine`) if one occurred; otherwise the guard's config and its test | "Thin book? The copy is shrunk or skipped. No transaction." | Book depth must be 2x the copy within the limit price | `engine/src/services/guard.ts`, `engine/src/domain/thinbook.ts`, `thinbook.test.ts`. Show only a real guard event, never a staged one |
| 6 | 1:20 | Stats page: copies with leader vs follower price and latency; blocks by reason | "Every copy and every block, public." | Copy quality from chain data | Stats page; indexer |
| 7 | 1:35 | A stop executed by the engine's stop executor or a stranger once it is true onchain (video 1 shot 8) | "Stops run only when true onchain." | Trigger refused unless reached | `StopTriggerTest`; trigger tx |
| 8 | 1:50 | End card | "Stats: mirror.0xo.in/stats · keeper 0x299E…e82C · Monad testnet" | | Keeper address in `contracts/deployments/10143.json` |
