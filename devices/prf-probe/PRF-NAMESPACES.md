# PRF namespaces with Mera 0.2.0 ("One Passkey, Many Keys")

Source read: `node_modules/@category-labs/mera/src/{passkey,webauthn,react-native-webauthn-client-internal,secret,webcrypto}.ts`. The working code is in `src/namespaces.ts`, and the probe app has buttons for it ("Create 2NS", "Encrypt key").

## What Mera supports

- **One salt per ceremony.** Mera only sends `prf: { eval: { first: salt } }` and only reads `results.first`. It never uses `eval.second` or `evalByCredential`.
- **The salt is yours to choose.** `createPasskeyWithPrfOutput({ prfSalt })` and `getPasskeyPrfOutput({ prfSalt })` both accept any 32-byte salt. Other lengths throw `INPUT_INVALID`. The default salt is `sha256("mera.prf.salt.v1")`, and Mera says it will never change. A different salt gives an unrelated output, so **one namespace = one salt**.
- **Each extra namespace costs one more prompt** with Mera alone, because every `getPasskeyPrfOutput` call is a separate user-verification ceremony.
- **One prompt is possible underneath Mera.** react-native-passkey 3.6.1 types `eval.second` and base64url-encodes it on Android (`PasskeyRequest.js`, `normalizePrfValues`). So one native ceremony can evaluate two salts. Mera's own client ignores `results.second`. `namespaces.ts › withSecondSalt` adds `second` to the request and reads `results.second` back. Mera still handles `first`, so you keep its validation and error mapping.
  - **Not yet tested:** whether Google Password Manager returns `second`. The probe logs `x25519=second-not-returned` if it does not, and you fall back to the second ceremony.
- **Mera already uses salts as namespaces itself.** The secret vault (`createSecretVaultWith*`) picks a fresh random salt per vault and derives the AES-256-GCM key with HKDF info `mera.v1.encrypt.secret`.
  - **Catch:** it needs `crypto.subtle`, which Hermes does not have. On React Native, the vault APIs throw `CRYPTO_UNAVAILABLE` unless you polyfill WebCrypto. Deriving with `@noble` directly (below) avoids that.

## Namespaces for Mirror

| namespace | salt | derived key | work |
|---|---|---|---|
| `NS_ACCOUNT` | `sha256("mera.prf.salt.v1")` = `896d46ac…0db9` (Mera default) | BIP-39 → `m/44'/60'/0'/0/0` secp256k1 | EVM account (signing) |
| `NS_ENCRYPT` | `sha256("mirror.prf.ns.encrypt.v1")` = `59014842…38b7` | HKDF-SHA256(info `mirror.v1.x25519`) → X25519 | **non-account work:** encrypt follow settings, leader notes and push payloads to self; ECDH with a backend or with another device |

For the bounty requirement ("at least one PRF namespace does non-account work"), `NS_ENCRYPT` is that namespace. Its key never signs a transaction. It only encrypts and decrypts.

```ts
import { getPasskeyPrfOutput } from "@category-labs/mera";
import { reactNativeWebAuthnClient } from "@category-labs/mera/react-native-webauthn-client";
import { x25519 } from "@noble/curves/ed25519.js";   // add @noble/curves + @noble/hashes as direct deps
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { utf8ToBytes } from "@noble/hashes/utils.js";

export const NS_ENCRYPT = sha256(utf8ToBytes("mirror.prf.ns.encrypt.v1"));

export function x25519FromPrf(prf: Uint8Array) {
  const secretKey = hkdf(sha256, prf, new Uint8Array(0), utf8ToBytes("mirror.v1.x25519"), 32);
  return { secretKey, publicKey: x25519.getPublicKey(secretKey) };
}

// second namespace = second ceremony (pin it to the account's credential)
export async function getEncryptionKey(rpId: string, credentialId: string) {
  const { prfOutput } = await getPasskeyPrfOutput({
    rpId, prfSalt: NS_ENCRYPT, credential: { credentialId },
    webAuthnClient: reactNativeWebAuthnClient,
  });
  const k = x25519FromPrf(prfOutput);
  prfOutput.fill(0);
  return k;
}

// sealing to self (or to a peer): ECDH(ephemeral, recipientPub) -> HKDF -> XChaCha20-Poly1305 (@noble/ciphers)
const eph = x25519.utils.randomSecretKey();
const shared = x25519.getSharedSecret(eph, recipientPublicKey);
const aeadKey = hkdf(sha256, shared, x25519.getPublicKey(eph), utf8ToBytes("mirror.v1.seal"), 32);
```

Tested in Node with this repo's `@noble/curves` 2.2.0: X25519 ECDH gives the same shared secret on both sides. Tested on the Android emulator: the app's self-test (PRF to EVM key, then EIP-712 sign and recover) passes on Hermes.

## Keeping account creation to one prompt

Recommended:
1. Create the account with Mera's default salt (one prompt). This gives `NS_ACCOUNT`.
2. Ask for `NS_ENCRYPT` lazily, the first time something needs encrypting. That is one extra prompt, at a moment the user expects one.

To get both namespaces from the create prompt, use `createWithTwoNamespaces()`. It depends on Google Password Manager returning `results.second`, which has not been checked yet. Re-test it once a Google account is signed in and the assetlinks file is live.

Do not stretch one PRF output into "many keys" with HKDF alone and call that multiple namespaces. That is only one PRF namespace. The bounty asks for separate PRF salts.
