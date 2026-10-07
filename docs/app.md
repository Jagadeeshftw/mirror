# Mirror Android app

Source: `app/` (Expo SDK 57, expo-router, TypeScript, React Native 0.86, Android only,
package `com.zeroxo.mirror`). The app talks only to the Mirror backend (`docs/api.md`) and to
Monad RPC for reads. It never sends transactions itself: the user signs, the relayer submits.

## Run it

```sh
cd app
npm install
npm run mock                        # dev mock of docs/api.md on :8787 (dev-mock/server.mjs)
scripts/build-apk.sh --devtools     # dist/mirror-<ver>-devtools.apk, points at http://localhost:8787
adb reverse tcp:8787 tcp:8787 && adb install -r dist/mirror-0.9.2-devtools.apk
EXPO_PUBLIC_API_BASE=https://<engine> scripts/build-apk.sh   # dist/mirror-<ver>-release.apk
python3 scripts/capture-all.py <serial> screenshots          # every screen, light + dark, + layout checks
npm test                            # jest: EIP-712, permit/3009, policy encoding, formatting, keys, SSE
```

`scripts/build-apk.sh` is a local Gradle build (no EAS) with R8 minification and resource
shrinking. It signs with `keys/mirror-release.keystore` when `keys/mirror-release.env` exists
and falls back to the debug keystore otherwise. `ARCHS` defaults to `arm64-v8a`.

Two variants:
- **release** (default): requires an https `EXPO_PUBLIC_API_BASE`, always uses Mera passkeys,
  and has no backend switch. The dev tools are behind a module-local
  `__DEV__ || process.env.EXPO_PUBLIC_MIRROR_DEV_TOOLS === "1"` constant that folds to `false`,
  so the minifier removes them. A string check on the bundle confirms the simulator, the
  override storage key and both developer UIs are absent. There is no cleartext exception.
- **devtools** (`--devtools`, or any `__DEV__` build): adds the passkey simulator (active
  against a local http mock), the backend switch (long-press the Welcome logo, Settings →
  Developer) and cleartext to `localhost`, `127.0.0.1` and `10.0.2.2` only. For emulators
  without a Google account. Never ship it.

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
  `mirror.0xo.in` that lists the signing certificate. In devtools builds pointed at a local
  http mock, a passkey simulator takes over (random 32-byte secret in SecureStore, the same
  derivation) so every other flow can be tested. Release builds have no simulator.

## One passkey, many keys: the notification key

The passkey is evaluated with two PRF salts in the same prompt: the account namespace (Mera's
`mera.prf.salt.v1`, which derives the owner key) and the notification namespace `sha256("mirror.prf.ns.notify.v1")`
as `prf.eval.second` (`prfNamespaces.ts` / `.web.ts`). A provider that ignores `second` costs one more prompt for the
notification namespace alone; it is never derived from the account output.

- Notification key = X25519 private key `HKDF-SHA256(ikm = notify-namespace PRF output, salt = "", info = "mirror.v1.notify.x25519")`.
  It never signs transactions. Stored on the device only (SecureStore on Android; on the web, localStorage sealed
  under a non-extractable IndexedDB key, `webStore.ts`).
- Registered with `POST /v1/push/register {owner, notifyPublicKey, expoPushToken?, webPush?}` (base64 public key).
  The server holds the public half only.
- Alert envelope v1 `{v: 1, epk, nonce, ct}` (base64): ephemeral X25519 → shared secret →
  `HKDF-SHA256(shared, salt = epk || recipientPub, info = "mirror.v1.push.chacha20poly1305")` →
  ChaCha20-Poly1305, AAD `mirror.v1`. Plaintext: `PushPayload` `{v, kind, title, body, account, eventId, txHash, timestamp}`.
  Engine and app are tested against the same vector (`shared/test-vectors/push-envelope-v1.json`).
- Private follow notes are sealed to the user's own key with info `mirror.v1.note.chacha20poly1305` before upload.
- Settings shows "Notification encryption key — derived from your passkey" with its fingerprint, and under Alerts
  the namespace, that the server only relays ciphertext, and the delivery channel.

## Alerts

Turned on from "Get alerts for this follow?" after the first follow (`follow.alerts.enable`) or the Settings switch.
The OS / browser permission is asked only then, never at sign-up. The Alerts screen (`/alerts`, also from Settings →
"Alerts received" and Notifications) lists the decrypted alerts; they never leave the device.

| Platform | Remote delivery | What the user sees | Where it is decrypted |
|---|---|---|---|
| Web | Web Push with VAPID through `public/sw.js` (no Firebase) | "Mirror / New activity" from the service worker | In the app when it opens or regains focus: the worker can't read the key (it sits in the app's encrypted storage) and has no X25519/ChaCha20 code, so it only queues the envelope in IndexedDB `mirror-inbox` and pings open tabs. Settings says so |
| Android | Expo push (FCM), data `mirror` = envelope | Foreground: the decrypted text as a local notification (the generic banner is suppressed). Background: "Mirror / New activity"; the background task decrypts into Alerts | On the phone |
| Both, app open | SSE `event: push` | Alerts list | On the device |

