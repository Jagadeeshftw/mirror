# Tester kit (Monad testnet)

Ready to send once stage B passes. The fields in `{braces}` are filled in on the day from the live deployment. Testnet only: no real money is involved at any point.

## Invite (DM or post)

> I'm testing Mirror, a copy-trading app for Perpl on Monad: your own contract copies a trader for you and checks your limits on every order, and it can never withdraw.
>
> Could you try it on testnet for 10 minutes and tell me what broke or confused you?
> - Android: {apk_url} (SHA-256 {apk_sha256})
> - iPhone or laptop: {web_url}
> - Steps and what to send back: {tester_kit_url}
>
> No real money is involved. You'll need a phone or laptop with a passkey (Google Password Manager, iCloud Keychain or a security key).

## Steps (about 10 minutes)

1. **Create an account.** Open the app and tap Create account. Approve the one passkey prompt.
   - Expect: an address on Home, and no seed phrase.
2. **Watch before you deposit.** On Home, watch copies land on the team-run demo follower. Tap "Run demo trade", then "Run blocked trade".
   - Expect: a copy about a second after the leader's trade, and a blocked one with the rule and the numbers. Each has a MonadVision link.
3. **Get test AUSD.** Tap "Get test AUSD" ({faucet_note}: testnet AUSD cannot be minted by Mirror; it comes from a pool Perpl funds).
   - Expect: a balance in the header.
4. **Look back.** Open a leader and set your limits. Read "What if I had followed".
   - Expect: a simulation labelled as one, with copied vs blocked trades.
5. **Follow.** Deposit 120 AUSD (the testnet minimum to open a Perpl account is 100), then Follow with match now.
   - Expect: your account opens a position matching the leader at your ratio.
6. **Set a stop.** On the position, set a stop-loss and a take-profit. Approve the passkey prompt.
   - Expect: the levels show as onchain.
7. **Leave.** Tap "Stop following, keep my positions" or "Stop and close". Then withdraw.
   - Expect: AUSD back in your wallet. You never needed MON.

## What to send back

Reply in the thread or by DM with any of these:

- Device and browser (e.g. Pixel 8 / Android 15, iPhone 15 / Safari, MacBook / Chrome).
- Where you got stuck, and the screen it happened on (a screenshot helps).
- Anything that surprised you: wording, numbers that looked wrong, waits.
- Whether you'd trust it with real money, and what would change your mind.
- Optional: your Mirror account address (Settings → Account), so I can find your transactions.

Please don't send passkeys, recovery codes or private keys. Mirror never asks for them.

## For me: running the round

- Track testers in the stats page's tester view (by account address), never by name.
- Team-run accounts are excluded from traction numbers.
- Triage within a day. Fix, rebuild, and post what changed in the thread.
