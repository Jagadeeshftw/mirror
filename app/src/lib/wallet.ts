// Account layer: Mera passkeys only.
// - Create: one passkey prompt (createPasskeyWithPrfOutput, rpId mirror.0xo.in).
// - Restore: discoverable assertion without a credential id (getPasskeyPrfOutput).
// - Keys: account PRF namespace -> BIP-39 entropy -> seed -> m/44'/60'/0'/0/0 (owner key);
//         separate notification PRF namespace (mirror.prf.ns.notify.v1) -> X25519 key that never signs.
//         Both namespaces are evaluated in the same passkey prompt (see prfNamespaces.ts).
// - Signing: a secp256k1 signing session is opened for one action and ended right after.
//   Nothing that can sign is ever persisted; only the address, the credential id and the
//   decrypt-only notification key are stored.
import { createPasskeyWithPrfOutput, getPasskeyPrfOutput, isMeraError } from "@category-labs/mera";
import { toViemAccount } from "@category-labs/mera/viem";
import { sha256 } from "@noble/hashes/sha2.js";
import { utf8ToBytes } from "@noble/hashes/utils.js";
import { base64 } from "@scure/base";
import Constants from "expo-constants";
import { Platform } from "react-native";
import * as SecureStore from "./secureStore";
import type { LocalAccount } from "viem";
import { addressFromPrf, mnemonicFromPrf, sessionFromPrf } from "./derive";
import { deriveNotifyKey, decodeKeyPair, encodeKeyPair, type NotifyKeyPair } from "./notifyKey";
import { NS_ACCOUNT, NS_NOTIFY, withSecondSalt } from "./prfNamespaces";
import type { Address } from "./types";
import { getApiBase } from "./api";
import { webAuthnClient } from "./webauthnClient";

export const RP_ID: string = Constants.expoConfig?.extra?.rpId ?? "mirror.0xo.in";
export const BRAND: string = Constants.expoConfig?.extra?.brand ?? "Mirror";
// Dev tools (passkey simulator, backend switch) exist only in debug builds or builds made with
// EXPO_PUBLIC_MIRROR_DEV_TOOLS=1. Release builds leave it unset, so this folds to `false` and
// the minifier drops every dev-only branch.
const DEV_TOOLS = __DEV__ || process.env.EXPO_PUBLIC_MIRROR_DEV_TOOLS === "1";
/**
 * Dev-only passkey simulator for emulators without a Google account. Never present in
 * release builds (DEV_TOOLS is false there). In dev builds it is active when
 * EXPO_PUBLIC_DEV_PASSKEY=1 or the app points at a local cleartext mock.
 */
export function devPasskeyActive(): boolean {
  if (!DEV_TOOLS) return false;
  // Web: only when asked for explicitly, so browser runs (including a virtual authenticator on
  // localhost) use real WebAuthn with the configured rpId.
  if (Platform.OS === "web") return process.env.EXPO_PUBLIC_DEV_PASSKEY === "1";
  return process.env.EXPO_PUBLIC_DEV_PASSKEY === "1" || /^http:\/\/(localhost|127\.0\.0\.1|10\.0\.2\.2)(:|\/|$)/.test(getApiBase());
}

const ACCOUNT_KEY = "mirror.account.v1";
const NOTIFY_KEY = "mirror.notify.v1";
const DEV_SECRET_KEY = "mirror.devpasskey.v1";

export interface StoredAccount {
  address: Address;
  credentialId: string;
  createdAt: number;
  device?: string;
  restored?: boolean;
}

// ---------- dev passkey simulator ----------
async function devPrf(create: boolean, salt: Uint8Array = NS_ACCOUNT): Promise<{ credentialId: string; prfOutput: Uint8Array }> {
  if (!DEV_TOOLS) throw new Error("unavailable");
  let secret = await SecureStore.getItem(DEV_SECRET_KEY);
  if (!secret) {
    if (!create) throw Object.assign(new Error("No passkey for mirror.0xo.in on this device"), { code: "NO_CREDENTIAL" });
    const b = new Uint8Array(32);
    globalThis.crypto.getRandomValues(b);
    const seedEnv = process.env.EXPO_PUBLIC_DEV_PASSKEY_SEED;
    secret = seedEnv ? base64.encode(sha256(utf8ToBytes(seedEnv))) : base64.encode(b);
    await SecureStore.setItem(DEV_SECRET_KEY, secret);
  }
  const s = base64.decode(secret);
  const prfOutput = sha256(new Uint8Array([...s, ...salt]));
  return { credentialId: "dev-" + base64.encode(sha256(s)).replace(/[+/=]/g, "").slice(0, 22), prfOutput };
}

// ---------- storage ----------
export async function loadAccount(): Promise<StoredAccount | null> {
  const raw = await SecureStore.getItem(ACCOUNT_KEY);
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as StoredAccount;
    if (!/^0x[0-9a-fA-F]{40}$/.test(v.address) || typeof v.credentialId !== "string") return null;
    return v;
  } catch {
    return null;
  }
}

async function saveAccount(a: StoredAccount, notifyPrf: Uint8Array) {
  await SecureStore.setItem(ACCOUNT_KEY, JSON.stringify(a));
  // Decrypt-only key from the notification namespace, needed in the background to open push
  // payloads without a prompt.
  await SecureStore.setItem(NOTIFY_KEY, encodeKeyPair(deriveNotifyKey(notifyPrf)));
}

/** Notification namespace on its own (one more prompt), for providers that ignore `eval.second`. */
async function notifyPrfAlone(credentialId: string): Promise<Uint8Array> {
  const got = await getPasskeyPrfOutput({
    rpId: RP_ID,
    prfSalt: NS_NOTIFY,
    credential: { credentialId },
    webAuthnClient,
  });
  return got.prfOutput;
}

