---
title: Quickstart
description: Install the APK, create your account, fund it and follow a leader with match now.
---

This is the path from install to your first copied trade. It takes about three minutes.

> The Android app and the mainnet contracts are not released yet. The steps below describe the beta as it ships; [Download](/download) shows when the APK is available.

## What you need

- An Android 9+ phone signed in to a Google account, with a screen lock set. Passkeys are stored in Google Password Manager, which is on by default.
- 10 to 25 AUSD on Monad to fund your account. 10 AUSD is Perpl's minimum to open an account; 25 AUSD is the beta deposit cap.
- Nothing else: no wallet app, no seed phrase, no MON for gas.

## 1. Install the APK

1. On your phone, open [mirror.0xo.in/download](/download) and tap **Download for Android**.
2. Open the downloaded file. Android asks whether to allow installs from this source (your browser): tap **Settings**, turn on **Allow from this source**, then go back and tap **Install**.
3. Open Mirror.

## 2. Create your account

Tap **Create account** and approve the single fingerprint, face or PIN prompt. That passkey is your account. It owns your MirrorAccount and signs every owner action. It restores on a new phone signed in to the same Google account: tap **Restore** and pick the passkey.

Your MirrorAccount's address is known before it is deployed (it is a deterministic clone), so you can fund it straight away.

## 3. Fund it

Home shows your AUSD balance, which is always visible at the top of every main screen.

1. Send at least 10 AUSD on Monad to the address shown on Home.
2. Approve the deposit with your passkey. The deposit is a signed AUSD permit; the relayer submits it and pays the gas. The first deposit also opens your account's own Perpl account.

## 4. Follow a leader, with match now

1. Open **Leaders**. Traders are ranked from onchain Perpl data: PnL, drawdown, win rate and consistency.
2. Open a profile to read the due-diligence card: equity curve, open positions, recent trades and risk flags.
3. Tap **Follow**. The follow sheet suggests defaults from the leader's history. Every field is in the [Policy reference](/docs/policy-reference).
4. Leave **Match the leader now** on (the default). Before you approve, the sheet shows the order it will place for each market where the leader already holds a position: expected size, price and the slippage bound.
5. Approve with your passkey.

One relayed transaction then sets your policy, resumes copying and places the matching orders. Each match order goes through exactly the same checks as a keeper copy. From then on, every time the leader trades, the copy lands in your account with its latency and a MonadVision link.

## 5. Stay in control

- **Pause** stops new copies. Reducing positions is still allowed.
- **Stop following, keep my positions** stops every copy from one leader, opens and closes, and leaves its positions open. Your own contract enforces it. Follow the leader again to resume.
- **Close all** pauses and closes every open position with bounded slippage.
- **Withdraw** sends AUSD back to you. It is gasless and always goes to the owner.

All four are signed with your passkey and relayed, so they work even if you hold no MON.
