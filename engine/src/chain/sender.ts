import {
  formatTransactionReceipt,
  keccak256,
  type Address,
  type Hex,
  type PrivateKeyAccount,
  type PublicClient,
  type TransactionReceipt,
} from 'viem';
import { NonceManager } from './nonce.js';
import { classifySendError, decodeRevert, type DecodedRevert } from './errors.js';
import type { Logger } from '../log.js';
import { metrics } from '../metrics.js';

export interface SendRequest {
  to: Address;
  data: Hex;
  value?: bigint;
  label: string;
  /**
   * Which headroom the estimate gets. 'book' is for calls whose gas depends on the Perpl book or on prices
   * (keeper copies, stop triggers, match now), which can move between estimate and inclusion. There is
   * deliberately no way to pass a gas limit: every limit is Monad's own eth_estimateGas x headroom.
   */
  gasProfile?: GasProfile;
}

export type GasProfile = 'standard' | 'book';

export interface SendResult {
  hash: Hex;
  from: Address;
  nonce: number;
  status: 'success' | 'reverted';
  blockNumber: number;
  blockHash: Hex;
  gasUsed: bigint;
  gasLimit: bigint;
  receipt: TransactionReceipt;
  sentMs: number;
  includedMs: number;
  revert?: DecodedRevert;
}

export class SimulationError extends Error {
  constructor(readonly revert: DecodedRevert) {
    super(`simulation reverted: ${revert.message}`);
  }
}
export class CircuitOpenError extends Error {}
export class SendError extends Error {
  constructor(message: string, readonly kind: string) {
    super(message);
  }
}

export interface SenderOptions {
  chainId: number;
  priorityFeeWei: bigint;
  /** Headroom over eth_estimateGas for ordinary calls (relays, demo orders). */
  gasMultiplier: number;
  /** Headroom for book- and price-dependent calls (keeper copies, stop triggers). */
  bookGasMultiplier: number;
  timeoutMs: number;
  circuitFailures: number;
  circuitCooldownMs: number;
}

/** Latest base fee, fed from new heads; falls back to eth_getBlock. */
export class FeeOracle {
  baseFee: bigint | undefined;
  constructor(private readonly client: PublicClient) {}
  update(baseFee: bigint | undefined) {
    if (baseFee !== undefined) this.baseFee = baseFee;
  }
  async get(): Promise<bigint> {
    if (this.baseFee === undefined) {
      const b = await this.client.getBlock();
      this.baseFee = b.baseFeePerGas ?? 100_000_000_000n;
    }
    return this.baseFee;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Signs locally and submits one signer's transactions: pipelined nonces, gas limits from the configured
 * Monad RPC's eth_estimateGas plus headroom and nothing else (Monad charges the full limit, so a limit priced
 * anywhere else is either wasted MON or an out-of-gas revert), EIP-1559 fees, eth_sendRawTransactionSync with a sendRawTransaction + receipt fallback, retries on
 * nonce/fee/timeout errors and a circuit breaker after repeated failures.
 */
export class TxSender {
  readonly nonces: NonceManager;
  private failures = 0;
  private openUntil = 0;
  private syncSupported: boolean | undefined;
  private broadcastMax = -1;

  constructor(
    readonly name: string,
    readonly account: PrivateKeyAccount,
    private readonly client: PublicClient,
    private readonly fees: FeeOracle,
    private readonly opts: SenderOptions,
    private readonly log: Logger,
  ) {
    this.nonces = new NonceManager(() => client.getTransactionCount({ address: account.address, blockTag: 'pending' }));
  }

  get address(): Address {
    return this.account.address;
  }
  get inflight() {
    return this.nonces.inflight;
  }
  get circuitOpen() {
    return Date.now() < this.openUntil;
  }

  multiplierFor(profile: GasProfile = 'standard'): number {
    return profile === 'book' ? this.opts.bookGasMultiplier : this.opts.gasMultiplier;
  }

  /** Gas limit for `req`: the configured RPC's eth_estimateGas from this signer, times the profile's headroom. */
  async estimate(req: Pick<SendRequest, 'to' | 'data' | 'value' | 'gasProfile'>): Promise<bigint> {
    try {
      const est = await this.client.estimateGas({ account: this.address, to: req.to, data: req.data, value: req.value });
      return withHeadroom(est, this.multiplierFor(req.gasProfile));
    } catch (err) {
      throw new SimulationError(decodeRevert(err));
    }
  }

