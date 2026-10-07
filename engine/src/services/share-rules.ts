// Shared position links: the pure parts. Owner-signed typed data (the account's "Mirror Account" v1 domain, as
// Detach), link ids, the friend's note clean-up, and the level checks a suggestion must pass before the owner
// ever sees it: the contract's own _setLevels rules for the position's side plus "not already hit at the mark".
import { getAddress, recoverTypedDataAddress, type Address, type Hex } from 'viem';
import { LONG, type Side } from '../domain/types.js';

export const SHARE_TYPES = {
  ShareLink: { ShareLink: [{ name: 'perpId', type: 'uint32' }, { name: 'linkId', type: 'bytes32' }, { name: 'deadline', type: 'uint256' }] },
  ShareRevoke: { ShareRevoke: [{ name: 'linkId', type: 'bytes32' }, { name: 'deadline', type: 'uint256' }] },
  ShareDecline: { ShareDecline: [{ name: 'suggestionId', type: 'uint256' }, { name: 'deadline', type: 'uint256' }] },
} as const;
export type ShareMessage =
  | { primaryType: 'ShareLink'; message: { perpId: number; linkId: Hex; deadline: bigint } }
  | { primaryType: 'ShareRevoke'; message: { linkId: Hex; deadline: bigint } }
  | { primaryType: 'ShareDecline'; message: { suggestionId: bigint; deadline: bigint } };

/** A signature is accepted for at most this long after it is made (as Detach). */
export const MAX_SHARE_TTL_SEC = 3600;
export const NOTE_MAX = 140;
/** uint64 (Level.stopLossPNS / takeProfitPNS). */
const U64_MAX = (1n << 64n) - 1n;

export function shareTypedData(account: Address, chainId: number, m: ShareMessage) {
  return {
    domain: { name: 'Mirror Account', version: '1', chainId, verifyingContract: getAddress(account) },
    types: SHARE_TYPES[m.primaryType],
    primaryType: m.primaryType,
    message: m.message,
  } as const;
}

export class ShareError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
  }
}

/** Deadline window and signer == the account's onchain owner. */
export async function verifyShareSig(account: Address, chainId: number, m: ShareMessage, signature: Hex, owner: Address, nowSec: number) {
  const deadline = m.message.deadline;
  if (deadline < BigInt(nowSec)) throw new ShareError(400, 'expired', 'This approval expired. Sign again.');
  if (deadline > BigInt(nowSec + MAX_SHARE_TTL_SEC)) throw new ShareError(400, 'deadline_too_far', `Deadline more than ${MAX_SHARE_TTL_SEC} s ahead`);
  let signer: Address;
  try {
    signer = await recoverTypedDataAddress({ ...(shareTypedData(account, chainId, m) as object), signature } as never);
  } catch {
    throw new ShareError(400, 'bad_signature', 'Signature does not decode');
  }
  if (signer.toLowerCase() !== owner.toLowerCase()) throw new ShareError(401, 'not_owner', 'Signature is not from the account owner');
}

// ---------------------------------------------------------------- link ids

/** bytes32 link id <-> the 43-character base64url id in /p/<id>. Both forms are accepted on every route. */
export function urlIdOf(linkId: Hex): string {
  return Buffer.from(linkId.slice(2), 'hex').toString('base64url');
}
export function parseLinkId(s: string): Hex | null {
  if (/^0x[0-9a-fA-F]{64}$/.test(s)) return s.toLowerCase() as Hex;
  if (!/^[A-Za-z0-9_-]{43}$/.test(s)) return null;
  const b = Buffer.from(s, 'base64url');
  return b.length === 32 ? (`0x${b.toString('hex')}` as Hex) : null;
}
/** A link id must carry real randomness: refuse all-zero and low-entropy ids (e.g. 0x00…01). */
export function linkIdOk(linkId: Hex): boolean {
  const b = Buffer.from(linkId.slice(2), 'hex');
  return b.length === 32 && new Set(b).size >= 12;
}

