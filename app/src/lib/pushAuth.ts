// Owner signature for push registration (engine services/pushauth.ts, docs/api.md "Push"). Registering this device's
// notification key decides who can read the owner's alerts and sealed share list, so the owner key signs it:
//   domain {name: "Mirror Push", version: "1", chainId}
//   PushRegister(address owner,bytes32 notifyPublicKey,bytes32 channelHash,uint256 deadline)
//   PushUnregister(address owner,bytes32 channelHash,uint256 deadline)
// channelHash = keccak256("<channel>:<target>"): "webpush:<endpoint>", "fcm:<device token>", "expo:<token>", "app:".
// Pure: the dev mock imports it too. Signing sessions and the remembered registration live in pushRegistration.ts.
import { getAddress, keccak256, stringToBytes, type LocalAccount } from "viem";
import { base64 } from "@scure/base";
import type { Address, Hex } from "./types";

export type PushChannel = "app" | "webpush" | "fcm" | "expo";
export const PUSH_DOMAIN = (chainId: number) => ({ name: "Mirror Push", version: "1", chainId }) as const;
export const PUSH_REGISTER_TYPES = {
  PushRegister: [
    { name: "owner", type: "address" },
    { name: "notifyPublicKey", type: "bytes32" },
    { name: "channelHash", type: "bytes32" },
    { name: "deadline", type: "uint256" },
  ],
} as const;
export const PUSH_UNREGISTER_TYPES = {
  PushUnregister: [
    { name: "owner", type: "address" },
    { name: "channelHash", type: "bytes32" },
    { name: "deadline", type: "uint256" },
  ],
} as const;
/** Well under the engine's one-hour limit. */
export const PUSH_SIG_TTL_SEC = 900;

export const channelHash = (channel: PushChannel, target: string): Hex => keccak256(stringToBytes(`${channel}:${channel === "app" ? "" : target}`));

const hex32 = (b64: string): Hex => {
  const b = base64.decode(b64);
  if (b.length !== 32) throw new Error("notifyPublicKey must be 32 bytes");
  return `0x${Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("")}` as Hex;
};

export const pushRegisterTypedData = (chainId: number, owner: Address, notifyPublicKeyB64: string, channel: PushChannel, target: string, deadline: bigint) => ({
  domain: PUSH_DOMAIN(chainId),
  types: PUSH_REGISTER_TYPES,
  primaryType: "PushRegister" as const,
  message: { owner: getAddress(owner), notifyPublicKey: hex32(notifyPublicKeyB64), channelHash: channelHash(channel, target), deadline },
});

export const pushUnregisterTypedData = (chainId: number, owner: Address, channel: Exclude<PushChannel, "app">, target: string, deadline: bigint) => ({
  domain: PUSH_DOMAIN(chainId),
  types: PUSH_UNREGISTER_TYPES,
  primaryType: "PushUnregister" as const,
  message: { owner: getAddress(owner), channelHash: channelHash(channel, target), deadline },
});

export const pushDeadline = (nowMs = Date.now()) => BigInt(Math.floor(nowMs / 1000) + PUSH_SIG_TTL_SEC);

/** The register body fields that carry the signature. `signer` is an open signing session (withSigner). */
export async function signPushRegister(signer: LocalAccount, chainId: number, owner: Address, notifyPublicKeyB64: string, channel: PushChannel, target: string) {
  const deadline = pushDeadline();
  const signature = (await signer.signTypedData!(pushRegisterTypedData(chainId, owner, notifyPublicKeyB64, channel, target, deadline))) as Hex;
  return { deadline: deadline.toString(), signature };
}

export async function signPushUnregister(signer: LocalAccount, chainId: number, owner: Address, channel: Exclude<PushChannel, "app">, target: string) {
  const deadline = pushDeadline();
  const signature = (await signer.signTypedData!(pushUnregisterTypedData(chainId, owner, channel, target, deadline))) as Hex;
  return { deadline: deadline.toString(), signature };
}

export interface PushRegRecord { owner: string; key: string; channel: PushChannel; hash: Hex }
/** Whether this exact owner + key + channel was registered from this device (no new signature needed). */
export function sameReg(r: PushRegRecord | null, owner: Address, key: string, channel: PushChannel, target: string) {
  return !!r && r.owner === owner.toLowerCase() && r.key === key && r.hash === channelHash(channel, target);
}
/** The owner's key is registered on this device for some channel (enough for the sealed share list). */
export function keyRegistered(r: PushRegRecord | null, owner: Address, key: string) {
  return !!r && r.owner === owner.toLowerCase() && r.key === key;
}
