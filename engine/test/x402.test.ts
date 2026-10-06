import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { verifyTypedData, type Address, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { x402Fetch, X402Error } from '../src/nansen/x402.js';

const payer = privateKeyToAccount('0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d');
const MONAD_USDC = '0x754704Bc059F8C67012fEd69BC8A327a5aafb603' as Address;
const PAY_TO = '0x93053f1e7A5eFEDa532Fe69CbbE43cBEc3A0F13f' as Address;

// Shape copied from a real Nansen 402 (PAYMENT-REQUIRED header, x402 v2), trimmed to two EVM options.
const requirements = (amount = '10000') => ({
  x402Version: 2,
  error: 'Payment required',
  resource: { url: 'http://mock/api/v1/profiler/address/pnl-summary', description: 'Get Address PnL Summary Data', mimeType: '' },
  accepts: [
    { scheme: 'exact', network: 'eip155:8453', asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', amount, payTo: PAY_TO, maxTimeoutSeconds: 300, extra: { name: 'USD Coin', version: '2' } },
    { scheme: 'exact', network: 'eip155:143', asset: MONAD_USDC, amount, payTo: PAY_TO, maxTimeoutSeconds: 300, extra: { name: 'USDC', version: '2' } },
  ],
});

type Seen = { payment?: any; valid?: boolean; payerHeader?: string };
let server: Server;
let base = '';
let price = '10000';
let version = 2;
const seen: Seen = {};

async function verify(p: any): Promise<boolean> {
  const a = p.payload.authorization;
  const accepted = version === 2 ? p.accepted : { network: p.network, asset: MONAD_USDC, payTo: PAY_TO, amount: price, extra: { name: 'USDC', version: '2' } };
  if (accepted.network !== 'eip155:143' || a.to !== PAY_TO || a.value !== price) return false;
  if (Number(a.validBefore) <= Math.floor(Date.now() / 1000)) return false;
  return verifyTypedData({
    address: a.from as Address,
    domain: { name: accepted.extra.name, version: accepted.extra.version, chainId: 143, verifyingContract: accepted.asset },
    types: {
      TransferWithAuthorization: [
        { name: 'from', type: 'address' }, { name: 'to', type: 'address' }, { name: 'value', type: 'uint256' },
        { name: 'validAfter', type: 'uint256' }, { name: 'validBefore', type: 'uint256' }, { name: 'nonce', type: 'bytes32' },
      ],
    },
    primaryType: 'TransferWithAuthorization',
    message: { from: a.from, to: a.to, value: BigInt(a.value), validAfter: BigInt(a.validAfter), validBefore: BigInt(a.validBefore), nonce: a.nonce as Hex },
    signature: p.payload.signature,
  });
}

beforeAll(async () => {
  server = createServer(async (req: IncomingMessage, res) => {
    const header = (version === 2 ? req.headers['payment-signature'] : req.headers['x-payment']) as string | undefined;
    if (!header) {
      seen.payerHeader = req.headers['x-payer-address'] as string;
      const body = JSON.stringify(requirements(price));
      if (version === 2) res.writeHead(402, { 'content-type': 'application/json', 'payment-required': Buffer.from(body).toString('base64') }).end('{}');
      else res.writeHead(402, { 'content-type': 'application/json' }).end(JSON.stringify({ ...requirements(price), x402Version: 1, accepts: requirements(price).accepts.map((a) => ({ ...a, maxAmountRequired: a.amount, amount: undefined })) }));
      return;
    }
    seen.payment = JSON.parse(Buffer.from(header, 'base64').toString());
    seen.valid = await verify(seen.payment);
    if (!seen.valid) return void res.writeHead(402).end('{}');
    const settle = Buffer.from(JSON.stringify({ success: true, transaction: '0x' + '11'.repeat(32), network: 'eip155:143', payer: payer.address })).toString('base64');
    res.writeHead(200, { 'content-type': 'application/json', 'payment-response': settle }).end(JSON.stringify({ realized_pnl_usd: 12.5, win_rate: 0.6, traded_times: 40, realized_pnl_percent: 3.1 }));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

const init = { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ wallet_address: '0x1', chain: 'monad' }) };

describe('x402 client', () => {
  it('pays a v2 402 on Monad with a valid ERC-3009 signature in PAYMENT-SIGNATURE', async () => {
    version = 2;
    price = '10000';
    const r = await x402Fetch(`${base}/api/v1/profiler/address/pnl-summary`, init, { account: payer, networks: ['eip155:143'], maxAmount: 50_000n });
    expect(r.response.status).toBe(200);
    expect(seen.valid).toBe(true);
    expect(seen.payerHeader).toBe(payer.address);
    expect(seen.payment.x402Version).toBe(2);
    expect(seen.payment.accepted.network).toBe('eip155:143');
    expect(seen.payment.payload.authorization.from).toBe(payer.address);
    expect(r.paid).toMatchObject({ amount: 10_000n, network: 'eip155:143' });
    expect(r.settlement).toMatchObject({ success: true });
    expect(await r.response.json()).toMatchObject({ win_rate: 0.6 });
  });

  it('falls back to v1 body requirements and the X-PAYMENT header', async () => {
    version = 1;
    const r = await x402Fetch(`${base}/x`, init, { account: payer, networks: ['eip155:143'], maxAmount: 50_000n });
    expect(r.response.status).toBe(200);
    expect(seen.payment.x402Version).toBe(1);
    expect(seen.valid).toBe(true);
    version = 2;
  });

  it('refuses prices above the per-call cap without signing', async () => {
    price = '7500000';
    seen.payment = undefined;
    await expect(x402Fetch(`${base}/x`, init, { account: payer, networks: ['eip155:143'], maxAmount: 50_000n })).rejects.toBeInstanceOf(X402Error);
    expect(seen.payment).toBeUndefined();
    price = '10000';
  });

  it('refuses when no requirement matches the allowed networks', async () => {
    await expect(x402Fetch(`${base}/x`, init, { account: payer, networks: ['eip155:1'], maxAmount: 50_000n })).rejects.toThrow(/no acceptable payment option/);
  });

  it('honours the budget hook', async () => {
    await expect(x402Fetch(`${base}/x`, init, { account: payer, networks: ['eip155:143'], maxAmount: 50_000n, approve: () => false })).rejects.toThrow(/budget/);
  });
});
