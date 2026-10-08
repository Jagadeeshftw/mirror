# Stage B evidence (Monad testnet, 8 Oct 2026)

Everything here ran against **public Monad testnet** (chain 10143): Mirror's deployed testnet contracts, Perpl's testnet exchange, the team-run demo leader (Perpl account 1000) and real passkey accounts. The one difference from the hosted setup: Mirror's engine ran on this machine (`scripts/engine-testnet-local.sh`), because the hosted engine waits on its secrets. Android runs are on **emulators** (mirror-a, mirror-b); no physical phone has been tested.

## Android emulators, public testnet

Flows: `devices/e2e/flows/stage-b.flow`, `stage-b-part2.flow`, `stage-b-part3.flow` (runner `devices/run-stage-b-android.sh`). The onchain state carries over between runs, so each part starts where the previous one stopped; failures in between were fixed before the next run.

| Step | What | Run (devices/evidence/…) | Result |
|---|---|---|---|
| 01 | mirror-a restores the demo follower's owner `0x3aBF…6C78` from its passkey (full passkey list opened) | stage-b-android-20261008-201427, -202501 | pass |
| 02-03 | Follow demo leader 1000: account `0x634B…4896` created, 150 test AUSD deposited by permit, policy set; one passkey prompt | -201427 | pass ([create](https://testnet.monadvision.com/tx/0x64cb1e2e64a0f36f5876b1c8b66851dd7ea0349299ece130a7c5efbc77930d59) · [deposit](https://testnet.monadvision.com/tx/0xd4afdf05e36ed5d9f3a5fc86dda98bd25f20134164a801bf82c4f3447dc27833) · [follow](https://testnet.monadvision.com/tx/0xe172e09112d5f3074d23b4b6233e10863d05e0b4ec001adb4f8a282106ea3987)) |
| 04 | Demo leader opens 50 lots BTC on Perpl testnet; the copy lands with builder 26 charged 166 units (0.000166 test AUSD) onchain; copy detail shows fills, deviation, both txs, fee | -202501 | pass ([leader](https://testnet.monadvision.com/tx/0x7f88b2b629e6fbe51487352c98c0c83b594943a11227b1886589c92169f06b1b) · [copy](https://testnet.monadvision.com/tx/0xc14cd15a3d3243263fc3b43cd2b7d1ae349c407622bf7479dc788ef7c873aa9b)) |
| 05-06 | mirror-b restores the test user `0x1bbD…040D`; follows leader 1000 with 100 test AUSD and match now (matched in the policy tx) | -202501 | pass ([deposit](https://testnet.monadvision.com/tx/0x8ad1f3ddddd07cb1621fff9fbe8da95c30229415765049bb4e9df99fd6a478be) · [follow + match](https://testnet.monadvision.com/tx/0x5a4e3210c01f5d5c3fa495b442cf742de147e477e3f3b5576f711d2963ee9061)) |
| 07 | Stop following, keep my positions: `leaderDetached(1000)` set onchain by the test user's contract | -202501 (tx) / -203746 (screen) | pass ([detach](https://testnet.monadvision.com/tx/0x741241722325f5536d633d084b824734ed2539c5d14aa7a2677d6f6f2b89537a)); the first run's profile showed a stale "Following" (app refresh timeout, fixed) |
| 08 | Leader closes: the demo follower's close is copied with no builder fee; the detached test user keeps its position | -203746 | pass ([leader](https://testnet.monadvision.com/tx/0x536a4772d808adb570d16a054591557c0c34bc569513d08717258708d57b124e) · [copy, fee 0](https://testnet.monadvision.com/tx/0x83922244bd82b863b07e8e7c771d39757d631d61327459afb89054ee04bfe373)) |
| 09 | Test user closes the kept position (Close all) | -204211 | pass ([close all](https://testnet.monadvision.com/tx/0x80380b957f82139fdd0adff853114bd8f5f8e451fba7eae30cbaefc7cb2e6890)) |
| 10 | Test user withdraws to the wallet: 149.733416 test AUSD back | -204211 | pass ([withdraw](https://testnet.monadvision.com/tx/0x3e03ec1a33e30ddd5770c6b7a84b3c6a79ab8eee90764be57510b405abf716c5)) |
| 11 | Leader opens at 10x: the demo follower's 2x rule blocks the copy onchain (Blocked, LeverageTooHigh) | -204211 | pass ([leader](https://testnet.monadvision.com/tx/0x0fb85e1eb4d23263d942d1ee0a3a6a8b52e76d0f689c0214f1d2b93a2368e85d) · [blocked](https://testnet.monadvision.com/tx/0xcfeeda062c5a5590e051c892d7c379c0019d93548f5f66f13043718f7a6d80aa)) |

Fixes made because of these runs: the engine's RPC budget (public testnet RPC: 15 req/s), the engine listening before its first sync, the app's refresh timeout, the passkey helper opening the full passkey list.

## Live web app and site (mirror.0xo.in)

- Post-deploy check against the public URL, 9 pages × desktop Chrome, Chrome at phone width, desktop Safari, Safari at phone width, clean uncached profiles: **36/36** on the 13:48 and 14:16 UTC deploys (`postdeploy-20261008T140454Z`, `postdeploy-20261008T141650Z`). The 15:20 UTC deploy (demo screen fix) passed 18/18 in Chrome; Safari automation could not start a Safari window at that time (see the resume brief).
- The hosted engine is not deployed yet, so its requests are listed as expected-while-down; every other error fails the check.
