// PRF namespaces: one passkey, several independent secrets ("One Passkey, Many Keys").
//
// A namespace is a PRF salt. The account namespace is Mera's default salt; the notification namespace
// is a separate salt whose output never signs transactions (it derives the X25519 key that decrypts push
// payloads and seals private follow notes). Mera 0.2.0 evaluates one salt per ceremony (`eval.first`),
// so we ask the platform for `eval.second` in the same ceremony by wrapping the native passkey call
// Mera's React Native client makes. Google Password Manager returns both outputs in one prompt
// (verified on device: devices/evidence/prf-signedin-*). If a provider ignores `second`, the caller
// evaluates the notification namespace on its own with one more prompt.
import { sha256 } from "@noble/hashes/sha2.js";
import { utf8ToBytes } from "@noble/hashes/utils.js";
import { Passkey } from "react-native-passkey";

export const NS_ACCOUNT_LABEL = "mera.prf.salt.v1";
export const NS_NOTIFY_LABEL = "mirror.prf.ns.notify.v1";
export const NS_ACCOUNT = sha256(utf8ToBytes(NS_ACCOUNT_LABEL));
export const NS_NOTIFY = sha256(utf8ToBytes(NS_NOTIFY_LABEL));

type NativeFn = (request: any) => Promise<any>;
type PasskeyStatics = { createPlatformKey?: NativeFn; getPlatformKey?: NativeFn; create?: NativeFn; get?: NativeFn };

/**
 * Run `fn` (a Mera create/get ceremony) with `second` added to the PRF eval of the native request, and
 * return the provider's second PRF output if it gave one.
 */
export async function withSecondSalt<T>(
  second: Uint8Array,
  fn: () => Promise<T>,
  passkey: PasskeyStatics = Passkey as unknown as PasskeyStatics,
): Promise<{ result: T; second: Uint8Array | undefined }> {
  const names = (["createPlatformKey", "getPlatformKey", "create", "get"] as const).filter(
    (k) => typeof passkey[k] === "function",
  );
  const originals = new Map<string, NativeFn>();
  let secondOut: unknown;
  for (const name of names) {
    const orig = passkey[name] as NativeFn;
    originals.set(name, orig);
    passkey[name] = async (request: any) => {
      const ev = request?.extensions?.prf?.eval;
      // Same encoding Mera used for `first` (raw bytes today; base64url if that ever changes).
      if (ev) ev.second = typeof ev.first === "string" ? toBase64Url(second) : second;
      const res = await orig.call(passkey, request);
      secondOut = res?.clientExtensionResults?.prf?.results?.second ?? secondOut;
      return res;
    };
  }
  try {
    const result = await fn();
    return { result, second: decodeOutput(secondOut) };
  } finally {
    for (const [name, orig] of originals) (passkey as any)[name] = orig;
  }
}

export function decodeOutput(v: unknown): Uint8Array | undefined {
  if (v === undefined || v === null) return undefined;
  let out: Uint8Array;
  if (typeof v === "string") {
    const b64 = v.replace(/-/g, "+").replace(/_/g, "/");
    const bin = atob(b64 + "===".slice((b64.length + 3) % 4));
    out = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  } else {
    out = Uint8Array.from(v as ArrayLike<number>);
  }
  return out.length === 32 ? out : undefined;
}

export function toBase64Url(b: Uint8Array): string {
  let s = "";
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
