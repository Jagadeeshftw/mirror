# Monad Foundation: Best Mera-Powered UX on Monad

All tracks. Single winner, $2,500.

Requirement text **(secondhand)**: "Build an app on Monad where Mera is the entire account layer — no seed phrase, no
extension, no custody backend." Excerpts: "one-prompt onboarding"; "prompt-free signing via Mera signing sessions with a
clearly scoped session"; "stateless test": identity rebuilds from the passkey on a fresh device.

| # | Requirement | Evidence | Status |
|---|---|---|---|
| 1 | Mera is the entire account layer | Owner of every MirrorAccount is the Mera-derived EOA (`app/src/lib/derive.ts`); every owner action is one passkey prompt (Stage A Android steps 13, 16, 17, 24, 28) | done (emulators) |
| 2 | No seed phrase, no extension | Passkey only; optional recovery phrase export in Settings (`settings.exportPhrase`) | done |
| 3 | No custody backend | Keepers can trade but never withdraw (invariant tests: `contracts/test/MirrorAccount.invariant.t.sol`); relayer only submits owner-signed actions | done (contracts, tests) |
| 4 | One-prompt onboarding | `devices/evidence/prf-signedin-a/` (probe) and Stage A Android step 01 in the Mirror app | done (emulators) |
| 5 | Scoped signing session, prompt-free signing | `app/src/lib/wallet.ts`: one `createSecp256k1SigningSession` per owner action (one prompt, can sign several signatures such as close all across accounts), ended and zeroed when the action settles. No longer-lived prompt-free session | done (per action) |
| 6 | Stateless test: fresh-device restore | `devices/evidence/prf-signedin-b2/` (probe) and Stage A Android step 18: same address restored on the second emulator (mirror-b) from the synced passkey | done (emulators); video todo |

## Asked for at submission (official, from the bounty page, read 6 Oct 2026)

- Describe how your project meaningfully integrates Mera as the entire account layer
- Submit an optional demo video (up to 2 mins) showing how Mera is integrated into your app, focusing on UX elements

Answers: `docs/submission.md` (source `docs/submission/fields/11-bounties.md`).
