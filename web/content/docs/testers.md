---
title: Testers
description: Try Mirror on Monad testnet in about 15 minutes, and what to send back.
---

Thanks for trying Mirror. Everything here is on **Monad testnet**: no real money is involved, test AUSD has no value, and you never need MON for gas. Ask for 100 test AUSD when you reach step 3.

## What you need

- **Android:** a phone with Google Play services, signed in to a Google account, with a screen lock (PIN, pattern, fingerprint or face). The APK installs from the browser, outside the Play Store. Mirror's own testing so far has been on Android 15 emulators, so tell me your Android version.
- **Laptop:** Chrome with passkeys (Google Password Manager or a security key). The web app has been tested in Chrome only; other browsers are welcome, just say which one you used.
- Nothing else: no wallet, no seed phrase, no MON.

## Steps (about 15 minutes)

1. **Create an account.** Open the app and tap **Create account**. Approve the one passkey prompt.
   - Expect: Home, with your balance at 0.00 and no seed phrase.
2. **Watch before you deposit.** Home shows the team-run demo account, labelled **Team-run**. Tap **Run demo trade**, then **Run blocked trade**.
   - Expect: a copy shortly after the leader's trade, with the leader's fill, the copy's fill and the Mirror fee; then a blocked one with the rule and the numbers. Each has a MonadVision link. The buttons are rate-limited, so if one says to wait, wait.
3. **Send me your address.** Tap **Add funds** and copy the address shown (or Account → copy address). Send it to me; I send you 100 test AUSD.
   - Expect: 100.00 in the balance chip at the top within a minute of my send.
4. **Look at a leader.** Open **Leaders**, pick one, tap **Follow**. Set your limits (leverage, size ratio, entry filter, markets), then tap **See what if**.
   - Expect: a result labelled **Simulation**, with copied and blocked trades under your limits.
5. **Follow.** Allocate all 100 test AUSD (Perpl's testnet minimum to open an account is 100), keep **Match the leader now** on, tap **Review**. Read the fee line ("Mirror fee: 0.02% of opening size (builder 26)"), then **Approve with passkey**.
   - Expect: one passkey prompt, then **Following** or **Matched**. With match now, your account opens a position matching the leader at your ratio, if the leader has one open.
6. **Set a stop.** Open the position (Positions), tap **Edit levels**, set a stop-loss and a take-profit, save with your passkey.
   - Expect: the levels marked as onchain, executable by anyone once reached.
7. **Stop following.** On the leader's profile, tap **Stop following** and choose **Stop following, keep my positions**.
   - Expect: the leader shows **Stopped, positions kept**. If the leader trades again, your feed shows the copy refused by your own contract. Your stop-loss and take-profit still work.
8. **Leave.** Positions → **Close all positions**, then **Withdraw** → **Max** → **Continue** → **Confirm with passkey**.
   - Expect: **Confirmed**, and the test AUSD back in your wallet. You never needed MON.
9. **Optional: restore.** On a second device signed in to the same Google account, tap **I already have an account**.
   - Expect: the same address and balances.

## What to send back

Reply in the thread or by DM with any of these:

- Device and browser, with the Android version (for example "Pixel 8, Android 15" or "MacBook, Chrome 141").
- Where you got stuck, and the screen it happened on (a screenshot helps).
- Anything that surprised you: wording, numbers that looked wrong, waits.
- Whether you'd trust it with real money, and what would change your mind.
- Your Mirror address (from step 3), so I can find your transactions.

Please don't send passkeys, recovery phrases or private keys. Mirror never asks for them.

## Known limits

- Testnet only. Deposits are capped at 200 test AUSD per account, and Perpl's testnet minimum to open an account is 100.
- Mirror's contracts are unaudited.
- Testnet leaders trade less than mainnet ones, so a copy may take a while; Run demo trade makes one happen on demand.
- If Mirror's testnet service is down, the app says so; balances and the demo account's copies are still read from Monad, and your stops can still be executed onchain.