  async send(req: SendRequest): Promise<SendResult> {
    if (this.circuitOpen) throw new CircuitOpenError(`${this.name} circuit open`);
    const gas = await this.estimate(req);
    let nonce = await this.nonces.allocate();
    let bump = 100n;
    let lastHash: Hex | undefined;
    const sentMs = Date.now();
    try {
      for (let attempt = 0; attempt < 5; attempt++) {
        const base = await this.fees.get();
        const prio = (this.opts.priorityFeeWei * bump) / 100n;
        const maxFee = ((base * 2n + this.opts.priorityFeeWei) * bump) / 100n;
        const raw = await this.account.signTransaction({
          chainId: this.opts.chainId,
          type: 'eip1559',
          nonce,
          gas,
          maxFeePerGas: maxFee,
          maxPriorityFeePerGas: prio,
          to: req.to,
          data: req.data,
          value: req.value ?? 0n,
        });
        try {
          const { hash, receipt } = await this.submitRaw(raw);
          lastHash = hash;
          this.broadcastMax = Math.max(this.broadcastMax, nonce);
          this.nonces.confirm(nonce);
          return this.finish(req, nonce, gas, hash, receipt, sentMs);
        } catch (err) {
          const kind = classifySendError(err);
          metrics.txErrors.inc({ sender: this.name, kind });
          this.log.warn({ sender: this.name, label: req.label, nonce, attempt, kind, err: (err as Error).message?.slice(0, 300) }, 'send attempt failed');
          if (kind === 'already_known' || kind === 'timeout') {
            const hash = (err as { hash?: Hex }).hash ?? lastHash ?? txHashOf(raw);
            const receipt = await this.waitReceipt(hash, this.opts.timeoutMs).catch(() => undefined);
            if (receipt) {
              this.broadcastMax = Math.max(this.broadcastMax, nonce);
              this.nonces.confirm(nonce);
              return this.finish(req, nonce, gas, hash, receipt, sentMs);
            }
            bump += 25n;
            continue;
          }
          if (kind === 'underpriced') {
            this.fees.update(undefined);
            bump += 25n;
            await sleep(100);
            continue;
          }
          if (kind === 'nonce_low') {
            if (lastHash) {
              const receipt = await this.waitReceipt(lastHash, 3_000).catch(() => undefined);
              if (receipt) {
                this.nonces.confirm(nonce);
                return this.finish(req, nonce, gas, lastHash, receipt, sentMs);
              }
            }
            // The nonce was consumed elsewhere: count it as used and take a fresh one.
            this.nonces.confirm(nonce);
            await this.nonces.resync();
            nonce = await this.nonces.allocate();
            bump = 100n;
            continue;
          }
          throw new SendError((err as Error).message ?? String(err), kind);
        }
      }
      throw new SendError('retries exhausted', 'retries');
    } catch (err) {
      if (!(err instanceof SimulationError)) {
        if (!lastHash) {
          this.nonces.release(nonce);
          if (nonce < this.broadcastMax) void this.fillGap(nonce);
        }
        this.recordFailure();
      }
      throw err;
    }
  }

  private finish(req: SendRequest, nonce: number, gas: bigint, hash: Hex, receipt: TransactionReceipt, sentMs: number): Promise<SendResult> | SendResult {
    const includedMs = Date.now();
    const base: SendResult = {
      hash,
      from: this.address,
      nonce,
      status: receipt.status,
      blockNumber: Number(receipt.blockNumber),
      blockHash: receipt.blockHash,
      gasUsed: receipt.gasUsed,
      gasLimit: gas,
      receipt,
      sentMs,
      includedMs,
    };
    metrics.txSent.inc({ sender: this.name, status: receipt.status });
    if (receipt.status === 'success') {
      this.failures = 0;
      return base;
    }
    this.recordFailure();
    return this.replayRevert(req, receipt).then((revert) => ({ ...base, revert }));
  }

  private async replayRevert(req: SendRequest, receipt: TransactionReceipt): Promise<DecodedRevert> {
    try {
      await this.client.call({ account: this.address, to: req.to, data: req.data, blockNumber: receipt.blockNumber - 1n, gas: receipt.gasUsed * 2n });
      return { name: 'Unknown', args: [], message: 'reverted onchain (replay succeeded; state-dependent)' };
    } catch (err) {
      return decodeRevert(err);
    }
  }

