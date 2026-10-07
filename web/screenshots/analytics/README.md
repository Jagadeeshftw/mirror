# Perpl analytics screenshots

`/perpl` (overview) and `/perpl/wallet/<id>` (wallet `4734`, plus `1767` as a second example) at 1440 and 390 px
wide, light and dark, full page. Taken on 7 Oct 2026, about 19:15 UTC, with `node scripts/shoot-analytics.mjs 4734 1767`
against a local production build (`npm run build && npx next start`).

**All data is real. No fixtures.**

- Perpl REST (`app.perpl.xyz/api`, public), live: markets, mark and oracle, 24h volume, open interest, funding, candles.
- Monad mainnet RPC (`rpc.monad.xyz`), live: the Exchange contract snapshot of every account (5,421) and open position
  (about 660), long and short open interest, the wallet's positions.
- Indexer panels (active traders, liquidations, realised PnL, leverage history, recent fills): **a local indexer**, the
  repo's `indexer/` run unchanged with `envio start` in RPC mode against Monad mainnet from block 111,300,500
  (about 10:30 UTC on 7 Oct, roughly 9 hours before the screenshots) to the chain head, with local Postgres and Hasura.
  That is why those panels show "indexed since …" and mark their 24h and 7d windows **partial**. A deployment whose
  indexer starts earlier fills the full windows. Without `NEXT_PUBLIC_INDEXER_URL`, these panels show "Not available".

## Compared with the design (`design/proposal-2/shots/laptop-analytics-*`, `laptop-wallet-*`, `phone-anaPhone-*`, `phone-walletPhone-*`)

- Same structure: KPI row (volume, open interest, active traders, liquidations, funding), daily volume, leverage
  distribution, markets table, closest to liquidation, latest liquidations. The wallet page has the same KPI row
  (equity, unrealised, realised 30d, leverage now, closest liquidation), risk panel with distance bars, open positions
  with liq. and distance, recent fills with tx links, and an "Open in Mirror" card ("Copy this trader in Mirror").
- It lives on the site at `/perpl` with the site header, not inside the app shell the design drew. That was the owner's
  decision. The app sidebar's "Perpl analytics" entry already opens `https://mirror.0xo.in/perpl`.
- Added beyond the design: mark vs oracle, 7d volume and 7d average funding columns, top accounts by OI, HHI, counts
  within 5% / 10% of liquidation, deleverages, and an "estimate" label on every liquidation figure.
- Different from the design:
  - The OI chart over 30 days is replaced by a 7-day funding chart. No source here has historical open interest
    (it would need an indexer entity, see the gaps in the report).
  - The design's long/short OI split is replaced by long vs short **position counts**. Perpl matches every long with a
    short, so open interest is always 50/50.
  - The wallet equity curve is replaced by realised PnL. Daily when the indexed range spans 3 or more days,
    per fill otherwise.
  - The Nansen label and follower count are omitted; the follower count appears when the indexer has Mirror followers.
