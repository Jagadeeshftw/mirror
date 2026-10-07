# Monad Foundation: Mera — One Passkey, Many Keys

All tracks. Single winner, $2,500.

Requirement text **(secondhand)**: "Most creative non-wallet use of Mera's PRF-derived key material." The use must be one
that "is NOT signing blockchain transactions from a wallet account".

| # | Requirement | Evidence | Status |
|---|---|---|---|
| 0 | At least one PRF namespace does non-account work (official wording) | `devices/evidence/prf-signedin-a/` and `-b2/`: second PRF namespace returned in the same prompt, X25519 key identical after restore. In the app: `app/src/lib/prfNamespaces.ts` / `.web.ts` add `prf.eval.second` = `sha256("mirror.prf.ns.notify.v1")` to Mera's ceremony; Stage-A web run checks "one passkey ceremony returns two PRF outputs" | done |
| 1 | Non-wallet use of PRF-derived key material | The notification namespace derives an X25519 key that decrypts end-to-end encrypted alerts (copies with fee, blocked trades with the rule and numbers, stops and who triggered them, leader loss stops, low equity, deposits, withdrawals) and seals private follow notes. The engine holds only the public key and relays ciphertext over Web Push (VAPID), Expo push and SSE; the visible push text is "Mirror: new activity". Code: `engine/src/services/{alerts,push,pushcrypto,webpush}.ts`, `app/src/lib/{notifyKey,push,push.web}.ts`, `app/public/sw.js`, `app/src/app/alerts.tsx`. Same-vector tests: `engine/test/push.test.ts`, `app/__tests__/pushEnvelope.test.ts` on `shared/test-vectors/push-envelope-v1.json`. Stage-A web run (`localnet/e2e-web/flows-alerts.mjs`): opt in after the first follow, demo trade with the app closed, the engine's Web Push request captured and still sealed (no market, amount or address in it), the real service worker shows the generic text, the Alerts screen shows the alert decrypted in the browser (run `devices/evidence/stage-a/alerts-all-3/web/`, 33/33 with the API run 23/23). Screens: `app/screenshots/alerts/` | done |
| 2 | Not signing blockchain transactions | The notification key is X25519 (key agreement only; it cannot produce an ECDSA signature) and comes from a different PRF salt than the owner key | done |
| 3 | Creative and demoable | Demo: turn on alerts after the first follow, close the tab, run a demo trade, the browser shows "Mirror: new activity", open Mirror, the Alerts screen shows "Copied BTC long … Mirror fee …" decrypted with the passkey-derived key. Video timestamp | video todo |

## Asked for at submission (official, from the bounty page, read 6 Oct 2026)

- Describe how your project meaningfully utilizes Mera in non-account work.
- Submit an optional demo video (up to 2 mins) showing how Mera is used where at least one PRF namespace does non-account work

Answers: `docs/submission.md` (source `docs/submission/fields/11-bounties.md`).
