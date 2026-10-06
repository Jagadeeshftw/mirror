import { BaseError, decodeErrorResult, type Hex } from 'viem';
import { mirrorAccountAbi } from '../abi/MirrorAccount.js';
import { mirrorAccountFactoryAbi } from '../abi/MirrorAccountFactory.js';

const abis = [mirrorAccountAbi, mirrorAccountFactoryAbi] as const;

export interface DecodedRevert {
  name: string;
  args: unknown[];
  message: string;
  data?: Hex;
}

function findData(err: unknown): Hex | undefined {
  if (err instanceof BaseError) {
    let data: Hex | undefined;
    err.walk((e) => {
      const d = (e as { data?: unknown }).data;
      if (typeof d === 'string' && d.startsWith('0x') && d.length >= 10) data = d as Hex;
      else if (d && typeof d === 'object' && typeof (d as { data?: unknown }).data === 'string') data = (d as { data: Hex }).data;
      return false;
    });
    return data;
  }
  const d = (err as { data?: unknown })?.data;
  return typeof d === 'string' && d.startsWith('0x') ? (d as Hex) : undefined;
}

export function decodeRevertData(data: Hex): DecodedRevert | undefined {
  for (const abi of abis) {
    try {
      const r = decodeErrorResult({ abi, data });
      const args = [...((r.args ?? []) as readonly unknown[])];
      return { name: r.errorName, args, message: `${r.errorName}(${args.map(String).join(', ')})`, data };
    } catch {
      /* try next */
    }
  }
  return undefined;
}

export function decodeRevert(err: unknown): DecodedRevert {
  const data = findData(err);
  if (data) {
    const d = decodeRevertData(data);
    if (d) return d;
  }
  const msg = err instanceof BaseError ? err.shortMessage : err instanceof Error ? err.message : String(err);
  return { name: 'Unknown', args: [], message: msg, data };
}

export type SendErrorKind = 'nonce_low' | 'already_known' | 'underpriced' | 'insufficient_funds' | 'timeout' | 'unsupported' | 'other';

export function classifySendError(err: unknown): SendErrorKind {
  const text = (err instanceof BaseError ? `${err.shortMessage} ${err.details ?? ''} ${err.message}` : String((err as Error)?.message ?? err)).toLowerCase();
  const code = (err as { code?: number })?.code ?? (err instanceof BaseError ? (err.walk((e) => typeof (e as { code?: unknown }).code === 'number') as { code?: number } | null)?.code : undefined);
  if (code === -32601 || text.includes('method not found') || text.includes('not supported') || text.includes('does not exist/is not available')) return 'unsupported';
  if (text.includes('nonce too low') || text.includes('nonce has already been used') || text.includes('invalid nonce') || text.includes('old nonce')) return 'nonce_low';
  if (text.includes('already known') || text.includes('known transaction') || text.includes('already imported')) return 'already_known';
  if (text.includes('underpriced') || text.includes('fee too low') || text.includes('max fee per gas less than block base fee') || text.includes('replacement')) return 'underpriced';
  if (text.includes('insufficient funds') || text.includes('insufficient balance')) return 'insufficient_funds';
  if (text.includes('timeout') || text.includes('timed out') || text.includes('took too long') || code === 4) return 'timeout';
  return 'other';
}
