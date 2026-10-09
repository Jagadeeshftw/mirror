# Resume brief (Stage B, hosted bring-up block)

Kept current while Stage B runs. Last updated: 2026-10-09 16:40 IST.

## Waiting on Jagadeesh

| # | Action (exact) | Unblocks |
|---|---|---|
| 1 | Decide where 100 test AUSD for one more funded web run comes from: take it from the tester pool (2,500 → 2,400, enough for 24 testers at 100), or ask Perpl for 100 or more test AUSD to the ops wallet `0x299E…e82C`. The demo leader's Perpl account holds 99.74, below Perpl's 100 minimum for a new account, and the first web run's 100 cannot be recovered (`docs/funding-ledger.md`, 9 Oct 09:35). Once decided, the run is `ENGINE_URL=https://engine-production-0fd2.up.railway.app node localnet/e2e-live-web.mjs --parts phone` (it opens a Chrome window: Web Push needs Chrome's real push service). | A real Web Push delivered in the web app; Send's Max fix checked live; the web funded flow through withdraw and send-back |
| 2 | Tester addresses, and the go for the tester round | Sending the invites and the test AUSD (nothing is sent before that) |
| 3 | Optional: leave the Mac unlocked while a deploy runs | The local Safari half of the post-deploy check: safaridriver cannot open Safari while the screen is locked (9 Oct). The GitHub macOS runner checks Safari meanwhile. |
| 4 | Optional: more testnet MON | Ops wallet holds 61.13 MON: the 25-tester round needs about 22, demos at most about 8 a day |
| 5 | Yes or no on the laptop layout proposal for the service-down state (below) | The last large empty area on /app/home at about 2000 px: with the service down, the Demo runs card has nothing to show (`app/screenshots/laptop-home/down-wide-2000-*.png`) |

## Proposal for item 5 (not built)

With Mirror's service down, a laptop Home at about 2000 x 1125 has the copies (read from Monad and the indexer) filling the right column while the left column's Demo runs card holds only "Demo runs need Mirror's service" in about 600 px. Nothing real can go there without the service, so balancing it needs a different arrangement for that state only (1440 and phones are already balanced):

```
[ Can't reach Mirror's service ........................................ Retry ]
[ Your account 0.00 ...................... ] [ Watch mode: demo follower card .. ]
[ Demo runs need Mirror's service   (Run demo trade) (Run blocked trade)  off  ]
[ Copies landing now, from Mirror's indexer and Monad                          ]
[  row  row  row ...                   |   row  row  row ...                   ]
```

That is: account and watch cards side by side, the disabled Run buttons as one strip, and the copies across the full width in two columns of rows. Only the service-down state changes; with the service up the current two columns stay.

## Later tasks

- When the mainnet indexer reports `isReady: true` (https://hasura-mainnet-production.up.railway.app/v1/graphql, `_meta`; at 10:33 UTC on 9 Oct it was at block 105,392,896 of 111,873,282, about 30k blocks a minute, so roughly 14:00-15:00 UTC), set `NEXT_PUBLIC_INDEXER_URL` to that URL on Vercel and redeploy, so /perpl's indexer panels use it. Until then /perpl reads Perpl from the RPC (current, not partial).
- Railway config-as-code (`railway.json` at the repo root) is deprecated and keeps working until 2026-12-01. Migrate to Railway's infrastructure-as-code (`railway config migrate`, `.railway/railway.ts`) before then; not now (owner's call, 9 Oct).
- Next APK build: copies read from the indexer while the service is down show their delay in blocks, not "0.00 s" (fixed in the web app on 9 Oct; APK 1.0.2 still shows "0.00 s · 2 blocks" on those rows, only during an outage).
- With the service down, the watch-mode demo card shows Balance and Open as "—" (seen in the 9 Oct layout shots): read them from Monad like the copies.
- After every web end-to-end run, add its test owners (the run prints them) to the engine's `TEAM_TEST_ADDRESSES` on Railway, so public numbers keep leaving them out.

## Decisions taken without review

