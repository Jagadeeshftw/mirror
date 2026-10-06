"use client";
import { cn } from "@/lib/utils";
import { MARKETS } from "@/lib/data";
import { BETA_DEPOSIT_CAP } from "@/lib/site";
import { IconFingerprint } from "@tabler/icons-react";
import React from "react";
import { AppTopBar, Sparkline } from "./app-ui";

const ALLOWED = new Set(["BTC", "ETH", "SOL", "MON", "HYPE"]);

/** Leader profile with the Follow bottom sheet open — every policy control. */
export const FollowSheetScreen = () => {
  return (
    <div className="absolute inset-x-0 top-8 bottom-0">
      <AppTopBar />
      <div className="px-4">
        <p className="font-mono text-[12px] text-foreground">0x7a3e…41f3</p>
        <div className="mt-1 flex items-center gap-1.5">
          <span className="rounded-full bg-brand-soft px-1.5 py-0.5 text-[9px] font-medium text-brand">
            Smart Trader
          </span>
          <span className="text-[9px] text-muted-foreground">via Nansen</span>
        </div>
        <div className="mt-3 flex items-end justify-between">
          <div>
            <p className="text-[10px] text-muted-foreground">30d PnL</p>
            <p className="font-mono text-xl font-semibold text-positive">+38.2%</p>
          </div>
          <Sparkline className="h-8 w-28" animate={false} points={[10, 11, 10.6, 12, 12.8, 12.2, 13.6, 14.1, 13.8, 15.2, 16, 15.7, 17.1, 18]} />
        </div>
      </div>

      {/* scrim */}
      <div className="absolute inset-0 bg-black/35" />

      {/* bottom sheet */}
      <div className="absolute inset-x-0 bottom-0 rounded-t-[22px] border-t border-border bg-card px-4 pt-2 pb-6">
        <div className="mx-auto mb-2.5 h-1 w-8 rounded-full bg-foreground/20" />
        <p className="text-[13px] font-semibold text-foreground">
          Follow 0x7a3e…41f3
        </p>
        <p className="text-[9.5px] text-muted-foreground">
          Your rules are written to your contract and checked on every order.
        </p>

        <div className="mt-2.5 divide-y divide-border">
          <Row label="Allocation" value="20.00 AUSD" />
          <Row label="Sizing" value="50% of leader size" />
          <Row label="Max leverage" value="5x">
            <Slider pct={25} />
          </Row>
          <Row label="Max notional / market" value="10.00 AUSD" />
          <div className="py-1.5">
            <p className="text-[10px] text-muted-foreground">Allowed markets</p>
            <div className="mt-1 flex flex-wrap gap-1">
              {MARKETS.map((m) => (
                <span
                  key={m}
                  className={cn(
                    "rounded-full px-1.5 py-[1px] font-mono text-[8.5px] border",
                    ALLOWED.has(m)
                      ? "border-brand/40 bg-brand-soft text-brand"
                      : "border-border text-muted-foreground"
                  )}
                >
                  {m}
                </span>
              ))}
            </div>
          </div>
          <Row label="Daily loss stop" value="5%" />
          <Row label="High-water-mark stop" value="15%" />
          <Row label="Expires" value="31 Dec 2026" />
        </div>

        <div className="mt-2.5 flex h-9 items-center justify-center gap-1.5 rounded-full bg-primary text-[11px] font-semibold text-primary-foreground">
          <IconFingerprint className="size-3.5" />
          Follow · confirm with passkey
        </div>
        <p className="mt-1.5 text-center text-[9px] text-muted-foreground">
          Deposit limit {BETA_DEPOSIT_CAP} during beta
        </p>
      </div>
    </div>
  );
};

const Row = ({
  label,
  value,
  children,
}: {
  label: string;
  value: string;
  children?: React.ReactNode;
}) => (
  <div className="py-1.5">
    <div className="flex items-center justify-between">
      <span className="text-[10px] text-muted-foreground">{label}</span>
      <span className="font-mono text-[10.5px] font-medium text-foreground">
        {value}
      </span>
    </div>
    {children}
  </div>
);

const Slider = ({ pct }: { pct: number }) => (
  <div className="relative mt-1.5 h-1 rounded-full bg-muted">
    <div className="absolute inset-y-0 left-0 rounded-full bg-brand" style={{ width: `${pct}%` }} />
    <div
      className="absolute top-1/2 size-2.5 -translate-y-1/2 -translate-x-1/2 rounded-full border-2 border-card bg-brand shadow"
      style={{ left: `${pct}%` }}
    />
  </div>
);
