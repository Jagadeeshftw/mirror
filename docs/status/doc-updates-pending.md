# Doc lines waiting on the deploys

Every line that still changes once the videos are recorded or the tester round starts. The hosted-engine lines (H) were filled on 9 Oct 2026; re-grep for the quoted text if line numbers have moved. After editing any `docs/submission/fields/*` file, run `python3 docs/submission/build.py`.

Legend: **H** = hosted engine, relayer and indexer, **V** = video recorded, **T** = tester round.

## Done on 9 Oct 2026 (H)

Filled from `devices/evidence/stage-b-hosted/README.md` (public testnet against the hosted engine: Android emulators 16 of 16 steps after one engine fix; the live web app every step except withdraw and Web Push) and the APK 1.0.2 release (`v1.0.2-testnet`, SHA-256 `713b904f…a566`):

- Submission: `04-description.txt` status block (APK 1.0.2 against the hosted service, the hosted end to end, hosting live, engine test count 227); `05-go-to-market.txt` outreach status, numbers (0 outside accounts on the stats page, team accounts listed separately), stats page source, targets (tester round not started; hosted-engine demo copies with tx links); `10-judge-access.txt` hosted engine and indexer URLs, APK 1.0.2, the "until the hosted engine is live" line removed, item 6 now the hosted run with tx links, "(PENDING …)" removed from the TESTNET PATH heading; `11-bounties.md` Agora Q1 status and tested line, Perpl Q1 (no longer "not live"), Perpl Q2 (link https://mirror.0xo.in/stats with hosted-engine tx links), Mera UX (hosted flows), Envio Q1 (hosted, GraphQL URLs).
- Site docs: `judges-guide.md` status (hosted service live, APK 1.0.2, the hosted end to end, users, test counts), "The app on testnet" without "(pending)", stats page line; `index.md` engine, indexer, web app and Android rows.
- README rows: web app and APK line, engine, indexer, app (1.0.2, 252 tests, hosted end to end), demo leader balance, users.
- Tester kit: invite APK link and SHA-256 (1.0.2), hosted-engine, Run demo trade, APK and MON boxes ticked; the "walk steps 1-8" box stays open (step 6 levels and Chrome's withdraw not walked on the hosted engine).
- Other docs: storyboards status rows, traction plan (metrics as of 9 Oct, stats page line, hosted milestone, demo copies, APK), `agora-mobile-trading.md` rows 1 and 4, `perpl-api.md` rows 1, 3, 4, 5, `envio.md` rows 1 and 3, `perpl-analytics.md` row 6 (indexer URL waits on the mainnet indexer), `docs/status/try-it.md`.
- `07-live-product.txt` keeps `https://mirror.0xo.in`: the site links to both `/app` and `/download`.

The 8 Oct fill-in (web app, APK and team-run accounts) is listed in this file's git history (commit before 9 Oct).

## Submission fields (`docs/submission/fields/`)

| File | Depends on | Fill in |
|---|---|---|
| `08-demo-video.txt` | V | Replace the whole field with the video URL. |
| `09-pitch-video.txt` | V | Replace with the video URL. |
| `12-product-ad.txt` | V | URL of the 30-second clip, or leave it out. |
| `05-go-to-market.txt` ("none of these channels has been used", numbers, targets) | T | The date outreach started; counts of accounts, funded accounts, copies and blocks from the stats page; the 25 testers target. |
| `11-bounties.md` Agora Q2, Perpl Q1 | V | The video URL (required fields). |
| `11-bounties.md` Mera UX Q2, Many Keys Q2, Envio Q2 | V | Video URL (optional). |
| `11-bounties.md` Mera UX ("the live web app passed the same flows except withdraw and Web Push") | web rerun | Once `localnet/e2e-live-web.mjs --parts phone` passes (resume brief, item 1). |

## Site docs (`web/content/docs/`)

| File | Depends on | Fill in |
|---|---|---|
| `judges-guide.md` "Users: none yet" | T | Counts once the round starts. |
| `judges-guide.md` and `index.md` web app lines | web rerun | Drop "except withdraw and Web Push" once the web rerun passes. |

## README.md

| Line | Depends on | Fill in |
|---|---|---|
| Users | T | Counts once the tester round starts. |
| App row ("every step except withdraw and Web Push") | web rerun | Once the web rerun passes. |

## Tester kit (`docs/tester-kit.md`)

| Line | Depends on | Fill in |
|---|---|---|
| "Walk steps 1-8" box | levels, web rerun | Tick once step 6 (levels) and Chrome's withdraw have been walked on the hosted engine. |

## Other docs

| File | Depends on | Fill in |
|---|---|---|
| `docs/traction-plan.md` channel rows | outreach | Channel statuses once posts go out. |
| `docs/traction-plan.md` "Value now" column | T | From the stats page once outside testers start. |
| `docs/bounties/agora-mobile-trading.md` row 5 | V | Video timestamp and tx link. |
| `docs/bounties/perpl-analytics.md` row 6 | mainnet indexer | Set `NEXT_PUBLIC_INDEXER_URL` on Vercel once the mainnet indexer reports ready, redeploy, then mark done. |
