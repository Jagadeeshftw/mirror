# Perpl: Best use of Perpl's API

All tracks. Top 2 winners, $2,500 each.

Requirement text **(secondhand)**: "Build a production-ready trading bot or automation system on Perpl."

| # | Requirement | Evidence | Status |
|---|---|---|---|
| 1 | Trading bot / automation system on Perpl | Copy engine (`engine/`): leader fills → policy pre-check → copied orders | todo |
| 2 | Uses Perpl's API | Public REST `/v1/pub/context` and WS `market-state`, `trades`, `order-book` for marks, books and market config | todo |
| 3 | Production-ready | Parallel submission, confirmation tracking, retries, monitoring dashboard, runbook | todo |
| 4 | Real trades on Perpl | Mainnet tx hashes from the engine | todo |
| 5 | A public link showing the bot's real onchain activity (official wording) | Public stats page listing engine copies with MonadVision links + keeper address | todo |
| Open question | Does onchain execution through MirrorAccount (data via the API) count as "use of the API"? | Ask Perpl in Discord | todo (needs user) |

## Asked for at submission (official, from the bounty page, read 6 Oct 2026)

- Submit a demo video (up to 2 mins) showing your trading bot or automation system on Perpl with demonstrated real on-chain activity.
- Link to your trading bot or automation system on Perpl with demonstrated real on-chain activity.

Answers: `docs/submission.md` (source `docs/submission/fields/11-bounties.md`).
