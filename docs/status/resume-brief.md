# Resume brief (Stage B, hosted bring-up block)

Kept current while Stage B runs. Last updated: 2026-10-09 15:35 IST.

## Waiting on Jagadeesh

| # | Action (exact) | Unblocks |
|---|---|---|
| 1 | Decide where 100 test AUSD for one more funded web run comes from: take it from the tester pool (2,500 → 2,400, enough for 24 testers at 100), or ask Perpl for 100 or more test AUSD to the ops wallet `0x299E…e82C`. The demo leader's Perpl account holds 99.74, below Perpl's 100 minimum for a new account, and the first web run's 100 cannot be recovered (`docs/funding-ledger.md`, 9 Oct 09:35). Once decided, the run is `ENGINE_URL=https://engine-production-0fd2.up.railway.app node localnet/e2e-live-web.mjs --parts phone` (it opens a Chrome window: Web Push needs Chrome's real push service). | A real Web Push delivered in the web app; Send's Max fix checked live; the web funded flow through withdraw and send-back |
| 2 | Tester addresses, and the go for the tester round | Sending the invites and the test AUSD (nothing is sent before that) |
| 3 | Optional: leave the Mac unlocked while a deploy runs | The local Safari half of the post-deploy check: safaridriver cannot open Safari while the screen is locked (9 Oct). The GitHub macOS runner checks Safari meanwhile. |
| 4 | Optional: more testnet MON | Ops wallet holds 62.0 MON: the 25-tester round needs about 22, demos at most about 8 a day |

## Later tasks

- When the mainnet indexer reports `isReady: true` (https://hasura-mainnet-production.up.railway.app/v1/graphql, `_meta`; about 7 hours after 9 Oct 09:00 UTC at the free token's pace), set `NEXT_PUBLIC_INDEXER_URL` to that URL on Vercel and redeploy, so /perpl's indexer panels use it. Until then /perpl reads Perpl from the RPC (current, not partial).
- Railway config-as-code (`railway.json` at the repo root) is deprecated and keeps working until 2026-12-01. Migrate to Railway's infrastructure-as-code (`railway config migrate`, `.railway/railway.ts`) before then; not now (owner's call, 9 Oct).

## Decisions taken without review

- Docker dry-run containers `mirror-dry-*` and `mirror-dry2-*` (7, stopped) were left in place rather than removed, under the no-deletion rule; `docker rm` them when convenient.
- Engine reads go through Multicall3 on Monad mainnet and testnet (off on a fresh localnet).

- `web/AGENTS.md` (the untracked file seen since Stage A) is written by `next dev` itself (Next 16 agent rules); it is now gitignored, not committed.
- APK republished as 1.0.1 (versionCode 101) the same day: 1.0.0's Demo screen showed an error instead of reading from Monad while the service is down.

