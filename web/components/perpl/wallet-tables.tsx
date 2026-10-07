import React from "react";
import type { Wallet } from "@/lib/perpl/wallet";
import { lev, money, pct, price, size, utc } from "@/lib/perpl/format";
import { Estimate, NotAvailable, Panel, SideBadge, SourceLine, Td, Th, TxLink, signTone } from "./parts";
import { cn } from "@/lib/utils";

const hideSm = "hidden md:table-cell";

const KIND: Record<string, string> = {
  OPEN: "Open",
  INCREASE: "Add",
  DECREASE: "Reduce",
  CLOSE: "Close",
  INVERT: "Flip",
  LIQUIDATION: "Liquidated",
  DELEVERAGE: "Deleveraged",
};

export const PositionsTable = ({ data }: { data: Wallet }) => (
  <Panel title="Open positions" meta={<span className="inline-flex items-center gap-2">live from chain <Estimate>liq. is an estimate</Estimate></span>} id="pos">
    {data.positions.length === 0 ? (
      <p className="py-6 text-center text-sm text-muted-foreground">No open positions.</p>
    ) : (
      <div className="-mx-2 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr>
              <Th>Market</Th>
              <Th right>Size</Th>
              <Th right className={hideSm}>Entry</Th>
              <Th right className={hideSm}>Mark</Th>
              <Th right className={hideSm}>Liq. (est.)</Th>
              <Th right>To liq.</Th>
              <Th right>Lev.</Th>
              <Th right className={hideSm}>Deposit</Th>
              <Th right>uPnL</Th>
            </tr>
          </thead>
          <tbody>
            {data.positions.map((p) => (
              <tr key={p.perpId}>
                <Td>
                  <span className="flex items-center gap-2 font-medium">
                    {p.symbol} <SideBadge side={p.side} />
                  </span>
                </Td>
                <Td right>{size(p.size, p.sizeDecimals)}</Td>
                <Td right className={hideSm}>{price(p.entry, p.priceDecimals)}</Td>
                <Td right className={hideSm}>{price(p.mark, p.priceDecimals)}</Td>
                <Td right className={hideSm}>{p.liqPrice === null ? "none" : price(p.liqPrice, p.priceDecimals)}</Td>
                <Td right className={cn(p.liqDistance !== null && p.liqDistance < 0.1 && "text-negative")}>{p.liqDistance === null ? "—" : pct(p.liqDistance)}</Td>
                <Td right>{lev(p.leverage)}</Td>
                <Td right className={hideSm}>{money(p.deposit, 2)}</Td>
                <Td right className={signTone(p.pnl)}>
                  <span title={`incl. funding ${money(p.funding, 2, true)}`}>{money(p.pnl, 2, true)}</span>
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )}
    <SourceLine>
      getPositionV2 on the Exchange at block {data.block?.toLocaleString("en-US") ?? "—"}. uPnL includes accrued funding. Leverage = notional at mark /
      (deposit + uPnL). Liquidation estimated at maintenance margin plus taker fee on the position&apos;s own deposit, so it errs early.
    </SourceLine>
  </Panel>
);

export const FillsTable = ({ data }: { data: Wallet }) => {
  const h = data.history;
  if (!h.ok)
    return (
      <Panel title="Recent fills">
        <NotAvailable source="Mirror indexer" reason={h.configured ? h.reason : "NEXT_PUBLIC_INDEXER_URL is not set on this deployment"} />
      </Panel>
    );
  const fills = h.value.fills.slice(0, 25);
  return (
    <Panel title="Recent fills" meta={`${h.value.fills.length} position events in the indexed range`} id="fills">
      {fills.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">No position events in the indexed range.</p>
      ) : (
        <div className="-mx-2 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr>
                <Th>Time</Th>
                <Th>Market</Th>
                <Th>Action</Th>
                <Th right>Size</Th>
                <Th right className={hideSm}>Price</Th>
                <Th right className={hideSm}>Realised</Th>
                <Th right>Tx</Th>
              </tr>
            </thead>
            <tbody>
              {fills.map((f, i) => (
                <tr key={`${f.txHash}-${i}`}>
                  <Td className="font-mono text-xs text-muted-foreground">{utc(f.timestamp)}</Td>
                  <Td>
                    <span className="flex items-center gap-2">
                      {f.symbol} <SideBadge side={f.side} />
                    </span>
                  </Td>
                  <Td className={cn(f.kind === "LIQUIDATION" || f.kind === "DELEVERAGE" ? "text-negative" : "")}>{KIND[f.kind] ?? f.kind}</Td>
                  <Td right>{f.size === null ? "—" : size(f.size, f.sizeDecimals)}</Td>
                  <Td right className={hideSm}>
                    {price(f.price, f.priceDecimals)}
                    {f.priceEstimated && <span title="Last trade price: the position opened before the indexed range"> *</span>}
                  </Td>
                  <Td right className={cn(hideSm, signTone(f.realized))}>{f.realized ? money(f.realized, 2, true) : "—"}</Td>
                  <Td right>
                    <TxLink hash={f.txHash} />
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <SourceLine>Perpl position events (open, add, reduce, close, flip, liquidation, deleverage) from the Mirror indexer. Realised excludes funding and fees.</SourceLine>
    </Panel>
  );
};
