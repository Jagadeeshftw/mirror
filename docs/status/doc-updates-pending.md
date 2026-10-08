# Doc lines waiting on the deploys

Every line that still changes once the hosted engine, relayer and indexer go live, or once the videos are recorded. Line numbers as of 8 Oct 2026 (after the W/A/D fill-in); re-grep for the quoted text if they have moved. After editing any `docs/submission/fields/*` file, run `python3 docs/submission/build.py`.

Live state checked on 8 Oct 2026 at about 16:00 UTC with curl: `https://mirror.0xo.in`, `/app`, `/download`, `/perpl`, `/stats`, `/docs/judges-guide`, `/c/leader/1000` and `/p/...` answer 200 (latest deploy 15:20 UTC). The GitHub Release asset `v1.0.1-testnet/mirror-1.0.1-testnet.apk` answers 200 with 43,845,077 bytes. **Not yet in sync:** the live `/download` page and `/release.json` still show APK 1.0.0 (build 100, 43,844,777 bytes, SHA-256 `655da916…642c`, `v1.0.0-testnet`); the repo's `web/public/release.json` already has 1.0.1. The docs below now say 1.0.1 is on `/download`, so redeploy `web` and re-check `/download` before the submission is saved. The hosted engine (`engine-production-0fd2.up.railway.app`) is not deployed.

Legend: **H** = hosted engine, relayer and indexer, **V** = video recorded.

## Done on 8 Oct 2026 (W = web app and site deploy, A = APK, D = team-run demo accounts)

Filled with the Stage B facts (`devices/evidence/stage-b/README.md`): `04-description.txt` status lines and fee sentence; `05-go-to-market.txt` outreach condition, targets and fee sentence; `10-judge-access.txt` web app and APK lines, team-run testnet accounts, a new "Real copies on public Monad testnet" item, TESTNET PATH step 3; `11-bounties.md` Agora Q1 status, tested line and fee sentence, Perpl Q1/Q2 testnet copies, Mera UX testnet flows; `judges-guide.md` web app and APK status, public-testnet line, fee line, "app on testnet" paragraph; `team-run-accounts.md` lines 12, 13, 15; `index.md` status table; `fees.md` fee sentence; README lines 6, 23, 33, 35, 37; tester kit `{apk_url}`, `{apk_sha256}` and two checklist boxes; storyboards status rows; traction-plan channel row, outside-users note, two milestones and fee sentence; `agora-mobile-trading.md` rows 1 and 4; `perpl-api.md` rows 4 and builder code; `perpl-analytics.md` line 9 and row 6 (page part). `07-live-product.txt` keeps `https://mirror.0xo.in`.

"No fee has accrued" was replaced everywhere it appeared: builder 26 has been charged onchain on testnet in test AUSD (166 units on a copied open). That is test funds, never revenue.

## Submission fields (`docs/submission/fields/`)

