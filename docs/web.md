# Web (mirror.0xo.in)

One Next.js 16 app in `web/` (Tailwind 4, Motion on the landing page only), deployed on Vercel as project
`mirror` (team jagadeesh-bs-projects). It replaces the landing proposal that lived in `web/landing/`.

## Routes

| Route | What | Motion |
|---|---|---|
| `/` | Landing (approved design + Aceternity Pro number ticker and beam path) | yes |
| `/docs`, `/docs/<slug>` | GitBook-style docs from `web/content/docs/*.md` | none |
| `/docs/search.json` | Build-time full-text index for the docs search (MiniSearch, client side) | n/a |
| `/stats` | Public stats, client-side fetch of `{API_BASE}/v1/stats`, `/v1/config`, `/v1/demo` | none |
| `/download` | APK page: install steps, requirements, SHA-256 | none |
| `/.well-known/assetlinks.json` | Static file `web/public/.well-known/assetlinks.json`, `Content-Type: application/json`, no redirect | n/a |
| `/opengraph-image`, `/icon.svg`, `/apple-icon`, `/sitemap.xml`, `/robots.txt` | SEO | n/a |

## What to update, and where

- **API base URL**: Vercel env `NEXT_PUBLIC_API_BASE` (all environments). It is currently the placeholder
  `https://api.placeholder.invalid`; any value containing `placeholder` makes `/stats` show "Not live yet".
  `NEXT_PUBLIC_*` is inlined at build time, so redeploy after changing it:
  `vercel env rm NEXT_PUBLIC_API_BASE production && vercel env add NEXT_PUBLIC_API_BASE production --value https://<api> --yes && vercel deploy --prod`.
- **Contract addresses**: `web/lib/site.ts` `CONTRACTS` (null = "pending"). The docs Contracts table is generated from it.
- **APK**: `web/lib/site.ts` `APK` (`available`, `url`, `version`, `sizeLabel`, `sha256`). Put the file at
  `web/public/downloads/mirror.apk` or point `url` at a GitHub release asset.
- **assetlinks.json**: `npm run build` runs `scripts/sync-assetlinks.mjs`, which copies `devices/assetlinks.json`
  into `web/public/.well-known/` when it exists. Vercel only uploads `web/`, so build/deploy from this machine
  (or commit the copied file) after the fingerprints change.
- **Team-run addresses**: come from `/v1/config` (`teamRun.*`) and `/v1/demo`; docs page
  `content/docs/team-run-accounts.md` says "pending" until filled in by hand.
- **Measured numbers** (300 ms, 550 ms, 279k gas, 91 tests): `web/lib/site.ts` `MEASURED` and the docs.

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
production deployment with Playwright.