  private async submitRaw(raw: Hex): Promise<{ hash: Hex; receipt: TransactionReceipt }> {
    if (this.syncSupported !== false) {
      try {
        const r = (await this.client.request({
          method: 'eth_sendRawTransactionSync',
          params: [raw],
        } as never)) as Record<string, unknown>;
        this.syncSupported = true;
        const receipt = formatTransactionReceipt(r as never) as TransactionReceipt;
        return { hash: receipt.transactionHash, receipt };
      } catch (err) {
        const invalidParams = (err as { code?: number }).code === -32602 || /invalid parameters/i.test(String((err as Error).message));
        if (classifySendError(err) !== 'unsupported' && !(invalidParams && this.syncSupported === undefined)) {
          // EIP-7966 timeouts carry the hash in error data.
          const data = (err as { data?: unknown }).data;
          if (typeof data === 'string' && /^0x[0-9a-f]{64}$/i.test(data)) Object.assign(err as object, { hash: data });
          throw err;
        }
        this.syncSupported = false;
        this.log.info({ sender: this.name }, 'eth_sendRawTransactionSync unsupported; falling back');
      }
    }
    const hash = await this.client.sendRawTransaction({ serializedTransaction: raw });
    const receipt = await this.waitReceipt(hash, this.opts.timeoutMs);
    return { hash, receipt };
  }

  private waitReceipt(hash: Hex, timeout: number) {
    return this.client.waitForTransactionReceipt({ hash, timeout, pollingInterval: 200, retryCount: 0 });
  }

  /**
   * Burns a released nonce with a zero-value self transfer so later pipelined transactions are not stuck. The
   * limit is estimated like every other transaction.
   */
  private async fillGap(nonce: number) {
    try {
      const gas = await this.estimate({ to: this.address, data: '0x', value: 0n });
      const base = await this.fees.get();
      const raw = await this.account.signTransaction({
        chainId: this.opts.chainId,
        type: 'eip1559',
        nonce,
        gas,
        maxFeePerGas: base * 2n + this.opts.priorityFeeWei,
        maxPriorityFeePerGas: this.opts.priorityFeeWei,
        to: this.address,
        value: 0n,
      });
      await this.submitRaw(raw);
      this.log.warn({ sender: this.name, nonce }, 'filled nonce gap');
    } catch (err) {
      this.log.error({ sender: this.name, nonce, err: (err as Error).message }, 'nonce gap fill failed; resyncing');
      await this.nonces.resync().catch(() => {});
    }
  }

  private recordFailure() {
    this.failures += 1;
    if (this.failures >= this.opts.circuitFailures) {
      this.openUntil = Date.now() + this.opts.circuitCooldownMs;
      this.failures = 0;
      metrics.circuitOpen.set(1, { sender: this.name });
      this.log.error({ sender: this.name, cooldownMs: this.opts.circuitCooldownMs }, 'circuit breaker opened');
      setTimeout(() => metrics.circuitOpen.set(0, { sender: this.name }), this.opts.circuitCooldownMs).unref();
    }
  }
}

/** estimate x multiplier, rounded up. Multipliers below 1 are refused: a limit under the estimate reverts. */
export function withHeadroom(estimate: bigint, multiplier: number): bigint {
  if (!(multiplier >= 1)) throw new Error(`gas multiplier must be >= 1 (got ${multiplier})`);
  const m = BigInt(Math.round(multiplier * 1000));
  return (estimate * m + 999n) / 1000n;
}

function txHashOf(raw: Hex): Hex {
  return keccak256(raw);
}

/** Several keeper signers; each copy goes to the least-busy signer whose circuit is closed. */
export class SenderPool {
  private rr = 0;
  constructor(readonly senders: TxSender[]) {
    if (!senders.length) throw new Error('SenderPool needs at least one sender');
  }
  pick(): TxSender {
    const ok = this.senders.filter((s) => !s.circuitOpen);
    if (!ok.length) throw new CircuitOpenError('all keeper circuits open');
    const min = Math.min(...ok.map((s) => s.inflight));
    const candidates = ok.filter((s) => s.inflight === min);
    return candidates[this.rr++ % candidates.length]!;
  }
  get addresses() {
    return this.senders.map((s) => s.address);
  }
}
