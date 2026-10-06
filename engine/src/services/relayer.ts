import { encodeFunctionData, getAddress, isAddress, isHex, pad, parseSignature, toHex, type Address, type Hex, type PublicClient } from 'viem';
import { z } from 'zod';
import { mirrorAccountAbi } from '../abi/MirrorAccount.js';
import { mirrorAccountFactoryAbi } from '../abi/MirrorAccountFactory.js';
import { authTokenAbi } from '../abi/erc20.js';
import { decodeRevert } from '../chain/errors.js';
import type { TxSender, SendResult } from '../chain/sender.js';
import type { Logger } from '../log.js';
import { metrics } from '../metrics.js';

export class RelayError extends Error {
  constructor(readonly status: number, message: string, readonly details?: unknown) {
    super(message);
  }
}

const address = z.string().refine((v) => isAddress(v), 'invalid address').transform((v) => getAddress(v));
const uint = z.union([z.string(), z.number()]).transform((v, ctx) => {
  try {
    const b = BigInt(v);
    if (b < 0n) throw new Error();
    return b;
  } catch {
    ctx.addIssue({ code: 'custom', message: 'expected unsigned integer' });
    return z.NEVER;
  }
});
const bytes32 = z.string().refine((v) => isHex(v) && v.length === 66, 'expected bytes32 hex').transform((v) => v as Hex);
const hex = z.string().refine((v) => isHex(v), 'expected hex').transform((v) => v as Hex);
const sigParts = z.object({ v: z.coerce.number().int().optional(), r: bytes32.optional(), s: bytes32.optional(), signature: hex.optional() });

function vrs(p: z.infer<typeof sigParts>): { v: number; r: Hex; s: Hex } {
  if (p.signature) {
    const sig = parseSignature(p.signature);
    return { v: Number(sig.v ?? BigInt(sig.yParity + 27)), r: sig.r, s: sig.s };
  }
  if (p.v === undefined || !p.r || !p.s) throw new RelayError(400, 'missing signature (v, r, s or signature)');
  return { v: p.v < 27 ? p.v + 27 : p.v, r: p.r, s: p.s };
}

export const CreateBody = z.object({
  owner: address,
  salt: z.union([z.string(), z.number()]).default('0').transform((v) => {
    if (typeof v === 'string' && isHex(v) && v.length === 66) return v as Hex;
    return pad(toHex(BigInt(v)), { size: 32 });
  }),
});

export const DepositBody = sigParts.extend({
  account: address,
  mode: z.enum(['permit', 'auth']),
  amount: uint,
  deadline: uint.optional(),
  validAfter: uint.optional(),
  validBefore: uint.optional(),
  nonce: bytes32.optional(),
});

export const ExecuteBody = z.object({
  account: address,
  action: z.object({ kind: z.coerce.number().int().min(1).max(255), data: hex, nonce: uint, deadline: uint }),
  signature: hex,
});

export const TransferBody = sigParts.extend({
  from: address,
  to: address,
  value: uint,
  validAfter: uint,
  validBefore: uint,
  nonce: bytes32,
});

export interface RelayResult {
  txHash: Hex;
  status: 'success' | 'reverted';
  block: number;
  gasUsed: string;
  gasLimit: string;
  revert?: string;
  [k: string]: unknown;
}

/**
 * Gasless relayer: every call is simulated with eth_call from the relayer first (reverts are returned to the
 * client, decoded, and nothing is sent), then submitted with an explicit gas limit (estimate x 1.2).
 */
export class Relayer {
  constructor(
    private readonly client: PublicClient,
    private readonly sender: TxSender,
    private readonly factory: Address | undefined,
    private readonly collateral: Address,
    private readonly log: Logger,
  ) {}

  get address() {
    return this.sender.address;
  }

  private async simulateAndSend(kind: string, to: Address, data: Hex): Promise<SendResult> {
    try {
      await this.client.call({ account: this.sender.address, to, data });
    } catch (err) {
      const r = decodeRevert(err);
      metrics.relayCalls.inc({ kind, outcome: 'simulation_reverted' });
      throw new RelayError(400, `simulation reverted: ${r.message}`, { error: r.name, args: r.args.map(String) });
    }
    const res = await this.sender.send({ to, data, label: `relay:${kind}` });
    metrics.relayCalls.inc({ kind, outcome: res.status });
    this.log.info({ kind, to, tx: res.hash, status: res.status, gasUsed: res.gasUsed.toString(), gasLimit: res.gasLimit.toString() }, 'relayed');
    return res;
  }

