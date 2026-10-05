# Agora: Best Mobile Trading App on Monad

Track lock: 01 Onchain Finance & Trading. Single winner, $10,000.

Requirement text **(secondhand)**: "Build a mobile app authenticating via Mera, holding an AUSD balance, and executing
trades through Perpl." Excerpts: must "authenticate users via Mera", "hold and display a stablecoin balance in AUSD",
"execute trades through Perpl"; demo must show "placing at least one trade on Perpl"; judged on "creative use of the
three integrations together".

| # | Requirement | Evidence | Status |
|---|---|---|---|
| 1 | Mobile application | Android APK (Expo / React Native), public download link | todo |
| 2 | Users authenticate via Mera (no other login) | `@category-labs/mera` PRF passkey; no Privy/Dynamic in deps | todo |
| 3 | Holds and displays an AUSD balance | Persistent AUSD balance header on every main screen | todo |
| 4 | Executes trades through Perpl | MirrorAccount `execOrder` on Perpl Exchange `0x34B6…2a6F`; mainnet tx hashes | in progress (fork-tested: `contracts/test/fork/PerplMainnetFork.t.sol`) |
| 5 | Demo shows at least one Perpl trade | Demo video timestamp + tx link | todo |
| 6 | Creative use of the three together | Copy trading: passkey owner, AUSD collateral, leader fills on Perpl mirrored under onchain rules | todo |
