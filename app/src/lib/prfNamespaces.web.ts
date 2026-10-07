// Web build of prfNamespaces.ts. Mera's browser client asks navigator.credentials for `prf.eval.first`
// only; we add `prf.eval.second` (the notification namespace) to the same create/get call, so one
// passkey ceremony returns both outputs. Browsers that ignore `second` fall back to one more prompt
// in the caller, as on Android.
import { decodeOutput } from "./prfShared";

export { NS_ACCOUNT, NS_ACCOUNT_LABEL, NS_NOTIFY, NS_NOTIFY_LABEL, decodeOutput, toBase64Url } from "./prfShared";

type CredFn = (options?: any) => Promise<any>;
type Creds = { create: CredFn; get: CredFn };

function buffer(b: Uint8Array): ArrayBuffer {
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
}

export async function withSecondSalt<T>(
  second: Uint8Array,
  fn: () => Promise<T>,
  creds: Creds | undefined = globalThis.navigator?.credentials as unknown as Creds | undefined,
): Promise<{ result: T; second: Uint8Array | undefined }> {
  if (!creds) return { result: await fn(), second: undefined };
  const orig = { create: creds.create, get: creds.get };
  let secondOut: unknown;
  const wrap = (name: "create" | "get") => async (options?: any) => {
    const ev = options?.publicKey?.extensions?.prf?.eval;
    if (ev) ev.second = buffer(second);
    const cred = await orig[name].call(creds, options);
    const res = typeof cred?.getClientExtensionResults === "function" ? cred.getClientExtensionResults() : cred?.clientExtensionResults;
    secondOut = res?.prf?.results?.second ?? secondOut;
    return cred;
  };
  // navigator.credentials methods live on the prototype; own properties shadow them for this ceremony.
  Object.defineProperty(creds, "create", { value: wrap("create"), configurable: true, writable: true });
  Object.defineProperty(creds, "get", { value: wrap("get"), configurable: true, writable: true });
  try {
    const result = await fn();
    return { result, second: decodeOutput(secondOut) };
  } finally {
    const own = (k: "create" | "get") => Object.prototype.hasOwnProperty.call(Object.getPrototypeOf(creds) ?? {}, k);
    for (const k of ["create", "get"] as const) {
      if (own(k)) delete (creds as any)[k];
      else Object.defineProperty(creds, k, { value: orig[k], configurable: true, writable: true });
    }
  }
}
