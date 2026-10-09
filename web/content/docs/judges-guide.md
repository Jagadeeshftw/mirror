---
title: Judges guide
description: What you can verify today, what is deployed on Monad testnet, and the app path on Mirror's hosted testnet service.
---

This page mirrors the judge access instructions in the Metropolis submission. It is updated with real links and transaction hashes as each piece goes live, and it says "pending" for anything that is not live yet.

## Status (9 Oct 2026)

- **Contracts on Monad testnet (chain 10143):** deployed on 7 Oct 2026 at 21:56 UTC (block 69,083,005) and verified on [Sourcify](https://repo.sourcify.dev/10143/0xaD81567BF5ee4206Ef349E9CCe6719210f16bD39). Addresses below and on [Contracts](/docs/contracts).
- **Mirror's fee is in that deployment:** Perpl builder 26, 0.02% of opening size only, confirmed by Perpl on 7 Oct 2026. No revenue yet: on testnet it has only been charged in test AUSD (for example 0.000166 test AUSD on a copied open), which is test funds.
- **Hosted copy engine, relayer and indexer:** live on Railway since 9 Oct 2026. The engine answers at [engine-production-0fd2.up.railway.app/v1/health](https://engine-production-0fd2.up.railway.app/v1/health); the indexers' read-only GraphQL is public ([testnet](https://hasura-testnet-production.up.railway.app/v1/graphql), [mainnet](https://hasura-mainnet-production.up.railway.app/v1/graphql)) and still catching up on history. If the service is ever unreachable, the app reads balances and the demo account from Monad and says so.
- **Web app and Android APK:** live since 8 Oct 2026. The web app is at [/app](/app) (testnet build). The APK is Mirror 1.0.2 (testnet beta) on [/download](/download), GitHub Release `v1.0.2-testnet`, SHA-256 `713b904fe2d548ae542a40e06c83a69697a13ee9928a5f67440da33c667ea566`, for Android 14 or newer with Google Password Manager. Both work against the hosted service: accounts, permit deposits, follows and the demo trades.
- **Public testnet, end to end, against the hosted service (9 Oct 2026):** 16 of 16 steps on Android emulators against Mirror's testnet contracts and Perpl testnet: a demo trade from an account with no funds, copied with builder 26 charged ([tx](https://testnet.monadvision.com/tx/0xfd60066f5cb2613ef657c0026781783b784ccb38dbf3cf5a04d1e66777c93110)) and its close with no fee ([tx](https://testnet.monadvision.com/tx/0xdad63b1568311e1251c6d811ea4ba2fd96780160821957cae03ef249481bcb7e)); a follower's copy after a permit deposit, with its Firebase alert ([tx](https://testnet.monadvision.com/tx/0x297284a6b1f2259ee4a927d40643ae349fde14ed528d721bb9032c6ca1f6fb7b)); stop following with the position kept ([tx](https://testnet.monadvision.com/tx/0xb08c19d6a072c7d3ebb465bc111051217038f97a4ad2666d140a640136c558b0)); close all, withdraw; and a 10x copy blocked by a 2x rule ([tx](https://testnet.monadvision.com/tx/0x464e326f240fe3392dba0ab92968fa4632cb9e8e7637523a9b1c6a933e97a57e)). The live web app passed the same flows except withdraw and Web Push, which wait on a rerun. Every step and transaction: `devices/evidence/stage-b-hosted/README.md` in the repository (the 8 Oct run from the developer's machine: `devices/evidence/stage-b/README.md`).
- **Monad mainnet:** Mirror's contracts are **not deployed**. The team-run demo leader exists there as Perpl account 5416 (10.00 AUSD, no trades).
- **Users:** none yet. The testnet tester round (25 outside testers, 100 test AUSD each, from Perpl) is next; no invites have gone out yet.
- **Devices:** Mirror has been tested on Android emulators and in Chrome; the site's pages were also checked in Safari.

## Deployed on Monad testnet

| Contract | Address |
|---|---|
| KeeperRegistry | `0x394B12D4355bE5B54DBCaa989cf44F8966195E41` |
| MirrorAccountFactory | `0xaD81567BF5ee4206Ef349E9CCe6719210f16bD39` |
| MirrorAccount implementation | `0x648e35cdfD4Aca744Ed33c69A0089A5621A76316` |
| Keeper (ops wallet) | `0x299E77E58DD37607e4890C761924D829F8ACe82C` |
| Perpl testnet Exchange (third party) | `0x1964C32f0bE608E7D29302AFF5E61268E72080cc` |
| Test AUSD (third party) | `0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC` |

Deposits on testnet are capped at 200 test AUSD per account (`depositCap` in `contracts/deployments/10143.json`). The three deployment transactions are listed there and in `docs/funding-ledger.md`.

## What you can verify today

You need a computer with [Foundry](https://getfoundry.sh) and Node.

1. Clone the repository:

   ```bash
   git clone --recursive https://github.com/Jagadeeshftw/mirror && cd mirror
   ```

2. Run the contract tests: 158 tests (unit, fuzz at 1,000 runs, 12 invariants). The 6 fork tests return early without the next step.

   ```bash
   cd contracts && forge test
   ```

3. Run the fork tests against the live Perpl Exchange and AUSD on Monad mainnet:

   ```bash
   MONAD_RPC_URL=https://rpc.monad.xyz forge test --mc PerplMainnetFork -vv
   ```

   They run a gasless deposit, a blocked copy, a real fill on Perpl's live order book, a keeper withdrawal that reverts, a signed close-all, a follow with match now and an owner withdrawal. `test_fork_newRulesAgainstLivePerpl` shows the entry filter blocking a copy of a leader far in profit and a stranger executing a reached take-profit; `test_fork_builderFeeOnLivePerpl` shows builder 26 charged on a copied open, equal to Mirror's proof, and nothing on the close; `test_fork_detachAgainstLivePerpl` shows a detached leader's exit refused while the follower keeps the position.

4. Compare the verified testnet source with `contracts/src` on Sourcify, one link per address: `https://repo.sourcify.dev/10143/<address>`.

5. Run the whole stack on a local network that runs Perpl's real exchange code (needs anvil):

   ```bash
   cd contracts && forge build && cd ../scripts && npm install && cd ../localnet
   npm install && npm run fetch && ./run-stage-a.sh --all
   ```

   Expected: the API run passes 29 of 29 and the web app run 64 of 64, with one optional check skipped (restoring the passkey in a second browser, which Chrome's virtual authenticator does not support). The Android run, `devices/run-stage-a-android.sh`, passes 34 of 34 on two Android emulators signed in to the same Google account, with real Google passkeys.

6. Optional: unit tests of the engine (227), indexer (44), app (252) and site (25), Slither ([static analysis](https://github.com/Jagadeeshftw/mirror/blob/main/docs/security/static-analysis.md): 137 findings, each fixed or explained), and the deployment plan. Commands are on [Run the tests](/docs/run-the-tests).

## The app on testnet

These steps run against Mirror's hosted testnet service, live since 9 Oct 2026.

**What you need:** an Android phone with Google Play services, signed in to a Google account, with a screen lock; or a desktop browser with passkey support. No wallet, no seed phrase, no MON.

1. Open [/download](/download) on Android for the APK, or [/app](/app) in a browser.
2. Tap **Create account** and approve the single passkey prompt. That passkey is your account.
3. Home starts in watch mode with the team-run demo follower, labelled **Team-run**. Tap **Run demo trade**: the team-run demo leader trades on Perpl testnet, and the copy appears with the leader's fill, the copy's fill, the deviation, the latency, the Mirror fee and two transaction links. Tap **Run blocked trade**: the leader opens above the follower's max leverage, and the feed shows **Not copied** with the rule, the numbers and its own transaction. Both buttons are rate-limited, and demo positions are closed again automatically.
4. Open **Leaders**, pick one and tap **Follow**. Set limits, tap **See what if** (a simulation, labelled as one), then **Review**: the fee line reads "Mirror fee: 0.02% of opening size (builder 26)".
5. Optional, with test AUSD: Perpl's testnet minimum to open an account is 100 test AUSD. To get it, open an issue titled "test AUSD" at github.com/Jagadeeshftw/mirror/issues with your Mirror address (Add funds shows it); we send 100 test AUSD from the tester pool Perpl funded. Deposit from **Add funds** (gasless permit), follow with **Match the leader now** on, and approve with one passkey prompt.
6. On a position, **Edit levels** sets a stop-loss or take-profit onchain, executable by anyone once reached. On the leader, **Stop following, keep my positions** makes your contract refuse that leader's copies while your stops and closes still work.
7. **Close all positions** and **Withdraw**: gasless, and always to you.
8. Optional: on a second device signed in to the same Google account, tap **I already have an account**. The same address comes back.

Team-run accounts are labelled and excluded from every count ([Team-run accounts](/docs/team-run-accounts)). Testnet tokens have no value. Live counts and every executed copy are on the [public stats page](/stats), from the hosted engine.
