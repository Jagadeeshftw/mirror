// Shared position links and suggested levels (design proposal-2 #share). The owner signs ShareLink once; anyone with
// the link sees a read-only card and may suggest a stop-loss / take-profit with a short note. The owner reviews it in
// the app: Accept is their own setLevels (ACTION_SET_LEVELS) and the engine only records which transaction carried it;
// Decline and Revoke are owner-signed. Links close for good when the position closes or flips side. No friend
// identity is stored; rate limits live in memory only.
import { decodeEventLog, getAddress, type Address, type Hex } from 'viem';
import { mirrorAccountAbi } from '../abi/MirrorAccount.js';
import type { Db } from '../db.js';
import type { Side } from '../domain/types.js';
import { fixed, type AlertPayload, type MarketText } from './alerts.js';
import { decodeNotifyKey, sealJson, type PushEnvelope } from './pushcrypto.js';
import { checkSuggestion, cleanNote, linkIdOk, parsePns, ShareError, shortAddr, urlIdOf, verifyShareSig, type LevelPair } from './share-rules.js';

export interface SharePosition { side: Side; lots: bigint; entryPNS: bigint; markPNS: bigint; depositCNS: bigint; pnlCNS: bigint }
export interface ShareReceipt { status: 'success' | 'reverted'; logs: { address: string; topics: Hex[]; data: Hex }[] }
export interface ShareLimits { linkIpHourly: number; linkHourly: number; ipHourly: number; maxOpenLinks: number; maxPending: number }

export interface ShareDeps {
  db: Db;
  chainId: number;
  readOwner: (account: Address) => Promise<Address>;
  /** The Perpl position of a Perpl account in a market (lots 0 when flat). */
  position: (perplAccountId: number, perpId: number) => Promise<SharePosition>;
  /** MirrorAccount.level(perpId). */
  level: (account: Address, perpId: number) => Promise<LevelPair & { side: number }>;
  /** The leader whose copy opened the market (address), for "copied from". */
  leaderOf?: (account: Address, perpId: number) => Promise<string | null>;
  market: (perpId: number) => MarketText | undefined;
  head: () => number;
  /** Delivers an encrypted alert to the owner's devices (PushService.deliver). */
  alert: (owner: string, account: string, p: AlertPayload) => Promise<unknown>;
  /** Notification public keys registered for the owner (push_subs). */
  ownerKeys: (owner: string) => string[];
  receipt: (hash: Hex) => Promise<ShareReceipt>;
  /** Content-free "something changed" on the account's stream. */
  publish: (account: string) => void;
  /** Counts a hit; throws RateLimitError when over. */
  hit: (key: string, max: number, windowMs: number, scope: string) => void;
  limits: ShareLimits;
  now?: () => number;
}

type LinkRow = { link_id: string; account: string; owner: string; perp_id: number; side: number; status: string; created_ms: number; created_block: number | null; ended_ms: number | null; ended_reason: string | null };
type SugRow = { id: number; link_id: string; account: string; perp_id: number; side: number; stop_loss_pns: string | null; take_profit_pns: string | null; prev_stop_loss_pns: string; prev_take_profit_pns: string; entry_pns: string; mark_pns: string; note: string; status: string; created_ms: number; decided_ms: number | null; tx_hash: string | null };
const HOUR = 3_600_000;
const sideName = (s: number) => (s === 1 ? 'short' : 'long');

export class ShareService {
  constructor(private readonly d: ShareDeps) {}
  private now() { return this.d.now?.() ?? Date.now(); }
  private nowSec() { return Math.floor(this.now() / 1000); }
  private link(id: Hex) { return this.d.db.get<LinkRow>('SELECT * FROM share_links WHERE link_id = ?', id); }
  private perplId(account: string) {
    return this.d.db.get<{ perpl_account_id: number | null }>('SELECT perpl_account_id FROM accounts WHERE address = ?', account.toLowerCase())?.perpl_account_id ?? null;
  }
  private async positionOf(account: string, perpId: number): Promise<SharePosition | null> {
    const id = this.perplId(account);
    return id ? this.d.position(id, perpId) : null;
  }

