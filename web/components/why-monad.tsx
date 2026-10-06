"use client";
import React, { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useInView } from "motion/react";
import { IconBolt, IconCoin, IconGitMerge, IconRosetteDiscountCheck } from "@tabler/icons-react";
import { Container } from "./container";
import { Eyebrow, Heading } from "./heading";
import { Subheading } from "./subheading";
import { cn } from "@/lib/utils";

const FACTS = [
  {
    icon: IconBolt,
    value: "~290 ms",
    title: "Block time",
    text: "Measured on mainnet. A leader's fill arrives at the Proposed stage through monadLogs, so the copy can follow within a couple of blocks.",
  },
  {
    icon: IconRosetteDiscountCheck,
    value: "~550 ms",
    title: "Finality",
    text: "Measured: Finalized arrives about 550 ms after Proposed. Every copy shows its commit state.",
  },
  {
    icon: IconGitMerge,
    value: "Parallel",
    title: "Execution",
    text: "Each follower has their own vault, so copies for many followers don't queue behind each other.",
  },
  {
    icon: IconCoin,
    value: "~$0.001",
    title: "Per copied open",
    text: "About 278k gas with every policy check, so your rules run onchain on every order. The relayer pays, so you never hold MON.",
  },
];

export const WhyMonad = () => {
  return (
    <section id="monad" className="relative border-t border-border bg-card/40 py-20 md:py-28 lg:py-32">
      <Container>
        <div className="grid grid-cols-1 gap-12 lg:grid-cols-2 lg:gap-16">
          <div>
            <Eyebrow>Why Monad</Eyebrow>
            <Heading>Copy trading only works when the chain keeps up.</Heading>
            <Subheading className="mt-6">
              If a copy lands seconds after the leader, you get a worse price.
              Monad&apos;s sub-second blocks and fast finality mean your copy
              trades nearly the same market your leader did, with every rule
              enforced onchain.
            </Subheading>
          </div>
          <BlockStream />
        </div>

        <div className="mt-14 grid grid-cols-1 gap-x-10 gap-y-10 border-t border-border pt-10 sm:grid-cols-2 lg:grid-cols-4 md:mt-20">
          {FACTS.map((f, i) => (
            <motion.div
              key={f.title}
              initial={{ opacity: 0, y: 10, filter: "blur(6px)" }}
              whileInView={{ opacity: 1, y: 0, filter: "blur(0px)" }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: i * 0.08 }}
            >
              <div className="flex items-center gap-2 text-muted-foreground">
                <f.icon className="size-4 text-brand" />
                <h3 className="text-sm font-medium">{f.title}</h3>
              </div>
              <p className="mt-3 font-mono text-3xl font-semibold tracking-tight text-foreground">
                {f.value}
              </p>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground text-pretty">
                {f.text}
              </p>
            </motion.div>
          ))}
        </div>
      </Container>
    </section>
  );
};

const BASE = 24_180_110;
const SHOW = 6;

const stateFor = (age: number) =>
  age <= 0 ? "Proposed" : age === 1 ? "Voted" : "Finalized";

const BlockStream = () => {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { margin: "-80px" });
  const [head, setHead] = useState(BASE + SHOW);

  useEffect(() => {
    if (!inView) return;
    const id = setInterval(() => setHead((h) => h + 1), 650);
    return () => clearInterval(id);
  }, [inView]);

  const blocks = Array.from({ length: SHOW }, (_, i) => head - (SHOW - 1) + i);

  return (
    <div ref={ref} className="self-center rounded-3xl border border-border bg-card p-4 shadow-float md:p-6">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-foreground">Monad blocks</p>
        <span className="font-mono text-[10px] text-muted-foreground">
          illustrative · slowed ~2× to be readable
        </span>
      </div>

      <div className="relative mt-5 overflow-hidden mask-l-from-75%">
        <motion.div layout className="flex justify-end gap-2">
          <AnimatePresence initial={false} mode="popLayout">
            {blocks.map((n) => {
              const age = head - n;
              const state = stateFor(age);
              const tag = n % 5 === 0 ? "leader" : n % 5 === 2 ? "copy" : null;
              return (
                <motion.div
                  key={n}
                  layout
                  initial={{ opacity: 0, scale: 0.85, x: 24 }}
                  animate={{ opacity: 1, scale: 1, x: 0 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  transition={{ type: "spring", stiffness: 380, damping: 32 }}
                  className={cn(
                    "relative flex h-32 w-[92px] shrink-0 flex-col justify-between rounded-xl border p-2.5 md:w-[104px]",
                    tag === "copy"
                      ? "border-brand/50 bg-brand-soft"
                      : "border-border bg-background"
                  )}
                >
                  <p className="font-mono text-[10px] text-muted-foreground">
                    #{n.toLocaleString("en-US")}
                  </p>
                  <div className="min-h-8">
                    {tag === "leader" && (
                      <p className="text-[11px] leading-tight text-foreground">
                        Leader fill
                        <span className="block font-mono text-[10px] text-muted-foreground">
                          BTC long 3x
                        </span>
                      </p>
                    )}
                    {tag === "copy" && (
                      <p className="text-[11px] font-medium leading-tight text-brand">
                        Your copy
                        <span className="block font-mono text-[10px]">+0.61 s</span>
                      </p>
                    )}
                  </div>
                  <span
                    className={cn(
                      "w-fit rounded-full px-1.5 py-0.5 text-[9px] font-medium transition-colors duration-300",
                      state === "Finalized"
                        ? "bg-positive/12 text-positive"
                        : state === "Voted"
                          ? "bg-brand/15 text-brand"
                          : "bg-muted text-muted-foreground"
                    )}
                  >
                    {state}
                  </span>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </motion.div>
      </div>

      <div className="mt-5 flex flex-wrap gap-x-5 gap-y-1.5 border-t border-border pt-4 text-[11px] text-muted-foreground">
        <Legend dot="bg-foreground/30" label="Proposed" />
        <Legend dot="bg-brand" label="Voted" />
        <Legend dot="bg-positive" label="Finalized (~0.55 s)" />
      </div>
    </div>
  );
};

const Legend = ({ dot, label }: { dot: string; label: string }) => (
  <span className="flex items-center gap-1.5">
    <span className={cn("size-1.5 rounded-full", dot)} />
    {label}
  </span>
);
