---
title: Judges guide
description: How to verify Mirror today, and the phone path once the app and mainnet contracts ship.
---

This page mirrors the judge access instructions in the Metropolis submission and is updated with real links, addresses and transaction hashes as they ship.

## Status right now (6 Oct 2026)

Not yet usable on a phone. The Android app, copy engine and indexer are being built, and the contracts are not deployed on mainnet yet. The steps marked **pending** describe the judge path once those ship.

## What you can verify today

You need a computer with [Foundry](https://getfoundry.sh).

1. Clone the repository:

   ```bash
   git clone https://github.com/Jagadeeshftw/mirror && cd mirror
   ```

2. Run the test suite (87 tests; the 3 fork tests need the next step):

   ```bash
   git submodule update --init --recursive && cd contracts && forge test
   ```

3. Run the fork tests against the live Perpl Exchange and AUSD on Monad mainnet:

   ```bash
   MONAD_RPC_URL=https://rpc.monad.xyz forge test --mc PerplMainnetFork -vv
   ```

   This runs a gasless deposit, a blocked copy, a real fill on Perpl's live order book, a keeper withdrawal that reverts, a signed close-all, a follow with match now and an owner withdrawal, all against a fork of mainnet state.

## What you need for the phone path (pending)

- An Android 9+ phone signed in to a Google account, with a screen lock set. Passkeys are stored in Google Password Manager, which is on by default.
- Nothing else: no wallet, no seed phrase, no MON, no AUSD.
- Works in the US and UK. The app reads through Mirror's own backend and indexer and talks to Monad contracts directly, so Perpl's API geo-block does not apply.

## Steps (pending)

1. On the phone, open [mirror.0xo.in](/) and tap **Download for Android**. Allow installs from this source when Android asks, then open the app.
2. Tap **Create account** and approve the single fingerprint, face or PIN prompt. That passkey is your account. No test login is needed, because the passkey is created on your own phone.
3. Home shows your AUSD balance. A new account has 0.00 AUSD.
4. Open **Leaders**: live Perpl traders ranked from onchain data. Open any profile to see the due-diligence card.
5. Open **Demo**. This is the team-run demo follower, a real MirrorAccount on Monad mainnet that follows the team-run demo leader. Both are run by the Mirror team and are excluded from all user and traction counts. You see its balance, positions and live copy feed.
6. Tap **Run demo trade**. The demo leader opens a 1-lot BTC position on Perpl mainnet. Within about a second the demo follower's copy appears in the feed, with its latency and a MonadVision tx link. Tap **Run blocked trade**: the demo leader opens at a leverage above the follower's limit, and the feed shows "Blocked by your rule" with its own tx link. Both buttons are rate-limited, and the demo positions are closed again automatically.
7. Optional, with your own funds: send at least 10 AUSD on Monad to the address on Home, follow a leader from the follow sheet with **Match the leader now** on (the default) and approve with your passkey. A Perpl order for your account is placed at once, shown with its expected size, price and slippage bound before you approve; later copies then land in your own account. Withdraw at any time from Account: gasless, and always to you.
8. Optional restore test: install the APK on a second phone signed in to the same Google account, tap **Restore** and pick the passkey. The same account and balances appear.

## What is on mainnet (pending)

- MirrorAccountFactory, the MirrorAccount implementation and KeeperRegistry, all verified on MonadVision. Addresses will be on [Contracts](/docs/contracts).
- The team-run demo leader account and demo follower MirrorAccount. See [Team-run accounts](/docs/team-run-accounts).
- Perpl Exchange `0x34B6552d57a35a1D042CcAe1951BD1C370112a6F` and AUSD `0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a` (third party, already live).

Everything the app shows is real Monad mainnet state. There is no testnet or simulated mode. Live counts and every executed copy are on the [public stats page](/stats).
