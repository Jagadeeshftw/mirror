"use client";
/**
 * Small, static building blocks of the Android app UI, re-drawn in HTML for
 * the landing page mockups. They use the same design tokens as the app.
 */
import { cn } from "@/lib/utils";
import { BRAND } from "@/lib/site";
import { LogoIcon } from "@/components/logo";
import {
  IconChartCandle,
  IconHome,
  IconSettings,
  IconUsers,
} from "@tabler/icons-react";
import { motion, AnimatePresence } from "motion/react";
import React from "react";

export const PhoneFrame = ({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) => {
  return (
    <div
      className={cn(
        "relative w-[284px] h-[600px] md:w-[300px] md:h-[630px] rounded-[2.75rem] bg-device p-[9px] shadow-float ring-1 ring-black/10 dark:ring-white/10",
        className
      )}
    >
      {/* side buttons */}
      <div className="absolute -right-[3px] top-28 h-14 w-[3px] rounded-r bg-device" />
      <div className="absolute -right-[3px] top-48 h-24 w-[3px] rounded-r bg-device" />
      <div className="relative h-full w-full overflow-hidden rounded-[2.25rem] bg-background">
        <StatusBar />
        {children}
        {/* gesture bar */}
        <div className="absolute bottom-1.5 left-1/2 z-30 h-1 w-24 -translate-x-1/2 rounded-full bg-foreground/70" />
      </div>
    </div>
  );
};

export const StatusBar = () => (
  <div className="relative z-20 flex h-8 items-center justify-between px-5 text-[11px] font-medium text-foreground">
    <span className="font-mono">9:41</span>
    {/* punch-hole camera */}
    <span className="absolute left-1/2 top-2 size-[14px] -translate-x-1/2 rounded-full bg-device ring-2 ring-black/20" />
    <span className="flex items-center gap-1">
      <svg width="13" height="10" viewBox="0 0 13 10" className="fill-current">
        <path d="M0 9h2V7H0v2Zm3.5 0h2V5h-2v4ZM7 9h2V3H7v6Zm3.5 0h2V0h-2v9Z" />
      </svg>
      <svg width="12" height="10" viewBox="0 0 12 10" className="fill-current">
        <path d="M6 9.5 0 3.2A8.6 8.6 0 0 1 6 1a8.6 8.6 0 0 1 6 2.2L6 9.5Z" />
      </svg>
      <svg width="20" height="10" viewBox="0 0 20 10" className="fill-none">
        <rect x="0.5" y="0.5" width="17" height="9" rx="2.5" className="stroke-current" strokeOpacity="0.5" />
        <rect x="2" y="2" width="12" height="6" rx="1.4" className="fill-current" />
        <rect x="18.5" y="3.5" width="1.2" height="3" rx="0.6" className="fill-current" fillOpacity="0.5" />
      </svg>
    </span>
  </div>
);

/** Persistent header: the AUSD balance is visible on every main screen. */
export const AppTopBar = ({ title }: { title?: string }) => (
  <div className="flex items-center justify-between px-4 pt-1 pb-3">
    <div className="flex items-center gap-1.5">
      <LogoIcon className="size-5" />
      <span className="text-[13px] font-semibold tracking-tight text-foreground">
        {title ?? BRAND}
      </span>
    </div>
    <div className="flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1">
      <span className="size-1.5 rounded-full bg-positive" />
      <span className="font-mono text-[11px] font-medium text-foreground">
        24.18
      </span>
      <span className="text-[10px] text-muted-foreground">AUSD</span>
    </div>
  </div>
);

export type CommitState = "Proposed" | "Voted" | "Finalized";

export const StatePill = ({ state }: { state: CommitState }) => {
  const steps: CommitState[] = ["Proposed", "Voted", "Finalized"];
  const idx = steps.indexOf(state);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] font-medium transition-colors duration-300",
        state === "Finalized"
          ? "bg-positive/12 text-positive"
          : "bg-muted text-muted-foreground"
      )}
    >
      <span className="flex gap-[2px]">
        {steps.map((s, i) => (
          <span
            key={s}
            className={cn(
              "size-[5px] rounded-full transition-colors duration-300",
              i <= idx
                ? state === "Finalized"
                  ? "bg-positive"
                  : "bg-brand"
                : "bg-foreground/15"
            )}
          />
        ))}
      </span>
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={state}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.18 }}
        >
          {state}
        </motion.span>
      </AnimatePresence>
    </span>
  );
};

export const MarketIcon = ({
  market,
  className,
}: {
  market: string;
  className?: string;
}) => (
  <span
    className={cn(
      "flex size-7 shrink-0 items-center justify-center rounded-full bg-muted font-mono text-[9px] font-semibold text-foreground",
      className
    )}
  >
    {market.slice(0, 3)}
  </span>
);

export const BottomNav = ({ active = "Home" }: { active?: string }) => {
  const items = [
    { label: "Home", icon: IconHome },
    { label: "Leaders", icon: IconUsers },
    { label: "Positions", icon: IconChartCandle },
    { label: "Settings", icon: IconSettings },
  ];
  return (
    <div className="absolute inset-x-0 bottom-0 z-20 grid grid-cols-4 border-t border-border bg-card px-2 pt-2 pb-5">
      {items.map(({ label, icon: Icon }) => (
        <div key={label} className="flex flex-col items-center gap-0.5">
          <span
            className={cn(
              "flex h-6 w-11 items-center justify-center rounded-full",
              label === active ? "bg-brand-soft text-brand" : "text-muted-foreground"
            )}
          >
            <Icon className="size-[15px]" stroke={1.8} />
          </span>
          <span
            className={cn(
              "text-[9px]",
              label === active ? "font-semibold text-foreground" : "text-muted-foreground"
            )}
          >
            {label}
          </span>
        </div>
      ))}
    </div>
  );
};

export const Sparkline = ({
  points,
  className,
  animate = true,
}: {
  points: number[];
  className?: string;
  animate?: boolean;
}) => {
  const w = 100;
  const h = 32;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const d = points
    .map((p, i) => {
      const x = (i / (points.length - 1)) * w;
      const y = h - ((p - min) / (max - min || 1)) * (h - 4) - 2;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
  const up = points[points.length - 1] >= points[0];
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      className={cn("overflow-visible", className)}
    >
      <motion.path
        d={d}
        fill="none"
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
        className={up ? "stroke-positive" : "stroke-negative"}
        initial={animate ? { pathLength: 0 } : false}
        whileInView={{ pathLength: 1 }}
        viewport={{ once: true }}
        transition={{ duration: 1.2, ease: "easeOut" }}
      />
    </svg>
  );
};