- Public-testnet end-to-end runs against the same engine code on this machine, since the hosted engine needs item 2. Everything else in it is live testnet (contracts, Perpl, demo leader 1000, the passkey accounts).
- Engine change found that way: it now listens before its first sync (Railway's health check would otherwise fail every hosted start).

- Every node_modules in the repo, web/.next and part of the Playwright browser cache were deleted around 18:53 local time on 8 Oct by something outside this session (a large external rm while disk was full; disk went from 0.1 to 69 GB free). I reinstalled from the lockfiles and rebuilt; nothing in git was affected.

- The post-deploy check takes `--down <origin>` (deploy.sh: `ENGINE_DOWN=1`) while the hosted engine is not deployed: errors naming the engine's origin are listed as expected, every other error still fails the check.
- Judges who ask (GitHub issue "test AUSD") get 100 test AUSD from the tester pool; each counts toward the 25.
- Minimum Android stated as 14 everywhere (passkey PRF in Google Password Manager); testing was on Android 15 emulators.
- Board posts run 11-14 Oct (four milestones that are true: onchain detach, builder fee, encrypted alerts, testnet deploy).

- Detach is per leader and onchain; `setPolicy` keeps it, `follow()` and removing the leader clear it (approved in principle; the clearing rules are mine).
- Main's unpushed history was rewritten (filter-branch, unpushed range only) to drop the workflow file before pushing; the original commits are on the local branch `postdeploy-workflow`.
- One Railway project `mirror-testnet` hosts the testnet engine plus a testnet indexer (Mirror data) and a mainnet indexer (/perpl analytics, 30 days back), sharing one HyperSync proxy so the single free token stays under 15 req/min.

## State

- **Public-testnet end-to-end on Android emulators: all 11 steps pass** (devices/evidence/stage-b/README.md, with every transaction). **First builder-26 fee charged onchain:** 166 units = 0.000166 test AUSD on the demo follower's copied open, testnet, tx 0xc14cd15a3d3243263fc3b43cd2b7d1ae349c407622bf7479dc788ef7c873aa9b. Test funds: not revenue. Mainnet: none.

- **Contracts (Monad testnet, verified on Sourcify):** KeeperRegistry `0x394B12D4355bE5B54DBCaa989cf44F8966195E41`, MirrorAccountFactory `0xaD81567BF5ee4206Ef349E9CCe6719210f16bD39`, implementation `0x648e35cdfD4Aca744Ed33c69A0089A5621A76316`, block 69,083,005. Deployed as the ops wallet's first testnet transactions. Verified on sourcify.dev and on MonadVision's Sourcify (status "match"). Demo leader: Perpl testnet account 1000 (ops wallet, 200 test AUSD). Mainnet: nothing deployed; plan, scripts and fork rehearsal ready in docs/runbook-mainnet.md (needs the go; ops nonce must still be 4).
- **Stage A (final contracts):** Android emulators 34/34, API 29/29, web 64/64.
- **Railway project `mirror-testnet`:** services created with every non-secret variable set; nothing deployed yet (needs item 2). Engine domain `https://engine-production-0fd2.up.railway.app`. `scripts/railway-up.sh --check` lists exactly what is missing.
- **APK:** 1.0.1 (versionCode 101), testnet beta, GitHub Release `v1.0.1-testnet`, 43,845,077 bytes, SHA-256 `2cee6e97e170a0d033e3d17cec712c38e5caa8dac0b6673219ca9e44a51a7728`, release-signed (certificate matches assetlinks.json). 1.0.0 (`v1.0.0-testnet`) is superseded: the Demo screen now reads from Monad when the service is down, and refreshes wait longer.
- **Public-testnet end-to-end:** the engine runs on this machine (`scripts/engine-testnet-local.sh`, port 8838, keys from .env, never printed) until the hosted one is up; Android flow `devices/run-stage-b-android.sh`.
- **Site:** live at mirror.0xo.in with the web app at /app (testnet build; engine down, so watch mode and Demo read the demo account from Monad), share cards, the suggestion page, /perpl, and the download page for APK 1.0.1. Final deploy 16:2x UTC 8 Oct; post-deploy check against the public URL 36/36 (Chrome 18/18 in the deploy run, Safari 18/18 rerun after its automation recovered), evidence devices/evidence/stage-b/.
- **Test funds:** ops wallet 2,500 test AUSD (the tester pool = 25 testers at 100; untouched), 63.86 test MON. Demo leader Perpl account 1000 holds 200.

## Work queue (in order)

Done: 3 (first-run fixes and engine-down states), 5 (mainnet prep), 6 (submission), 7 (board clips/snippets for 11-14 Oct in marketing/board/), 8 (storyboards), 9 (tester kit, judges guide, README, adversarial walk-through), hosted bring-up script (4, minus the image dry-run, which waits on disk space).

1. Site + web app deploy, working without the hosted engine; post-deploy check.
2. Testnet APK, release notes, download page.
3. Remaining Group 2 items and first-run fixes.
4. Hosted deployment ready except secrets; one-command bring-up.
5. Mainnet prep (plan, verification, demo follower, smoke run, funds-return script tested on a fork).
6. docs/submission up to date.
7. Board clips and snippets (marketing/board/).
8. Storyboards final.
9. Tester kit, judges guide, README, adversarial walk-through.
10. Full Stage A rerun.
