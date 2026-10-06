/**
 * Multiple PRF namespaces from one passkey ("One Passkey, Many Keys").
 *
 * Mera 0.2.0 evaluates exactly one PRF salt per ceremony (`eval.first`), but
 * the salt is caller-controlled (`prfSalt`, 32 bytes) on both
 * createPasskeyWithPrfOutput and getPasskeyPrfOutput. A "namespace" is a salt:
 *
 *   NS_ACCOUNT = Mera default salt sha256("mera.prf.salt.v1") -> EVM account
 *   NS_ENCRYPT = sha256("mirror.prf.ns.encrypt.v1")          -> X25519 key (non-account work)
 *
 * Two ways to get NS_ENCRYPT:
 *   A) Mera only: getPasskeyPrfOutput({ prfSalt: NS_ENCRYPT }) -> one more UV prompt.
 *   B) One prompt: a custom WebAuthnClient that sends eval.first AND eval.second
 *      (react-native-passkey 3.6.1 types `second`) and stashes results.second.
 *      Mera still gets `first` and is unaware of the second output.
 */
import { createPasskeyWithPrfOutput, getPasskeyPrfOutput, type WebAuthnClient } from "@category-labs/mera";
import { reactNativeWebAuthnClient } from "@category-labs/mera/react-native-webauthn-client";
import { x25519 } from "@noble/curves/ed25519.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import { Passkey } from "react-native-passkey";
import { rpId } from "./wallet";

export const NS_ACCOUNT = sha256(utf8ToBytes("mera.prf.salt.v1"));
export const NS_ENCRYPT = sha256(utf8ToBytes("mirror.prf.ns.encrypt.v1"));

/** PRF output of NS_ENCRYPT -> X25519 keypair (HKDF domain-separated). */
export function x25519FromPrf(prf: Uint8Array) {
  const secretKey = hkdf(sha256, prf, new Uint8Array(0), utf8ToBytes("mirror.v1.x25519"), 32);
  const publicKey = x25519.getPublicKey(secretKey);
  return { secretKey, publicKey, publicKeyHex: bytesToHex(publicKey) };
}

/** A) Second namespace via a second Mera ceremony (one more prompt). */
export async function deriveEncryptKey(credentialId?: string) {
  const r = await getPasskeyPrfOutput({
    rpId,
    prfSalt: NS_ENCRYPT,
    webAuthnClient: reactNativeWebAuthnClient,
    ...(credentialId ? { credential: { credentialId } } : {}),
  });
  return { credentialId: r.credentialId, ...x25519FromPrf(r.prfOutput) };
}

/**
 * B) Wrap Mera's RN client so the native request carries eval.second too.
 * Mera's client calls Passkey.createPlatformKey/getPlatformKey on the shared
 * class; we temporarily wrap those statics for the duration of one call.
 */
async function withSecondSalt<T>(second: Uint8Array, fn: () => Promise<T>) {
  const P = Passkey as any;
  const origCreate = P.createPlatformKey;
  const origGet = P.getPlatformKey;
  let secondOut: unknown;
  const inject = (orig: (r: any) => Promise<any>) => async (req: any) => {
    const ev = req?.extensions?.prf?.eval;
    if (ev) ev.second = second;
    const res = await orig.call(P, req);
    secondOut = res?.clientExtensionResults?.prf?.results?.second;
    return res;
  };
  P.createPlatformKey = inject(origCreate);
  P.getPlatformKey = inject(origGet);
  try {
    const result = await fn();
    return { result, second: decodeSecond(secondOut) };
  } finally {
    P.createPlatformKey = origCreate;
    P.getPlatformKey = origGet;
  }
}

function decodeSecond(v: unknown): Uint8Array | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v === "string") {
    const b64 = v.replace(/-/g, "+").replace(/_/g, "/");
    const bin = atob(b64 + "===".slice((b64.length + 3) % 4));
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
  }
  return Uint8Array.from(v as ArrayLike<number>);
}

/** Create the passkey and evaluate both namespaces in one prompt (if the provider honours `second`). */
export async function createWithTwoNamespaces(webAuthnClient: WebAuthnClient = reactNativeWebAuthnClient) {
  const { result, second } = await withSecondSalt(NS_ENCRYPT, () =>
    createPasskeyWithPrfOutput({
      rp: { id: rpId, name: "Mirror" },
      user: { name: "probe", displayName: `Mirror probe ${new Date().toISOString()}` },
      webAuthnClient,
    }),
  );
  return {
    created: result,
    encrypt: second && second.length === 32 ? x25519FromPrf(second) : undefined,
  };
}
