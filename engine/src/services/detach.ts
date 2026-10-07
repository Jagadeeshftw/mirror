// "Stop following, keep my positions": an owner-signed, engine-side state. A detached account receives no keeper
// copies at all (opens or closes); its positions stay with the owner. This is keeper behaviour, NOT enforced by
// the contract: the owner keeps full control onchain (levels, stops anyone can trigger, closeMarket, closeAll,
// withdraw), and a keeper could still send a copy the policy allows. Re-following (a new policy, or a signed
// detached=false) clears it.
import { getAddress, recoverTypedDataAddress, type Address, type Hex } from 'viem';
import type { Db } from '../db.js';
import { feedJson, insertFeed } from './feed.js';

export const DETACH_TYPES = { Detach: [{ name: 'detached', type: 'bool' }, { name: 'deadline', type: 'uint256' }] } as const;
/** A signature is accepted for at most this long after it is made. */
export const MAX_DETACH_TTL_SEC = 3600;

export function detachTypedData(account: Address, chainId: number, detached: boolean, deadline: bigint) {
  return {
    domain: { name: 'Mirror Account', version: '1', chainId, verifyingContract: getAddress(account) },
    types: DETACH_TYPES,
    primaryType: 'Detach' as const,
    message: { detached, deadline },
  };
}

export class DetachError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
  }
}

export interface DetachRequest {
  account: Address;
  detached: boolean;
  deadline: bigint;
  signature: Hex;
}

/** Checks the deadline and that the signer is `owner` (the account's onchain owner). Returns the signer. */
export async function verifyDetach(req: DetachRequest, chainId: number, owner: Address, nowSec: number): Promise<Address> {
  if (req.deadline < BigInt(nowSec)) throw new DetachError(400, 'expired', 'This approval expired. Sign again.');
  if (req.deadline > BigInt(nowSec + MAX_DETACH_TTL_SEC)) throw new DetachError(400, 'deadline_too_far', `Deadline more than ${MAX_DETACH_TTL_SEC} s ahead`);
  let signer: Address;
  try {
    signer = await recoverTypedDataAddress({ ...detachTypedData(req.account, chainId, req.detached, req.deadline), signature: req.signature });
  } catch {
    throw new DetachError(400, 'bad_signature', 'Signature does not decode');
  }
  if (signer.toLowerCase() !== owner.toLowerCase()) throw new DetachError(401, 'not_owner', 'Signature is not from the account owner');
  return signer;
}

/** Followers that should get keeper copies of a leader change: everyone except detached accounts (paused ones still get closes). */
export function copyTargets<T extends { detached?: boolean }>(followers: T[]): T[] {
  return followers.filter((f) => !f.detached);
}

const LABELS = { true: 'Stopped following; positions kept', false: 'Following again' } as const;

/** Feed row for a change of the detached state (engine-side, no transaction). Returns its JSON, or undefined if a duplicate. */
export function recordDetachFeed(db: Db, explorerTx: string, account: string, detached: boolean, block: number, ref: string, reason: 'signed' | 'policy') {
  const row = insertFeed(db, {
    account: account.toLowerCase(), kind: 'Detached', tx_hash: `engine:detach:${ref}`, log_index: 0, block, block_hash: null,
    ts: Math.floor(Date.now() / 1000), commit_state: 'offchain', leader_id: null, perp_id: null, order_type: null, lots: null, price: null, leverage: null,
    reason: null, limit_v: null, actual_v: null, leader_ref: null, keeper: null, amount: null, latency_ms: null,
    data: JSON.stringify({ detached, label: LABELS[String(detached) as 'true' | 'false'], reason }),
  });
  return row ? feedJson(row, explorerTx) : undefined;
}

/**
 * A new policy (setPolicy / follow, relayed or not) at `block` clears a detach made before it. Older replayed
 * PolicyUpdated logs (block <= the detach's head block) do not. Returns the feed JSON when it cleared.
 */
export function clearDetachOnPolicy(db: Db, explorerTx: string, account: string, block: number, txHash: string) {
  const r = db.get<{ detached: number; detached_block: number | null }>('SELECT detached, detached_block FROM accounts WHERE address = ?', account.toLowerCase());
  if (!r || r.detached !== 1 || block <= (r.detached_block ?? 0)) return undefined;
  db.run('UPDATE accounts SET detached = 0 WHERE address = ?', account.toLowerCase());
  return recordDetachFeed(db, explorerTx, account, false, block, `policy:${txHash}`, 'policy');
}

export interface DetachDeps {
  db: Db;
  chainId: number;
  explorerTx: string;
  /** The account's onchain owner (MirrorAccount.owner()). */
  readOwner: (account: Address) => Promise<Address>;
  head: () => number;
  publish?: (account: string, item: unknown) => void;
  /** Reload the account into the copier's registry. */
  refresh?: (account: string) => void;
}

/** POST /v1/accounts/:account/detach. Signatures are single-use: each must carry a later deadline than the last accepted. */
export async function applyDetach(d: DetachDeps, req: DetachRequest, nowSec = Math.floor(Date.now() / 1000)) {
  const addr = req.account.toLowerCase();
  const row = d.db.get<{ detach_deadline: number | null }>('SELECT detach_deadline FROM accounts WHERE address = ?', addr);
  if (!row) throw new DetachError(404, 'unknown_account', 'Unknown account');
  const owner = await d.readOwner(req.account);
  await verifyDetach(req, d.chainId, owner, nowSec);
  if (row.detach_deadline !== null && req.deadline <= BigInt(row.detach_deadline)) throw new DetachError(409, 'replayed', 'This approval was already used. Sign again.');
  const block = d.head();
  d.db.run('UPDATE accounts SET detached = ?, detached_block = ?, detach_deadline = ? WHERE address = ?', req.detached ? 1 : 0, block, Number(req.deadline), addr);
  d.refresh?.(addr);
  const item = recordDetachFeed(d.db, d.explorerTx, addr, req.detached, block, `${addr}:${req.deadline}`, 'signed');
  if (item) d.publish?.(addr, { type: 'feed', item });
  return { account: getAddress(req.account), detached: req.detached, block };
}