  private result(res: SendResult, extra: Record<string, unknown> = {}): RelayResult {
    return {
      txHash: res.hash,
      status: res.status,
      block: res.blockNumber,
      gasUsed: res.gasUsed.toString(),
      gasLimit: res.gasLimit.toString(),
      ...(res.revert ? { revert: res.revert.message } : {}),
      ...extra,
    };
  }

  async predict(owner: Address, salt: Hex): Promise<Address> {
    if (!this.factory) throw new RelayError(503, 'factory not configured');
    return this.client.readContract({ address: this.factory, abi: mirrorAccountFactoryAbi, functionName: 'predictAccount', args: [owner, salt] });
  }

  async isAccount(account: Address): Promise<boolean> {
    if (!this.factory) return false;
    return this.client.readContract({ address: this.factory, abi: mirrorAccountFactoryAbi, functionName: 'isAccount', args: [account] });
  }

  async create(b: z.infer<typeof CreateBody>): Promise<RelayResult | { status: 'exists'; account: Address }> {
    if (!this.factory) throw new RelayError(503, 'factory not configured');
    const account = await this.predict(b.owner, b.salt);
    if (await this.isAccount(account)) return { status: 'exists', account };
    const data = encodeFunctionData({ abi: mirrorAccountFactoryAbi, functionName: 'createAccount', args: [b.owner, b.salt] });
    const res = await this.simulateAndSend('create', this.factory, data);
    return this.result(res, { account, owner: b.owner, salt: b.salt });
  }

  async deposit(b: z.infer<typeof DepositBody>): Promise<RelayResult> {
    if (!(await this.isAccount(b.account))) throw new RelayError(404, 'not a MirrorAccount');
    const { v, r, s } = vrs(b);
    let data: Hex;
    if (b.mode === 'permit') {
      if (b.deadline === undefined) throw new RelayError(400, 'deadline required for permit');
      data = encodeFunctionData({ abi: mirrorAccountAbi, functionName: 'depositWithPermit', args: [b.amount, b.deadline, v, r, s] });
    } else {
      if (b.validAfter === undefined || b.validBefore === undefined || !b.nonce) throw new RelayError(400, 'validAfter, validBefore and nonce required for auth');
      data = encodeFunctionData({ abi: mirrorAccountAbi, functionName: 'depositWithAuthorization', args: [b.amount, b.validAfter, b.validBefore, b.nonce, v, r, s] });
    }
    return this.result(await this.simulateAndSend(`deposit_${b.mode}`, b.account, data), { account: b.account });
  }

  async execute(b: z.infer<typeof ExecuteBody>): Promise<RelayResult> {
    if (!(await this.isAccount(b.account))) throw new RelayError(404, 'not a MirrorAccount');
    const data = encodeFunctionData({
      abi: mirrorAccountAbi,
      functionName: 'execute',
      args: [{ kind: b.action.kind, data: b.action.data, nonce: b.action.nonce, deadline: b.action.deadline }, b.signature],
    });
    return this.result(await this.simulateAndSend(`execute_${b.action.kind}`, b.account, data), { account: b.account, kind: b.action.kind });
  }

  async transfer(b: z.infer<typeof TransferBody>): Promise<RelayResult> {
    const { v, r, s } = vrs(b);
    const data = encodeFunctionData({
      abi: authTokenAbi,
      functionName: 'transferWithAuthorization',
      args: [b.from, b.to, b.value, b.validAfter, b.validBefore, b.nonce, v, r, s],
    });
    return this.result(await this.simulateAndSend('transfer', this.collateral, data), { from: b.from, to: b.to });
  }

  async ownerOf(account: Address): Promise<Address | undefined> {
    try {
      return await this.client.readContract({ address: account, abi: mirrorAccountAbi, functionName: 'owner' });
    } catch {
      return undefined;
    }
  }
}