| File:line | Depends on | Fill in |
|---|---|---|
| `07-live-product.txt:1` | H | Decide whether to switch to `https://mirror.0xo.in/app` once the web app works end to end with the hosted engine. |
| `08-demo-video.txt:1-7` | V | Replace the whole field with the video URL. |
| `09-pitch-video.txt:1` | V | Replace with the video URL. |
| `12-product-ad.txt:1` | V | URL of the 30-second clip, or leave it out. |
| `04-description.txt:42` | H | "Hosted engine and indexer: prepared, not live yet." → live, with the date. |
| `05-go-to-market.txt:16` | H | "Outreach starts with the testnet tester round below, once the hosted engine is live" → the date outreach started, once it has. |
| `05-go-to-market.txt:29` | H | "the tester round has not started" → counts of accounts, funded accounts, copies, blocks from the stats page. |
| `05-go-to-market.txt:33` | H | "once the hosted indexer is live" → drop the condition and quote the stats page. |
| `05-go-to-market.txt:46-47` | H | Targets: the 25 outside testers (not started); the demo copies from the hosted engine (done so far from the developer's machine only). |
| `10-judge-access.txt:7` | H | "Hosted copy engine and indexer: prepared, not live yet." → engine URL (`https://engine-production-0fd2.up.railway.app` was the planned domain) and that it is live. |
| `10-judge-access.txt:10` | H | "Until the hosted engine is live, the web app and the APK show …" → remove once live. |
| `10-judge-access.txt:32` | H | Remove "(PENDING: …)" from the TESTNET PATH heading once a full walk-through works against the hosted engine. |
| `11-bounties.md:23` | H | Agora Q1 status: "hosted engine not live yet". |
| `11-bounties.md:30-33` | V | Agora Q2: the video URL (required field). |
| `11-bounties.md:40-45` | V, H | Perpl Q1: the video URL (required field). |
| `11-bounties.md:49` | H | Perpl Q2: the stats page URL (`https://mirror.0xo.in/stats`) once the hosted indexer lists the copies (required field). Testnet copy tx links from the developer's machine are already in the answer. |
| `11-bounties.md:76` | H | Mera UX: "Not yet: the same flows against the hosted testnet service (pending)." |
| `11-bounties.md:81` | V | Mera UX Q2: video URL (optional). |
| `11-bounties.md:97` | V | Many Keys Q2: video URL (optional). |
| `11-bounties.md:118` | H | Envio Q1: "Built, not hosted yet." → hosted, with the GraphQL endpoint if public. |
| `11-bounties.md:128` | V | Envio Q2: video URL (optional). |

## Site docs (`web/content/docs/`)

| File:line | Depends on | Fill in |
|---|---|---|
| `judges-guide.md:12` | H | Hosted service status. |
| `judges-guide.md:13` | H | "Until the hosted service is live, both show …" → remove once live. |
| `judges-guide.md:16` | H | Users and the tester round: counts once it starts. |
| `judges-guide.md:69` (heading "The app on testnet (pending)") and the paragraph under it | H | Drop "(pending)" and the "rest of this section is a description" sentence once the path works against the hosted service. |
| `judges-guide.md:84` | H | "will be on the public stats page once the hosted indexer is live" → drop the condition. |
| `index.md:37-38` | H | Engine and indexer rows: "not hosted yet". |

## README.md

| Line | Depends on | Fill in |
|---|---|---|
| 6 | H | "until the hosted engine is live they show …" → remove once live. |
| 33 | H | Engine: "Hosting prepared on Railway … not live yet". |
| 34 | H | Indexer: "Hosting prepared, not live yet". |
| 38 | H | Users: counts once the tester round starts. |

## Tester kit (`docs/tester-kit.md`)

| Line | Depends on | Fill in |
|---|---|---|
| 12 | done | `{tester_kit_url}` filled with https://mirror.0xo.in/docs/testers (page added 9 Oct; live with the next site deploy). |
| 71, 73 | H | Tick the hosted-engine and Run demo trade boxes. |
| 75 | ops | Tick once the ops wallet's test MON is topped up. |
| 76 | H | Walk steps 1-8 once on an Android emulator and in Chrome against the hosted service. |

## Other docs

| File:line | Depends on | Fill in |
|---|---|---|
| `docs/storyboards.md:21-22` | H | "Before recording" status of the hosted engine and indexer. |
| `docs/traction-plan.md:18-21` | outreach | Channel statuses once posts go out. |
| `docs/traction-plan.md:40-46` | H | "Value now" column from the stats page. |
| `docs/traction-plan.md:50` | H | "its numbers need the hosted indexer, which is not live yet". |
| `docs/traction-plan.md:57-58, 60, 62-63` | H | Hosted engine, tester round, demo copies from the hosted engine, external followers. |
| `docs/bounties/agora-mobile-trading.md:15, 16` | H, V | Trades from the hosted engine; video timestamp. |
| `docs/bounties/perpl-api.md:9, 11, 12, 13` | H | Hosted engine; copies from the hosted engine; stats page link. |
| `docs/bounties/envio.md:10, 12` | H | Hosted indexer. |
| `docs/bounties/perpl-analytics.md:19` | H | The public indexer URL for `/perpl`'s indexer panels. |
| `docs/releases/1.0.1-testnet.md:31` | H | "Mirror's hosted testnet service … is not live yet." (The 1.0.0 notes file was renamed to this one.) |
