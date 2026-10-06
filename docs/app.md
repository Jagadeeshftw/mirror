# Mirror Android app

Source: `app/` (Expo SDK 57, expo-router, TypeScript, React Native 0.86, Android only,
package `com.zeroxo.mirror`). The app talks only to the Mirror backend (`docs/api.md`) and to
Monad RPC for reads. It never sends transactions itself: the user signs, the relayer submits.

## Run it

```sh
cd app
npm install
npm run mock                        # dev mock of docs/api.md on :8787 (dev-mock/server.mjs)
EXPO_PUBLIC_API_BASE=http://localhost:8787 scripts/build-apk.sh
adb reverse tcp:8787 tcp:8787 && adb install -r android/app/build/outputs/apk/release/app-release.apk
npm test                            # jest: EIP-712, permit/3009, policy encoding, formatting, keys, SSE
```

`scripts/build-apk.sh` is a local Gradle build (no EAS). It signs with
`keys/mirror-release.keystore` when `keys/mirror-release.env` exists and falls back to the
debug keystore otherwise. `ARCHS` defaults to `arm64-v8a`.

The backend URL is baked in from `EXPO_PUBLIC_API_BASE` (default `https://api.mirror.0xo.in`)
and can be changed at runtime: long-press the logo on the Welcome screen, or Settings →
Developer. Cleartext HTTP is allowed only to `localhost`, `127.0.0.1` and `10.0.2.2`
(network security config); every other host must be HTTPS.

## Accounts: Mera passkeys only

- **Create**: one prompt. `createPasskeyWithPrfOutput({ rp: { id: "mirror.0xo.in" } })`.
- **Restore**: `getPasskeyPrfOutput({ rpId })` with no credential id (discoverable), so a
  synced passkey restores the account on a new phone. Nothing to import.
- **Owner key**: PRF output (32 bytes) → BIP-39 entropy → seed → `m/44'/60'/0'/0/0`, the same
  derivation as the Mera probe. Verified in tests against `cast wallet address --mnemonic`.
- **Scoped signing sessions**: every action asks for the passkey, derives the key, opens one
  `createSecp256k1SigningSession`, signs everything that action needs, and calls
  `session.end()` (key zeroed) in a `finally`. Nothing that can sign is stored. The device
  stores only the address, the credential id and the decrypt-only notification key.
- **Recovery phrase**: not shown during onboarding. Settings → "Export recovery phrase" asks
  for the passkey and shows the 24 words in a dialog. They are never written to storage.
- **Emulators**: passkeys need a Google account on the device and `assetlinks.json` on
  `mirror.0xo.in` that lists the signing certificate. When the app points at a local http
  mock, a passkey simulator takes over (random 32-byte secret in SecureStore, the same
  derivation) so every other flow can be tested. Against any https backend the app always
  uses Mera.

## One passkey, many keys: the notification key

Mera 0.2 returns one PRF output per WebAuthn ceremony (the `first` evaluation for one salt).
A second PRF salt would need a second ceremony, which would mean a second biometric prompt
at account creation. To keep create to one prompt, namespaced keys come from the single PRF
output with HKDF-SHA256 and distinct `info` strings. Mera uses the same domain-separation
pattern for its own secret vaults (`mera.v1.encrypt.secret`).

- Notification key = X25519 private key `HKDF-SHA256(ikm = PRF, salt = "", info = "mirror.v1.notify.x25519")`.
  It never signs transactions and is independent of the owner key (different derivation path).
- Registered with `POST /v1/push/register {owner, expoPushToken, notifyPublicKey}` (base64 public key).
- Push envelope `{v: 1, epk, nonce, ct}` (base64): ephemeral X25519 → shared secret →
  `HKDF-SHA256(shared, salt = epk || recipientPub, info = "mirror.v1.push.chacha20poly1305")` →
  ChaCha20-Poly1305, AAD `mirror.v1`. The plaintext is a JSON `PushPayload`
  (`{kind, title, body, account?, eventId?, timestamp}`). The server and the push provider only see ciphertext.
- Delivery: an FCM/Expo data message with `data.mirror = "<envelope JSON>"` (handled in the
  foreground listener and a background task), or the SSE stream's `event: push` while the app is
  open. The device decrypts and shows a local notification on channel `copies`.
- Private follow notes are sealed to the user's own key with info
  `mirror.v1.note.chacha20poly1305` before upload.
- Settings shows "Notification encryption key — derived from your passkey" with its fingerprint.

## What the app signs

All EIP-712. Unit tests compare the digests with the deployed contract (`actionDigest()` on a
clone created by `MirrorAccountFactory` on a local anvil), with `cast keccak` / `cast
abi-encode`, and the signatures with `cast wallet sign --data`. See
`app/scripts/eip712-reference.sh`.

