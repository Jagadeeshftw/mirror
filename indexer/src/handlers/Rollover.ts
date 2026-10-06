/**
 * Hourly window rollover. Windows are updated on every trade, but an account that stops trading
 * would keep stale 7d/30d/90d figures. Once the indexer is at the chain head, this handler rolls
 * every stale window forward to the current UTC day. During historical sync it is a no-op (each
 * account's windows are recomputed on its next trade instead), which keeps backfills fast.
 */
import { indexer } from "envio";

import { CHAIN_ID } from "../lib/constants.js";
import { dayOf } from "../lib/math.js";
import { refreshStaleWindows } from "../lib/store.js";

/** ~1 hour of Monad blocks (0.4 s block time). */
export const ROLLOVER_EVERY_BLOCKS = 9_000;

indexer.onBlock(
  {
    name: "WindowRollover",
    where: ({ chain }) => (chain.id === CHAIN_ID ? { block: { number: { _every: ROLLOVER_EVERY_BLOCKS } } } : false),
  },
  async ({ block, context }) => {
    if (!context.chain.isRealtime) return;
    const today = dayOf(Math.floor(Date.now() / 1000));
    const refreshed = await refreshStaleWindows(context, today);
    if (refreshed > 0 && !context.isPreload) {
      context.log.info(`window rollover at block ${block.number}: refreshed ${refreshed} accounts to day ${today}`);
    }
  },
);
