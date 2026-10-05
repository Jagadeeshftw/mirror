# Monad Foundation: Mera — One Passkey, Many Keys

All tracks. Single winner, $2,500.

Requirement text **(secondhand)**: "Most creative non-wallet use of Mera's PRF-derived key material." The use must be one
that "is NOT signing blockchain transactions from a wallet account".

| # | Requirement | Evidence | Status |
|---|---|---|---|
| 0 | At least one PRF namespace does non-account work (official wording) | Separate PRF namespace, never signs transactions | todo |
| 1 | Non-wallet use of PRF-derived key material | Candidates: PRF-derived Ed25519 key as the user's read-only Perpl API credential; PRF-derived key encrypting push-notification payloads and private follow notes end to end | todo (pick in design review) |
| 2 | Not signing blockchain transactions | Derived keys never sign Monad txs | todo |
| 3 | Creative and demoable | Video timestamp | todo |

## Asked for at submission (official, from the bounty page, read 6 Oct 2026)

- Describe how your project meaningfully utilizes Mera in non-account work.
- Submit an optional demo video (up to 2 mins) showing how Mera is used where at least one PRF namespace does non-account work

Answers: `docs/submission.md` (source `docs/submission/fields/11-bounties.md`).
