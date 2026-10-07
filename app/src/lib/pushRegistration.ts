// Signed push registration shared by the native (push.ts) and web (push.web.ts) builds and the share flows: one
// passkey prompt, or a signature inside a signing session that is already open (e.g. the share-link prompt). The last
// registration is remembered on the device so app starts never prompt again.
import type { LocalAccount } from "viem";
import { api } from "./api";
import { channelHash, signPushRegister, signPushUnregister, type PushChannel, type PushRegRecord } from "./pushAuth";
import * as SecureStore from "./secureStore";
import type { Address, WebPushSubscriptionJSON } from "./types";
import { withSigner } from "./wallet";

export async function pushChainId(): Promise<number> {
  const c = await api.pushConfig().catch(() => null);
  return c?.chainId ?? (await api.config()).chainId;
}

export async function registerSigned(
  owner: Address,
  notifyPublicKey: string,
  channel: PushChannel,
  target: string,
  extra: { fcmToken?: string; webPush?: WebPushSubscriptionJSON },
  opts: { signer?: LocalAccount; chainId?: number } = {},
) {
  const chainId = opts.chainId ?? (await pushChainId());
  const sign = (s: LocalAccount) => signPushRegister(s, chainId, owner, notifyPublicKey, channel, target);
  const sig = opts.signer ? await sign(opts.signer) : await withSigner((s) => sign(s));
  const r = await api.pushRegister({ owner, notifyPublicKey, ...extra, ...sig });
  await savePushReg(owner, notifyPublicKey, channel, target);
  return r;
}

export async function unregisterSigned(owner: Address, channel: Exclude<PushChannel, "app">, target: string) {
  const chainId = await pushChainId();
  const sig = await withSigner((s) => signPushUnregister(s, chainId, owner, channel, target));
  return api.pushUnregister({ owner, channel, target, ...sig });
}

// ---------------------------------------------------------------- last registration on this device

const REG_KEY = "mirror.pushreg.v1";

export async function loadPushReg(): Promise<PushRegRecord | null> {
  try {
    const raw = await SecureStore.getItem(REG_KEY);
    return raw ? (JSON.parse(raw) as PushRegRecord) : null;
  } catch {
    return null;
  }
}
export async function savePushReg(owner: Address, key: string, channel: PushChannel, target: string) {
  await SecureStore.setItem(REG_KEY, JSON.stringify({ owner: owner.toLowerCase(), key, channel, hash: channelHash(channel, target) }));
}
export async function clearPushReg() {
  await SecureStore.deleteItem(REG_KEY);
}
