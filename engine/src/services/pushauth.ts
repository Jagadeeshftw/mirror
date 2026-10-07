// Owner signatures for push registration (docs/api.md "Push"). Registering a device key decides who can read the
// owner's alerts and sealed share list, so the owner EOA (the passkey-derived key) signs it as EIP-712 typed data:
//   domain {name: "Mirror Push", version: "1", chainId}
//   PushRegister(address owner,bytes32 notifyPublicKey,bytes32 channelHash,uint256 deadline)
//   PushUnregister(address owner,bytes32 channelHash,uint256 deadline)
// channelHash = keccak256(utf8("<channel>:<target>")): "webpush:<endpoint>", "fcm:<device token>",
// "expo:<Expo token>" or "app:" for the in-app (SSE) channel alone. Deadlines are at most an hour ahead and every
// signature is accepted once (push_sig_used).
import { getAddress, hashTypedData, keccak256, recoverTypedDataAddress, stringToBytes, type Address, type Hex } from 'viem';
import type { Db } from '../db.js';

export const PUSH_DOMAIN_NAME = 'Mirror Push';
export const PUSH_DOMAIN_VERSION = '1';
export const MAX_PUSH_SIG_TTL_SEC = 3600;
export type PushChannel = 'app' | 'webpush' | 'fcm' | 'expo';

export const PUSH_TYPES = {
  PushRegister: [
    { name: 'owner', type: 'address' },
    { name: 'notifyPublicKey', type: 'bytes32' },
    { name: 'channelHash', type: 'bytes32' },
    { name: 'deadline', type: 'uint256' },
  ],
  PushUnregister: [
    { name: 'owner', type: 'address' },
    { name: 'channelHash', type: 'bytes32' },
    { name: 'deadline', type: 'uint256' },
  ],
} as const;

export type PushAuthMessage =
  | { primaryType: 'PushRegister'; message: { owner: Address; notifyPublicKey: Hex; channelHash: Hex; deadline: bigint } }
  | { primaryType: 'PushUnregister'; message: { owner: Address; channelHash: Hex; deadline: bigint } };

export const channelHash = (channel: PushChannel, target: string): Hex => keccak256(stringToBytes(`${channel}:${channel === 'app' ? '' : target}`));

export function pushTypedData(chainId: number, m: PushAuthMessage) {
  return {
    domain: { name: PUSH_DOMAIN_NAME, version: PUSH_DOMAIN_VERSION, chainId },
    types: { [m.primaryType]: PUSH_TYPES[m.primaryType] },
    primaryType: m.primaryType,
    message: m.message,
  } as const;
}

export class PushAuthError extends Error {
  readonly statusCode: number;
  constructor(statusCode: number, readonly code: string, message: string) {
    super(message);
    this.statusCode = statusCode;
  }
}

/**
 * Deadline window, signer == owner, and one use per signature. Throws PushAuthError (400 expired / deadline_too_far /
 * bad_signature, 401 not_owner, 409 replayed). On success the signature is spent.
 */
export async function verifyPushSig(db: Db, chainId: number, m: PushAuthMessage, signature: string | undefined, nowMs: number): Promise<void> {
  if (!signature || !/^0x[0-9a-fA-F]{130}$/.test(signature)) throw new PushAuthError(401, 'signature_required', 'An owner signature is required (PushRegister / PushUnregister typed data)');
  const nowSec = Math.floor(nowMs / 1000);
  const deadline = m.message.deadline;
  if (deadline < BigInt(nowSec)) throw new PushAuthError(400, 'expired', 'This approval expired. Sign again.');
  if (deadline > BigInt(nowSec + MAX_PUSH_SIG_TTL_SEC)) throw new PushAuthError(400, 'deadline_too_far', `Deadline more than ${MAX_PUSH_SIG_TTL_SEC} s ahead`);
  const td = pushTypedData(chainId, m) as never;
  let signer: Address;
  try {
    signer = await recoverTypedDataAddress({ ...(td as object), signature: signature as Hex } as never);
  } catch {
    throw new PushAuthError(400, 'bad_signature', 'Signature does not decode');
  }
  if (getAddress(signer) !== getAddress(m.message.owner)) throw new PushAuthError(401, 'not_owner', 'Signature is not from the owner');
  // The digest, not the signature bytes: a malleated (high-s) copy of the same approval is the same approval.
  const digest = hashTypedData(td);
  db.run('DELETE FROM push_sig_used WHERE expires_ms < ?', nowMs);
  const r = db.run('INSERT OR IGNORE INTO push_sig_used (digest, expires_ms) VALUES (?, ?)', digest, (Number(deadline) + 60) * 1000);
  if (!Number(r.changes)) throw new PushAuthError(409, 'replayed', 'This approval was already used. Sign again.');
}