  /** POST /v1/share: the owner's signed ShareLink for an open position. */
  async create(b: { account: Address; perpId: number; linkId: Hex; deadline: bigint; signature: Hex }) {
    const account = b.account.toLowerCase();
    if (!this.d.db.get('SELECT 1 FROM accounts WHERE address = ?', account)) throw new ShareError(404, 'unknown_account', 'Unknown account');
    const linkId = b.linkId.toLowerCase() as Hex;
    if (!linkIdOk(linkId)) throw new ShareError(400, 'weak_link_id', 'linkId must be 32 random bytes');
    if (this.link(linkId)) throw new ShareError(409, 'link_exists', 'This link id is taken. Make a new one.');
    const owner = await this.d.readOwner(b.account);
    await verifyShareSig(b.account, this.d.chainId, { primaryType: 'ShareLink', message: { perpId: b.perpId, linkId, deadline: b.deadline } }, b.signature, owner, this.nowSec());
    const p = await this.positionOf(account, b.perpId);
    if (!p || p.lots === 0n) throw new ShareError(409, 'no_position', 'There is no open position in this market to share');
    const open = this.d.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM share_links WHERE account = ? AND status = 'open'", account)!.n;
    if (open >= this.d.limits.maxOpenLinks) throw new ShareError(429, 'too_many_links', `At most ${this.d.limits.maxOpenLinks} open links per account. Revoke one first.`);
    this.d.db.run('INSERT INTO share_links (link_id, account, owner, perp_id, side, deadline, signature, created_ms, created_block) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      linkId, account, owner.toLowerCase(), b.perpId, p.side, Number(b.deadline), b.signature, this.now(), this.d.head());
    this.d.publish(account);
    return { linkId, urlId: urlIdOf(linkId), status: 'open', perpId: b.perpId, side: sideName(p.side) };
  }

  /** Closes the link for good when the position is flat or on the other side. Returns the (possibly new) status. */
  private async refresh(l: LinkRow, p?: SharePosition | null): Promise<{ status: string; p: SharePosition | null }> {
    if (l.status !== 'open') return { status: l.status, p: null };
    const pos = p === undefined ? await this.positionOf(l.account, l.perp_id) : p;
    const reason = !pos || pos.lots === 0n ? 'position_closed' : pos.side !== l.side ? 'side_flipped' : null;
    if (!reason) return { status: 'open', p: pos };
    this.end(l, 'closed', reason);
    return { status: 'closed', p: pos };
  }

  private end(l: LinkRow, status: 'closed' | 'revoked', reason: string) {
    this.d.db.tx(() => {
      this.d.db.run("UPDATE share_links SET status = ?, ended_ms = ?, ended_reason = ? WHERE link_id = ? AND status = 'open'", status, this.now(), reason, l.link_id);
      this.d.db.run("UPDATE share_suggestions SET status = 'expired', decided_ms = ? WHERE link_id = ? AND status = 'pending'", this.now(), l.link_id);
    });
    this.d.publish(l.account);
  }

  /** Re-checks every open link (of one account): called on closes in the account feed and periodically. */
  async sweep(account?: string) {
    const rows = account
      ? this.d.db.all<LinkRow>("SELECT * FROM share_links WHERE status = 'open' AND account = ?", account.toLowerCase())
      : this.d.db.all<LinkRow>("SELECT * FROM share_links WHERE status = 'open'");
    let closed = 0;
    for (const l of rows) {
      try {
        if ((await this.refresh(l)).status !== 'open') closed++;
      } catch {
        /* chain read failed: try again next time */
      }
    }
    return closed;
  }

  /** GET /v1/share/:id: the friend's read-only card. Nothing that identifies the owner beyond the short address. */
  async card(linkId: Hex) {
    const l = this.link(linkId);
    if (!l) throw new ShareError(404, 'unknown_link', 'This link does not exist');
    const m = this.d.market(l.perp_id);
    const base = { status: l.status, perpId: l.perp_id, symbol: m?.symbol ?? `#${l.perp_id}`, side: sideName(l.side), sharedBy: shortAddr(getAddress(l.owner)), lotDecimals: m?.lotDecimals ?? 0, priceDecimals: m?.priceDecimals ?? 0 };
    const { status, p } = await this.refresh(l);
    if (status !== 'open' || !p) return { ...base, status, endedReason: status === 'revoked' ? 'revoked' : (this.link(linkId)?.ended_reason ?? 'position_closed') };
    const account = getAddress(l.account);
    const [lv, leader] = await Promise.all([this.d.level(account, l.perp_id), this.d.leaderOf?.(account, l.perp_id).catch(() => null)]);
    const own = lv.side === l.side;
    return {
      ...base,
      lotLNS: p.lots.toString(), entryPNS: p.entryPNS.toString(), markPNS: p.markPNS.toString(), depositCNS: p.depositCNS.toString(), pnlCNS: p.pnlCNS.toString(),
      stopLossPNS: own ? lv.stopLossPNS.toString() : '0', takeProfitPNS: own ? lv.takeProfitPNS.toString() : '0',
      copiedFrom: leader ? shortAddr(getAddress(leader)) : null, block: this.d.head(),
    };
  }

  /** POST /v1/share/:id/suggest. */
  async suggest(linkId: Hex, ip: string, b: { stopLossPNS?: unknown; takeProfitPNS?: unknown; note?: unknown }) {
    const l = this.link(linkId);
    if (!l) throw new ShareError(404, 'unknown_link', 'This link does not exist');
    if (l.status !== 'open') throw new ShareError(410, l.status, l.status === 'revoked' ? 'The owner revoked this link' : 'This position is closed');
    const sl = parsePns(b.stopLossPNS, 'stopLossPNS');
    const tp = parsePns(b.takeProfitPNS, 'takeProfitPNS');
    const n = cleanNote(b.note);
    if ('error' in n) throw new ShareError(400, 'bad_note', n.error);
    const { status, p } = await this.refresh(l);
    if (status !== 'open' || !p) throw new ShareError(410, 'closed', 'This position is closed');
    const lv = await this.d.level(getAddress(l.account), l.perp_id);
    // A level left from a position on the other side does not protect this one.
    const current: LevelPair = lv.side === p.side ? lv : { stopLossPNS: 0n, takeProfitPNS: 0n };
    const bad = checkSuggestion(p.side, p.markPNS, current, sl, tp);
    if (bad) throw Object.assign(new ShareError(400, `level_${bad.code}`, bad.message), { field: bad.field });
    const pending = this.d.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM share_suggestions WHERE link_id = ? AND status = 'pending'", linkId)!.n;
    if (pending >= this.d.limits.maxPending) throw new ShareError(429, 'too_many_pending', 'The owner has not looked at the earlier suggestions yet');
    // Counted only once the suggestion is valid, so a typo does not use up the hour.
    this.d.hit(`share-ip:${ip}`, this.d.limits.ipHourly, HOUR, 'suggestions per IP');
    this.d.hit(`share-link:${linkId}`, this.d.limits.linkHourly, HOUR, 'suggestions per link');
    this.d.hit(`share-link-ip:${linkId}:${ip}`, this.d.limits.linkIpHourly, HOUR, 'one suggestion per link per hour');
    const r = this.d.db.run(
      'INSERT INTO share_suggestions (link_id, account, perp_id, side, stop_loss_pns, take_profit_pns, prev_stop_loss_pns, prev_take_profit_pns, entry_pns, mark_pns, note, created_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      linkId, l.account, l.perp_id, l.side, sl?.toString() ?? null, tp?.toString() ?? null, current.stopLossPNS.toString(), current.takeProfitPNS.toString(), p.entryPNS.toString(), p.markPNS.toString(), n.note, this.now(),
    );
    const id = Number(r.lastInsertRowid);
    this.d.publish(l.account);
    void Promise.resolve(this.d.alert(l.owner, getAddress(l.account), this.alertPayload(id, l, sl, tp, n.note))).catch(() => {});
    return { id, status: 'pending', stopLossPNS: sl?.toString() ?? null, takeProfitPNS: tp?.toString() ?? null, prevStopLossPNS: current.stopLossPNS.toString(), prevTakeProfitPNS: current.takeProfitPNS.toString(), note: n.note };
  }

  alertPayload(id: number, l: Pick<LinkRow, 'account' | 'perp_id' | 'side'>, sl: bigint | null, tp: bigint | null, note: string): AlertPayload {
    const m = this.d.market(l.perp_id);
    const px = (v: bigint) => (m ? fixed(v, m.priceDecimals, 1) : v.toString());
    const parts = [sl !== null ? `Stop-loss ${px(sl)}` : null, tp !== null ? `take-profit ${px(tp)}` : null].filter(Boolean).join(' · ');
    const body = `${parts.charAt(0).toUpperCase()}${parts.slice(1)}${note ? ` · "${note}"` : ''}. Review it in Mirror.`;
    return { v: 1, kind: 'suggestion', title: `Suggested levels for ${m?.symbol ?? `#${l.perp_id}`} ${sideName(l.side)}`, body, account: getAddress(l.account), eventId: `suggestion:${id}`, txHash: null, timestamp: this.now() };
  }

  /** GET /v1/accounts/:account/share?key=: links and suggestions sealed to one of the owner's registered device keys. */
  async ownerList(account: Address, key: string): Promise<{ pending: number; sealed: PushEnvelope }> {
    const a = account.toLowerCase();
    const row = this.d.db.get<{ owner: string }>('SELECT owner FROM accounts WHERE address = ?', a);
    if (!row) throw new ShareError(404, 'unknown_account', 'Unknown account');
    const raw = (k: string) => { try { return decodeNotifyKey(k).toString('hex'); } catch { return null; } };
    const want = raw(key.replace(/ /g, '+'));
    if (!want || !this.d.ownerKeys(row.owner).some((k) => raw(k) === want)) throw new ShareError(403, 'unknown_key', 'Register this device key first (POST /v1/push/register)');
    await this.sweep(a);
    const links = this.d.db.all<LinkRow>('SELECT * FROM share_links WHERE account = ? ORDER BY created_ms DESC LIMIT 50', a);
    const sugs = this.d.db.all<SugRow>('SELECT * FROM share_suggestions WHERE account = ? ORDER BY id DESC LIMIT 100', a);
    const payload = {
      v: 1, account: getAddress(a),
      links: links.map((l) => ({ linkId: l.link_id, urlId: urlIdOf(l.link_id as Hex), perpId: l.perp_id, side: sideName(l.side), status: l.status, createdMs: l.created_ms, endedMs: l.ended_ms, endedReason: l.ended_reason })),
      suggestions: sugs.map((s) => ({
        id: s.id, linkId: s.link_id, perpId: s.perp_id, side: sideName(s.side), stopLossPNS: s.stop_loss_pns, takeProfitPNS: s.take_profit_pns, prevStopLossPNS: s.prev_stop_loss_pns, prevTakeProfitPNS: s.prev_take_profit_pns,
        entryPNS: s.entry_pns, markPNS: s.mark_pns, note: s.note, status: s.status, createdMs: s.created_ms, decidedMs: s.decided_ms, txHash: s.tx_hash,
      })),
    };
    return { pending: sugs.filter((s) => s.status === 'pending').length, sealed: sealJson(want, payload) };
  }

  /** POST /v1/share/:id/revoke (owner-signed ShareRevoke). Idempotent. */
  async revoke(linkId: Hex, deadline: bigint, signature: Hex) {
    const l = this.link(linkId);
    if (!l) throw new ShareError(404, 'unknown_link', 'This link does not exist');
    const account = getAddress(l.account);
    await verifyShareSig(account, this.d.chainId, { primaryType: 'ShareRevoke', message: { linkId, deadline } }, signature, await this.d.readOwner(account), this.nowSec());
    if (l.status === 'open') this.end(l, 'revoked', 'revoked');
    return { linkId, status: this.link(linkId)!.status };
  }

  private sug(id: number) {
    const s = this.d.db.get<SugRow>('SELECT * FROM share_suggestions WHERE id = ?', id);
    if (!s) throw new ShareError(404, 'unknown_suggestion', 'Unknown suggestion');
    return s;
  }

  /** POST /v1/share/suggestions/:id/decline (owner-signed ShareDecline). */
  async decline(id: number, deadline: bigint, signature: Hex) {
    const s = this.sug(id);
    const account = getAddress(s.account);
    await verifyShareSig(account, this.d.chainId, { primaryType: 'ShareDecline', message: { suggestionId: BigInt(id), deadline } }, signature, await this.d.readOwner(account), this.nowSec());
    if (s.status !== 'pending' && s.status !== 'declined') throw new ShareError(409, s.status, `This suggestion is already ${s.status}`);
    this.d.db.run("UPDATE share_suggestions SET status = 'declined', decided_ms = ? WHERE id = ? AND status = 'pending'", this.now(), id);
    this.d.publish(s.account);
    return { id, status: 'declined' };
  }

  /**
   * POST /v1/share/suggestions/:id/accept {txHash}: the owner's own setLevels went onchain. No signature: the
   * transaction is the proof. It must have succeeded and carry the account's LevelSet for this market with every
   * level the friend suggested.
   */
  async accepted(id: number, txHash: Hex) {
    const s = this.sug(id);
    if (s.status === 'accepted') return { id, status: 'accepted', txHash: s.tx_hash };
    if (s.status !== 'pending') throw new ShareError(409, s.status, `This suggestion is already ${s.status}`);
    const r = await this.d.receipt(txHash).catch(() => null);
    if (!r) throw new ShareError(404, 'unknown_tx', 'Transaction not found');
    if (r.status !== 'success') throw new ShareError(409, 'tx_reverted', 'The transaction reverted');
    const set = r.logs.filter((g) => g.address.toLowerCase() === s.account).flatMap((g) => {
      try {
        const e = decodeEventLog({ abi: mirrorAccountAbi, data: g.data, topics: g.topics as [Hex, ...Hex[]] });
        return e.eventName === 'LevelSet' ? [e.args as { perpId: number; side: number; stopLossPNS: bigint; takeProfitPNS: bigint }] : [];
      } catch {
        return [];
      }
    });
    const ok = set.some((e) => Number(e.perpId) === s.perp_id && Number(e.side) === s.side && (s.stop_loss_pns === null || e.stopLossPNS.toString() === s.stop_loss_pns) && (s.take_profit_pns === null || e.takeProfitPNS.toString() === s.take_profit_pns));
    if (!ok) throw new ShareError(409, 'levels_mismatch', 'The transaction did not set the suggested levels');
    this.d.db.run("UPDATE share_suggestions SET status = 'accepted', decided_ms = ?, tx_hash = ? WHERE id = ?", this.now(), txHash.toLowerCase(), id);
    this.d.publish(s.account);
    return { id, status: 'accepted', txHash: txHash.toLowerCase() };
  }
}
