# Perpl: Analytics / Risk Tool

Track 01. $3k pool, 3 winners × $1k (from `docs/research/2026-10-07-research.md`, row 9).

Requirement text: **to confirm.** The official wording is not in this repo or in the secondhand portal copy.
The research note names three expectations: a protocol view, a wallet drill-down and dark mode. Paste the
official text from the bounty page here and re-check every row against it.

Live at `https://mirror.0xo.in/perpl` since 8 Oct 2026 (answers 200). Code: `web/app/(site)/perpl/`,
`web/components/perpl/`, `web/lib/perpl/`. Explainer: `web/content/docs/perpl-analytics.md` (`/docs/perpl-analytics`).

| # | Requirement | Evidence | Status |
|---|---|---|---|
| 1 | Protocol view (per market and totals) | `/perpl`: 24h and 7d volume, open interest, active traders, liquidations and deleverages (count, notional, recent list with tx links), current funding and 7-day history, mark vs oracle divergence, top accounts by OI. Screenshots `web/screenshots/analytics/overview-*` | done (local, live data) |
| 2 | Risk analytics | Risk panel: top-10 share of OI, HHI, positions within 5% / 10% of liquidation, closest-to-liquidation list (estimate, labelled), leverage distribution. Math in `web/lib/perpl/risk.ts`, unit tests in `risk.test.ts` | done (local) |
| 3 | Wallet drill-down for any Perpl account | `/perpl/wallet/<id or 0x address>`: open positions read onchain (entry, mark, size, leverage, uPnL with funding, estimated liquidation price and distance), equity, realised PnL curve, leverage history, recent fills with tx links, "Copy this trader in Mirror" link. Screenshots `web/screenshots/analytics/wallet-*` | done (local, live data) |
| 4 | Dark mode | Site theme toggle; both themes captured at 1440 and 390 | done |
| 5 | Uses Perpl data | Perpl REST `/v1/pub/context`, candles, funding; Exchange `getAccountById`, `getPositionV2`, `getPerpetualInfoV2` on Monad (full snapshot of every account); Envio indexer over Perpl position, liquidation and deleverage events (`indexer/queries/analytics.graphql`) | done |
| 6 | Public link | `https://mirror.0xo.in/perpl`, deployed 8 Oct 2026. The indexer panels need a public indexer URL (`NEXT_PUBLIC_INDEXER_URL`): the hosted mainnet indexer (https://hasura-mainnet-production.up.railway.app/v1/graphql) has been live since 9 Oct 2026 and is still catching up on its 30 days of history; the URL is set on Vercel once it reports ready. Until then the REST and onchain panels work and the indexer panels say Not available | partly: page live; indexer catching up |
| 7 | Submission asks (video, link) | to confirm from the bounty page | todo |
