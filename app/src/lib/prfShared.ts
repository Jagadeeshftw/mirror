// PRF namespace salts and output decoding, shared by the Android (prfNamespaces.ts) and web
// (prfNamespaces.web.ts) implementations.
import { sha256 } from "@noble/hashes/sha2.js";
import { utf8ToBytes } from "@noble/hashes/utils.js";

export const NS_ACCOUNT_LABEL = "mera.prf.salt.v1";
export const NS_NOTIFY_LABEL = "mirror.prf.ns.notify.v1";
export const NS_ACCOUNT = sha256(utf8ToBytes(NS_ACCOUNT_LABEL));
export const NS_NOTIFY = sha256(utf8ToBytes(NS_NOTIFY_LABEL));

/** A 32-byte PRF output from base64url, an ArrayBuffer, a typed array or a byte list; anything else is undefined. */
export function decodeOutput(v: unknown): Uint8Array | undefined {
  if (v === undefined || v === null) return undefined;
  let out: Uint8Array;
  if (typeof v === "string") {
    const b64 = v.replace(/-/g, "+").replace(/_/g, "/");
    const bin = atob(b64 + "===".slice((b64.length + 3) % 4));
    out = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  } else if (v instanceof ArrayBuffer) {
    out = new Uint8Array(v.slice(0));
  } else if (ArrayBuffer.isView(v)) {
    out = new Uint8Array(v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength));
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
