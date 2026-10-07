import { describe, expect, it } from 'vitest';
import { keccak256, parseTransaction, type Address, type Hex, type PublicClient } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import pino from 'pino';
import { FeeOracle, TxSender, withHeadroom, type SenderOptions } from '../src/chain/sender.js';

// anvil default key (test fixture only)
const account = privateKeyToAccount('0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d');
const TARGET = '0x00000000000000000000000000000000000000aa' as Address;
const log = pino({ level: 'silent' });

const opts: SenderOptions = { chainId: 143, priorityFeeWei: 2_000_000_000n, gasMultiplier: 1.2, bookGasMultiplier: 1.3, timeoutMs: 1_000, circuitFailures: 100, circuitCooldownMs: 1_000 };

type EstimateCall = { account: unknown; to: Address; data?: Hex; value?: bigint };

/**
 * A fake of the configured Monad RPC: records every eth_estimateGas and every raw transaction, returns a
 * fixed estimate per target, and answers eth_sendRawTransactionSync with a receipt.
 */
function fakeRpc(estimates: (c: EstimateCall) => bigint, failNonceOnce?: number, delayNonce?: number) {
  const estimateCalls: EstimateCall[] = [];
  const sent: Array<{ nonce: number; gas: bigint; to: Address | null | undefined }> = [];
  const failed = new Set<number>();
  const client = {
    async estimateGas(c: EstimateCall) {
      estimateCalls.push(c);
      return estimates(c);
    },
    async getTransactionCount() {
      return 0;
    },
    async getBlock() {
      return { baseFeePerGas: 100_000_000_000n, timestamp: 1n };
    },
    async request({ method, params }: { method: string; params: unknown[] }) {
      if (method !== 'eth_sendRawTransactionSync') throw new Error(`unexpected ${method}`);
      const raw = params[0] as Hex;
      const tx = parseTransaction(raw);
      if (delayNonce !== undefined && tx.nonce === delayNonce) await new Promise((r) => setTimeout(r, 30));
      if (failNonceOnce !== undefined && tx.nonce === failNonceOnce && !failed.has(tx.nonce)) {
        failed.add(tx.nonce);
        throw new Error('node rejected the transaction');
      }
      sent.push({ nonce: tx.nonce!, gas: tx.gas!, to: tx.to });
      return {
        transactionHash: keccak256(raw), blockHash: `0x${'11'.repeat(32)}`, blockNumber: '0x10', transactionIndex: '0x0', from: account.address, to: tx.to,
        status: '0x1', gasUsed: '0x5208', cumulativeGasUsed: '0x5208', effectiveGasPrice: '0x1', logs: [], logsBloom: `0x${'00'.repeat(256)}`, type: '0x2', contractAddress: null,
      };
    },
  };
  return { client: client as unknown as PublicClient, estimateCalls, sent };
}

describe('TxSender gas limits come only from Monad eth_estimateGas x headroom', () => {
  it('estimates on the configured RPC from the signer and signs exactly withHeadroom(estimate)', async () => {
    const rpc = fakeRpc(() => 123_457n);
    const s = new TxSender('t', account, rpc.client, new FeeOracle(rpc.client), opts, log);
    const res = await s.send({ to: TARGET, data: '0x1234', label: 'test' });
    expect(rpc.estimateCalls).toHaveLength(1);
    expect(rpc.estimateCalls[0]).toMatchObject({ to: TARGET, data: '0x1234' });
    expect(rpc.sent).toHaveLength(1);
    expect(rpc.sent[0]!.gas).toBe(withHeadroom(123_457n, 1.2));
    expect(res.gasLimit).toBe(withHeadroom(123_457n, 1.2));
  });

  it("uses the book headroom for book-dependent calls (keeper copies, triggers)", async () => {
    const rpc = fakeRpc(() => 800_001n);
    const s = new TxSender('t', account, rpc.client, new FeeOracle(rpc.client), opts, log);
    await s.send({ to: TARGET, data: '0xabcd', label: 'mirror', gasProfile: 'book' });
    expect(rpc.sent[0]!.gas).toBe(withHeadroom(800_001n, 1.3));
  });

  it('estimates every transaction separately (no cached or fixed limit)', async () => {
    let n = 100_000n;
    const rpc = fakeRpc(() => (n += 1_000n));
    const s = new TxSender('t', account, rpc.client, new FeeOracle(rpc.client), opts, log);
    await s.send({ to: TARGET, data: '0x01', label: 'a' });
    await s.send({ to: TARGET, data: '0x02', label: 'b' });
    expect(rpc.estimateCalls).toHaveLength(2);
    expect(rpc.sent.map((x) => x.gas)).toEqual([withHeadroom(101_000n, 1.2), withHeadroom(102_000n, 1.2)]);
  });

  it('does not sign anything when the estimate reverts', async () => {
    const rpc = fakeRpc(() => {
      throw new Error('execution reverted');
    });
    const s = new TxSender('t', account, rpc.client, new FeeOracle(rpc.client), opts, log);
    await expect(s.send({ to: TARGET, data: '0x01', label: 'x' })).rejects.toThrow(/simulation reverted/);
    expect(rpc.sent).toHaveLength(0);
  });

  it('the nonce gap fill is estimated too and signed with withHeadroom(estimate)', async () => {
    // Nonce 0 fails before broadcast while nonce 1 is already out, so nonce 0 is burned with a self transfer.
    const rpc = fakeRpc((c) => (c.to === account.address ? 21_001n : 300_000n), 0, 0);
    const s = new TxSender('t', account, rpc.client, new FeeOracle(rpc.client), opts, log);
    const a = s.send({ to: TARGET, data: '0x01', label: 'a' });
    const b = s.send({ to: TARGET, data: '0x02', label: 'b' });
    await expect(a).rejects.toThrow(/rejected/);
    await b;
    for (let i = 0; i < 50 && rpc.sent.length < 2; i++) await new Promise((r) => setTimeout(r, 10));
    const fill = rpc.sent.find((x) => x.to?.toLowerCase() === account.address.toLowerCase());
    expect(fill).toBeDefined();
    expect(fill!.nonce).toBe(0);
    expect(fill!.gas).toBe(withHeadroom(21_001n, 1.2));
    expect(rpc.estimateCalls.some((c) => c.to === account.address && c.value === 0n)).toBe(true);
    // Every signed transaction's limit is an estimate x headroom.
    for (const t of rpc.sent) expect([withHeadroom(300_000n, 1.2), withHeadroom(21_001n, 1.2)]).toContain(t.gas);
  });

  it('refuses a multiplier below 1', () => {
    expect(() => withHeadroom(100n, 0.9)).toThrow();
    expect(withHeadroom(100n, 1.3)).toBe(130n);
  });
});