- **Engine: no account stop on an account with no equity** (found by the hosted Android run, step 11). An account emptied after a loss keeps a high-water mark above zero, so its drawdown stop read as hit and the keeper paused it right after "Follow again", before the deposit landed. Copies stay blocked onchain while the stop holds; funded accounts latch as before. Deployed to Railway on 9 Oct (commit 9702a5f).
- **Engine: `TEAM_TEST_ADDRESSES`**: the team's own end-to-end test accounts are left out of `/v1/stats` and copy quality (listed under `teamTest`) but still alerted, unlike team-run accounts. Set on Railway to the test user's owner and the first web run's two owners.
- **App: Max fills in the exact amount** (Send, Follow, Funds' cap room); Send's Max rounded 99.996 up to 100.00 and disabled Send. APK 1.0.2 was rebuilt with it before publishing (the first 1.0.2 build, SHA-256 `2a63eb53…d12e`, was never published).
- **Web run team funds**: 100 test AUSD from the demo leader's Perpl account, never the tester pool. They are stuck in the web test account's follow account `0x7289…32CD` (the run's withdraw step failed and its passkey lived only in that browser), recorded in the funding ledger. The funded web rerun waits on item 1.
- **The demo leader's 50 lots left open by the failed first try of step 11** were closed by hand during step 13 (the leader's own close order, gas from Monad's estimator), so the leader exited fully and the demo follower's close was copied. Both team-run accounts are flat.
- **Local post-deploy check stopped** during its Safari half: safaridriver cannot open Safari while the screen is locked. The GitHub macOS runner passed 36 of 36 for the same deploy.
- **Mock data for the layout screenshots**: the dev mock's quiet mode keeps the runs (older), as the engine does with its latest 20 at any age, and the mock is seeded with three hours of runs and copies like the hosted engine's. The service-down screenshots are taken as a visitor arriving while the service is down (bundled testnet network, real demo account from Monad and the indexer).
- **Stopping processes**: once, to stop this session's local `next start` on port 8791, I used `pkill -f next-server`, a pattern broad enough to match other projects' Next servers. Nothing else was listening on 3000/3002 afterwards and no `next dev` parent was running, so most likely nothing else was hit, but I cannot prove it. Processes are stopped by PID only from now on.
- **The workflow file** went to main as a new commit (dee9e7b) rather than a merge of `postdeploy-workflow`, whose commits predate the history rewrite; the branch was deleted.
- `DEMO_IP_HOURLY=6` on the hosted engine (the Run buttons, per network per hour), 48 a day.

Earlier, still standing:

- Docker dry-run containers `mirror-dry-*` and `mirror-dry2-*` (7, stopped) were left in place rather than removed, under the no-deletion rule; `docker rm` them when convenient.
- Engine reads go through Multicall3 on Monad mainnet and testnet (off on a fresh localnet).
- `web/AGENTS.md` (written by `next dev` itself) is gitignored, not committed.
- Judges who ask (GitHub issue "test AUSD") get 100 test AUSD from the tester pool; each counts toward the 25.
- Minimum Android stated as 14 everywhere (passkey PRF in Google Password Manager); testing was on Android 15 emulators.
- Board posts run 11-14 Oct (four milestones that are true: onchain detach, builder fee, encrypted alerts, testnet deploy).
- Detach is per leader and onchain; `setPolicy` keeps it, `follow()` and removing the leader clear it.
- One Railway project `mirror-testnet` hosts the testnet engine plus a testnet indexer (Mirror data) and a mainnet indexer (/perpl analytics, 30 days back), sharing one HyperSync proxy so the single free token stays under 15 req/min.

## State

- **Hosted on Railway (`mirror-testnet`) since 9 Oct 2026:** engine and relayer https://engine-production-0fd2.up.railway.app (ready, chain 10143, database on a volume), Hasura testnet and mainnet (25 of 25 entities each, read-only), both indexers, the HyperSync proxy (14 requests a minute, 0 throttled). The testnet indexer caught up at about 10:50 UTC; the mainnet one is still catching up (later tasks).
- **Public testnet end to end against the hosted engine (`devices/evidence/stage-b-hosted/README.md`, every transaction linked):** Android emulators 16 of 16 steps on APK 1.0.2, including Firebase's alert delivered, the permit deposit, stop following with the position kept, close all and withdraw (step 11 passed after the engine fix above). Live web app in Chrome: 11 of 15 checks; Web Push, withdraw and send-back wait on the funded rerun (item 1).
- **Contracts (Monad testnet, verified on Sourcify):** KeeperRegistry `0x394B12D4355bE5B54DBCaa989cf44F8966195E41`, MirrorAccountFactory `0xaD81567BF5ee4206Ef349E9CCe6719210f16bD39`, implementation `0x648e35cdfD4Aca744Ed33c69A0089A5621A76316`, block 69,083,005. Mainnet: nothing deployed; plan, scripts and fork rehearsal ready in docs/runbook-mainnet.md (needs the go; ops nonce must still be 4).
- **APK:** 1.0.2 (versionCode 102), testnet beta, GitHub Release `v1.0.2-testnet`, 43,855,153 bytes, SHA-256 `713b904fe2d548ae542a40e06c83a69697a13ee9928a5f67440da33c667ea566`, release-signed (certificate matches assetlinks.json), built against the hosted engine. `web/public/release.json` points at it.
- **Site:** mirror.0xo.in with the web app at /app against the hosted engine (no service banner, Run buttons enabled). Redeployed on 9 Oct at about 10:57 UTC (beam fix, APK 1.0.2 on /download, the docs above): local post-deploy check 18 of 18 in Chrome (Safari skipped, screen locked), GitHub run 37920756482 36 of 36 (desktop Chrome, Chrome at phone width with Reduce Motion, desktop Safari, Safari at phone width). The 09:46 UTC deploy also passed 36 of 36 there.
- **Public numbers:** `/v1/stats` counts 0 outside accounts; team-run and the team's test accounts are listed separately.
- **Test funds:** ops wallet 2,500 test AUSD (the tester pool; untouched) and 61.13 test MON; demo leader Perpl account 1000 holds 99.65 test AUSD; the test user's wallet holds 149.627387 test AUSD; 100 test AUSD stuck in the first web run's account (see above).
- **Stage A (final contracts):** Android emulators 34/34, API 29/29, web 64/64.
