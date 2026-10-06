import { randomBytes } from 'node:crypto';
import { getAddress, toHex, type Address, type Hex, type LocalAccount } from 'viem';

/** x402 PaymentRequirements (v2; v1 fields accepted). https://github.com/coinbase/x402/tree/main/specs */
export interface PaymentRequirements {
  scheme: string;
  network: string;
  asset: Address;
  amount?: string;
  maxAmountRequired?: string;
  payTo: Address;
  maxTimeoutSeconds?: number;
  resource?: string;
  description?: string;
  extra?: { name?: string; version?: string; assetTransferMethod?: string; [k: string]: unknown };
}

export interface PaymentRequired {
  x402Version: number;
  error?: string;
  resource?: { url: string; description?: string; mimeType?: string };
  accepts: PaymentRequirements[];
}

export interface X402Options {
  account: LocalAccount;
  /** CAIP-2 networks we are willing to pay on, in preference order (e.g. eip155:143 for Monad). */
  networks: string[];
  /** Refuse any requirement above this amount (token base units). */
  maxAmount: bigint;
  /** Called before signing; return false to refuse (budget checks). */
  approve?: (req: PaymentRequirements, amount: bigint) => boolean | Promise<boolean>;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

export class X402Error extends Error {
  constructor(message: string, readonly requirements?: PaymentRequired) {
    super(message);
  }
}

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64');
const unb64 = <T>(s: string): T => JSON.parse(Buffer.from(s, 'base64').toString('utf8')) as T;

const chainIdOf = (network: string): number => {
  const m = /^eip155:(\d+)$/.exec(network);
  if (!m) throw new X402Error(`unsupported network ${network}`);
  return Number(m[1]);
};

export async function parsePaymentRequired(res: Response): Promise<PaymentRequired> {
  const header = res.headers.get('payment-required');
  if (header) return unb64<PaymentRequired>(header);
  const body = (await res.json().catch(() => undefined)) as PaymentRequired | undefined;
  if (body?.accepts) return body;
  throw new X402Error('402 without payment requirements');
}

export function selectRequirement(pr: PaymentRequired, networks: string[]): PaymentRequirements | undefined {
  for (const n of networks) {
    const r = pr.accepts.find(
      (a) => a.scheme === 'exact' && a.network === n && (!a.extra?.assetTransferMethod || a.extra.assetTransferMethod === 'eip3009'),
    );
    if (r) return r;
  }
  return undefined;
}

/** Signs an ERC-3009 transferWithAuthorization for the `exact` EVM scheme and builds the payment payload. */
export async function buildPayment(account: LocalAccount, pr: PaymentRequired, req: PaymentRequirements, nowSec: number) {
  const value = BigInt(req.amount ?? req.maxAmountRequired ?? '0');
  const authorization = {
    from: account.address,
    to: getAddress(req.payTo),
    value: value.toString(),
    validAfter: String(nowSec - 600),
    validBefore: String(nowSec + (req.maxTimeoutSeconds ?? 60)),
    nonce: toHex(randomBytes(32)) as Hex,
  };
  const signature = await account.signTypedData({
    domain: { name: req.extra?.name ?? 'USD Coin', version: req.extra?.version ?? '2', chainId: chainIdOf(req.network), verifyingContract: getAddress(req.asset) },
    types: {
      TransferWithAuthorization: [
        { name: 'from', type: 'address' },
        { name: 'to', type: 'address' },
        { name: 'value', type: 'uint256' },
        { name: 'validAfter', type: 'uint256' },
        { name: 'validBefore', type: 'uint256' },
        { name: 'nonce', type: 'bytes32' },
      ],
    },
    primaryType: 'TransferWithAuthorization',
    message: {
      from: authorization.from,
      to: authorization.to,
      value,
      validAfter: BigInt(authorization.validAfter),
      validBefore: BigInt(authorization.validBefore),
      nonce: authorization.nonce,
    },
  });
  const payload = { signature, authorization };
  if (pr.x402Version >= 2) {
    return { header: 'PAYMENT-SIGNATURE', value: b64({ x402Version: 2, resource: pr.resource, accepted: req, payload }), amount: value };
  }
  return { header: 'X-PAYMENT', value: b64({ x402Version: 1, scheme: req.scheme, network: req.network, payload }), amount: value };
}

export interface PaidResponse {
  response: Response;
  paid: { amount: bigint; network: string; asset: Address; payTo: Address } | null;
  settlement: unknown;
}

/**
 * fetch with x402: on 402, pick an `exact` requirement on an allowed network, sign an ERC-3009 authorization,
 * retry once with the payment header (PAYMENT-SIGNATURE for v2, X-PAYMENT for v1).
 */
export async function x402Fetch(url: string, init: RequestInit, o: X402Options): Promise<PaidResponse> {
  const f = o.fetchImpl ?? fetch;
  const first = await f(url, { ...init, headers: { ...(init.headers as Record<string, string>), 'X-Payer-Address': o.account.address } });
  if (first.status !== 402) return { response: first, paid: null, settlement: null };
  const pr = await parsePaymentRequired(first);
  const req = selectRequirement(pr, o.networks);
  if (!req) throw new X402Error(`no acceptable payment option on ${o.networks.join(', ')}`, pr);
  const amount = BigInt(req.amount ?? req.maxAmountRequired ?? '0');
  if (amount > o.maxAmount) throw new X402Error(`price ${amount} exceeds cap ${o.maxAmount}`, pr);
  if (o.approve && !(await o.approve(req, amount))) throw new X402Error('payment not approved (budget)', pr);
  const nowSec = Math.floor((o.now ?? Date.now)() / 1000);
  const p = await buildPayment(o.account, pr, req, nowSec);
  const second = await f(url, { ...init, headers: { ...(init.headers as Record<string, string>), [p.header]: p.value } });
  const sr = second.headers.get('payment-response') ?? second.headers.get('x-payment-response');
  return {
    response: second,
    paid: second.ok ? { amount, network: req.network, asset: req.asset, payTo: req.payTo } : null,
    settlement: sr ? unb64(sr) : null,
  };
}