| Flow | Signatures (one passkey prompt) | Relay calls |
|---|---|---|
| Follow (new MirrorAccount per follow) | AUSD `Permit` (spender = predicted account) + `Action{kind: 7 FOLLOW, data: abi.encode(Policy, MirrorOrder[])}` with nonce 0 | `/v1/relay/create` → `/v1/relay/deposit` (permit) → `/v1/relay/execute` |
| Edit limits | `Action{1 SET_POLICY, abi.encode(Policy)}` | execute |
| Pause / resume (one or all follows) | `Action{2 SET_PAUSED, abi.encode(bool)}` per account | execute ×N |
| Close all | `Action{3 CLOSE_ALL, abi.encode(uint16 100)}` per account with positions | execute ×N |
| Withdraw | `Action{4 WITHDRAW, abi.encode(uint256)}`; to another address adds `TransferWithAuthorization` | execute (+ transfer) |
| Top up a follow | `Permit` (or `ReceiveWithAuthorization`) | deposit |
| Send AUSD | `TransferWithAuthorization` | transfer |

Domain for actions: `{name: "Mirror Account", version: "1", chainId: 143, verifyingContract: <MirrorAccount>}`.
AUSD domain: `{name: "Agora Dollar", version: "1", chainId: 143, verifyingContract: 0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a}`.
Account addresses are predicted locally (EIP-1167 clone, CREATE2, salt `keccak256(abi.encode(owner, bytes32(n)))`),
matching `MirrorAccountFactory.predictAccount`; the relayer's returned address is cross-checked.

## Follow sheet (product rules)

- Allocation 10 to 25 AUSD: Perpl's 10 AUSD account minimum, beta cap 25 AUSD per account, one account per follow.
- Sizing is only "% of leader size" (`ratioBps`, 0.01% to 10% presets). The sheet suggests the
  largest ratio that keeps the leader's biggest position under the per-market cap.
- Max leverage 1x to 15x (Perpl's BTC maximum), max slippage 1 to 1000 bps (`maxSlippageBps`),
  max notional per market, allowed markets, daily loss stop, drawdown stop, expiry.
- Daily loss and drawdown stops pause new exposure; existing positions still follow the leader's closes.
- "Match the leader now" (ON by default) shows, per market where the leader holds a position:
  expected size, expected fill, worst price (slippage bound), notional, margin, leverage, and
  whether a rule would block it. The orders come from `POST /v1/quote/follow` and go into the
  same ACTION_FOLLOW signature. Orders the contract rejects emit `Blocked` and appear on the
  result screen with the Blocked explanation.

## Backend contract assumptions (beyond docs/api.md)

The app accepts these shapes; `app/src/lib/types.ts` is the full reference and
`app/dev-mock/server.mjs` implements all of them.

- `GET /v1/config`: `{chainId, rpc, explorerTx, explorerAddress, contracts: {factory, implementation, keeperRegistry, perplExchange, collateral}, depositCapCNS, minAccountOpenCNS, markets: [{perpId, symbol, lotDecimals, priceDecimals, markPNS, maxLeverage}], teamRun}`.
- `GET /v1/owners/:owner/accounts`: `{owner, walletBalanceCNS, accounts: MirrorAccount[]}` (a bare array also works). Each account carries `salt`, `actionNonce`, `equityHistory`, `leader` and `pnl.byLeader`.
- Feed events: `{id, kind, account, txHash, block, timestamp, commitState, latencyMs, leaderAccountId, leaderAddress, perpId, orderType, lotLNS, pricePNS, leverageHdths, notionalCNS, realisedPnlCNS, matchNow, blocked: {reason, reasonCode, limit, actual, rule}}`. `leaderLotLNS` / `leaderLeverageHdths` let the Blocked sheet show the leader's own order.
- SSE `/v1/stream?account=…`: `event: feed` (FeedEvent), `event: commit` (`{id, txHash, commitState}`), `event: push` (encrypted envelope), `event: demo` (DemoCycle with steps, latency and tx hashes), `event: hello`.
- `POST /v1/quote/follow` body adds `policy.allocationCNS` so the quote can flag orders that don't fit the margin. Response: `{rows, orders, ordersEncoded}`.
- Errors: `{error, message, retryAfterSec?, revertReason?}` with HTTP 429 for rate limits (also `Retry-After`) and 409 when a demo cycle is already running.
- Proposed addition: `PUT /v1/notes {owner, account, note: envelope}`, `GET /v1/notes/:owner` for encrypted private follow notes.

## No motion

Native stack and tabs use `animation: "none"`, modals `animationType="none"`, the Android
window animation style is `@null`, there is no ripple (instant pressed state instead), no
ActivityIndicator (static progress states), no pull-to-refresh spinner, `overScrollMode="never"`,
and custom switch and slider without animated values. Charts are static SVG.

## Not finished / needs outside pieces

- Real passkeys on device need a Google account on the phone and
  `https://mirror.0xo.in/.well-known/assetlinks.json` listing `com.zeroxo.mirror` with the SHA-256
  of the release certificate.
- Remote push needs FCM credentials (`google-services.json`) or an Expo project id; without
  them the app registers `expoPushToken: "unavailable:no-fcm-config"` and receives encrypted
  payloads over SSE while open.
- Contract addresses (`factory`, `implementation`) come from `/v1/config`; `shared/config.json`
  still has them as null.
