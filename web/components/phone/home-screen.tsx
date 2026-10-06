"use client";
import { cn } from "@/lib/utils";
import { COPY_EVENTS, type CopyEvent } from "@/lib/data";
import { IconArrowUpRight, IconShieldCheck } from "@tabler/icons-react";
import { AnimatePresence, motion, useInView } from "motion/react";
import React, { useEffect, useRef, useState } from "react";
import {
  AppTopBar,
  BottomNav,
  type CommitState,
  MarketIcon,
  Sparkline,
  StatePill,
} from "./app-ui";

type FeedItem = { ev: CopyEvent; state: CommitState; key: string };

const INITIAL: FeedItem[] = [2, 1, 0].map((i) => ({
  ev: COPY_EVENTS[i],
  state: "Finalized",
  key: `init-${i}`,
}));

export const HomeScreen = () => {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { margin: "-10% 0px" });
  const [feed, setFeed] = useState<FeedItem[]>(INITIAL);
  const cursor = useRef(3);
  const tick = useRef(0);

  useEffect(() => {
    if (!inView) return;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const push = () => {
      const ev = COPY_EVENTS[cursor.current % COPY_EVENTS.length];
      cursor.current += 1;
      tick.current += 1;
      const key = `${ev.id}-${tick.current}`;
      setFeed((prev) =>
        [{ ev, state: "Proposed" as CommitState, key }, ...prev].slice(0, 4)
      );
      if (ev.kind === "copied") {
        const set = (state: CommitState) =>
          setFeed((prev) =>
            prev.map((f) => (f.key === key ? { ...f, state } : f))
          );
        timers.push(setTimeout(() => set("Voted"), 500));
        timers.push(setTimeout(() => set("Finalized"), 1000));
      }
    };
    const first = setTimeout(push, 900);
    const interval = setInterval(push, 3000);
    return () => {
      clearTimeout(first);
      clearInterval(interval);
      timers.forEach(clearTimeout);
    };
  }, [inView]);

  return (
    <div ref={ref} className="absolute inset-x-0 top-8 bottom-0 flex flex-col">
      <AppTopBar />

      <div className="mx-3 rounded-2xl border border-border bg-card p-3.5">
        <p className="text-[10px] text-muted-foreground">Today&apos;s PnL</p>
        <div className="mt-0.5 flex items-end justify-between gap-2">
          <div>
            <p className="font-mono text-[22px] font-semibold leading-none tracking-tight text-positive">
              +0.42
              <span className="ml-1 text-[11px] font-medium">AUSD</span>
            </p>
            <p className="mt-1 font-mono text-[10px] text-positive">+1.77%</p>
          </div>
          <Sparkline
            className="h-8 w-24"
            points={[5, 5.2, 5.1, 5.6, 5.4, 5.9, 6.3, 6.1, 6.6, 6.9]}
          />
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2 border-t border-border pt-2.5 text-[10px]">
          <Mini label="Following" value="2" />
          <Mini label="Open" value="3" />
          <Mini label="Blocked" value="2" />
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between px-4">
        <p className="text-[11px] font-semibold text-foreground">Live copies</p>
        <span className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
          <span className="relative flex size-1.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-positive opacity-60" />
            <span className="relative inline-flex size-1.5 rounded-full bg-positive" />
          </span>
          Live
        </span>
      </div>

      <div className="relative mt-2 flex-1 overflow-hidden px-3 mask-b-from-70% pb-20">
        <motion.ul layout className="flex flex-col gap-2">
          <AnimatePresence initial={false} mode="popLayout">
            {feed.map((f) => (
              <motion.li
                key={f.key}
                layout
                initial={{ opacity: 0, y: -16, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, transition: { duration: 0.15 } }}
                transition={{ type: "spring", stiffness: 420, damping: 34 }}
              >
                {f.ev.kind === "copied" ? (
                  <CopiedRow ev={f.ev} state={f.state} />
                ) : (
                  <BlockedRow ev={f.ev} />
                )}
              </motion.li>
            ))}
          </AnimatePresence>
        </motion.ul>
      </div>

      <BottomNav active="Home" />
    </div>
  );
};

const Mini = ({ label, value }: { label: string; value: string }) => (
  <div>
    <p className="text-muted-foreground">{label}</p>
    <p className="font-mono text-[12px] font-medium text-foreground">{value}</p>
  </div>
);

const CopiedRow = ({
  ev,
  state,
}: {
  ev: Extract<CopyEvent, { kind: "copied" }>;
  state: CommitState;
}) => (
  <div className="flex items-start gap-2.5 rounded-xl border border-border bg-card p-2.5">
    <MarketIcon market={ev.market} />
    <div className="min-w-0 flex-1">
      <div className="flex items-center justify-between gap-1">
        <p className="truncate text-[11px] font-semibold text-foreground">
          {ev.market} {ev.side.toLowerCase()} {ev.lev}
          <span className="ml-1 font-mono font-normal text-muted-foreground">
            {ev.size}
          </span>
        </p>
        <StatePill state={state} />
      </div>
      <div className="mt-1 flex items-center justify-between font-mono text-[9.5px] text-muted-foreground">
        <span className={cn(state === "Finalized" && "text-foreground")}>
          copied in {ev.latency} s
        </span>
        <span className="flex items-center gap-0.5 text-brand">
          {ev.tx}
          <IconArrowUpRight className="size-2.5" />
        </span>
      </div>
    </div>
  </div>
);

const BlockedRow = ({ ev }: { ev: Extract<CopyEvent, { kind: "blocked" }> }) => (
  <div className="rounded-xl border border-warning/35 bg-warning/[0.07] p-2.5">
    <div className="flex items-center justify-between">
      <p className="flex items-center gap-1 text-[10px] font-semibold text-warning">
        <IconShieldCheck className="size-3" />
        Blocked by your rule
      </p>
      <span className="rounded-full bg-card px-1.5 py-0.5 text-[9px] text-muted-foreground border border-border">
        {ev.rule}
      </span>
    </div>
    <p className="mt-1 text-[10.5px] leading-snug text-foreground">{ev.detail}</p>
  </div>
);