// ---------------------------------------------------------------- note

// Control characters, zero-width and bidi-override characters (they can disguise text), angle brackets.
const STRIP = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F​-‏‪-‮⁠-⁩﻿<>]/g;
const LINK = /(https?:\/\/|www\.|\b[a-z0-9-]+\.(com|io|xyz|net|org|app|gg|me|co|link|ly)\b)/i;

/** Plain text, one paragraph, at most 140 characters. Links are refused (spam). Returns the clean note or an error. */
export function cleanNote(raw: unknown): { note: string } | { error: string } {
  if (raw === undefined || raw === null) return { note: '' };
  if (typeof raw !== 'string') return { error: 'note must be text' };
  const t = raw.normalize('NFC').replace(STRIP, '').replace(/\s+/g, ' ').trim();
  if ([...t].length > NOTE_MAX) return { error: `note is longer than ${NOTE_MAX} characters` };
  if (LINK.test(t)) return { error: 'links are not allowed in the note' };
  return { note: t };
}

// ---------------------------------------------------------------- levels

export interface LevelPair {
  stopLossPNS: bigint;
  takeProfitPNS: bigint;
}

/** "112000.0"-free integer PNS from the request: a positive integer string, or absent. */
export function parsePns(v: unknown, field: string): bigint | null {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v !== 'string' && typeof v !== 'number') throw new ShareError(400, 'bad_level', `${field} must be an integer price`);
  const s = String(v);
  if (!/^\d{1,20}$/.test(s)) throw new ShareError(400, 'bad_level', `${field} must be an integer price`);
  const n = BigInt(s);
  if (n <= 0n || n > U64_MAX) throw new ShareError(400, 'bad_level', `${field} out of range`);
  return n;
}

/** The level the owner would sign if they accept: suggested fields replace the current ones, the rest stay. */
export function mergedLevel(current: LevelPair, sl: bigint | null, tp: bigint | null): LevelPair {
  return { stopLossPNS: sl ?? current.stopLossPNS, takeProfitPNS: tp ?? current.takeProfitPNS };
}

/**
 * The checks MirrorAccount._setLevels applies to a level for `side` (a long's stop below its take-profit, a short's
 * above), plus the app's own: a level already reached at the mark would fire at once, and a price more than 10x away
 * from the mark is not a level. Returns null when the suggestion may be shown to the owner.
 */
export function checkSuggestion(side: Side, markPNS: bigint, current: LevelPair, sl: bigint | null, tp: bigint | null): { field: 'sl' | 'tp'; code: string; message: string } | null {
  const long = side === LONG;
  if (sl === null && tp === null) return { field: 'sl', code: 'empty', message: 'Suggest a stop-loss, a take-profit or both' };
  const m = mergedLevel(current, sl, tp);
  if (m.stopLossPNS !== 0n && m.takeProfitPNS !== 0n && (long ? m.stopLossPNS >= m.takeProfitPNS : m.stopLossPNS <= m.takeProfitPNS)) {
    const field = sl !== null ? 'sl' : 'tp';
    return { field, code: 'order', message: long ? 'On a long the stop-loss must be below the take-profit' : 'On a short the stop-loss must be above the take-profit' };
  }
  if (markPNS > 0n) {
    if (sl !== null && (long ? sl >= markPNS : sl <= markPNS)) return { field: 'sl', code: 'reached', message: long ? 'Stop-loss must be below the mark, or it fires at once' : 'Stop-loss must be above the mark, or it fires at once' };
    if (tp !== null && (long ? tp <= markPNS : tp >= markPNS)) return { field: 'tp', code: 'reached', message: long ? 'Take-profit must be above the mark, or it fires at once' : 'Take-profit must be below the mark, or it fires at once' };
    for (const [f, v] of [['sl', sl], ['tp', tp]] as const) if (v !== null && (v * 10n < markPNS || v > markPNS * 10n)) return { field: f, code: 'far', message: 'Price is too far from the mark' };
  }
  return null;
}

export const shortAddr = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
