---
title: Perpl analytics
description: What each number on /perpl and /perpl/wallet means, where it comes from, and which ones are estimates.
---

[Perpl analytics](/perpl) is a public, Perpl-wide view: every market, every open position and any account, read from Perpl's public API and the Perpl Exchange contract on Monad. It does not depend on Mirror's own contracts. Open any account with the search box, by Perpl account id (`4734`) or by address (`0x…`), or go straight to `/perpl/wallet/<id or address>`.

Nothing on these pages is made up. When a source is down or not configured, the panel says **Not available**, names the source and gives the reason. Estimates are labelled **estimate**.

## Sources

| Source | What it gives | Freshness |
| --- | --- | --- |
| Perpl REST `GET /api/v1/pub/context` | Markets, mark and oracle price, 24h volume (`dva`), open interest (`oi`), current funding rate, initial and maintenance margin, taker fee | Cached 15 s |
| Perpl REST candles (`/market-data/:id/candles/3600/…`) | Hourly volume per market over 30 days: daily totals and trailing 7 days | Cached 5 min |
| Perpl REST funding (`/market-data/:id/funding/…`) | Every funding interval of the last 7 days per market | Cached 5 min |
| Exchange `0x34B6…2a6F` on Monad: `getAccountById`, `getPositionV2` | Every Perpl account (ids are sequential from 1) and every open position: side, size, entry, deposit, unrealised PnL with funding, mark | A full snapshot (about 5,400 accounts, about 670 positions, roughly 25 batched `eth_call`s through Multicall3), cached 60 s |
| Exchange `getPerpetualInfoV2` | Long and short open interest per market, used to check the REST figure | Each page load |
| Mirror indexer (Envio + Hasura, `NEXT_PUBLIC_INDEXER_URL`) | Active traders, liquidations and deleverages, and per account: realised PnL by day, leverage after each fill, recent fills with transactions | Live once the indexer has caught up to the chain head |

The indexer only knows what it has indexed. Every indexer-backed panel shows the start of the indexed range, and a 24h or 7d window that starts before it is marked **partial**. The GraphQL operations are in `indexer/queries/analytics.graphql`.

## Protocol overview (`/perpl`)

- **24h volume**: sum of Perpl's `dva` across markets (AUSD). The 7d figure in the note sums the hourly candles of the last 7 x 24 hours.
- **Open interest**: Perpl's `oi` (one side, in lots) valued at the mark price, summed across markets. Perpl matches every long with a short, so long and short open interest are always equal. The contract's `longOpenInterestLNS` and `shortOpenInterestLNS` confirm it.
- **Active traders, 24h**: distinct accounts with a position event (open, add, reduce, close, flip, liquidation, deleverage) in the window, from the indexer. Without the indexer, the tile shows accounts that hold a position now, from the onchain snapshot, and says so.
- **Liquidations, 24h**: notional (closed size x liquidation price) of `PositionLiquidated` and `PositionDeleveraged` events, with counts. The panel below lists the most recent ones with their transactions.
- **Funding, OI-weighted**: each market's current funding rate per interval, weighted by its open-interest notional. Positive means longs pay shorts. Perpl's interval is `funding_interval_sec` (43 minutes today). The chart shows the largest market over 7 days.
- **Markets table**: mark, mark vs oracle divergence (highlighted beyond 0.5%), 24h and 7d volume, open interest, number of long vs short positions (from the onchain snapshot), current funding and its 7-day average.
- **Open positions by leverage**: every open position's effective leverage = notional at mark / (deposit + unrealised PnL), counted in buckets 1-2x, 2-5x, 5-10x, 10-20x, 20x+.
- **Top accounts by open interest**: notional at mark summed over each account's open positions, with its share of total open notional.

### Risk panel

- **Top-10 share of OI**: share of total open notional held by the 10 largest accounts.
- **Concentration (HHI)**: Herfindahl-Hirschman index of account shares, from 0 (spread out) to 1 (a single account).
- **Within 5% / 10% of liquidation** and **Closest to liquidation**: see the estimate below. *Margin used* is the maintenance requirement as a share of the position's equity, where 100% means the position is at liquidation.

## Wallet drill-down (`/perpl/wallet/<account>`)

- **Equity**: free balance + locked balance + the deposit and unrealised PnL of every open position, read onchain.
- **Unrealised**: Perpl's `pnlCNS` per position, price PnL plus accrued funding.
- **Realised, 30 days**: realised price PnL + funding − opening fees per UTC day, from the indexer (indexed range only). Perpl's position events do not carry closing fees, so this is slightly optimistic.
- **Leverage now**: total open notional / equity. *Peak* is the highest position leverage after a fill in the indexed range.
- **Leverage history**: position size after each fill x fill price / position deposit after the fill.
- **Open positions**: entry, mark, size, effective leverage, deposit, uPnL (funding included, see the tooltip) and the estimated liquidation price and distance.
- **Recent fills**: the account's Perpl position events with MonadVision links. A `*` price is the market's last trade price for a position opened before the indexed range.
- **Copy this trader in Mirror** opens the leader profile in the Mirror app. It is hidden for Mirror follower accounts and team-run accounts.

## The liquidation estimate

Perpl margins each position on its own deposit. A position is liquidated when its equity (deposit + unrealised PnL, funding included) falls below the maintenance margin of its notional at the mark price. Perpl's context gives `maintenance_margin` as a leverage in hundredths: `2000` is 20x, or 5% of notional.

For a position of size *S*, entry *E*, deposit *D*, accrued funding *F* and maintenance fraction *m*:

- long: liquidation price = (S·E − D − F) / (S·(1 − m))
- short: liquidation price = (S·E + D + F) / (S·(1 + m))
- distance = how far the mark has to move against the position, as a share of the mark.

The estimate errs on the early side:

- *m* is raised by the market's taker fee, the cost of closing the position;
- only the position's own deposit counts, never free account balance;
- accrued funding is held at its current value and only the mark moves.

Perpl's own liquidation engine decides when a position is actually liquidated. Treat these numbers as early warnings, not as the exact trigger.

## Running it

- Without `NEXT_PUBLIC_INDEXER_URL`, the REST and onchain panels still work live. The indexer panels say Not available.
- `MONAD_RPC_URL` (default `https://rpc.monad.xyz`) and `PERPL_API_URL` (default `https://app.perpl.xyz/api`) can be overridden.
- The risk math is unit-tested in `web/lib/perpl/risk.test.ts` (`npm test` in `web`).
