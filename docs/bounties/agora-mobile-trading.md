# Agora: Best Mobile Trading App on Monad

Track lock: 01 Onchain Finance & Trading. Single winner, $10,000.

Requirement text **(secondhand)**: "Build a mobile app authenticating via Mera, holding an AUSD balance, and executing
trades through Perpl." Excerpts: must "authenticate users via Mera", "hold and display a stablecoin balance in AUSD",
"execute trades through Perpl"; demo must show "placing at least one trade on Perpl"; judged on "creative use of the
three integrations together".

| # | Requirement | Evidence | Status |
|---|---|---|---|
| 1 | Mobile application | Android app 1.0.2 (Expo / React Native), `app/`; Stage A 34/34 on Android emulators (`devices/e2e/flows/stage-a.flow`, `stage-a-g2.flow`); Stage B on Android emulators against public testnet: 11/11 with the engine on the developer's machine (`devices/evidence/stage-b/README.md`), 16/16 against the hosted engine (`devices/evidence/stage-b-hosted/README.md`). Testnet APK 1.0.2 on `https://mirror.0xo.in/download` (GitHub Release `v1.0.2-testnet`, SHA-256 `713b904fe2d548ae542a40e06c83a69697a13ee9928a5f67440da33c667ea566`) | done: public testnet APK since 8 Oct 2026 |
| 2 | Users authenticate via Mera (no other login) | `@category-labs/mera` PRF passkey (`app/src/lib/derive.ts`, `wallet.ts`); no Privy/Dynamic in deps; Stage A step 01 (one prompt) and step 18 (restore on the second emulator) | done (emulators) |
| 3 | Holds and displays an AUSD balance | Balance chip in the app bar on every main screen (`home.balance.ausd`); Stage A step 08 checks it | done (emulators) |
| 4 | Executes trades through Perpl | MirrorAccount orders on Perpl's Exchange: fork-tested against mainnet (`contracts/test/fork/PerplMainnetFork.t.sol`), Stage A on Perpl's real exchange code (match now, copies, close all). Testnet contracts deployed 7 Oct 2026 21:56 UTC (`contracts/deployments/10143.json`); on public testnet, with the engine run on the developer's machine: copy of a Perpl testnet open [0xc14c…aa9b](https://testnet.monadvision.com/tx/0xc14cd15a3d3243263fc3b43cd2b7d1ae349c407622bf7479dc788ef7c873aa9b), follow with match now [0x5a4e…9061](https://testnet.monadvision.com/tx/0x5a4e3210c01f5d5c3fa495b442cf742de147e477e3f3b5576f711d2963ee9061), close all [0x8038…6890](https://testnet.monadvision.com/tx/0x80380b957f82139fdd0adff853114bd8f5f8e451fba7eae30cbaefc7cb2e6890); from the hosted engine, 9 Oct 2026: a follower's copy of a Perpl testnet open [0x2972…fb7b](https://testnet.monadvision.com/tx/0x297284a6b1f2259ee4a927d40643ae349fde14ed528d721bb9032c6ca1f6fb7b), close all [0xf8b2…98bb](https://testnet.monadvision.com/tx/0xf8b251d53d9cdea821149ce0836603a6ac816e677fe890c4e22c42f75c4d98bb), withdraw [0xb6a8…8373](https://testnet.monadvision.com/tx/0xb6a8713e0c7c297f94f7f1270e70f83f99a62c07b83e12309bf3d703f7118373) (`devices/evidence/stage-b-hosted/README.md`) | done (fork, localnet, public testnet, hosted engine) |
| 5 | Demo shows at least one Perpl trade | Video 3 in `docs/storyboards.md` (final shot list); timestamp + tx link once recorded | storyboard final; not recorded |
| 6 | Creative use of the three together | Copy trading: passkey owner, AUSD collateral, leader fills on Perpl mirrored under onchain rules; answer in `docs/submission/fields/11-bounties.md` | written |

## Asked for at submission (official, from the bounty page, read 6 Oct 2026)

- Describe the core features of your trading app.
- Submit a demo video (up to 2 mins) showing a user logging in via passkey, funding or viewing an AUSD balance, and placing at least one trade on Perpl in your app

Answers: `docs/submission.md` (source `docs/submission/fields/11-bounties.md`).
