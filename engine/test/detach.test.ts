import { describe, expect, it } from 'vitest';
import { privateKeyToAccount } from 'viem/accounts';
import type { Address, Hex } from 'viem';
import { Db } from '../src/db.js';
import { applyDetach, clearDetachOnPolicy, copyTargets, detachTypedData, verifyDetach, DetachError, MAX_DETACH_TTL_SEC } from '../src/services/detach.js';
import { planCopy } from '../src/domain/planner.js';
import { LONG } from '../src/domain/types.js';

const owner = privateKeyToAccount('0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d');
const stranger = privateKeyToAccount('0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a');
const ACCOUNT = '0x00000000000000000000000000000000000000aa' as Address;
const OTHER = '0x00000000000000000000000000000000000000bb' as Address;
const CHAIN = 143;
const NOW = 1_800_000_000;

const sign = (who = owner, account = ACCOUNT, detached = true, deadline = BigInt(NOW + 600)) =>
  who.signTypedData(detachTypedData(account, CHAIN, detached, deadline)) as Promise<Hex>;
const code = async (p: Promise<unknown>) => p.then(() => 'ok', (e) => (e instanceof DetachError ? e.code : String(e)));

describe('Detach signature (EIP-712, domain Mirror Account v1, verifyingContract = the account)', () => {
  it('accepts the onchain owner', async () => {
    const sig = await sign();
    await expect(verifyDetach({ account: ACCOUNT, detached: true, deadline: BigInt(NOW + 600), signature: sig }, CHAIN, owner.address, NOW)).resolves.toBe(owner.address);
  });
  it('refuses a wrong signer', async () => {
    const sig = await sign(stranger);
    expect(await code(verifyDetach({ account: ACCOUNT, detached: true, deadline: BigInt(NOW + 600), signature: sig }, CHAIN, owner.address, NOW))).toBe('not_owner');
  });
  it('refuses an expired or too distant deadline', async () => {
    const past = BigInt(NOW - 1);
    expect(await code(verifyDetach({ account: ACCOUNT, detached: true, deadline: past, signature: await sign(owner, ACCOUNT, true, past) }, CHAIN, owner.address, NOW))).toBe('expired');
    const far = BigInt(NOW + MAX_DETACH_TTL_SEC + 1);
    expect(await code(verifyDetach({ account: ACCOUNT, detached: true, deadline: far, signature: await sign(owner, ACCOUNT, true, far) }, CHAIN, owner.address, NOW))).toBe('deadline_too_far');
  });
  it('refuses a signature made for another account (or another value)', async () => {
    const sig = await sign(owner, OTHER);
    expect(await code(verifyDetach({ account: ACCOUNT, detached: true, deadline: BigInt(NOW + 600), signature: sig }, CHAIN, owner.address, NOW))).toBe('not_owner');
    const t = await sign(owner, ACCOUNT, true);
    expect(await code(verifyDetach({ account: ACCOUNT, detached: false, deadline: BigInt(NOW + 600), signature: t }, CHAIN, owner.address, NOW))).toBe('not_owner');
  });
});

