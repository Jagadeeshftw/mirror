# Web (mirror.0xo.in)

One Next.js 16 app in `web/` (Tailwind 4, Motion on the landing page only), deployed on Vercel as project
`mirror` (team jagadeesh-bs-projects). It replaces the landing proposal that lived in `web/landing/`.

## Routes

| Route | What | Motion |
|---|---|---|
| `/` | Landing (approved design + Aceternity Pro number ticker and beam path) | yes |
| `/docs`, `/docs/<slug>` | GitBook-style docs from `web/content/docs/*.md` | none |
| `/docs/search.json` | Build-time full-text index for the docs search (MiniSearch, client side) | n/a |
| `/stats` | Public stats, client-side fetch of `{API_BASE}/v1/stats`, `/v1/stats/copy-quality`, `/v1/config`, `/v1/demo` | none |
| `/stats#copy-quality` | Copy quality section: deviation distribution, median/p90 deviation and latency (ms and blocks), blocks by reason, recent copies with leader vs follower fill, team-run card | none |
| `/download` | APK page: version, size, SHA-256 from `public/release.json`; install steps, requirements | none |
| `/app`, `/app/...` | The Expo web app (static export in `public/app`, SPA fallback to `public/app/index.html`) | n/a |
| `/release.json` | APK release metadata (same file the download page is built from) | n/a |
| `/app.webmanifest` | PWA manifest for the web app (`scope` and `start_url` `/app`) | n/a |
| `/.well-known/assetlinks.json` | Static file `web/public/.well-known/assetlinks.json`, `Content-Type: application/json`, no redirect | n/a |
| `/opengraph-image`, `/icon.svg`, `/apple-icon`, `/sitemap.xml`, `/robots.txt` | SEO | n/a |

## What to update, and where

- **API base URL**: Vercel env `NEXT_PUBLIC_API_BASE` (all environments). It is currently the placeholder
  `https://api.placeholder.invalid`; any value containing `placeholder` makes `/stats` show "Not live yet".
  `NEXT_PUBLIC_*` is inlined at build time, so redeploy after changing it:
  `vercel env rm NEXT_PUBLIC_API_BASE production && vercel env add NEXT_PUBLIC_API_BASE production --value https://<api> --yes && vercel deploy --prod`.
- **Contract addresses**: `web/lib/site.ts` `CONTRACTS` (null = "pending"). The docs Contracts table is generated from it.
- **APK**: `web/public/release.json`, read at build time by `web/lib/release.ts`:
  `{"available": true, "version": "1.0.0", "channel": "beta", "versionCode": 100, "size": 61132288,
  "sha256": "<64 hex>", "url": "/downloads/mirror-1.0.0.apk", "date": "2026-10-08"}`. The download button only
  shows when `available` is true and `url`, `size` and a 64-hex `sha256` are all set; otherwise the page shows
  "APK not yet published" (the shipped placeholder). Put the file in `web/public/downloads/` or point `url` at a
  GitHub release asset, then rebuild and redeploy. `size` is bytes (`stat -f%z`), `sha256` from `shasum -a 256`.
- **assetlinks.json**: `npm run build` runs `scripts/sync-assetlinks.mjs`, which copies `devices/assetlinks.json`
  into `web/public/.well-known/` when it exists. Vercel only uploads `web/`, so build/deploy from this machine
  (or commit the copied file) after the fingerprints change.
- **Team-run addresses**: come from `/v1/config` (`teamRun.*`) and `/v1/demo`; docs page
  `content/docs/team-run-accounts.md` says "pending" until filled in by hand.
- **Measured numbers** (300 ms, 550 ms, 278k gas, 91 tests): `web/lib/site.ts` `MEASURED` and the docs.

## Web app under `/app`

The Expo app in `app/` is exported for web with base path `/app` and served by this Next app as static files:

```bash
cd web
EXPO_PUBLIC_API_BASE=https://<api> npm run build:app   # scripts/build-app.sh -> public/app
npm run build && vercel deploy --prod
```

- `scripts/build-app.sh` runs `npx expo export -p web --output-dir ../web/public/app` in `app/` with
  `EXPO_PUBLIC_API_BASE` (falls back to `NEXT_PUBLIC_API_BASE`) and `EXPO_BASE_URL=/app`. The app config must set
  `experiments.baseUrl` to `/app` (for example from `EXPO_BASE_URL`); the script fails if `index.html` does not load
  its bundles from `/app/_expo/`. It links `/app.webmanifest` into `index.html` unless the export has a manifest.
