# Resume brief (Stage B)

Kept current while Stage B runs. Last updated: 2026-10-08 19:00 IST (18:55 local machine time).

## Waiting on Jagadeesh

| # | Action (exact) | Unblocks |
|---|---|---|
| 1 | `gh auth refresh -h github.com -s workflow --user Jagadeeshftw` | Pushing the post-deploy check workflow `.github/workflows/postdeploy.yml` (kept locally, excluded from main, and on the local branch `postdeploy-workflow`). After the refresh it is one commit: `git add -f .github/workflows/postdeploy.yml`, commit, push. |
| 2 | `cd ~/personal/projects/grants/monad/mirror && bash scripts/railway-secrets.sh` | Hosted engine, both indexers, HyperSync proxy, Hasura secrets. After it: `bash scripts/railway-up.sh` brings everything up. |
| 3 | More testnet MON for the ops wallet `0x299E77E58DD37607e4890C761924D829F8ACe82C` (faucet) | A full 25-tester round: Mirror's relayer and keeper pay all tester gas. 58.90 MON left after the deploy. |
| 4 | Free disk space: at least 15 GB on the Data volume (was 119 MB free at 18:20 on 8 Oct; 3.4 GB after I removed Mirror's own build outputs). The large items are not Mirror's to delete: `~/Library/Caches` 23 GB, Colima's VM `~/.colima` 44 GB (images shared with other projects), `~/.gradle` 13 GB, AVD `mirror-dev` 3 GB (not mine; mine are mirror-a/b) | The release APK build, the Docker dry-run of the hosted images, and emulator runs (each needs several GB) |

## Decisions taken without review

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

- **Contracts (Monad testnet, verified on Sourcify):** KeeperRegistry `0x394B12D4355bE5B54DBCaa989cf44F8966195E41`, MirrorAccountFactory `0xaD81567BF5ee4206Ef349E9CCe6719210f16bD39`, implementation `0x648e35cdfD4Aca744Ed33c69A0089A5621A76316`, block 69,083,005. Deployed as the ops wallet's first testnet transactions. Verified on sourcify.dev and on MonadVision's Sourcify (status "match"). Demo leader: Perpl testnet account 1000 (ops wallet, 200 test AUSD). Mainnet: nothing deployed; plan, scripts and fork rehearsal ready in docs/runbook-mainnet.md (needs the go; ops nonce must still be 4).
- **Stage A (final contracts):** Android emulators 34/34, API 29/29, web 64/64.
- **Railway project `mirror-testnet`:** services created with every non-secret variable set; nothing deployed yet (needs item 2). Engine domain `https://engine-production-0fd2.up.railway.app`. `scripts/railway-up.sh --check` lists exactly what is missing.
- **APK:** 1.0.0 (versionCode 100), testnet beta, GitHub Release `v1.0.0-testnet`, 43,844,777 bytes, SHA-256 `655da916eb700e0fdd86002597b30429d1e18a48f2dd606bd93abbcc5a5a642c`, release-signed (certificate matches assetlinks.json). Download page live.
- **Public-testnet end-to-end:** the engine runs on this machine (`scripts/engine-testnet-local.sh`, port 8838, keys from .env, never printed) until the hosted one is up; Android flow `devices/run-stage-b-android.sh`.
- **Site:** deployed 8 Oct 13:48 UTC with the web app at /app (testnet build, engine down: watch mode read from Monad), share cards, the suggestion page and /perpl. Post-deploy check against the public URL: 36/36 (9 pages × desktop Chrome, Chrome phone, desktop Safari, Safari phone), evidence devices/evidence/stage-b/postdeploy-20261008T140454Z. Fonts served from /app/assets/assets/fonts (no node_modules paths).
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
