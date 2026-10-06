"use client";
import React, { useMemo, useState } from "react";
import { motion } from "motion/react";
import { Container } from "./container";
import { Eyebrow, Heading } from "./heading";
import { Subheading } from "./subheading";
import { GlowingEffect } from "./ui/glowing-effect";
import { Sparkline } from "./phone/app-ui";
import { LEADERS } from "@/lib/data";
import { cn } from "@/lib/utils";

type Period = "30D" | "7D";

const COLS =
  "grid grid-cols-[28px_1fr_auto] md:grid-cols-[36px_1.6fr_1fr_1fr_1fr_1.2fr_1.2fr_auto] items-center gap-3 md:gap-4";

export const Leaderboard = () => {
  const [period, setPeriod] = useState<Period>("30D");
  const rows = useMemo(
    () =>
      [...LEADERS].sort((a, b) =>
        period === "30D" ? b.pnl30 - a.pnl30 : b.pnl7 - a.pnl7
      ),
    [period]
  );

  return (
    <section id="leaders" className="py-20 md:py-28 lg:py-32">
      <Container>
        <div className="flex flex-col justify-between gap-6 lg:flex-row lg:items-end">
          <div>
            <Eyebrow>Leaderboard</Eyebrow>
            <Heading>Ranked by what they did onchain.</Heading>
          </div>
          <Subheading>
            Every public Perpl trader is scored on PnL, drawdown, win rate and
            consistency. Next: Nansen wallet intelligence for labels, fund
            status and cross-venue history.
          </Subheading>
        </div>

        <div className="relative mt-12 rounded-[1.75rem] border border-border p-1.5 md:mt-16 md:p-2">
          <GlowingEffect
            variant="brand"
            spread={48}
            glow
            disabled={false}
            proximity={80}
            inactiveZone={0.01}
            borderWidth={2}
          />
          <div className="relative overflow-hidden rounded-[1.4rem] border border-border bg-card">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3 md:px-6">
              <div className="flex items-center gap-2">
                <p className="text-sm font-semibold text-foreground">Top leaders</p>
                <span className="rounded-full bg-muted px-2 py-0.5 font-mono text-[10px] text-muted-foreground">
                  illustrative
                </span>
              </div>
              <div className="flex rounded-full border border-border bg-background p-0.5">
                {(["30D", "7D"] as Period[]).map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setPeriod(p)}
                    className={cn(
                      "relative cursor-pointer rounded-full px-3 py-1 font-mono text-xs transition-colors",
                      period === p ? "text-foreground" : "text-muted-foreground"
                    )}
                  >
                    {period === p && (
                      <motion.span
                        layoutId="period-pill"
                        className="absolute inset-0 rounded-full bg-card shadow-sm ring-1 ring-border"
                        transition={{ type: "spring", stiffness: 420, damping: 34 }}
                      />
                    )}
                    <span className="relative">{p}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className={cn(COLS, "border-b border-border px-4 py-2.5 text-[11px] font-medium text-muted-foreground md:px-6")}>
              <span>#</span>
              <span>Trader</span>
              <span className="text-right md:text-left">{period} PnL</span>
              <span className="hidden md:block">Max drawdown</span>
              <span className="hidden md:block">Win rate</span>
              <span className="hidden md:block">Consistency</span>
              <span className="hidden md:block">Equity</span>
              <span className="hidden md:block" />
            </div>

            <motion.ul layout>
              {rows.map((l, idx) => {
                const pnl = period === "30D" ? l.pnl30 : l.pnl7;
                return (
                  <motion.li
                    key={l.address}
                    layout
                    transition={{ type: "spring", stiffness: 380, damping: 36 }}
                    className={cn(COLS, "border-b border-border px-4 py-3.5 last:border-b-0 md:px-6 hover:bg-muted/50 transition-colors")}
                  >
                    <span className="font-mono text-sm text-muted-foreground">{idx + 1}</span>
                    <span className="flex min-w-0 flex-col gap-1 sm:flex-row sm:items-center sm:gap-2">
                      <span className="font-mono text-sm text-foreground">{l.address}</span>
                      <span className="w-fit rounded-full bg-brand-soft px-2 py-0.5 text-[10px] font-medium text-brand">
                        {l.label}
                      </span>
                    </span>
                    <span
                      className={cn(
                        "text-right font-mono text-sm font-medium md:text-left",
                        pnl >= 0 ? "text-positive" : "text-negative"
                      )}
                    >
                      {pnl >= 0 ? "+" : "−"}
                      {Math.abs(pnl).toFixed(1)}%
                    </span>
                    <span className="hidden font-mono text-sm text-foreground md:block">
                      {l.drawdown.toFixed(1)}%
                    </span>
                    <span className="hidden font-mono text-sm text-foreground md:block">
                      {l.winRate}%
                    </span>
                    <span className="hidden items-center gap-2 md:flex">
                      <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                        <motion.span
                          className="block h-full rounded-full bg-brand"
                          initial={{ width: 0 }}
                          whileInView={{ width: `${l.consistency}%` }}
                          viewport={{ once: true }}
                          transition={{ duration: 1, delay: 0.1 * idx, ease: "easeOut" }}
                        />
                      </span>
                      <span className="w-6 font-mono text-xs text-muted-foreground">{l.consistency}</span>
                    </span>
                    <span className="hidden md:block">
                      <Sparkline points={l.spark} className="h-7 w-full max-w-28" />
                    </span>
                    <span className="hidden md:block">
                      <span className="rounded-full border border-border px-3 py-1 text-xs font-medium text-foreground">
                        Follow
                      </span>
                    </span>
                  </motion.li>
                );
              })}
            </motion.ul>
          </div>
        </div>
        <p className="mt-4 text-xs text-muted-foreground">
          Labels such as Smart Trader and Fund come from Nansen. Past results
          don&apos;t predict future returns. Addresses and figures shown are
          illustrative.
        </p>
      </Container>
    </section>
  );
};
