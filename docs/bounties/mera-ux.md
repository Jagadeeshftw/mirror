# Monad Foundation: Best Mera-Powered UX on Monad

All tracks. Single winner, $2,500.

Requirement text **(secondhand)**: "Build an app on Monad where Mera is the entire account layer — no seed phrase, no
extension, no custody backend." Excerpts: "one-prompt onboarding"; "prompt-free signing via Mera signing sessions with a
clearly scoped session"; "stateless test": identity rebuilds from the passkey on a fresh device.

| # | Requirement | Evidence | Status |
|---|---|---|---|
| 1 | Mera is the entire account layer | Owner of every MirrorAccount is the Mera-derived EOA | todo |
| 2 | No seed phrase, no extension | Passkey only; optional recovery export | todo |
| 3 | No custody backend | Keepers can trade but never withdraw (invariant tests: `contracts/test/MirrorAccount.invariant.t.sol`); relayer only submits owner-signed actions | in progress |
| 4 | One-prompt onboarding | `devices/evidence/prf-signedin-a/`: one prompt creates passkey and account | done in probe; in-app todo |
| 5 | Scoped signing session, prompt-free signing | `createSecp256k1SigningSession` scoped to the action set; session ended after use | todo |
| 6 | Stateless test: fresh-device restore | `devices/evidence/prf-signedin-b2/`: same address restored on a second emulator from the synced passkey | done in probe; video todo |

## Asked for at submission (official, from the bounty page, read 6 Oct 2026)

- Describe how your project meaningfully integrates Mera as the entire account layer
- Submit an optional demo video (up to 2 mins) showing how Mera is integrated into your app, focusing on UX elements

Answers: `docs/submission.md` (source `docs/submission/fields/11-bounties.md`).
