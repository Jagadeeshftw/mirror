# Mainnet runbook

**Who does what.** Steps that move real funds (deposits, swaps, transfers, real-money trades) are run by the wallet owner, Jagadeesh. Claude does not execute them. Everything else is scripted.

The ops wallet is `0x299E77E58DD37607e4890C761924D829F8ACe82C`. Its key is in `mirror/.env` (gitignored).

| # | Step | Who | Command / action |
|---|---|---|---|
| 1 | Fund the ops wallet per `docs/funding.md` | Jagadeesh | Exchange withdrawal / CCTP / swap |
| 2 | Deploy and verify KeeperRegistry, MirrorAccountFactory (+ MirrorAccount implementation), register the ops EOA as keeper. Only on the owner's explicit go. | Claude | Plan first, sending nothing: `cd scripts && node deploy-contracts.mjs --network mainnet --cap 25 --keepers <ops>`. Then the same with `--send --expect-nonce <n> --confirm-mainnet`. Every gas limit comes from Monad's `eth_estimateGas` × 1.15 (never forge's simulation). Writes `contracts/deployments/143.json` and prints the `forge verify-contract` commands (no transaction). |
| 3 | Open the team-run demo leader's Perpl account with 10.00 AUSD | Jagadeesh | **Done 7 Oct 2026:** Perpl account 5416, see `docs/funding-ledger.md`. |
| 4 | Deploy the engine to Railway (EU region) with the ops key as keeper, relayer and demo leader; deploy the indexer | Claude | `engine/README.md`, `indexer/README.md` |
| 5 | Team-run demo follower: in the app, create the account (passkey), send 10.00 AUSD to the shown address, deposit, and follow the demo leader with match now | Jagadeesh (in the app) | App |
| 6 | First live demo cycle: tap "Run demo trade" and "Run blocked trade" | Jagadeesh (in the app) | App |
| 7 | Update addresses in `shared/config.json`, docs, the stats page and `docs/submission/fields/*`; rebuild `docs/submission.md` | Claude | `python3 docs/submission/build.py` |

**Recovering parked funds after judging:**
- Demo follower: in-app Withdraw.
- Demo leader: `cast send 0x34B6552d57a35a1D042CcAe1951BD1C370112a6F "withdrawCollateral(uint256)" <amount> --private-key ...`, run by the owner.
