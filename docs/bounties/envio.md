# Envio: Best Use of Envio

All tracks. Single winner, $1,000.

Requirement text **(secondhand)**: "Meaningfully use Envio's HyperIndex, HyperSync, or HyperRPC to power real on-chain data
driving a core feature in your app." Excerpt: judged on "non-trivial schema design, derived/aggregated entities".

| # | Requirement | Evidence | Status |
|---|---|---|---|
| 1 | HyperIndex powers a core feature | Indexer over Perpl Exchange + Mirror events drives leaderboard, leader profiles, follower PnL, stats, `/perpl` analytics | built (44 tests); hosting pending |
| 2 | Non-trivial schema, derived/aggregated entities | Leader stats (PnL, drawdown, win rate, consistency), per-copy quality, follower PnL attribution per leader (`indexer/schema.graphql`) | done |
| 3 | Real onchain data | Monad mainnet from Perpl deploy block 54773010 (`config.yaml`); Monad testnet (`config.testnet.yaml`) | built; live sync of recent mainnet blocks tested; hosting pending |

## Asked for at submission (official, from the bounty page, read 6 Oct 2026)

- Describe how your project meaningfully uses Envio's HyperIndex, HyperSync or HyperRPC to power real on-chain data in your app — not just installed, but actually driving a feature.
- Submit an optional demo video (up to 2 mins) showing the data flowing end to end through Envio's HyperIndex, HyperSync or HyperRPC.

Answers: `docs/submission.md` (source `docs/submission/fields/11-bounties.md`).
