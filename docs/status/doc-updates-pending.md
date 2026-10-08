# Doc lines waiting on the deploys

Every line that changes once the site/web app, the APK or the hosted engine and indexer go live. Line numbers as of 8 Oct 2026 (after the docs refresh); re-grep for the quoted text if they have moved. After editing any `docs/submission/fields/*` file, run `python3 docs/submission/build.py`.

Live state checked on 8 Oct 2026 with curl: `https://mirror.0xo.in` and `/docs/*` answer 200 but serve the pre-Stage-B deploy (Vercel cache age about 27 h); `/app` says "Not published yet"; `/download` says "APK not yet published"; `/perpl` and `/c/...` are 404 (not in that deploy); `/stats` answers 200 without hosted data.

Legend: **W** = web app at `/app` (and the new site deploy), **A** = APK on `/download`, **H** = hosted engine, relayer and indexer, **D** = team-run demo leader and demo follower created on testnet, **V** = video recorded.

## Submission fields (`docs/submission/fields/`)

| File:line | Depends on | Fill in |
|---|---|---|
| `07-live-product.txt:1` | W | Now `https://mirror.0xo.in` (live). Decide whether to switch to `https://mirror.0xo.in/app` once the web app works end to end with H. |
| `08-demo-video.txt:1-7` | V | Replace the whole field with the video URL. |
| `09-pitch-video.txt:1` | V | Replace with the video URL. |
| `12-product-ad.txt:1` | V | URL of the 30-second clip, or leave it out. |
| `04-description.txt:39` | W, A, H | "Hosted engine and indexer: prepared, not live yet. Testnet APK and web app: being published." → what is live, with dates. |
| `05-go-to-market.txt:16` | W, A, H | "Outreach starts with the testnet tester round…" → the date outreach started, once it has. |
| `05-go-to-market.txt:29` | H | "the tester round has not started" → counts of accounts, funded accounts, copies, blocks from the stats page. |
| `05-go-to-market.txt:33` | H | "once the hosted indexer is live" → drop the condition and quote the stats page. |
| `05-go-to-market.txt:44-47` | W, A, H, D | Targets before judging: mark each as met, with numbers. |
| `10-judge-access.txt:7` | H | "Hosted copy engine and indexer: prepared, not live yet." → engine URL (`https://engine-production-0fd2.up.railway.app` was the planned domain) and that it is live. |
| `10-judge-access.txt:8` | W, A | "are being published; until then those pages say so" → live, with the APK version and SHA-256. |
| `10-judge-access.txt:23` | W, A, H, D | Remove "(PENDING: …)" from the TESTNET PATH heading once a full walk-through works. |
| `10-judge-access.txt` (TESTNET PATH step 3) | D | Add the testnet demo leader's Perpl account id and the demo follower's tx links once created. |
| `11-bounties.md:23` | W, A, H | Agora Q1 status line. |
| `11-bounties.md:30-33` | V | Agora Q2: the video URL (required field). |
| `11-bounties.md:40-45` | V, H | Perpl Q1: the video URL (required field). |
| `11-bounties.md:49-51` | H | Perpl Q2: the stats page URL (`https://mirror.0xo.in/stats`) or the keeper's MonadVision page, once real copies exist (required field). |
| `11-bounties.md:71` | H | Mera UX: "Not yet: the same flows against the hosted testnet service (pending)." |
| `11-bounties.md:76` | V | Mera UX Q2: video URL (optional). |
| `11-bounties.md:92` | V | Many Keys Q2: video URL (optional). |
| `11-bounties.md:113` | H | Envio Q1: "Built, not hosted yet." → hosted, with the GraphQL endpoint if public. |
| `11-bounties.md:123` | V | Envio Q2: video URL (optional). |

## Site docs (`web/content/docs/`)

| File:line | Depends on | Fill in |
|---|---|---|
| `judges-guide.md:12` | H | Hosted service status. |
| `judges-guide.md:13` | W, A | Web app and APK status; APK version and SHA-256. |
| `judges-guide.md:15` | H | Users and the tester round: counts once it starts. |
| `judges-guide.md:68` (heading "The app on testnet (pending)") and the paragraph under it | W, A, H, D | Drop "(pending)" and the "this section is a description" sentence once the path works. |
| `judges-guide.md:83` | H | "will be on the public stats page once the hosted indexer is live" → drop the condition. |
| `team-run-accounts.md:12` | D | Demo leader: testnet Perpl account id. |
| `team-run-accounts.md:13` | D | Demo follower: testnet address is predicted; say "created" with the creation tx. |
| `team-run-accounts.md:15` | D | "its testnet account is opened … when the hosted service goes live" → the account id. |

## README.md

| Line | Depends on | Fill in |
|---|---|---|
| 6 | W, A | "(both being published; until then the pages say so)" → remove once live. |
| 33 | H | Engine: "Hosting prepared on Railway … not live yet". |
| 34 | H | Indexer: "Hosting prepared, not live yet". |
| 35 | W, A | App: "Testnet APK and web app being published." |
| 37 | D | Team-run demo leader: "Testnet: not opened yet." |
| 38 | H | Users: counts once the tester round starts. |

## Tester kit (`docs/tester-kit.md`)

| Line | Depends on | Fill in |
|---|---|---|
| 10 | A | `{apk_url}`: the direct APK link from `/download`; `{apk_sha256}`: its SHA-256 as published there. |
| 12 | W | `{tester_kit_url}`: where the steps are published for testers (a public page or a pinned post). |
| 70-74 | W, A, H, D | Tick the checklist boxes as each is done. |

## Other docs

| File:line | Depends on | Fill in |
|---|---|---|
| `docs/storyboards.md:21-24` | H, D, W, A | "Before recording" status column. |
| `docs/traction-plan.md:18-21` | outreach | Channel statuses once posts go out. |
| `docs/traction-plan.md:40-46` | H | "Value now" column from the stats page. |
| `docs/traction-plan.md:48` | H | "its numbers need the hosted indexer, which is not live yet". |
| `docs/traction-plan.md:55-61` | W, A, H, D | Milestone statuses. |
| `docs/bounties/agora-mobile-trading.md:12, 15, 16` | A, H, V | Public APK; testnet trade tx hashes; video timestamp. |
| `docs/bounties/perpl-api.md:9, 11, 12, 13` | H | Hosted engine; testnet tx hashes; stats page link. |
| `docs/bounties/envio.md:10, 12` | H | Hosted indexer. |
| `docs/bounties/perpl-analytics.md:9, 19` | W, H | `/perpl` live (404 on 8 Oct) and the public indexer URL. |
| `docs/releases/1.0.0-testnet.md:26` | H | "Mirror's hosted testnet service … is not live yet." |