### Android push: what the owner provides

Android remote push needs Firebase; everything else (web alerts, in-app alerts on Android) works without it.

1. Firebase console → a project → add an Android app with package `com.zeroxo.mirror` → download
   `google-services.json` and put it at `app/google-services.json` (gitignored). `app.config.ts` picks it up
   automatically (`android.googleServicesFile`) on the next `expo prebuild` / `scripts/build-apk.sh`.
2. Expo push also needs an Expo project id and the FCM V1 service-account key: `eas init` (or set
   `EXPO_PUBLIC_EAS_PROJECT_ID` at build time), then upload the Firebase service-account JSON in the Expo dashboard
   (Credentials → Android → FCM V1). On the engine set `PUSH_ENABLED=1` (and `EXPO_ACCESS_TOKEN` if push security
   is on in the Expo project).

Without these the app registers the in-app channel only (`expoPushToken` is not sent) and Settings shows
"Registered · in-app delivery while open".

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
| Edit / clear levels (one position) | `Action{9 SET_LEVELS, abi.encode(Level[1])}`, `Level{perpId, side, stopLossPNS, takeProfitPNS, slippageBps 300}`; both prices 0 clears | execute |
| Close position | `Action{10 CLOSE_MARKET, abi.encode(uint32 perpId, uint16 300)}` | execute |
| Resume a market after a level fired | `Action{1 SET_POLICY}` with the same policy (a new policy lifts `halted`) | execute |
| Stop following, keep my positions | other leaders left: `SET_POLICY` without the leader. Only leader: `Detach{detached: true, deadline}` (EIP-712, account domain) + `SET_PAUSED true`, one prompt; the engine then sends no copies, opens or closes (keeper behaviour) | `/v1/accounts/:account/detach` + execute |
| Follow again (after detach) | `Detach{detached: false}` + `SET_PAUSED false` | detach + execute |
| Stop and close | only leader: `CLOSE_ALL 300`; otherwise `SET_POLICY` without the leader + `CLOSE_MARKET` per market it holds (consecutive nonces, one prompt) | execute ×N |
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
- Stop-loss / take-profit are not follow-sheet defaults: the contract stores them per position (`Level`), so they
  are set from the position (Positions, Edit levels) once it is open. Anyone can execute a level once the mark
  (and a fresh Chainlink price) has reached it; the close is reduce-only and the caller is paid nothing.
- "Match the leader now" (ON by default) shows, per market where the leader holds a position:
  expected size, expected fill, worst price (slippage bound), notional, margin, leverage, and
  whether a rule would block it. The orders come from `POST /v1/quote/follow` and go into the
  same ACTION_FOLLOW signature. Orders the contract rejects emit `Blocked` and appear on the
  result screen with the Blocked explanation.

## Backend contract assumptions (beyond docs/api.md)

The app accepts these shapes; `app/src/lib/types.ts` is the full reference and
`app/dev-mock/server.mjs` implements all of them.

- `GET /v1/config`: `{chainId, rpc, explorerTx, explorerAddress, contracts: {factory, implementation, keeperRegistry, perplExchange, collateral}, depositCapCNS, minAccountOpenCNS, markets: [{perpId, symbol, lotDecimals, priceDecimals, markPNS, maxLeverage}], teamRun}`.
- `GET /v1/owners/:owner/accounts`: `{owner, walletBalanceCNS, accounts: MirrorAccount[]}` (a bare array also works; the engine's `walletCNS` maps to `walletBalanceCNS`). Each account carries `salt`, `actionNonce`, `equityHistory` (engine `{t (s), equityCNS}` maps to `{t (ms), v}`), `leader` and `pnl.byLeader`; the engine's `todayPnlCNS` maps to `pnl.todayCNS` and `dailyLossHit` / `drawdownHit` to `stops`.
- Feed events: `{id, kind, account, txHash, block, timestamp, commitState, latencyMs, leaderAccountId, leaderAddress, perpId, orderType, lotLNS, pricePNS, leverageHdths, notionalCNS, realisedPnlCNS, matchNow, blocked: {reason, reasonCode, limit, actual, rule}}`. `leaderLotLNS` / `leaderLeverageHdths` let the Blocked sheet show the leader's own order.
- SSE `/v1/stream?account=…`: `event: feed` (FeedEvent), `event: commit` (`{id, txHash, commitState}`), `event: push` (alert envelope sealed to a device key), `event: demo` (DemoCycle with steps, latency and tx hashes), `event: hello`.
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
- Android remote push needs `app/google-services.json` and an Expo project id with the FCM V1 key (see "Android
  push: what the owner provides"); without them Android receives encrypted alerts over SSE while open. Web alerts
  use Web Push with VAPID and need only the engine's VAPID keys.
- Contract addresses (`factory`, `implementation`) come from `/v1/config`; `shared/config.json`
  still has them as null.