- Routing (`web/next.config.ts`): `/app` rewrites to `/app/index.html`; a `fallback` rewrite sends every path under
  `/app/` whose last segment has no file extension (deep links like `/app/leaders/4638`) to `/app/index.html`.
  Real files always win; a missing `.js`/`.png` stays a 404 instead of returning HTML. If `public/app/index.html`
  does not exist at build time, `/app` and its deep links show the "Web app: not published yet" page instead.
- Caching: `/app` and `/app/*` `max-age=0, must-revalidate` (new exports show at once);
  `/app/_expo/static/*` (content-hashed bundles) `max-age=31536000, immutable`; `/app/assets/*` one day.
- PWA: `public/app.webmanifest` (`id`, `start_url` and `scope` `/app`). The site's own `/manifest.webmanifest`
  keeps `start_url` `/`.
- `/.well-known/assetlinks.json` is unaffected (not under `/app`), and `/.well-known/apple-app-site-association`
  gets `Content-Type: application/json` if that file is ever added.
- `public/app/` is **build output and gitignored**. Vercel's CLI ignores `.gitignore` (it only reads
  `.vercelignore`), so `vercel deploy` from this machine uploads it; a Git-triggered Vercel build would not have it
  (and has no `app/` to export from), so deploy the web app from this machine after `npm run build:app`.

## `/v1/stats/copy-quality` (Copy quality section)

`web/lib/copy-quality.ts` reads `GET /v1/stats/copy-quality?period=7d|30d|all` (period switch, default 30D) in the
shape of docs/api.md. Medians and p90s come from the API's `aggregates`; the deviation histogram and the
"blocks between leader and copy" shares are computed in the browser from the `copies` list the API returns (latest
50 keeper copies) and say so ("latest 50 of N copies"). Team-run comes only from the `teamRun` block, shown in its own
card. Not configured or unreachable: every figure is "—", the cards say "Not available yet" and a note says why.
"Download CSV" exports the loaded rows only.

## `/v1/stats` shape the page reads

The normaliser in `web/lib/stats.ts` accepts docs/api.md names and the indexer's `GlobalStats`/`CopyEvent` names:

```jsonc
{
  "accountsCreated": 0,            // or mirrorAccounts
  "fundedAccounts": 0,
  "netDepositedCNS": "0",          // raw 6-dec, or netDepositsCNS / netDepositedUsd
  "copiesExecuted": 0,
  "copiesBlockedByRule": { "LeverageTooHigh": 0 },  // or [{reason, count}], reason name or enum index
  "copiesBlocked": 0,              // optional, summed from the rules if absent
  "medianLatencyMs": 0,
  "activeFollowers7d": 0,
  "keeper": "0x…",                 // optional, else /v1/config keeper.address
  "updatedAt": 1790000000,
  "copies": { "items": [ { "txHash": "0x…", "timestamp": 0, "account": "0x…", "leaderAccountId": "4127",
                           "perpId": 1, "orderType": 0, "lotLNS": "100000", "leverageHdths": 300,
                           "latencyMs": 610, "keeper": "0x…", "isMatchNow": false } ],
              "nextCursor": "…", "total": 0 }
}
```

Request: `GET /v1/stats?limit=25&cursor=<nextCursor>`. The API must send CORS headers allowing
`https://mirror.0xo.in` (the page fetches from the browser).

## Aceternity Pro sources

The Pro site was not logged in in Chrome during the build (no sign-in was attempted), so Pro code came from the
user's licensed copies on disk:

- `components/ui/number-ticker.tsx`: Stats Sections block "Stats With Number Ticker" (`AnimatedNumber`), via
  `grants/tally-site/components/aceternity/stats-with-number-ticker.tsx`.
- `components/ui/beam-path.tsx`: Illustrations block "Animated Beam Path Illustration", via
  `grants/tally-site/components/aceternity/beam-path.tsx` (same drawing as
  `simplistic-saas-template/components/features-two/animated-path.tsx`).
- The rest of the landing was already from the Agenforce template and free components.

## Deploy

```bash
cd web
npm ci && npm run build      # local check
vercel deploy                # preview
vercel deploy --prod         # production
```

Domain `mirror.0xo.in` is attached to the project; DNS (Cloudflare) needs:
`CNAME  mirror  77fe96411416821f.vercel-dns-017.com`  (DNS only, proxy off). Vercel also accepts `A mirror 76.76.21.21`.

## Screenshots

`web/screenshots/<page>-<desktop|mobile>-<light|dark>.png` (1440 and 390 wide, full page), captured from the
production deployment with Playwright. Stage A (copy quality, download from `release.json`, `/app` entry points):
`web/screenshots/stage-a/`, captured from a local production build with the API not configured.
