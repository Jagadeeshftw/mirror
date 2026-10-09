# Stage B against the hosted engine (Monad testnet, 9 Oct 2026)

Everything here ran against **public Monad testnet** (chain 10143) and Mirror's **hosted** testnet service on Railway (project `mirror-testnet`): the engine and relayer at https://engine-production-0fd2.up.railway.app, Mirror's testnet contracts, Perpl's testnet exchange and the team-run demo leader (Perpl account 1000). Nothing ran on the developer's machine except the test drivers: Android **emulators** (`mirror-a`, `mirror-b`, Android 15) with the release APK testers get, and Google Chrome against the live site https://mirror.0xo.in/app. Test funds only (test AUSD has no value); builder 26's fees here are test AUSD, not revenue. No mainnet transaction.

Every transaction below links to MonadVision (testnet).

## Hosted services (checked on 9 Oct 2026, 10:00-10:35 UTC)

- **Engine and relayer** (`engine`): https://engine-production-0fd2.up.railway.app/v1/health answers `ok`, `ready`, chain 10143, Monad WebSocket stream connected. Keeper and relayer are the ops wallet `0x299E…e82C`. Run buttons: 6 per network per hour, 48 a day. The database is on a Railway volume, so push registrations survive redeploys.
- **Hasura** (`hasura-testnet`, `hasura-mainnet`): https://hasura-testnet-production.up.railway.app/v1/graphql and https://hasura-mainnet-production.up.railway.app/v1/graphql track all 25 indexer entities each, read-only for the public (a mutation is refused: "no mutations exist").
- **Indexers** (`indexer-testnet`, `indexer-mainnet`), still catching up on history at 10:33 UTC: testnet at block 68,852,249 of 69,516,764 (from 60,598,814, before Mirror's deployment), mainnet at 105,392,896 of 111,873,282 (30 days back, for the /perpl analytics).
- **HyperSync proxy** (`hypersync-proxy`, private): its once-a-minute log line reads "14 req in the last minute (limit 14/min), queued 19-23, throttled 0 total", so the two indexers share the free token below Envio's 15 a minute and were never throttled.
- **Public numbers**: `/v1/stats` counts outside users only. The team-run demo accounts and, since the 9 Oct redeploy, the team's own test accounts from these runs (`TEAM_TEST_ADDRESSES`) are listed separately; at the time of writing the user counts are 0.
- **Site**: deployed against the hosted engine on 9 Oct (09:46 UTC). Post-deploy check on GitHub's macOS runner: 36 of 36 (9 pages × desktop Chrome, Chrome at phone width with Reduce Motion, desktop Safari, Safari at phone width, clean profiles). The local run passed 17 of 18 in Chrome; its one failure, a console error from the home page's beam animation (`<stop>` offset "undefined", 3 of 4 clean loads), is fixed for the next deploy. Its Safari half could not open Safari because the Mac's screen was locked. `/app` shows no "Can't reach Mirror's service" banner, and Run demo trade and Run blocked trade are enabled.

## Android emulators, hosted engine

APK: Mirror 1.0.2 (versionCode 102, release-signed, certificate `f318967317…87ba` as in `assetlinks.json`), `app/dist/mirror-1.0.2-release.apk`, 43,855,153 bytes, SHA-256 `713b904fe2d548ae542a40e06c83a69697a13ee9928a5f67440da33c667ea566`, built against the hosted engine with the bundled network testnet. Flows: `devices/e2e/flows/stage-b-hosted.flow` (01-16) and `stage-b-hosted-part4.flow` (07, 08, 10b, 11-16; the runner reinstalls the app at the start of a run, so part 4 restores the test user again). Runner: `devices/run-stage-b-android.sh --hosted`.

Accounts: a brand-new passkey account on `mirror-a` with no funds; the demo follower's owner `0x3aBF…6C78` restored on `mirror-a`; the test user `0x1bbD…040D` (follow account `0xE199…29ba`, its own 149.73 test AUSD) restored on `mirror-b`.

| Step | What | Run (devices/evidence/…) | Result |
|---|---|---|---|
| 01 | A brand-new account on mirror-a with one passkey prompt, no funds | stage-b-hosted-android-20261009-153121 | pass |
| 02 | Watch mode on the hosted engine: Live, the Team-run demo account, Run buttons enabled, no service banner | -153121 | pass |
| 03 | Run demo trade from the unfunded account: the copy lands with builder 26 charged 166 units (0.000166 test AUSD); the copy detail shows both fills (82,624.9), +0.0 bps, 0.61 s / 2 blocks, the fee and both transactions | -153121 | pass ([copy](https://testnet.monadvision.com/tx/0xfd60066f5cb2613ef657c0026781783b784ccb38dbf3cf5a04d1e66777c93110)) |
| 04 | The demo's close copied with no builder fee | -153121 | pass ([copy, fee 0](https://testnet.monadvision.com/tx/0xdad63b1568311e1251c6d811ea4ba2fd96780160821957cae03ef249481bcb7e)) |
| 05 | Run blocked trade: Blocked onchain, "Blocked by your max leverage rule", 10x against 2x | -153121 | pass ([blocked](https://testnet.monadvision.com/tx/0xd25e9293903ea0f7b556c7f9da725a6802cb639af8cdb21086db79e78895640c)) |
| 06 | mirror-a restores the demo follower's owner from its passkey: same address, follow account `0x634B…4896` with 150 deposited | -153121 | pass |
| 07 | mirror-b restores the test user from its passkey | -153121, -155229 | pass |
| 08 | Alerts on: Android's notification permission (asked only then), one passkey prompt signs the Firebase registration ("Registered · Android push") | -153121, -155229 | pass |
| 09 | Follow the demo leader again (one passkey prompt): the contract clears the detach | -153121 | pass ([follow](https://testnet.monadvision.com/tx/0x13aa47b154d4c501d3f72dd1e60142ee11e4a4e237f037bc974b37bf13ec3552) · [resume](https://testnet.monadvision.com/tx/0xa454d8e8a599d95f2660f6c475860ab163b94f8425a1d893a79f263da5c9613c)) |
| 10 | Deposit 100 test AUSD into the follow account by permit (one passkey prompt, no gas) | -153121 | pass ([deposit](https://testnet.monadvision.com/tx/0x05aa597f3ee339d51e7a3360577c9ad6c48de86a02145efe3849fcbf0519ae8b)) |
| 11, first try | The demo leader opens 50 lots: no copy for the test user, no alert | -153121 | **fail**: right after step 09 the engine's keeper had paused the account with an account stop ([stop](https://testnet.monadvision.com/tx/0xd9d9cb2d3751d3c2bad79f370af9138028a4bcdc843e926d67a8cc850c305987), Drawdown, limit 213,267, actual 0). The account was empty: after an 0.27 test AUSD loss on 8 Oct it had withdrawn everything, which leaves the high-water mark above zero. Engine fixed and redeployed (below). ([leader](https://testnet.monadvision.com/tx/0xae62651e40c98f12b920bb8770fc207d7a5cd5ccee512f2d970c08d3b3c0d894)) |
| 10b | The test user resumes copying on the leader's profile (one passkey prompt); with the deposit in, the stop no longer holds | -155229 | pass ([resume](https://testnet.monadvision.com/tx/0x3c66172225e6279630bd98e51c109412dc4760440f4b227b0752bee5eeff7551)) |
| 11 | The demo leader opens 50 lots BTC on Perpl testnet: the test user's copy lands (100 lots, matching the leader's 100 then open), builder 26 charged 16,526 units (0.016526 test AUSD); **Firebase delivers the alert**, shown only as "Mirror · New activity" | -155229 | pass ([leader](https://testnet.monadvision.com/tx/0x4d4b693f65a0ebe42a92691f9ab3426aa2a667a8f61393b3a67bc18881e8f1de) · [copy](https://testnet.monadvision.com/tx/0x297284a6b1f2259ee4a927d40643ae349fde14ed528d721bb9032c6ca1f6fb7b)) |
| 12 | Stop following, keep my positions (one passkey prompt): `leaderDetached(1000)` set by the test user's own contract; the profile reads "Stopped, positions kept" | -155229 | pass ([detach](https://testnet.monadvision.com/tx/0xb08c19d6a072c7d3ebb465bc111051217038f97a4ad2666d140a640136c558b0)) |
| 13 | The leader exits: the demo follower's close is copied with no fee; the detached test user keeps its 100 lots. The leader closed in two orders: the flow's 50, then the 50 left open by the first try of step 11 (sent by hand during the step, so the leader was flat) | -155229 | pass ([leader](https://testnet.monadvision.com/tx/0xc5a38e10f8eff23ff444e41c5c90f9f21f6326c9d0c881262152e395339b700b) · [leader, the rest](https://testnet.monadvision.com/tx/0x011fa21a780618d2e0e8800ac05a69140aef16113b869b781adfa76ac4dd41e5) · [copy, fee 0](https://testnet.monadvision.com/tx/0x24b4f241fd825cd802b6abcbdbde4acce4cd4b61e87b6af44414a109f04d10e9)) |
| 14 | Close all (one passkey prompt): 0 lots onchain | -155229 | pass ([close all](https://testnet.monadvision.com/tx/0xf8b251d53d9cdea821149ce0836603a6ac816e677fe890c4e22c42f75c4d98bb)) |
| 15 | Withdraw to the wallet (one passkey prompt): 99.893971 test AUSD back, wallet 149.627387 | -155229 | pass ([withdraw](https://testnet.monadvision.com/tx/0xb6a8713e0c7c297f94f7f1270e70f83f99a62c07b83e12309bf3d703f7118373)) |
| 16 | The demo leader opens at 10x: the demo follower's 2x rule blocks the copy onchain; mirror-a's watch feed shows it as Not copied | -155229 | pass ([leader](https://testnet.monadvision.com/tx/0x222097487d7cd94064e44500d45e483fd7a44b807efaf380db735787f72499ea) · [blocked](https://testnet.monadvision.com/tx/0x464e326f240fe3392dba0ab92968fa4632cb9e8e7637523a9b1c6a933e97a57e) · [leader close](https://testnet.monadvision.com/tx/0x41aa67756ba985955597170aaeb19c0808e77ba68dea0c87aa47c5a0ddef24a3)) |

Afterwards the demo leader (99.65 test AUSD) and the demo follower are flat again.

Earlier attempts the same day are kept as found: `stage-b-hosted-android-20261009-144615` (01-05 pass on the first 1.0.2 build, SHA-256 `2a63eb53…d12e`, never published), `-145058` (06-07 pass; 08 failed on Android's notification permission dialog, now tapped), `-145553` (the emulator refused to start for lack of disk space), `-154938` (part 4 before it restored the test user after the runner's reinstall).

## Live web app (Chrome), hosted engine

Run `web-2026-10-09T09-34-34-764Z` (`localnet/e2e-live-web.mjs`): the live https://mirror.0xo.in/app in Google Chrome with a virtual passkey authenticator (passkeys with PRF), no mocks. The funded part used 100 test AUSD of team funds from the demo leader's Perpl account, never the tester pool (`docs/funding-ledger.md`, 9 Oct 09:35).

| What | Result |
|---|---|
| A brand-new account (laptop layout) with one passkey ceremony, no funds | pass |
| Watch mode on the hosted engine: Live, no service banner, Run buttons enabled | pass |
| Run demo trade: the copy lands; the copy detail shows the leader's fill and the copy's fill (82,599.1 both, +0.0 bps) and builder 26's fee, checked onchain (166 units = 0.000166 test AUSD) | pass ([copy](https://testnet.monadvision.com/tx/0xcb940adb1bd270c15dc81dc8be7205e37cf556bf9a04acadb627d2f7e8e94db2)) |
| The demo's close copied with no builder fee | pass ([copy, fee 0](https://testnet.monadvision.com/tx/0x4eaa8bcd3c0e03b66c8b04de16e11ec11e92ccff7d7a055e51969817a4cc1262)) |
| Run blocked trade: Blocked onchain, "Blocked by your max leverage rule" (limit 2x, actual 10x) | pass ([blocked](https://testnet.monadvision.com/tx/0x0ab5d940387c260c535a4d84612cc8b6c1bce0811b7bb466c85a468dbdae5227)) |
| A second new account (phone layout), then 100 test AUSD of team funds: withdrawn from Perpl account 1000 and sent to it; the ops wallet's 2,500 test AUSD tester pool unchanged | pass ([withdraw](https://testnet.monadvision.com/tx/0xa1c918282253bec7f86f36221d6547a2bc924a0c6141e10b2eae21c15d3b797c) · [transfer](https://testnet.monadvision.com/tx/0xf858e80be37f29f167766506a718e3ff48fa65eb98c672bb3b250c25f770de5a)) |
| Follow the demo leader with a permit deposit of 100 and match now; the fee line ("Mirror fee: 0.02% of opening size (builder 26) …") before the one passkey prompt | pass ([deposit](https://testnet.monadvision.com/tx/0x5ca5c2bcaf31ed22a9f7e0510e4f2376d6c22547830925f73e1ece0f88458760) · [follow](https://testnet.monadvision.com/tx/0xc0c893d2ec78bb917c78a2f41db69f9c139772102fcc02a9a83a95251b3700ac)) |
| Alerts on with a real Web Push subscription | **fail**: headless Chrome has no push service, and the step left the page before the signature (both fixed in the script; the rerun waits on test funds, see below) |
| A real copied Perpl testnet trade with builder 26's fee (166 units) | pass ([copy](https://testnet.monadvision.com/tx/0x771fc2efea2ddb1c49fa1ee5b90e6ac2513deb64f35e7d9fadce68d6148b867c)); its Web Push **not shown** (no subscription) |
| Stop following, keep my positions: set onchain by the account's contract; the profile reads "Stopped, positions kept" | pass ([detach](https://testnet.monadvision.com/tx/0xa91e5d97d8e0b7390879080ed32cdd4634ead42788736cd994804580d009a2ba)) |
| The leader exits: the demo follower's close is copied ([copy, fee 0](https://testnet.monadvision.com/tx/0x1baec9cba9a956bae58d61a9e5894d767f4a32ccaac0dd2192367af09be787a8), from the engine's feed; the run's report names an older close, `0x4eaa…`, because the check did not wait for a newer one, fixed since), the detached web account keeps its position (1 lot) | pass |
| Close all: flat onchain | pass ([close all](https://testnet.monadvision.com/tx/0xe3c4ed69573ad4f90b4b05d24b90d50baf9b3fba4d26e18a1eba2988e14ceb42)) |
| Withdraw | **fail**: the script tapped Max before the withdrawable amount had loaded (Max filled in 0; the screen showed "Withdrawable 100.00 AUSD"). Fixed in the script. |
| Send the test AUSD back to the ops wallet | not run (needs the withdraw) |
| The demo leader opens at 10x: the demo follower's 2x rule blocks the copy, shown on the Demo screen | pass ([blocked](https://testnet.monadvision.com/tx/0x361774085f4ee2923529eee22aa1dced73c90b9d4fe5c659aaf0c9378c373f84)) |

11 of 15 checks passed. The run's 100 test AUSD stayed in the web account's follow account `0x7289…32CD`: the test passkey existed only in that browser session, so it cannot be withdrawn (recorded in the funding ledger). The demo leader's Perpl account now holds less than Perpl's 100 minimum for a new account, so the funded web rerun (Web Push, withdraw, send back) waits on 100 test AUSD from somewhere other than the tester pool (resume brief, "Waiting on Jagadeesh").

## Not shown yet

- **Web Push delivered in the web app**, and the web app's withdraw and send-back: the first web run could not show them (no push service in headless Chrome; the withdraw step tapped Max too early), and the rerun with the fixed script needs 100 test AUSD that is not in the tester pool (resume brief, item 1). Android's Firebase alert and Android's withdraw passed above.
- **Outside users**: none yet. The tester round (25 testers at 100 test AUSD) has not started.

## Fixes made because of these runs

- **Engine: no account stop on an empty account** (step 11, first try). An account emptied after a loss keeps a high-water mark above zero, so its drawdown stop reads as hit until the next deposit; the keeper used to pause it then, so a returning user's deposit landed in a paused account. Copies stay blocked onchain while the stop holds; funded accounts latch as before. Redeployed on Railway on 9 Oct (`engine/src/services/stops.ts`, tests in `engine/test/stops.test.ts`).
- **Engine: the team's test accounts out of the public numbers.** `/v1/stats` had started counting the test accounts from these runs as users. `TEAM_TEST_ADDRESSES` leaves them out (listed under `teamTest`) while they are alerted like any user, unlike team-run accounts, which never alert.
- **App: Max fills in the exact amount** (Send, Follow, Funds' cap room). Send's Max rounded the wallet to two decimals, so a balance like 99.996 became 100.00 and Send stayed disabled (`app/src/lib/format.ts` `ausdExact`). In APK 1.0.2.
- **Site: the home page's beam animation** wrote `offset="undefined"` before its first keyframe (a console error the post-deploy check caught).
- **Test drivers**: Web Push needs Chrome's real push service, so the web run uses headed Chrome with background networking on, waits for the owner's signature before leaving the alerts card, and records the service worker's push pings; Max is tapped only once balances have loaded; a recovery pass returns team funds if withdraw or send fails; `wait-copy` only accepts a copy mined after the leader's trade, and the demo follower's close is matched from a block mark (both had matched older transactions); the Android flows tap Android's notification permission dialog before the passkey prompt, clear the app before a fresh account, and part flows restore accounts after the runner's reinstall.
