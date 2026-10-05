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
| 4 | One-prompt onboarding | Single passkey prompt creates account | todo |
| 5 | Scoped signing session, prompt-free signing | `createSecp256k1SigningSession` scoped to the action set; session ended after use | todo |
| 6 | Stateless test: fresh-device restore | Restore flow on a second device; video timestamp | todo (needs Google-signed-in device) |
