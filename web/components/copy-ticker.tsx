"use client";
import React from "react";
import { InfiniteMovingCards } from "./ui/infinite-moving-cards";
import { COPY_EVENTS, type CopyEvent } from "@/lib/data";
import { IconCircleCheckFilled, IconShieldCheck } from "@tabler/icons-react";

export const CopyTicker = () => {
  return (
    <section aria-label="Illustrative copy feed" className="border-y border-border bg-card/60">
      <div className="mx-auto flex max-w-7xl items-center gap-4 px-4 md:px-8">
        <p className="hidden shrink-0 font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground md:block">
          Copy feed
          <span className="block text-[10px] normal-case tracking-normal opacity-70">
            illustrative
          </span>
        </p>
        <InfiniteMovingCards<CopyEvent>
          items={COPY_EVENTS}
          speed="slow"
          direction="left"
          className="max-w-none flex-1 [&>ul]:py-3"
          getKey={(e) => e.id}
          renderItem={(e) => <TickerItem ev={e} />}
        />
      </div>
    </section>
  );
};

const TickerItem = ({ ev }: { ev: CopyEvent }) => {
  if (ev.kind === "blocked") {
    return (
      <span className="flex items-center gap-2 whitespace-nowrap rounded-full border border-border bg-card px-3 py-1.5 text-[13px]">
        <IconShieldCheck className="size-4 text-warning" />
        <span className="font-medium text-foreground">
          {ev.market} {ev.side.toLowerCase()} {ev.lev}
        </span>
        <span className="text-muted-foreground">blocked · {ev.rule.toLowerCase()}</span>
      </span>
    );
  }
  return (
    <span className="flex items-center gap-2 whitespace-nowrap rounded-full border border-border bg-card px-3 py-1.5 text-[13px]">
      <IconCircleCheckFilled className="size-4 text-positive" />
      <span className="font-medium text-foreground">
        {ev.market} {ev.side.toLowerCase()} {ev.lev}
      </span>
      <span className="font-mono text-muted-foreground">copied in {ev.latency} s</span>
      <span className="font-mono text-brand">{ev.tx}</span>
    </span>
  );
};
