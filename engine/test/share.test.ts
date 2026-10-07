import { randomBytes } from 'node:crypto';
import { concat, encodeAbiParameters, encodeEventTopics, hashTypedData, keccak256, toHex, type Address, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { beforeEach, describe, expect, it } from 'vitest';
import { mirrorAccountAbi } from '../src/abi/MirrorAccount.js';
import { Db } from '../src/db.js';
import type { AlertPayload } from '../src/services/alerts.js';
import { open, x25519PublicOf } from '../src/services/pushcrypto.js';
import { RateLimiter, RateLimitError } from '../src/services/ratelimit.js';
import { ShareService, type SharePosition, type ShareReceipt } from '../src/services/share.js';
import { checkSuggestion, cleanNote, linkIdOk, parseLinkId, shareTypedData, urlIdOf, type ShareMessage } from '../src/services/share-rules.js';

const owner = privateKeyToAccount('0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d');
const stranger = privateKeyToAccount('0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba');
const ACCT = '0x00000000000000000000000000000000000000a1' as Address;
const CHAIN = 143;
const BTC = { symbol: 'BTC', lotDecimals: 5, priceDecimals: 1 };
const nowSec = () => Math.floor(Date.now() / 1000);
const newLinkId = () => toHex(randomBytes(32));
const devicePriv = randomBytes(32);
const deviceKey = x25519PublicOf(devicePriv).toString('base64');

const sign = (m: ShareMessage, who = owner) => who.signTypedData(shareTypedData(ACCT, CHAIN, m) as never);

let db: Db;
let pos: SharePosition;
let level: { side: number; stopLossPNS: bigint; takeProfitPNS: bigint };
let alerts: AlertPayload[];
let published: string[];
let receipt: ShareReceipt | null;
let svc: ShareService;

beforeEach(() => {
  db = new Db(':memory:');
  db.run("INSERT INTO accounts (address, owner, salt, created_block, created_tx, perpl_account_id) VALUES (?, ?, '0x0', 1, '0x0', 77)", ACCT.toLowerCase(), owner.address.toLowerCase());
  db.run("INSERT INTO push_subs (id, owner, channel, target, notify_public_key, created_ms, updated_ms) VALUES ('app:1', ?, 'app', '', ?, 0, 0)", owner.address.toLowerCase(), deviceKey);
  pos = { side: 0, lots: 10n, entryPNS: 1_178_800n, markPNS: 1_184_205n, depositCNS: 2_960_000n, pnlCNS: 50_000n };
  level = { side: 0, stopLossPNS: 1_084_500n, takeProfitPNS: 1_414_560n };
  alerts = [];
  published = [];
  receipt = null;
  const limiter = new RateLimiter();
  svc = new ShareService({
    db, chainId: CHAIN,
    readOwner: async () => owner.address,
    position: async () => pos,
    level: async () => level,
    leaderOf: async () => '0x7a3f00000000000000000000000000000000c91e',
    market: () => BTC,
    head: () => 18_204_402,
    alert: async (_o, _a, p) => void alerts.push(p),
    ownerKeys: (o) => db.all<{ k: string }>('SELECT notify_public_key AS k FROM push_subs WHERE owner = ?', o).map((r) => r.k),
    receipt: async () => { if (!receipt) throw new Error('not found'); return receipt; },
    publish: (a) => void published.push(a),
    hit: (key, max, windowMs, scope) => { const r = limiter.hit(key, max, windowMs); if (!r.ok) throw new RateLimitError(scope, r.resetAt); },
    limits: { linkIpHourly: 1, linkHourly: 10, ipHourly: 20, maxOpenLinks: 3, maxPending: 20 },
  });
});

async function makeLink(perpId = 1) {
  const linkId = newLinkId();
  const deadline = BigInt(nowSec() + 600);
  const signature = await sign({ primaryType: 'ShareLink', message: { perpId, linkId, deadline } });
  return svc.create({ account: ACCT, perpId, linkId, deadline, signature });
}

describe('typed data and link ids', () => {
  it('ShareLink(uint32 perpId,bytes32 linkId,uint256 deadline) in the account Mirror Account v1 domain', () => {
    const linkId = `0x${'ab'.repeat(32)}` as Hex;
    const td = shareTypedData(ACCT, CHAIN, { primaryType: 'ShareLink', message: { perpId: 1, linkId, deadline: 5n } });
    const domainType = keccak256(toHex('EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)'));
    const sep = keccak256(encodeAbiParameters([{ type: 'bytes32' }, { type: 'bytes32' }, { type: 'bytes32' }, { type: 'uint256' }, { type: 'address' }], [domainType, keccak256(toHex('Mirror Account')), keccak256(toHex('1')), BigInt(CHAIN), ACCT]));
    const struct = keccak256(encodeAbiParameters([{ type: 'bytes32' }, { type: 'uint32' }, { type: 'bytes32' }, { type: 'uint256' }], [keccak256(toHex('ShareLink(uint32 perpId,bytes32 linkId,uint256 deadline)')), 1, linkId, 5n]));
    expect(hashTypedData(td as never)).toBe(keccak256(concat(['0x1901', sep, struct])));
  });
  it('bytes32 <-> 43-char base64url, both accepted; weak ids refused', () => {
    const id = newLinkId();
    expect(urlIdOf(id)).toHaveLength(43);
    expect(parseLinkId(urlIdOf(id))).toBe(id.toLowerCase());
    expect(parseLinkId(id)).toBe(id.toLowerCase());
    expect(parseLinkId('abc')).toBeNull();
    expect(linkIdOk(`0x${'00'.repeat(31)}01`)).toBe(false);
    expect(linkIdOk(id)).toBe(true);
  });
});

describe('note and level rules', () => {
  it('note: plain text, control/bidi/angle stripped, whitespace collapsed, 140 max, no links', () => {
    expect(cleanNote('  Funding <b>flipped</b>\n\n negative‮ ')).toEqual({ note: 'Funding bflipped/b negative' });
    expect(cleanNote('x'.repeat(140))).toEqual({ note: 'x'.repeat(140) });
    expect(cleanNote('x'.repeat(141))).toHaveProperty('error');
    expect(cleanNote('see https://evil.example')).toHaveProperty('error');
    expect(cleanNote('buy at scam.xyz')).toHaveProperty('error');
    expect(cleanNote(undefined)).toEqual({ note: '' });
    expect(cleanNote(5)).toHaveProperty('error');
  });
  it('the contract order rule per side, merged with the current level; reached-at-mark and far refused', () => {
    const cur = { stopLossPNS: 1000n, takeProfitPNS: 2000n };
    expect(checkSuggestion(0, 1500n, cur, null, 1800n)).toBeNull();
    expect(checkSuggestion(0, 1500n, cur, null, null)?.code).toBe('empty');
    expect(checkSuggestion(0, 1500n, { stopLossPNS: 0n, takeProfitPNS: 0n }, null, 1300n)?.code).toBe('reached');
    expect(checkSuggestion(0, 1500n, { stopLossPNS: 1700n, takeProfitPNS: 0n }, null, 1600n)?.code).toBe('order');
    expect(checkSuggestion(0, 1500n, cur, 1600n, null)?.code).toBe('reached');
    expect(checkSuggestion(0, 1500n, cur, null, 16_000n)?.code).toBe('far');
    // A short: stop above the take-profit, stop above the mark.
    const sc = { stopLossPNS: 2000n, takeProfitPNS: 1000n };
    expect(checkSuggestion(1, 1500n, sc, 1800n, 1200n)).toBeNull();
    expect(checkSuggestion(1, 1500n, sc, 1400n, null)?.code).toBe('reached');
    expect(checkSuggestion(1, 1500n, { stopLossPNS: 0n, takeProfitPNS: 1600n }, 1550n, null)?.code).toBe('order');
  });
});

describe('links', () => {
  it('owner-signed link on an open position; wrong signer, expiry, no position, reuse, cap', async () => {
    const r = await makeLink();
    expect(r).toMatchObject({ status: 'open', side: 'long', perpId: 1 });
    const linkId = newLinkId();
    const deadline = BigInt(nowSec() + 600);
    await expect(svc.create({ account: ACCT, perpId: 1, linkId, deadline, signature: await sign({ primaryType: 'ShareLink', message: { perpId: 1, linkId, deadline } }, stranger) })).rejects.toMatchObject({ code: 'not_owner' });
    const old = BigInt(nowSec() - 1);
    await expect(svc.create({ account: ACCT, perpId: 1, linkId, deadline: old, signature: await sign({ primaryType: 'ShareLink', message: { perpId: 1, linkId, deadline: old } }) })).rejects.toMatchObject({ code: 'expired' });
    await expect(svc.create({ account: ACCT, perpId: 2, linkId, deadline, signature: await sign({ primaryType: 'ShareLink', message: { perpId: 1, linkId, deadline } }) })).rejects.toMatchObject({ code: 'not_owner' });
    await expect(svc.create({ account: ACCT, perpId: 1, linkId: r.linkId, deadline, signature: await sign({ primaryType: 'ShareLink', message: { perpId: 1, linkId: r.linkId, deadline } }) })).rejects.toMatchObject({ code: 'link_exists' });
    await makeLink();
    await makeLink();
    await expect(makeLink()).rejects.toMatchObject({ code: 'too_many_links' });
    pos = { ...pos, lots: 0n };
    await expect(makeLink()).rejects.toMatchObject({ status: 409 });
  });
  it('friend card: numbers and the short owner only (no account or full owner address)', async () => {
    const r = await makeLink();
    const c = await svc.card(r.linkId);
    expect(c).toMatchObject({ status: 'open', symbol: 'BTC', side: 'long', entryPNS: '1178800', stopLossPNS: '1084500', takeProfitPNS: '1414560', sharedBy: `${owner.address.slice(0, 6)}…${owner.address.slice(-4)}`, copiedFrom: expect.stringMatching(/^0x7a3f…c91e$/i), block: 18_204_402 });
    const text = JSON.stringify(c).toLowerCase();
    expect(text).not.toContain(ACCT.toLowerCase().slice(2));
    expect(text).not.toContain(owner.address.toLowerCase().slice(2));
  });
  it('revoke is owner-signed; the card then shows revoked with no numbers and suggestions are refused', async () => {
    const r = await makeLink();
    const deadline = BigInt(nowSec() + 60);
    await expect(svc.revoke(r.linkId, deadline, await sign({ primaryType: 'ShareRevoke', message: { linkId: r.linkId, deadline } }, stranger))).rejects.toMatchObject({ code: 'not_owner' });
    expect(await svc.revoke(r.linkId, deadline, await sign({ primaryType: 'ShareRevoke', message: { linkId: r.linkId, deadline } }))).toMatchObject({ status: 'revoked' });
    const c = await svc.card(r.linkId);
    expect(c).toMatchObject({ status: 'revoked', endedReason: 'revoked' });
    expect(c).not.toHaveProperty('entryPNS');
    await expect(svc.suggest(r.linkId, '1.1.1.1', { takeProfitPNS: '1350000' })).rejects.toMatchObject({ status: 410, code: 'revoked' });
  });
  it('closes for good when the position closes (sweep) or flips side; pending suggestions expire', async () => {
    const r = await makeLink();
    await svc.suggest(r.linkId, '1.1.1.1', { takeProfitPNS: '1350000' });
    pos = { ...pos, lots: 0n };
    expect(await svc.sweep(ACCT)).toBe(1);
    expect(await svc.card(r.linkId)).toMatchObject({ status: 'closed', endedReason: 'position_closed' });
    pos = { ...pos, lots: 10n };
    expect((await svc.card(r.linkId)).status).toBe('closed');
    expect(db.get<{ status: string }>('SELECT status FROM share_suggestions')!.status).toBe('expired');
    const r2 = await makeLink();
    pos = { ...pos, side: 1 };
    expect(await svc.card(r2.linkId)).toMatchObject({ status: 'closed', endedReason: 'side_flipped' });
  });
});

describe('suggestions', () => {
  it('valid take-profit -> pending, sanitized note, encrypted-alert payload, stream ping', async () => {
    const r = await makeLink();
    const s = await svc.suggest(r.linkId, '1.1.1.1', { takeProfitPNS: '1350000', note: " Funding flipped\nnegative. <script>" });
    expect(s).toMatchObject({ status: 'pending', takeProfitPNS: '1350000', stopLossPNS: null, prevTakeProfitPNS: '1414560', note: 'Funding flipped negative. script' });
    await Promise.resolve();
    expect(alerts[0]).toMatchObject({ kind: 'suggestion', title: 'Suggested levels for BTC long', eventId: `suggestion:${s.id}`, txHash: null });
    expect(alerts[0]!.body).toBe('Take-profit 135,000.0 · "Funding flipped negative. script". Review it in Mirror.');
    expect(published).toContain(ACCT.toLowerCase());
  });
  it('refuses invalid levels before counting; one per link per IP per hour', async () => {
    const r = await makeLink();
    await expect(svc.suggest(r.linkId, '1.1.1.1', {})).rejects.toMatchObject({ code: 'level_empty' });
    await expect(svc.suggest(r.linkId, '1.1.1.1', { stopLossPNS: '1200000' })).rejects.toMatchObject({ code: 'level_reached' });
    await expect(svc.suggest(r.linkId, '1.1.1.1', { stopLossPNS: '-5' })).rejects.toMatchObject({ code: 'bad_level' });
    await expect(svc.suggest(r.linkId, '1.1.1.1', { stopLossPNS: '18446744073709551616' })).rejects.toMatchObject({ code: 'bad_level' });
    await expect(svc.suggest(r.linkId, '1.1.1.1', { takeProfitPNS: '1350000', note: 'x'.repeat(141) })).rejects.toMatchObject({ code: 'bad_note' });
    await svc.suggest(r.linkId, '1.1.1.1', { stopLossPNS: '1120000', takeProfitPNS: '1350000' });
    await expect(svc.suggest(r.linkId, '1.1.1.1', { takeProfitPNS: '1360000' })).rejects.toBeInstanceOf(RateLimitError);
    await svc.suggest(r.linkId, '2.2.2.2', { takeProfitPNS: '1360000' });
  });
  it('a short position follows the short rules', async () => {
    pos = { ...pos, side: 1, markPNS: 1_184_205n };
    level = { side: 1, stopLossPNS: 1_300_000n, takeProfitPNS: 0n };
    const r = await makeLink();
    await expect(svc.suggest(r.linkId, '1.1.1.1', { takeProfitPNS: '1250000' })).rejects.toMatchObject({ code: 'level_reached' });
    await expect(svc.suggest(r.linkId, '1.1.1.1', { takeProfitPNS: '1100000' })).resolves.toMatchObject({ status: 'pending' });
  });
  it('owner list is sealed to a registered device key; others are refused', async () => {
    const r = await makeLink();
    await svc.suggest(r.linkId, '1.1.1.1', { takeProfitPNS: '1350000', note: 'hi' });
    await expect(svc.ownerList(ACCT, x25519PublicOf(randomBytes(32)).toString('base64'))).rejects.toMatchObject({ status: 403 });
    const res = await svc.ownerList(ACCT, deviceKey.replace(/\+/g, ' '));
    expect(res.pending).toBe(1);
    const body = JSON.parse(open(devicePriv, res.sealed).toString());
    expect(body.links[0]).toMatchObject({ linkId: r.linkId, urlId: r.urlId, status: 'open', side: 'long' });
    expect(body.suggestions[0]).toMatchObject({ takeProfitPNS: '1350000', stopLossPNS: null, note: 'hi', status: 'pending' });
  });
  it('decline is owner-signed and final', async () => {
    const r = await makeLink();
    const s = await svc.suggest(r.linkId, '1.1.1.1', { takeProfitPNS: '1350000' });
    const deadline = BigInt(nowSec() + 60);
    const m = { primaryType: 'ShareDecline', message: { suggestionId: BigInt(s.id), deadline } } as const;
    await expect(svc.decline(s.id, deadline, await sign(m, stranger))).rejects.toMatchObject({ code: 'not_owner' });
    expect(await svc.decline(s.id, deadline, await sign(m))).toMatchObject({ status: 'declined' });
    await expect(svc.accepted(s.id, `0x${'11'.repeat(32)}`)).rejects.toMatchObject({ code: 'declined' });
  });
  it('accept is proven by the transaction: a successful LevelSet of the account with the suggested levels', async () => {
    const r = await makeLink();
    const s = await svc.suggest(r.linkId, '1.1.1.1', { takeProfitPNS: '1350000' });
    const log = (address: string, perpId: number, sl: bigint, tp: bigint) => ({
      address,
      topics: encodeEventTopics({ abi: mirrorAccountAbi, eventName: 'LevelSet', args: { perpId } }) as Hex[],
      data: encodeAbiParameters([{ type: 'uint8' }, { type: 'uint64' }, { type: 'uint64' }, { type: 'uint16' }], [0, sl, tp, 300]),
    });
    const tx = `0x${'22'.repeat(32)}` as Hex;
    receipt = { status: 'success', logs: [log(ACCT, 1, 1_084_500n, 1_360_000n)] };
    await expect(svc.accepted(s.id, tx)).rejects.toMatchObject({ code: 'levels_mismatch' });
    receipt = { status: 'success', logs: [log('0x00000000000000000000000000000000000000b2', 1, 1_084_500n, 1_350_000n)] };
    await expect(svc.accepted(s.id, tx)).rejects.toMatchObject({ code: 'levels_mismatch' });
    receipt = { status: 'reverted', logs: [] };
    await expect(svc.accepted(s.id, tx)).rejects.toMatchObject({ code: 'tx_reverted' });
    receipt = { status: 'success', logs: [log(ACCT, 1, 1_084_500n, 1_350_000n)] };
    expect(await svc.accepted(s.id, tx)).toMatchObject({ status: 'accepted', txHash: tx });
    expect(await svc.accepted(s.id, tx)).toMatchObject({ status: 'accepted' });
  });
});
