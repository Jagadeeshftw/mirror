# Resume brief (Stage B)

Kept current while Stage B runs. Last updated: 2026-10-08 03:50 IST.

## Waiting on Jagadeesh

| # | Action (exact) | Unblocks |
|---|---|---|
| 1 | `gh auth refresh -h github.com -s workflow --user Jagadeeshftw` | Pushing the post-deploy check workflow `.github/workflows/postdeploy.yml` (kept locally, excluded from main, and on the local branch `postdeploy-workflow`). After the refresh it is one commit: `git add -f .github/workflows/postdeploy.yml`, commit, push. |
| 2 | `cd ~/personal/projects/grants/monad/mirror && bash scripts/railway-secrets.sh` | Hosted engine, both indexers, HyperSync proxy, Hasura secrets. After it: `bash scripts/railway-up.sh` brings everything up. |
| 3 | More testnet MON for the ops wallet `0x299E77E58DD37607e4890C761924D829F8ACe82C` (faucet) | A full 25-tester round: Mirror's relayer and keeper pay all tester gas. 58.90 MON left after the deploy. |

## Decisions taken without review

- Detach is per leader and onchain; `setPolicy` keeps it, `follow()` and removing the leader clear it (approved in principle; the clearing rules are mine).
- Main's unpushed history was rewritten (filter-branch, unpushed range only) to drop the workflow file before pushing; the original commits are on the local branch `postdeploy-workflow`.
- One Railway project `mirror-testnet` hosts the testnet engine plus a testnet indexer (Mirror data) and a mainnet indexer (/perpl analytics, 30 days back), sharing one HyperSync proxy so the single free token stays under 15 req/min.

## State

- **Contracts (Monad testnet, verified on Sourcify):** KeeperRegistry `0x394B12D4355bE5B54DBCaa989cf44F8966195E41`, MirrorAccountFactory `0xaD81567BF5ee4206Ef349E9CCe6719210f16bD39`, implementation `0x648e35cdfD4Aca744Ed33c69A0089A5621A76316`, block 69,083,005. Deployed as the ops wallet's first testnet transactions. Mainnet: nothing deployed.
- **Stage A (final contracts):** Android emulators 34/34, API 29/29, web 64/64.
- **Railway project `mirror-testnet`:** services created with every non-secret variable set; nothing deployed yet (needs item 2). Engine domain `https://engine-production-0fd2.up.railway.app`.
- **Site:** mirror.0xo.in still serves the pre-Stage-B deploy.
- **Test funds:** ops wallet 2,700 test AUSD (200 demo leader + 2,500 tester pool = 25 testers at 100).

## Work queue (in order)

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
