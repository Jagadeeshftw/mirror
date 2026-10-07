// Mirror's Perpl builder fee: builder 26, 20 per 100,000 (0.02%) of the opening notional of every
// opening copy. Closes, stops and close-all never pay it. The owner's policy caps it
// (maxBuilderFeePer100K, default 20); a higher fee blocks the copy (BuilderFeeTooHigh).
import { formatFixed, toBig } from "./format";
import { BUILDER_FEE_PER_100K, BUILDER_ID, builderFeeCNS } from "./policy";
import type { FeedEvent, QuoteRow } from "./types";

export { BUILDER_FEE_PER_100K, BUILDER_ID };
export const FEES_DOC_URL = "https://mirror.0xo.in/docs/fees";

export function feeFor(notionalCNS: bigint | string, per100k = BUILDER_FEE_PER_100K): bigint {
  return builderFeeCNS(toBig(notionalCNS), per100k);
}

/** Fee charged on a copy, from its proof (`proof.builderFeeCNS`); 0 for closes; null when unknown. */
export function copyFeeCNS(e: FeedEvent): bigint | null {
  if (e.kind !== "Mirrored") return null;
  if ((e.orderType ?? 0) >= 2) return 0n;
  const v = (e.proof as { builderFeeCNS?: string } | undefined)?.builderFeeCNS;
  return v === undefined || v === null ? null : toBig(v);
}

/** Fee for the opening orders a follow plans now (match-now quote lines that will copy). */
export function plannedFeeCNS(rows: Pick<QuoteRow, "notionalCNS" | "wouldBlock" | "orderType">[]): bigint {
  return rows.filter((r) => !r.wouldBlock && r.orderType <= 1).reduce((s, r) => s + feeFor(r.notionalCNS), 0n);
}

/** "0.0017": fees are small, so four decimals of AUSD. */
export function feeText(cns: bigint): string {
  return formatFixed(cns, 6, 4);
}

export const FEE_PCT = `${(BUILDER_FEE_PER_100K / 1000).toFixed(2)}%`;