describe('applyDetach: stored state, feed item, replay, re-follow', () => {
  const setup = () => {
    const db = new Db(':memory:');
    db.run("INSERT INTO accounts (address, owner, salt, created_block, created_tx) VALUES (?, ?, '0x0', 1, '0x1')", ACCOUNT, owner.address.toLowerCase());
    const published: unknown[] = [];
    let head = 100;
    const deps = { db, chainId: CHAIN, explorerTx: 'https://x/tx/', readOwner: async () => owner.address, head: () => head, publish: (_a: string, ev: unknown) => published.push(ev) };
    return { db, deps, published, setHead: (h: number) => (head = h) };
  };
  const feed = (db: Db) => db.all<{ kind: string; data: string }>('SELECT kind, data FROM feed ORDER BY id');

  it('detaches, records "Stopped following; positions kept", refuses a replay, and a later policy clears it', async () => {
    const { db, deps, published, setHead } = setup();
    const deadline = BigInt(NOW + 600);
    const r = await applyDetach(deps, { account: ACCOUNT, detached: true, deadline, signature: await sign() }, NOW);
    expect(r.detached).toBe(true);
    expect(db.get<{ detached: number }>('SELECT detached FROM accounts')!.detached).toBe(1);
    expect(JSON.parse(feed(db)[0]!.data)).toMatchObject({ detached: true, label: 'Stopped following; positions kept' });
    expect(published).toHaveLength(1);
    expect(await code(applyDetach(deps, { account: ACCOUNT, detached: true, deadline, signature: await sign() }, NOW))).toBe('replayed');
    // A replayed old PolicyUpdated (before the detach) does not clear it; a new one does.
    expect(clearDetachOnPolicy(db, 'https://x/tx/', ACCOUNT, 90, '0xold')).toBeUndefined();
    setHead(120);
    const cleared = clearDetachOnPolicy(db, 'https://x/tx/', ACCOUNT, 101, '0xnew');
    expect(cleared).toMatchObject({ kind: 'Detached', onchain: false, txHash: null, label: 'Following again' });
    expect(db.get<{ detached: number }>('SELECT detached FROM accounts')!.detached).toBe(0);
  });
  it('a signed detached=false follows again', async () => {
    const { db, deps } = setup();
    await applyDetach(deps, { account: ACCOUNT, detached: true, deadline: BigInt(NOW + 600), signature: await sign() }, NOW);
    await applyDetach(deps, { account: ACCOUNT, detached: false, deadline: BigInt(NOW + 601), signature: await sign(owner, ACCOUNT, false, BigInt(NOW + 601)) }, NOW);
    expect(db.get<{ detached: number }>('SELECT detached FROM accounts')!.detached).toBe(0);
    expect(feed(db).map((f) => JSON.parse(f.data).label)).toEqual(['Stopped following; positions kept', 'Following again']);
  });
  it('unknown account and wrong owner', async () => {
    const { deps } = setup();
    expect(await code(applyDetach(deps, { account: OTHER, detached: true, deadline: BigInt(NOW + 600), signature: await sign(owner, OTHER) }, NOW))).toBe('unknown_account');
    expect(await code(applyDetach({ ...deps, readOwner: async () => stranger.address }, { account: ACCOUNT, detached: true, deadline: BigInt(NOW + 600), signature: await sign() }, NOW))).toBe('not_owner');
  });
});

describe('copier targets', () => {
  const f = (address: string, over: { paused?: boolean; detached?: boolean } = {}) => ({ address, paused: false, detached: false, ...over });
  it('skips detached accounts entirely (opens and closes)', () => {
    expect(copyTargets([f('a'), f('b', { detached: true })]).map((x) => x.address)).toEqual(['a']);
  });
  it('a paused account still receives the leader closes', () => {
    const targets = copyTargets([f('p', { paused: true })]);
    expect(targets.map((x) => x.address)).toEqual(['p']);
    // The leader went flat: the plan for the paused follower is a close (the contract only refuses opens while paused).
    const orders = planCopy({
      perpId: 1, follower: { side: LONG, lots: 4n }, holder: 7, holderTarget: 0n, triggerTarget: 0n,
      trigger: { leaderAccountId: 7, side: LONG, increased: false, leverageHdths: 0, leaderRef: `0x${'ab'.repeat(32)}`, leaderFillPNS: 0n, leaderEntryPNS: 0n },
      mark: 1_000_000n, maxSlippageBps: 100, safetyBps: 5, maxMatches: 10, maxEntryDeviationBps: 0,
    });
    expect(orders).toHaveLength(1);
    expect(orders[0]!).toMatchObject({ kind: 'close', orderType: 2, lotLNS: 4n });
  });
});