export async function loadNotifyKey(): Promise<NotifyKeyPair | null> {
  const raw = await SecureStore.getItem(NOTIFY_KEY);
  return raw ? decodeKeyPair(raw) : null;
}

export async function signOutDevice(): Promise<void> {
  await SecureStore.deleteItem(ACCOUNT_KEY);
  await SecureStore.deleteItem(NOTIFY_KEY);
}

// ---------- ceremonies ----------
export async function createAccount(deviceName?: string): Promise<StoredAccount> {
  let credentialId: string;
  let prfOutput: Uint8Array;
  let notifyPrf: Uint8Array | undefined;
  if (DEV_TOOLS && devPasskeyActive()) {
    ({ credentialId, prfOutput } = await devPrf(true));
    notifyPrf = (await devPrf(false, NS_NOTIFY)).prfOutput;
  } else {
    const { result: created, second } = await withSecondSalt(NS_NOTIFY, () =>
      createPasskeyWithPrfOutput({
        rp: { id: RP_ID, name: BRAND },
        user: { name: `${BRAND} account`, displayName: `${BRAND} account` },
        webAuthnClient,
      }),
    );
    credentialId = created.credentialId;
    prfOutput = created.prfOutput;
    notifyPrf = second ?? (await notifyPrfAlone(credentialId));
  }
  try {
    const account: StoredAccount = { address: addressFromPrf(prfOutput), credentialId, createdAt: Date.now(), device: deviceName };
    await saveAccount(account, notifyPrf);
    return account;
  } finally {
    prfOutput.fill(0);
    notifyPrf.fill(0);
  }
}

/** Restore on any device from the synced passkey alone: no credential id is passed. */
export async function restoreAccount(deviceName?: string): Promise<StoredAccount> {
  let credentialId: string;
  let prfOutput: Uint8Array;
  let notifyPrf: Uint8Array | undefined;
  if (DEV_TOOLS && devPasskeyActive()) {
    ({ credentialId, prfOutput } = await devPrf(false));
    notifyPrf = (await devPrf(false, NS_NOTIFY)).prfOutput;
  } else {
    const { result: got, second } = await withSecondSalt(NS_NOTIFY, () =>
      getPasskeyPrfOutput({ rpId: RP_ID, webAuthnClient }),
    );
    credentialId = got.credentialId;
    prfOutput = got.prfOutput;
    notifyPrf = second ?? (await notifyPrfAlone(credentialId));
  }
  try {
    const account: StoredAccount = {
      address: addressFromPrf(prfOutput),
      credentialId,
      createdAt: Date.now(),
      device: deviceName,
      restored: true,
    };
    await saveAccount(account, notifyPrf);
    return account;
  } finally {
    prfOutput.fill(0);
    notifyPrf.fill(0);
  }
}

async function assertPrf(stored: StoredAccount): Promise<Uint8Array> {
  if (DEV_TOOLS && devPasskeyActive()) return (await devPrf(false)).prfOutput;
  const got = await getPasskeyPrfOutput({
    rpId: RP_ID,
    credential: { credentialId: stored.credentialId },
    webAuthnClient,
  });
  return got.prfOutput;
}

/**
 * Runs `fn` with a viem account backed by a scoped Mera signing session. One passkey prompt;
 * the session is ended (private key zeroed) as soon as `fn` settles.
 */
export async function withSigner<T>(fn: (account: LocalAccount, address: Address) => Promise<T>): Promise<T> {
  const stored = await loadAccount();
  if (!stored) throw new Error("No account on this device");
  const prf = await assertPrf(stored);
  const { session, address } = sessionFromPrf(prf);
  prf.fill(0);
  try {
    if (address.toLowerCase() !== stored.address.toLowerCase()) {
      throw new Error("This passkey belongs to a different account");
    }
    return await fn(toViemAccount(session) as LocalAccount, address);
  } finally {
    session.end();
  }
}

/** Optional recovery phrase export, behind a passkey prompt. The caller must not persist it. */
export async function exportRecoveryPhrase(): Promise<string[]> {
  const stored = await loadAccount();
  if (!stored) throw new Error("No account on this device");
  const prf = await assertPrf(stored);
  try {
    if (addressFromPrf(prf).toLowerCase() !== stored.address.toLowerCase()) throw new Error("Passkey mismatch");
    return mnemonicFromPrf(prf).split(" ");
  } finally {
    prf.fill(0);
  }
}

export function describeError(e: unknown): { title: string; detail: string; cancelled: boolean } {
  if (isMeraError(e)) {
    const cause = (e.cause ?? {}) as { error?: string; message?: string };
    const msg = `${cause.error ?? ""} ${cause.message ?? ""}`.toLowerCase();
    const cancelled = /cancel|abort|user/.test(msg);
    if (e.code === "PRF_UNAVAILABLE") {
      return { title: "This passkey provider can't derive keys", detail: "Use Google Password Manager on Android 14 or newer, or a browser with passkey PRF support (Chrome, Edge, Safari 18).", cancelled: false };
    }
    if (cancelled) return { title: "Passkey cancelled", detail: "Nothing was signed or created.", cancelled: true };
    if (/no credential|nocredential|no passkey|not found/.test(msg)) {
      return { title: "No passkey found", detail: `No ${BRAND} passkey is saved to this device's Google account.`, cancelled: false };
    }
    return { title: "Passkey didn't complete", detail: cause.message || e.message, cancelled: false };
  }
  const err = e as { message?: string; code?: string };
  if (err?.code === "NO_CREDENTIAL") return { title: "No passkey found", detail: err.message ?? "", cancelled: false };
  return { title: "Something went wrong", detail: err?.message ?? String(e), cancelled: false };
}
