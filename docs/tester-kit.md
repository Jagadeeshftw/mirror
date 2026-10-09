# Tester kit (Monad testnet)

For the testnet round: 25 outside testers, 100 test AUSD each. The steps are published for testers at https://mirror.0xo.in/docs/testers (generated from this file's sections). Testnet only: no real money is involved at any point, and test AUSD has no value.

## Invite (DM or post)

> I'm testing Mirror, a copy-trading app for Perpl on Monad: your own contract copies a trader for you, checks your limits on every order, and can never withdraw.
>
> Could you try it on Monad testnet for about 15 minutes and tell me what broke or confused you? I'll send you 100 test AUSD to trade with.
> - Android: https://github.com/Jagadeeshftw/mirror/releases/download/v1.0.2-testnet/mirror-1.0.2-testnet.apk (Mirror 1.0.2, SHA-256 713b904fe2d548ae542a40e06c83a69697a13ee9928a5f67440da33c667ea566; Android 14 or newer). Install steps: https://mirror.0xo.in/download
> - Laptop: https://mirror.0xo.in/app in Chrome
> - Steps and what to send back: https://mirror.0xo.in/docs/testers
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
- **Sending a tester their 100 test AUSD** (only after the owner says go and gives the addresses):
  1. Plan, which sends nothing: `cd scripts && node send-test-ausd.mjs --network testnet --to <address> [--to <address> ...]`. Check the plan: one `AUSD.transfer` per address, 100 each, and the pool left over.
  2. Send, with the nonce the plan printed: `node send-test-ausd.mjs --network testnet --to <address> ... --send --expect-nonce <n>`.
  3. Paste the printed ledger rows into `docs/funding-ledger.md`, and tell the tester to look for 100.00 in the balance chip.
  The script refuses any network but testnet, duplicate addresses, and a send that would overdraw the pool (`--keep <AUSD>` sets a floor).
- **Gas budget (test MON, from the gas limits Monad charged in the Stage B runs, at 102 gwei):** per tester about 0.87 MON, made up of create 200,421 + permit deposit 516,436 + follow with match-now about 1.02M + levels about 0.2M + stop following 116,884 + close all 507,549 + withdraw 275,999 + about 10 copies at about 566k + the 100 test AUSD send 64,228 = about 8.5M gas. **25 testers: about 22 MON.** Each Run demo trade costs about 0.17 MON (leader open and close plus the demo follower's copies); the engine caps demos at 48 a day, at most about 8 MON a day. The ops wallet holds 61.13 MON (9 Oct, after the hosted end-to-end runs), enough for the round plus a few days of demos at the cap.
- Gas for testers is paid by Mirror's relayer and keeper (the ops wallet's test MON), not by testers; watch its MON balance during the round.

### Before the first invite

- [x] Contracts deployed and verified on testnet (KeeperRegistry `0x394B12D4355bE5B54DBCaa989cf44F8966195E41`, MirrorAccountFactory `0xaD81567BF5ee4206Ef349E9CCe6719210f16bD39`, implementation `0x648e35cdfD4Aca744Ed33c69A0089A5621A76316`).
- [x] Hosted testnet engine, relayer and indexer live (`scripts/railway-up.sh`); `/v1/config` reports chain 10143 and the factory above (9 Oct 2026; the indexers are still catching up on history).
- [x] Team-run demo leader's Perpl testnet account opened (account 1000, 200 test AUSD) and the demo follower created (`0x634BFE3c2E4c483e8F7F4f3F3b6B2B7383A74896`, 150 test AUSD, following 1000), 8 Oct 2026.
- [x] Run demo trade and Run blocked trade work once each (9 Oct 2026, hosted engine, on an Android emulator and in Chrome; `devices/evidence/stage-b-hosted/README.md`).
- [x] APK published with its SHA-256 on `/download` (1.0.2, GitHub Release `v1.0.2-testnet`, 9 Oct 2026); web app live at `/app` (8 Oct 2026).
- [x] Ops wallet test MON enough for the round: 61.13 MON on 9 Oct against about 22 MON for 25 testers; the relayer and keeper pay every tester's gas.
- [ ] Walk steps 1-8 once yourself on an Android emulator and in Chrome. Done against the hosted engine on 9 Oct except step 6 (stop-loss and take-profit levels, not part of those runs) and, in Chrome, step 8's withdraw (`devices/evidence/stage-b-hosted/README.md`).

### Sending test AUSD

- One transfer of exactly 100.000000 test AUSD (`0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC`, 6 decimals) per tester, to the address they send from step 3. Gas limit from Monad's `eth_estimateGas` plus a margin, as for every other ops transaction.
- Log each send in `docs/funding-ledger.md` (date, amount, tester's address, tx). Never record names next to addresses.
- At most 25 sends of 100 (2,500 in total).

### During the round

- Track testers in the stats page's tester view (by account address), never by name.
- Team-run accounts are excluded from traction numbers.
- Triage within a day. Fix, rebuild, and post what changed in the thread.
