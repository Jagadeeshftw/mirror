# Perpl: Best use of Perpl's API

All tracks. Top 2 winners, $2,500 each.

Requirement text **(secondhand)**: "Build a production-ready trading bot or automation system on Perpl."

| # | Requirement | Evidence | Status |
|---|---|---|---|
| 1 | Trading bot / automation system on Perpl | Copy engine (`engine/`, 218 tests): leader fills → policy pre-check → thin-book guard (`engine/src/services/guard.ts`) → copied orders; stop executor (`stops.ts`) | built; hosting pending |
| 2 | Uses Perpl's API | Public REST `/v1/pub/context` and WS `market-state`, `trades`, `order-book` for marks, books and market config (`engine/src/perpl/`) | done |
| 3 | Production-ready | Parallel submission, confirmation tracking, retries, monitoring, runbook; Railway project `mirror-testnet` prepared (`scripts/railway-up.sh`) | built; not live (waiting on secrets) |
| 4 | Real trades on Perpl | Engine run from the developer's machine against public testnet, 8 Oct 2026 (`devices/evidence/stage-b/README.md`): copied open with builder 26 charged 166 units, 0.000166 test AUSD ([tx](https://testnet.monadvision.com/tx/0xc14cd15a3d3243263fc3b43cd2b7d1ae349c407622bf7479dc788ef7c873aa9b)); copied close, fee 0 ([tx](https://testnet.monadvision.com/tx/0x83922244bd82b863b07e8e7c771d39757d631d61327459afb89054ee04bfe373)); 10x copy blocked ([tx](https://testnet.monadvision.com/tx/0xcfeeda062c5a5590e051c892d7c379c0019d93548f5f66f13043718f7a6d80aa)); engine fork e2e against live Perpl state | done on testnet from the developer's machine; from the hosted engine: pending |
| 5 | A public link showing the bot's real onchain activity (official wording) | Public stats page listing engine copies with MonadVision links + keeper address `0x299E77E58DD37607e4890C761924D829F8ACe82C` | pending (hosted engine and indexer) |
| Builder code | Mirror is builder 26; onchain attribution via `execOrderV2` confirmed by Perpl (Arich, 7 Oct 2026); 0.02% on opening size only, capped by the follower's signed maximum, shown before signing and on every copy (Perpl's condition: fees explicitly visible to users) | Fork test `test_fork_builderFeeOnLivePerpl`: builder 26 charged 168 CNS on a copied open, matching Mirror's proof; close charged 0 | done (contracts, engine, app: `follow.review.fee`, `copy.proof.fee`); set in the testnet deployment (`builderId` 26, `builderFeePer100K` 20); charged onchain on testnet in test AUSD (166 units on a copied open, 0 on its close); no revenue (test funds; nothing on mainnet) |
| Eligibility | Does onchain execution through MirrorAccount (data via the API) count as "use of the API"? | **Confirmed by Perpl staff (Arich) in Perpl's Discord, 7 Oct 2026:** reading Perpl's REST and WebSocket API and placing orders through the Exchange contract counts. | confirmed |

## Asked for at submission (official, from the bounty page, read 6 Oct 2026)

- Submit a demo video (up to 2 mins) showing your trading bot or automation system on Perpl with demonstrated real on-chain activity.
- Link to your trading bot or automation system on Perpl with demonstrated real on-chain activity.

Answers: `docs/submission.md` (source `docs/submission/fields/11-bounties.md`).
