# Agora: Best Mobile Trading App on Monad

Track lock: 01 Onchain Finance & Trading. Single winner, $10,000.

Requirement text **(secondhand)**: "Build a mobile app authenticating via Mera, holding an AUSD balance, and executing
trades through Perpl." Excerpts: must "authenticate users via Mera", "hold and display a stablecoin balance in AUSD",
"execute trades through Perpl"; demo must show "placing at least one trade on Perpl"; judged on "creative use of the
three integrations together".

| # | Requirement | Evidence | Status |
|---|---|---|---|
| 1 | Mobile application | Android app 1.0.0 (Expo / React Native), `app/`; Stage A 34/34 on Android emulators (`devices/e2e/flows/stage-a.flow`, `stage-a-g2.flow`). Testnet APK on `https://mirror.0xo.in/download`: being published | built; public APK pending |
| 2 | Users authenticate via Mera (no other login) | `@category-labs/mera` PRF passkey (`app/src/lib/derive.ts`, `wallet.ts`); no Privy/Dynamic in deps; Stage A step 01 (one prompt) and step 18 (restore on the second emulator) | done (emulators) |
| 3 | Holds and displays an AUSD balance | Balance chip in the app bar on every main screen (`home.balance.ausd`); Stage A step 08 checks it | done (emulators) |
| 4 | Executes trades through Perpl | MirrorAccount orders on Perpl's Exchange: fork-tested against mainnet (`contracts/test/fork/PerplMainnetFork.t.sol`), Stage A on Perpl's real exchange code (match now, copies, close all). Testnet contracts deployed 7 Oct 2026 21:56 UTC (`contracts/deployments/10143.json`); testnet tx hashes need the hosted engine | done (fork, localnet); testnet trades pending |
| 5 | Demo shows at least one Perpl trade | Video 3 in `docs/storyboards.md` (final shot list); timestamp + tx link once recorded | storyboard final; not recorded |
| 6 | Creative use of the three together | Copy trading: passkey owner, AUSD collateral, leader fills on Perpl mirrored under onchain rules; answer in `docs/submission/fields/11-bounties.md` | written |

## Asked for at submission (official, from the bounty page, read 6 Oct 2026)

- Describe the core features of your trading app.
- Submit a demo video (up to 2 mins) showing a user logging in via passkey, funding or viewing an AUSD balance, and placing at least one trade on Perpl in your app

Answers: `docs/submission.md` (source `docs/submission/fields/11-bounties.md`).
