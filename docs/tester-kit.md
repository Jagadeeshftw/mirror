# Tester kit (Monad testnet)

For the testnet round: 25 outside testers, 100 test AUSD each. Everything here is final except the fields in `{braces}`, which the deploy determines (see `docs/status/doc-updates-pending.md`). Testnet only: no real money is involved at any point, and test AUSD has no value.

## Invite (DM or post)

> I'm testing Mirror, a copy-trading app for Perpl on Monad: your own contract copies a trader for you, checks your limits on every order, and can never withdraw.
>
> Could you try it on Monad testnet for about 15 minutes and tell me what broke or confused you? I'll send you 100 test AUSD to trade with.
> - Android: {apk_url} (SHA-256 {apk_sha256}). Install steps: https://mirror.0xo.in/download
> - Laptop: https://mirror.0xo.in/app in Chrome
> - Steps and what to send back: {tester_kit_url}
>
> No real money is involved, and you never need MON for gas. You need a passkey: on Android, Google Password Manager with a screen lock; on a laptop, Chrome's passkey support.

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

## For me: running the round

- **Tester pool: 25 outside testers at 100 test AUSD each.** Perpl sent 2,500 test AUSD to the ops wallet on 7 Oct ([0x743e8690…ca4b02](https://testnet.monadvision.com/tx/0x743e86900d73d5e3fb4c13b6a316887a4bb85f135b344f8d38f8b9fd55ca4b02)). The ops wallet's first 200 stay with the team-run demo leader; the demo follower and the test user have their own 150 each. Send each tester 100 from the ops wallet to their Mirror owner address, only after the contracts are deployed, and log every send in docs/funding-ledger.md.
- Judges who ask (GitHub issue titled "test AUSD", per the judges guide) get 100 from the same pool; each counts as one of the 25.
- Gas for testers is paid by Mirror's relayer and keeper (the ops wallet's test MON), not by testers; watch its MON balance during the round.

### Before the first invite

- [x] Contracts deployed and verified on testnet (KeeperRegistry `0x394B12D4355bE5B54DBCaa989cf44F8966195E41`, MirrorAccountFactory `0xaD81567BF5ee4206Ef349E9CCe6719210f16bD39`, implementation `0x648e35cdfD4Aca744Ed33c69A0089A5621A76316`).
- [ ] Hosted testnet engine, relayer and indexer live (`scripts/railway-up.sh`); `/v1/config` reports chain 10143 and the factory above.
- [ ] Team-run demo leader's Perpl testnet account opened and the demo follower created; Run demo trade and Run blocked trade work once each.
- [ ] APK published with its SHA-256 on `/download`; web app live at `/app`.
- [ ] Ops wallet test MON topped up from the faucet: about 58.9 MON after the deploy, and the relayer and keeper pay every tester's gas.
- [ ] Walk steps 1-8 once yourself on an Android emulator and in Chrome.

### Sending test AUSD

- One transfer of exactly 100.000000 test AUSD (`0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC`, 6 decimals) per tester, to the address they send from step 3. Gas limit from Monad's `eth_estimateGas` plus a margin, as for every other ops transaction.
- Log each send in `docs/funding-ledger.md` (date, amount, tester's address, tx). Never record names next to addresses.
- At most 25 sends of 100 (2,500 in total).

### During the round

- Track testers in the stats page's tester view (by account address), never by name.
- Team-run accounts are excluded from traction numbers.
- Triage within a day. Fix, rebuild, and post what changed in the thread.
