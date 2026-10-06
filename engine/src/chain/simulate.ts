import { decodeEventLog, decodeFunctionResult, type Address, type Hex, type PublicClient } from 'viem';
import { mirrorAccountAbi } from '../abi/MirrorAccount.js';
import { decodeRevert, decodeRevertData, type DecodedRevert } from './errors.js';
import { BLOCK_REASONS, type BlockReason } from '../domain/types.js';

export interface BlockedInfo {
  reason: BlockReason;
  limit: bigint;
  actual: bigint;
}

export interface SimResult {
  ok: boolean;
  returnData?: Hex;
  revert?: DecodedRevert;
  /** Blocked events emitted during the simulated call (only when eth_simulateV1 is available). */
  blocked: BlockedInfo[];
  mirrored: number;
  withLogs: boolean;
}

let simulateV1Supported: boolean | undefined;

/**
 * Simulates a call. Uses eth_simulateV1 when the node supports it, so Blocked events (and their reasons) are
 * visible; otherwise falls back to eth_call, which only reports the return value or revert.
 */
export async function simulateCall(client: PublicClient, from: Address, to: Address, data: Hex): Promise<SimResult> {
  if (simulateV1Supported !== false) {
    try {
      const res = (await client.request({
        method: 'eth_simulateV1',
        params: [{ blockStateCalls: [{ calls: [{ from, to, data }] }], validation: false, traceTransfers: false }, 'latest'],
      } as never)) as Array<{ calls: Array<{ status: string; returnData: Hex; logs: Array<{ address: Address; topics: Hex[]; data: Hex }>; error?: { message: string; data?: Hex } }> }>;
      simulateV1Supported = true;
      const call = res[0]?.calls[0];
      if (!call) throw new Error('empty simulate result');
      if (call.status !== '0x1') {
        const revert = (call.error?.data && decodeRevertData(call.error.data)) || { name: 'Reverted', args: [], message: call.error?.message ?? 'reverted', data: call.error?.data };
        return { ok: false, revert, blocked: [], mirrored: 0, withLogs: true };
      }
      const blocked: BlockedInfo[] = [];
      let mirrored = 0;
      for (const l of call.logs) {
        try {
          const ev = decodeEventLog({ abi: mirrorAccountAbi, data: l.data, topics: l.topics as [Hex, ...Hex[]] });
          if (ev.eventName === 'Blocked') blocked.push({ reason: BLOCK_REASONS[ev.args.reason] ?? 'None', limit: ev.args.limit, actual: ev.args.actual });
          if (ev.eventName === 'Mirrored') mirrored += 1;
        } catch {
          /* other contracts' logs */
        }
      }
      return { ok: true, returnData: call.returnData, blocked, mirrored, withLogs: true };
    } catch (err) {
      const msg = String((err as Error).message ?? err).toLowerCase();
      if (msg.includes('not found') || msg.includes('not supported') || msg.includes('unsupported') || msg.includes('does not exist') || msg.includes('unknown method')) {
        simulateV1Supported = false;
      }
    }
  }
  try {
    const r = await client.call({ account: from, to, data });
    return { ok: true, returnData: r.data, blocked: [], mirrored: 0, withLogs: false };
  } catch (err) {
    return { ok: false, revert: decodeRevert(err), blocked: [], mirrored: 0, withLogs: false };
  }
}

export function decodeBool(data: Hex | undefined, fn: 'mirror'): boolean | undefined {
  if (!data || data === '0x') return undefined;
  try {
    return decodeFunctionResult({ abi: mirrorAccountAbi, functionName: fn, data }) as boolean;
  } catch {
    return undefined;
  }
}

export function decodeBoolArray(data: Hex | undefined, fn: 'follow' | 'matchNow'): readonly boolean[] | undefined {
  if (!data || data === '0x') return undefined;
  try {
    return decodeFunctionResult({ abi: mirrorAccountAbi, functionName: fn, data }) as readonly boolean[];
  } catch {
    return undefined;
  }
}
