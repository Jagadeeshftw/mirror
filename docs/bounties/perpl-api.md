# Perpl: Best use of Perpl's API

All tracks. Top 2 winners, $2,500 each.

Requirement text **(secondhand)**: "Build a production-ready trading bot or automation system on Perpl."

| # | Requirement | Evidence | Status |
|---|---|---|---|
| 1 | Trading bot / automation system on Perpl | Copy engine (`engine/`, 227 tests): leader fills → policy pre-check → thin-book guard (`engine/src/services/guard.ts`) → copied orders; stop executor (`stops.ts`) | built; hosted on Railway since 9 Oct 2026 |
| 2 | Uses Perpl's API | Public REST `/v1/pub/context` and WS `market-state`, `trades`, `order-book` for marks, books and market config (`engine/src/perpl/`) | done |
| 3 | Production-ready | Parallel submission, confirmation tracking, retries, monitoring, runbook; Railway project `mirror-testnet` (`scripts/railway-up.sh`) | live on testnet since 9 Oct 2026 |
| 4 | Real trades on Perpl | Hosted engine against public testnet, 9 Oct 2026 (`devices/evidence/stage-b-hosted/README.md`): demo open copied with builder 26 charged 166 units, 0.000166 test AUSD ([tx](https://testnet.monadvision.com/tx/0xfd60066f5cb2613ef657c0026781783b784ccb38dbf3cf5a04d1e66777c93110)), its close with fee 0 ([tx](https://testnet.monadvision.com/tx/0xdad63b1568311e1251c6d811ea4ba2fd96780160821957cae03ef249481bcb7e)), a follower's copy with 0.016526 test AUSD to builder 26 ([tx](https://testnet.monadvision.com/tx/0x297284a6b1f2259ee4a927d40643ae349fde14ed528d721bb9032c6ca1f6fb7b)), a 10x copy blocked by a 2x rule ([tx](https://testnet.monadvision.com/tx/0x464e326f240fe3392dba0ab92968fa4632cb9e8e7637523a9b1c6a933e97a57e)). The 8 Oct run from the developer's machine: `devices/evidence/stage-b/README.md`. Test funds, not revenue. | done on testnet |
| 5 | A public link showing the bot's real onchain activity (official wording) | Public stats page listing engine copies with MonadVision links + keeper address `0x299E77E58DD37607e4890C761924D829F8ACe82C`: https://mirror.0xo.in/stats (outside users' copies: none yet; the team-run demo runs listed separately) | live since 9 Oct 2026 |
| Builder code | Mirror is builder 26; onchain attribution via `execOrderV2` confirmed by Perpl (Arich, 7 Oct 2026); 0.02% on opening size only, capped by the follower's signed maximum, shown before signing and on every copy (Perpl's condition: fees explicitly visible to users) | Fork test `test_fork_builderFeeOnLivePerpl`: builder 26 charged 168 CNS on a copied open, matching Mirror's proof; close charged 0 | done (contracts, engine, app: `follow.review.fee`, `copy.proof.fee`); set in the testnet deployment (`builderId` 26, `builderFeePer100K` 20); charged onchain on testnet in test AUSD (166 units on a copied open, 0 on its close); no revenue (test funds; nothing on mainnet) |
| Eligibility | Does onchain execution through MirrorAccount (data via the API) count as "use of the API"? | **Confirmed by Perpl staff (Arich) in Perpl's Discord, 7 Oct 2026:** reading Perpl's REST and WebSocket API and placing orders through the Exchange contract counts. | confirmed |

## Asked for at submission (official, from the bounty page, read 6 Oct 2026)

- Submit a demo video (up to 2 mins) showing your trading bot or automation system on Perpl with demonstrated real on-chain activity.
- Link to your trading bot or automation system on Perpl with demonstrated real on-chain activity.

Answers: `docs/submission.md` (source `docs/submission/fields/11-bounties.md`).
