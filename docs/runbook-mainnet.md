# Mainnet runbook

**Who does what.** Steps that move real funds (deposits, swaps, transfers, real-money trades) are run by the wallet owner, Jagadeesh. Claude does not execute them. Everything else is scripted.

The ops wallet is `0x299E77E58DD37607e4890C761924D829F8ACe82C`. Its key is in `mirror/.env` (gitignored).

| # | Step | Who | Command / action |
|---|---|---|---|
| 1 | Fund the ops wallet per `docs/funding.md` | Jagadeesh | Exchange withdrawal / CCTP / swap |
| 2 | Deploy and verify KeeperRegistry, MirrorAccountFactory (+ MirrorAccount implementation), register the ops EOA as keeper | Claude | `cd contracts && KEEPERS=<ops> forge script script/Deploy.s.sol --rpc-url $MONAD_RPC_URL --private-key $OPS_PRIVATE_KEY --broadcast --gas-estimate-multiplier 115 --verify --verifier sourcify` (writes `deployments/143.json`) |
| 3 | Open the team-run demo leader's Perpl account with 10.00 AUSD | Jagadeesh | `cd contracts && forge script script/DemoLeaderSetup.s.sol --rpc-url https://rpc.monad.xyz --private-key $OPS_PRIVATE_KEY --broadcast --gas-estimate-multiplier 120` |
| 4 | Deploy the engine to Railway (EU region) with the ops key as keeper, relayer and demo leader; deploy the indexer | Claude | `engine/README.md`, `indexer/README.md` |
| 5 | Team-run demo follower: in the app, create the account (passkey), send 10.00 AUSD to the shown address, deposit, and follow the demo leader with match now | Jagadeesh (in the app) | App |
| 6 | First live demo cycle: tap "Run demo trade" and "Run blocked trade" | Jagadeesh (in the app) | App |
| 7 | Update addresses in `shared/config.json`, docs, the stats page and `docs/submission/fields/*`; rebuild `docs/submission.md` | Claude | `python3 docs/submission/build.py` |

**Recovering parked funds after judging:**
- Demo follower: in-app Withdraw.
- Demo leader: `cast send 0x34B6552d57a35a1D042CcAe1951BD1C370112a6F "withdrawCollateral(uint256)" <amount> --private-key ...`, run by the owner.
