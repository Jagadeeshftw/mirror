# Mainnet runbook

One ordered checklist from the owner's go to getting the funds back. Monad mainnet is chain 143.

**Who does what.** Every step that sends a mainnet transaction is run by the wallet owner, Jagadeesh, from his own terminal. Claude prepares the plans, checks them on a fork, and does the off-chain steps, but sends nothing to mainnet.

**Ops wallet:** `0x299E77E58DD37607e4890C761924D829F8ACe82C`. Its key is in `mirror/.env` (gitignored). On mainnet this one EOA does every team-run job:
- deployer and KeeperRegistry owner;
- keeper and relayer;
- team-run demo leader (Perpl account 5416, which is also builder 26's payout account);
- Nansen x402 payer.

**Rules every script follows** (`scripts/lib/ops.mjs`, `scripts/deploy-contracts.mjs`):
- **Plan mode by default.** Nothing is signed without `--send`. Mainnet also needs `--confirm-mainnet` and `--expect-nonce N` (the ops wallet's current nonce).
- **Gas limits come from Monad itself.**
  - A step whose inputs are already onchain uses Monad's `eth_estimateGas`.
  - A step that depends on an earlier step in the same run (for example approve, then deposit) is sized by a binary search over Monad's `eth_simulateV1`, with the earlier steps in front of it. Monad reports `gasUsed` = gas limit there, so the script reads success or failure at each limit.
  - Each step is re-estimated against live state right before it is sent.
  - Headroom is ×1.15, or ×1.3 for orders that hit the book.
  - Forge's simulation and third-party quotes are never used. Monad charges the full limit.
- **Fees are shown before anything is sent.** Expected cost = limit × (base + tip). Worst case = limit × max fee, where max fee = 2 × base + tip.
- **Local forks run with `--chain-id 31337`.** Anything the ops key signs there is then invalid on mainnet (EIP-155). The scripts refuse to sign on a local RPC that reports chain 143.

All commands below run from:

```
cd /Users/jagadeesh/personal/projects/grants/monad/mirror/scripts
```

---

## 0. Owner's go

The owner says go. Until then, nothing in sections 2–8 is sent.

Before step 2, the ops wallet must send **no other mainnet transaction**. The predicted contract addresses depend on its nonce being **4**. If the nonce has moved, plan again: the addresses will change, and the plan prints the new ones.

## 1. Funds needed

| Wallet | Asset | Amount | Why | Status (8 Oct 2026) |
|---|---|---|---|---|
| Ops `0x299E…e82C` | MON | ≥ 2.2 for the deploy (worst case 2.184823), ≥ 40 in total for the demo and keeper budget in `docs/funding.md` | Gas | **Covered:** holds 197.656 MON. Nothing to add. |
| Ops, Perpl account 5416 | AUSD | 10.00 | Demo leader collateral (Perpl's minimum to open an account) | **Done 7 Oct** (`docs/funding-ledger.md`) |
| Demo follower's passkey owner address (shown in the app after Create account) | AUSD | **10.00** | Opens the demo follower's MirrorAccount on Perpl. 10.00 is Perpl's minimum; the deposit cap is 25.00 | **To do.** The ops wallet holds only 0.385718 AUSD. Send 10.00 AUSD from your own wallet, or send it to the ops wallet and use `demo-setup.mjs --follower-fund 10` (step 5) |
| Ops | USDC | 3.00 (optional) | Nansen via x402 | Only if the engine's Nansen signal is wanted (`docs/funding.md`) |

The demo follower's owner address needs **no MON**: create, deposit and follow are relayed and gasless.

## 2. Deploy (owner sends)

**Plan, sends nothing.** Captured 8 Oct 2026, mainnet block ≈111,614,500:

```
node deploy-contracts.mjs --network mainnet --cap 25 --builder-id 26 --builder-fee 20 --keepers 0x299E77E58DD37607e4890C761924D829F8ACe82C
```

```
network    mainnet (chain 143) via https://rpc.monad.xyz
deployer   0x299E77E58DD37607e4890C761924D829F8ACe82C  nonce 4  balance 197.656181 MON
perpl      0x34B6552d57a35a1D042CcAe1951BD1C370112a6F  collateral 0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a  min open 10 AUSD
cap        25 AUSD per account
builder    id 26, fee 20 per 100,000 (0.020%) on opening size only
predicted  KeeperRegistry 0x0CFF24E2282CADF081F12350Ef13Cc3A6A042345
           MirrorAccountFactory 0xfFb9Eb75171E831B1BD4e1dD3F04E843b3100Ccf
           MirrorAccount implementation 0x7F38c9CB1f53C0d046dE5A8cC854e7bf838BFfE6
runtime    MirrorAccount 38767 bytes
gas        every limit = Monad eth_estimateGas x 1.15

deploy KeeperRegistry
   estimate 436963  limit 502508  expected fee 0.051256 MON  worst 0.101507 MON
deploy MirrorAccountFactory (+ MirrorAccount implementation)
   estimate 8906973  limit 10243019  expected fee 1.044788 MON  worst 2.069090 MON
KeeperRegistry.setKeepers(0x299E77E58DD37607e4890C761924D829F8ACe82C)
   estimate 61243  limit 70430  expected fee 0.007184 MON  worst 0.014227 MON

base fee 100 gwei, tip 2 gwei, max fee 202 gwei
total limit 10815957: expected 1.103228 MON, worst case 2.184823 MON

plan only: nothing was sent. Add --send --expect-nonce 4 to deploy.
```

**Expected cost: 1.103 MON. Worst case: 2.185 MON.** Monad charges the full limit. On testnet the same three transactions cost 1.103232 MON, with gasUsed = limit.

**Send, owner only.** Run the plan again first and check that it still says nonce 4 and the same three addresses. Then:

```
node deploy-contracts.mjs --network mainnet --cap 25 --builder-id 26 --builder-fee 20 --keepers 0x299E77E58DD37607e4890C761924D829F8ACe82C --send --expect-nonce 4 --confirm-mainnet
```

This writes `contracts/deployments/143.json` (addresses, block, transaction hashes) and prints the verify commands. If the nonce has moved, the script refuses. Plan again and use the new nonce; the addresses below then change too.

Record the three transactions in `docs/funding-ledger.md`.

## 3. Verify (no transaction)

There are three verifiers; the source is the same each time.
- **sourcify.dev:** the testnet contracts are verified there.
- **MonadVision:** reads BlockVision's own Sourcify instance. The testnet contracts are **not** verified there yet.
- **Monadscan:** Etherscan API v2. Needs an Etherscan API key.

The addresses below are the predicted ones for nonce 4. If the deploy prints different addresses, use those.

```
cd /Users/jagadeesh/personal/projects/grants/monad/mirror/contracts
```

sourcify.dev:

```
forge verify-contract 0x0CFF24E2282CADF081F12350Ef13Cc3A6A042345 src/KeeperRegistry.sol:KeeperRegistry --chain 143 --verifier sourcify --constructor-args $(cast abi-encode "c(address)" 0x299E77E58DD37607e4890C761924D829F8ACe82C)
forge verify-contract 0xfFb9Eb75171E831B1BD4e1dD3F04E843b3100Ccf src/MirrorAccountFactory.sol:MirrorAccountFactory --chain 143 --verifier sourcify --constructor-args $(cast abi-encode "c(address,address,address,uint256,uint8,uint16)" 0x34B6552d57a35a1D042CcAe1951BD1C370112a6F 0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a 0x0CFF24E2282CADF081F12350Ef13Cc3A6A042345 25000000 26 20)
forge verify-contract 0x7F38c9CB1f53C0d046dE5A8cC854e7bf838BFfE6 src/MirrorAccount.sol:MirrorAccount --chain 143 --verifier sourcify --constructor-args $(cast abi-encode "c(address,address,address,address,uint256,uint8,uint16)" 0x34B6552d57a35a1D042CcAe1951BD1C370112a6F 0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a 0x0CFF24E2282CADF081F12350Ef13Cc3A6A042345 0xfFb9Eb75171E831B1BD4e1dD3F04E843b3100Ccf 25000000 26 20)
```

MonadVision (BlockVision Sourcify):

```
forge verify-contract 0x0CFF24E2282CADF081F12350Ef13Cc3A6A042345 src/KeeperRegistry.sol:KeeperRegistry --chain 143 --verifier sourcify --verifier-url https://sourcify-api-monad.blockvision.org/ --constructor-args $(cast abi-encode "c(address)" 0x299E77E58DD37607e4890C761924D829F8ACe82C)
forge verify-contract 0xfFb9Eb75171E831B1BD4e1dD3F04E843b3100Ccf src/MirrorAccountFactory.sol:MirrorAccountFactory --chain 143 --verifier sourcify --verifier-url https://sourcify-api-monad.blockvision.org/ --constructor-args $(cast abi-encode "c(address,address,address,uint256,uint8,uint16)" 0x34B6552d57a35a1D042CcAe1951BD1C370112a6F 0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a 0x0CFF24E2282CADF081F12350Ef13Cc3A6A042345 25000000 26 20)
forge verify-contract 0x7F38c9CB1f53C0d046dE5A8cC854e7bf838BFfE6 src/MirrorAccount.sol:MirrorAccount --chain 143 --verifier sourcify --verifier-url https://sourcify-api-monad.blockvision.org/ --constructor-args $(cast abi-encode "c(address,address,address,address,uint256,uint8,uint16)" 0x34B6552d57a35a1D042CcAe1951BD1C370112a6F 0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a 0x0CFF24E2282CADF081F12350Ef13Cc3A6A042345 0xfFb9Eb75171E831B1BD4e1dD3F04E843b3100Ccf 25000000 26 20)
```

Monadscan (optional, needs a key): run the same three commands with `--verifier etherscan --etherscan-api-key <key> --watch` instead of `--verifier sourcify`.

Check the result (read-only):

```
curl -s https://sourcify.dev/server/v2/contract/143/0xfFb9Eb75171E831B1BD4e1dD3F04E843b3100Ccf
curl -s https://sourcify-api-monad.blockvision.org/v2/contract/143/0xfFb9Eb75171E831B1BD4e1dD3F04E843b3100Ccf
```

## 4. Smoke (read-only, anyone can run it)

```
cd /Users/jagadeesh/personal/projects/grants/monad/mirror/scripts
node smoke-mainnet.mjs --cap 25 --api
```

The smoke script checks:
- there is code at all three addresses, and it is the compiled code from `contracts/out` (immutables masked);
- the factory and implementation immutables: exchange, AUSD, registry, factory, `DEPOSIT_CAP` 25, `BUILDER_ID` 26, `BUILDER_FEE_PER_100K` 20;
- the implementation has no owner and cannot be initialised;
- the registry owner is the ops wallet, there is no pending owner, the ops wallet is a keeper and a random address is not;
- `createAccount` (`eth_call`) returns `predictAccount`;
- the Perpl exchange is reachable: collateral, minimum open ≤ cap, BTC mark, and the demo leader's account;
- the Perpl REST API answers (`--api`);
- `shared/config.json` matches the deployment, once it is filled in.

It exits with 1 on any failure.

The same script already passes against the real **testnet** deployment:

```
node smoke-mainnet.mjs --network testnet --cap 200 --api
```

It gave 37 PASS, with one WARN: the testnet demo leader had no Perpl account yet.

## 5. Demo setup

**Onchain steps, by script.** The script plans by default; the owner sends.

```
node demo-setup.mjs --network mainnet
```

What `demo-setup.mjs` does (each step only if needed):
1. **Demo leader Perpl account.** Opens it with an exact approval plus `createAccount`. On mainnet it already exists (account 5416, 10.00 AUSD), so this is skipped. `--leader-topup <AUSD>` adds collateral.
2. **Keepers.** Registers each `--keepers` address (default: ops) in the KeeperRegistry. The deploy already does this, so this is normally skipped.
3. **Optional AUSD to the demo follower's owner.** `--follower-owner <passkey address> --follower-fund 10` sends 10.00 AUSD from the ops wallet to the passkey address. Use it only if the ops wallet holds the AUSD.
4. **Read-only checklist** for the in-app steps (below), and the engine and indexer variables for the demo pair.

Current mainnet plan (before the deploy): `leader Perpl account 5416, balance 10.000000 AUSD`; nothing to send.

If something is to be sent, the owner adds `--send --expect-nonce <n> --confirm-mainnet` with the nonce the plan prints.

**In the app, with the passkey** (Jagadeesh; the engine's relayer pays the gas):
1. **Create account.** The app shows the passkey owner address and the MirrorAccount address.
2. **Fund the owner address** with 10.00 AUSD (section 1).
3. **Deposit 10.00 AUSD.** This is an EIP-2612 permit relayed by the engine, and it opens the MirrorAccount's Perpl account.
4. **Follow the demo leader** (Perpl account 5416) in BTC with match now.
5. **Check:**

   ```
   node demo-setup.mjs --network mainnet --follower-owner <passkey owner address>
   ```

   It shows `[x]` for create, deposit and follow, and prints `DEMO_FOLLOWER_ACCOUNT`.
6. **First live demo cycle:** "Run demo trade" and "Run blocked trade".

**Testnet** (sends allowed there). The demo leader deposit is 200 test AUSD. `--reserve-ausd 2500` makes the script refuse to touch the 2,500 test AUSD tester pool. Plan:

```
node demo-setup.mjs --network testnet --leader-deposit 200 --reserve-ausd 2500
```

The plan (8 Oct) has two steps:
- approve 200: estimate 71,099, limit 81,764;
- `createAccount(200)`: simulated 202,146, limit 232,468.

That is 0.032 MON expected and 0.063 MON worst case, and the ops wallet keeps 2,500.000000 test AUSD. To send it, add `--send --expect-nonce <n>` with the nonce the plan prints (3 on 8 Oct).

## 6. Engine and indexer switch to mainnet

Use the values from `contracts/deployments/143.json` and step 5. Keys go only into Railway variables, never into a file.

**Engine (Railway, EU region):**
- `NETWORK=mainnet`
- `FACTORY_ADDRESS=0xfFb9Eb75171E831B1BD4e1dD3F04E843b3100Ccf`
- `KEEPER_REGISTRY_ADDRESS=0x0CFF24E2282CADF081F12350Ef13Cc3A6A042345`
- `MIRROR_DEPLOY_BLOCK=<block in 143.json>`
- `KEEPER_PRIVATE_KEYS`, `RELAYER_PRIVATE_KEY` and `DEMO_LEADER_PRIVATE_KEY`: the ops key
- `DEMO_FOLLOWER_ACCOUNT=<MirrorAccount>`
- `DEMO_PERP_ID=1`
- `TEAM_RUN_ADDRESSES=<passkey owner address>`
- `RPC_URL` and `WS_RPC_URL` default to the public mainnet RPC.

**Indexer:**
- `ENVIO_MIRROR_FACTORY_ADDRESS=0xfFb9Eb75171E831B1BD4e1dD3F04E843b3100Ccf`
- `ENVIO_MIRROR_START_BLOCK=<block in 143.json>`
- `ENVIO_TEAM_RUN_ADDRESSES=0x299E77E58DD37607e4890C761924D829F8ACe82C,<passkey owner>,<MirrorAccount>`
- `ENVIO_TEAM_RUN_ACCOUNT_IDS=5416`

**Repository (Claude):**
- fill `shared/config.json` → `networks.mainnet.mirror` (factory, implementation, keeperRegistry, deployBlock) and `teamRun`;
- run `node smoke-mainnet.mjs --cap 25` again (it now also checks `shared/config.json`);
- update the docs, the stats page and `docs/submission/fields/*`, then `python3 docs/submission/build.py`.

## 7. Funds return (after judging)

There is one command for everything the team's own key can move.

**Plan, sends nothing.** Captured 8 Oct 2026, before the deploy:

```
node return-funds-mainnet.mjs --to <owner wallet> --mon
```

```
ops        0x299E77E58DD37607e4890C761924D829F8ACe82C  197.656181 MON  AUSD 0.385718  USDC 0.000000
perpl      account 5416: free 10.000000 AUSD, locked 0.000000, positions in none
1. Perpl.withdrawCollateral(free balance: 10.000000 AUSD now) to the ops wallet
   gas 132685 (eth_estimateGas) x 1.15 = limit 152588; expected 0.015564 MON, worst 0.030823 MON
2. AUSD.transfer(<owner wallet>, all: about 10.385718)
   gas 72233 (eth_simulateV1 after the steps above) x 1.15 = limit 83068; expected 0.008473 MON, worst 0.016780 MON
3. MON to <owner wallet>: everything above 10.000000 MON (amount set at send time, after gas)
   gas 21914 (eth_simulateV1 after the steps above) x 1.15 = limit 25202; expected 0.002571 MON, worst 0.005091 MON
total gas limit 260858: expected 0.026608 MON, worst case 0.052693 MON
```

**Send, owner only.** Stop the engine first so the ops key sends nothing else. Then run the demo follower's in-app Withdraw (below), and then:

```
node return-funds-mainnet.mjs --to <owner wallet> --mon --send --expect-nonce <n> --confirm-mainnet
```

**What the script returns:**
- **The demo leader's Perpl account 5416.** It closes any open position with an IOC order that is at most 100 bps worse than the mark (`--close-slippage-bps`), then withdraws the whole free balance to the ops wallet. `--keep-positions` skips the closes.
- **Any MirrorAccount whose owner is the ops EOA itself.** None is planned; the script checks salt 0. It calls `withdraw()`, which by contract pays the owner, the ops wallet. It skips the account if it holds positions.
- **With `--to`:** all AUSD and USDC from the ops wallet. With `--mon`, all MON above `--keep-mon`.
  - The default `--keep-mon` is **10 MON**: Monad's reserve balance. A transaction that leaves an EOA below 10 MON reverts unless it is an "emptying" transaction, and the ops wallet has just sent the steps before it.
  - To go below 10: `--keep-mon 0.05 --engine-stopped`. The script then waits 5 s before the MON transfer.

**What a script cannot return (passkey only).** The script reports these read-only and never calls them:
- **The demo follower's MirrorAccount.** In the app: Close all, then Withdraw. The contract pays the passkey owner address.
- **The passkey owner address itself.** Send the AUSD on from the app's wallet.
- **Any other follower's collateral.** No script can move it: withdrawals from a MirrorAccount only ever go to that account's owner, and keepers and the registry owner have no path to funds.

### Fork rehearsal (8 Oct 2026): passed

```
node fork-test-mainnet.mjs --port 8560
```

It runs the real scripts against `anvil --fork-url https://rpc.monad.xyz --chain-id 31337 --disable-code-size-limit --no-storage-caching`, forked at mainnet block 111,616,462. Fork-only setup uses impersonation and throwaway keys; nothing is signed with a key that is valid on mainnet. The full log is in `scripts/.fork-test/fork-test.log`.

1. **Deploy.** `deploy-contracts.mjs --network local`: plan, then `--send --expect-nonce 4`.
   - The addresses equal the mainnet plan: registry `0x0CFF…2345`, factory `0xfFb9…0Ccf`, implementation `0x7F38…FfE6`.
   - Gas on anvil: 428,610 / 8,821,386 / 48,533. Anvil's estimates; the mainnet limits come from Monad's estimator, above.
2. **Smoke.** `smoke-mainnet.mjs --network local --cap 25`: all checks passed.
3. **Demo setup.**
   - The demo follower stand-in creates its MirrorAccount and deposits 10 AUSD (its Perpl account 5429).
   - `demo-setup.mjs` shows `[x] create`, `[x] deposit`, `[ ] follow`, and plans nothing for the leader or keepers.
   - `--leader-topup 0.3 --send`: approve (limit 59,006, used 50,958), then `depositCollateral` (simulated 81,381, limit 93,030, used 70,270).
4. **State left for the return.** The demo leader (ops) holds 1 lot of BTC long at 2x, filled against the forked book. An ops-owned MirrorAccount holds 10 AUSD.
5. **Return.** `return-funds-mainnet.mjs --network local --to <owner stand-in> --mon --send` sent five transactions, all `success`:
   - close BTC long: limit 228,083, used 163,581;
   - `withdrawCollateral(10.299431)`: limit 99,262, used 75,604;
   - MirrorAccount `withdraw(10.000000)` to its owner: limit 162,928, used 111,896;
   - AUSD transfer 30.385149 to the owner stand-in: limit 62,312, used 49,384;
   - MON transfer 186.870192, keeping 10 MON: limit 24,150, used 21,000.
6. **Checks, all PASS:**
   - demo leader flat, with 0.000000 free on Perpl;
   - ops-owned MirrorAccount emptied to its owner;
   - ops wallet AUSD 0;
   - owner stand-in received 30.385149 AUSD and the MON;
   - ops wallet MON 10.000227, at the reserve;
   - **demo follower MirrorAccount untouched** (Perpl 10.000000, net deposits 10.000000), and its owner untouched;
   - smoke passed again.
7. anvil was stopped by PID, and `contracts/deployments/local-31337.json` was removed.

## 8. After the return

Record every mainnet transaction from sections 2, 5 and 7 in `docs/funding-ledger.md`.

---

## Decisions taken without review

- **Deposit cap 25 AUSD per account (immutable).**
  - It is Perpl's 10.00 minimum plus room for one top-up or a re-deposit after losses.
  - The code is unaudited, so it caps what any one follower can lose to a bug at $25. With the ~10 external followers in `docs/funding.md`, that is about $250 at risk in the worst case.
  - It cannot be raised later. Raising it means a new factory, which can reuse the same KeeperRegistry; existing accounts keep 25. The roadmap already says "audit, then raise the deposit cap".
- **Keepers = the ops EOA only,** as on testnet. One key does every job, so no MON moves between team wallets and Monad's reserve rule never bites between them.
- **Fork tests use `--chain-id 31337`, not 143.**
  - The ops key signs real transactions on the fork (deploy, demo setup, return), at its real nonce 4.
  - With chain 143 those signed transactions would be valid on mainnet if they leaked.
  - `deploy-contracts.mjs` and `lib/ops.mjs` now refuse `--send` on a local RPC that reports chain 143. The engine's own `pnpm e2e:fork` signs only with anvil keys, so it is unaffected.
- **Dependent steps are sized with `eth_simulateV1` on Monad.** A step that needs an earlier step of the same run (approve, then deposit; close, then withdraw) cannot be estimated alone. The scripts binary-search the gas limit with Monad's `eth_simulateV1` and the earlier steps in front of it. Monad reports `gasUsed` = limit in `eth_simulateV1`, so the success or revert status is the signal. Every step is re-estimated with `eth_estimateGas` right before it is sent.
- **Funds return keeps 10 MON in the ops wallet by default** (Monad's reserve balance). Going lower needs `--engine-stopped`.
- **Funds return closes the demo leader's open positions by default.** Otherwise the "one command" could not withdraw the collateral behind them. The closes use IOC orders at most 100 bps worse than the mark; `--keep-positions` opts out.
- **The funds-return script refuses `--network testnet`.** Its `--to` sweep would take the 2,500 test AUSD tester pool. `demo-setup.mjs` runs on testnet with `--reserve-ausd 2500` as a guard.
- **`smoke-mainnet.mjs` compares runtime code byte for byte with `contracts/out`** (immutables masked). Build with the committed `foundry.toml` (`bytecode_hash = "none"`) before running it.
