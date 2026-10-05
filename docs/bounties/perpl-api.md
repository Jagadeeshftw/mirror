# Perpl: Best use of Perpl's API

All tracks. Top 2 winners, $2,500 each.

Requirement text **(secondhand)**: "Build a production-ready trading bot or automation system on Perpl."

| # | Requirement | Evidence | Status |
|---|---|---|---|
| 1 | Trading bot / automation system on Perpl | Copy engine (`engine/`): leader fills → policy pre-check → copied orders | todo |
| 2 | Uses Perpl's API | Public REST `/v1/pub/context` and WS `market-state`, `trades`, `order-book` for marks, books and market config | todo |
| 3 | Production-ready | Parallel submission, confirmation tracking, retries, monitoring dashboard, runbook | todo |
| 4 | Real trades on Perpl | Mainnet tx hashes from the engine | todo |
| Open question | Does onchain execution through MirrorAccount (data via the API) count as "use of the API"? | Ask Perpl in Discord | todo (needs user) |
