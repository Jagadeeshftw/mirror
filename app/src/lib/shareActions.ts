// Owner flows for shared position links. Create, revoke and decline are one passkey prompt each (an EIP-712 message
// the engine checks against the account's onchain owner). Accept is the ordinary ACTION_SET_LEVELS (useOwnerAction)
// followed by telling the engine which transaction carried it. The owner list arrives sealed to this device's
// notification key and is opened here, like an alert. The engine seals it only to keys the owner registered with a
// signed PushRegister, so creating a link also registers this device's key (in-app channel) in the same prompt when
// it is not registered yet.
import { api } from "./api";
import { openJson, publicKeyB64 } from "./notifyKey";
import { newLinkId, normalizeShareList, shareDeclineTypedData, shareLinkTypedData, shareRevokeTypedData, type ShareList } from "./shareLink";
import { keyRegistered } from "./pushAuth";
import { loadPushReg, registerSigned } from "./pushRegistration";
import type { Address, AppConfig, Hex } from "./types";
import { loadNotifyKey, withSigner } from "./wallet";

const deadline = () => BigInt(Math.floor(Date.now() / 1000) + 900);

export async function createShareLink(cfg: AppConfig, account: Address, perpId: number) {
  const linkId = newLinkId();
  const d = deadline();
  const keys = await loadNotifyKey();
  const key = keys ? publicKeyB64(keys) : null;
  const reg = await loadPushReg();
  const signature = await withSigner(async (signer, owner) => {
    const sig = await signer.signTypedData!(shareLinkTypedData(account, cfg.chainId, perpId, linkId, d));
    // Same passkey prompt: register this device's key so the owner list (suggestions) can be sealed to it.
    if (key && !keyRegistered(reg, owner, key)) await registerSigned(owner, key, "app", "", {}, { signer, chainId: cfg.chainId }).catch(() => {});
    return sig;
  });
  return api.shareCreate({ account, perpId, linkId, deadline: d.toString(), signature });
}

export async function revokeShareLink(cfg: AppConfig, account: Address, linkId: Hex) {
  const d = deadline();
  const signature = await withSigner((signer) => signer.signTypedData!(shareRevokeTypedData(account, cfg.chainId, linkId, d)));
  return api.shareRevoke(linkId, { deadline: d.toString(), signature });
}

export async function declineSuggestion(cfg: AppConfig, account: Address, id: number) {
  const d = deadline();
  const signature = await withSigner((signer) => signer.signTypedData!(shareDeclineTypedData(account, cfg.chainId, id, d)));
  return api.shareDecline(id, { deadline: d.toString(), signature });
}

/** Links and suggestions of one account, opened with this device's notification key. null without a key. */
export async function fetchShareList(owner: Address, account: Address): Promise<{ list: ShareList; pending: number } | null> {
  const keys = await loadNotifyKey();
  if (!keys) return null;
  const key = publicKeyB64(keys);
  let r;
  try {
    r = await api.shareList(account, key);
  } catch (e: any) {
    // This device's key is not registered for the owner (alerts never turned on here, no link made here). The
    // registration needs a passkey signature, so it happens on the next owner action, never from a background fetch.
    if (e?.status === 403) return null;
    throw e;
  }
  return { list: normalizeShareList(openJson<any>(keys, r.sealed), account), pending: r.pending };
}
