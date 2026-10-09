# Try Mirror yourself (Monad testnet)

Link: **https://mirror.0xo.in/app** (testnet; test funds only). Android: the APK on https://mirror.0xo.in/download.

Steps 3-8 (the demo runs, creating an onchain account, following) use Mirror's hosted testnet service, live since 9 Oct 2026. If it is ever unreachable, steps 1-2 still work and the rest say "Can't reach Mirror's service" before any passkey prompt. Safari on iPhone has not been through Mirror's automated passkey tests yet (they run in Chrome and on Android emulators), so tell me exactly where anything differs.

## iPhone, Safari (iOS 18 or newer, iCloud Keychain on)

1. Open **https://mirror.0xo.in/app** in Safari. Optional: Share → **Add to Home Screen**, then open it from the icon.
2. **Watch mode.** On the welcome screen tap **Watch real copies**: the team-run demo account (labelled Team-run) and its latest copies, each with a MonadVision link. With the engine down it says the copies are read straight from Monad.
3. **Create an account.** Back, then **Create account**. Approve the Face ID passkey prompt (saved to iCloud Keychain). Expect Home with 0.00 and no seed phrase.
4. **Demo trade.** On Home, tap **Run demo trade**. Expect the leader's trade, then the copy about a second later; tap the copy: leader fill, your fill, difference in bps, latency, both transactions, and "Mirror fee … (builder 26)" on the open.
5. **Blocked trade.** Tap **Run blocked trade**. Expect a "Not copied" card; tap it: the rule (max leverage), the limit and the actual value.
6. **Get test AUSD.** Tap **Add funds**, copy your address and send it to me. I send 100 test AUSD from the tester pool after you say so (or run `node scripts/send-test-ausd.mjs --network testnet --to <address>` yourself, plan first). Expect 100.00 in the balance chip.
7. **Follow with match-now.** **Leaders** → the demo leader (Perpl #1000) → **Follow** → allocate 100 → keep **Match the leader now** on → **See what if** → **Review** (read the fee line) → **Approve with passkey**. Expect **Following** (or **Matched** if the leader has a position open; run a demo trade first to give it one).
8. **Stop following.** On the leader's profile, **Stop following** → **Stop following, keep my positions** → approve. Expect **Stopped, positions kept**. Then Positions → **Close all**, and **Withdraw** → **Max** → **Confirm** to get the test AUSD back.

## Laptop, Chrome

1. Open **https://mirror.0xo.in/app** (the laptop layout, with a sidebar).
2. **Watch mode:** **Watch real copies** on the welcome screen, as on the phone.
3. **Create account:** save the passkey in Google Password Manager. Chrome may also offer **Use a phone or tablet** (QR code); that path has not been tested with Mirror's key derivation yet, so if you try it, tell me what happens.
4. **Run demo trade** and 5. **Run blocked trade** from the watch panel; click a copy or the blocked card for its detail.
6. Send me the address from **Add funds** for 100 test AUSD.
7. **Leaders** → Perpl #1000 → **Follow**: the what-if sits next to the limits; **Review** → passkey.
8. **Stop following, keep my positions** from the leader panel, then close and withdraw.

What to tell me: device, browser and OS version; the step number where something broke or surprised you; a screenshot if you can.
