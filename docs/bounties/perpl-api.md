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
| Builder code | Mirror is builder 26; onchain attribution via `execOrderV2` confirmed by Perpl (Arich, 7 Oct 2026); 0.02% on opening size only, capped by the follower's signed maximum, shown before signing and on every copy (Perpl's condition: fees explicitly visible to users) | Fork test `test_fork_builderFeeOnLivePerpl`: builder 26 charged 168 CNS on a copied open, matching Mirror's proof; close charged 0 | done (contracts); UI in progress |
| Eligibility | Does onchain execution through MirrorAccount (data via the API) count as "use of the API"? | **Confirmed by Perpl staff (Arich) in Perpl's Discord, 7 Oct 2026:** reading Perpl's REST and WebSocket API and placing orders through the Exchange contract counts. | confirmed |

## Asked for at submission (official, from the bounty page, read 6 Oct 2026)

- Submit a demo video (up to 2 mins) showing your trading bot or automation system on Perpl with demonstrated real on-chain activity.
- Link to your trading bot or automation system on Perpl with demonstrated real on-chain activity.

Answers: `docs/submission.md` (source `docs/submission/fields/11-bounties.md`).
