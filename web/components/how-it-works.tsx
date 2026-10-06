"use client";
import React, { useEffect, useState } from "react";
import { animate, motion, useInView, useMotionValue, useTransform } from "motion/react";
import { IconCheck, IconFingerprint, IconLoader2 } from "@tabler/icons-react";
import { Container } from "./container";
import { Eyebrow, Heading } from "./heading";
import { Subheading } from "./subheading";
import { Card, CardContent, CardDescription, CardSkeleton, CardStep, CardTitle } from "./feature-card";
import { DottedGlowBackground } from "./ui/dotted-glow-background";
import { cn } from "@/lib/utils";

export const HowItWorks = () => {
  return (
    <section id="how" className="py-20 md:py-28 lg:py-32">
      <Container>
        <div className="flex flex-col justify-between gap-6 lg:flex-row lg:items-end">
          <div>
            <Eyebrow>How it works</Eyebrow>
            <Heading>
              Three steps.
              <br className="hidden sm:block" /> Then it runs on its own.
            </Heading>
          </div>
          <Subheading>
            No charts to watch and no custody to hand over. Choose who to
            follow, set the limits you can live with, and let the contract do
            the rest.
          </Subheading>
        </div>

        <div className="mt-12 grid grid-cols-1 gap-4 md:mt-16 lg:grid-cols-3">
          <Card className="lg:rounded-l-3xl">
            <CardSkeleton>
              <SkeletonLeaders />
            </CardSkeleton>
            <CardContent>
              <CardStep>01</CardStep>
              <CardTitle>Pick a leader</CardTitle>
              <CardDescription>
                Any public Perpl trader, ranked from onchain PnL, drawdown, win
                rate and consistency. Nansen labels like Smart Trader or Fund
                are coming.
              </CardDescription>
            </CardContent>
          </Card>
          <Card>
            <CardSkeleton>
              <SkeletonRules />
            </CardSkeleton>
            <CardContent>
              <CardStep>02</CardStep>
              <CardTitle>Set your rules</CardTitle>
              <CardDescription>
                Sizing, max leverage, allowed markets, per-market caps,
                slippage, loss stops and an expiry date. One fingerprint signs
                them into your contract.
              </CardDescription>
            </CardContent>
          </Card>
          <Card className="lg:rounded-r-3xl">
            <CardSkeleton>
              <SkeletonLatency />
            </CardSkeleton>
            <CardContent>
              <CardStep>03</CardStep>
              <CardTitle>Copies land in about a second</CardTitle>
              <CardDescription>
                When your leader trades, a copy is sized to your rules, checked
                onchain and finalized on Monad. You see the measured latency and
                the tx for every one.
              </CardDescription>
            </CardContent>
          </Card>
        </div>
      </Container>
    </section>
  );
};

/* ---------- 01: stacked leader cards (template SkeletonOne, re-skinned) ---------- */

const SkeletonLeaders = () => {
  const cards = [
    { addr: "0x5e02…9ab4", label: "Smart Trader", pnl: "+19.5%", dd: "9.8%", win: "55%", cls: "bottom-[8rem] left-4 max-w-[78%] z-10" },
    { addr: "0xc19b…07de", label: "Fund", pnl: "+24.7%", dd: "4.3%", win: "58%", cls: "bottom-[4rem] left-8 max-w-[84%] z-20" },
    { addr: "0x7a3e…41f3", label: "Smart Trader", pnl: "+38.2%", dd: "6.1%", win: "64%", cls: "bottom-0 left-12 max-w-[88%] z-30" },
  ];
  return (
    <div className="perspective-distant rotate-z-12 -rotate-y-20 rotate-x-30 scale-[1.15] h-full w-full -translate-y-6 mask-radial-from-55% mask-r-from-60%">
      {cards.map((c, i) => (
        <motion.div
          key={c.addr}
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-60px" }}
          transition={{ duration: 0.5, delay: i * 0.12, ease: "easeOut" }}
          className={cn(
            "absolute w-full rounded-2xl border border-border bg-background p-3 shadow-float",
            c.cls
          )}
        >
          <div className="flex items-center gap-2">
            <span className="size-5 rounded-full bg-gradient-to-br from-brand to-brand/40" />
            <p className="font-mono text-xs text-foreground">{c.addr}</p>
            <span className="rounded-full bg-brand-soft px-1.5 py-0.5 text-[10px] font-medium text-brand">
              {c.label}
            </span>
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2 text-[10px] md:text-xs">
            <Stat k="30d PnL" v={c.pnl} className="text-positive" />
            <Stat k="Max DD" v={c.dd} />
            <Stat k="Win rate" v={c.win} />
          </div>
        </motion.div>
      ))}
    </div>
  );
};

const Stat = ({ k, v, className }: { k: string; v: string; className?: string }) => (
  <div>
    <p className="text-muted-foreground">{k}</p>
    <p className={cn("font-mono font-medium text-foreground", className)}>{v}</p>
  </div>
);

/* ---------- 02: rule rows (template SkeletonTwo, re-skinned) ---------- */

const SkeletonRules = () => {
  const rows = [
    { k: "Allocation", v: "20.00 AUSD" },
    { k: "Max leverage", v: "5x" },
    { k: "Max notional / market", v: "10.00 AUSD" },
    { k: "Daily loss stop", v: "5%" },
    { k: "Expires", v: "31 Dec 2026" },
  ];
  return (
    <div
      style={{ transform: "rotateY(20deg) rotateX(20deg) rotateZ(-20deg)" }}
      className={cn(
        "group absolute inset-x-0 top-8 mx-auto flex h-[115%] w-[85%] translate-x-6 flex-col rounded-2xl border border-border bg-muted p-3 shadow-float mask-radial-from-50% mask-b-from-50%",
        "[--pattern-fg:color-mix(in_oklab,var(--foreground)_6%,transparent)]"
      )}
    >
      <div className="flex items-center gap-2">
        <span className="size-2 rounded-full bg-brand" />
        <p className="text-sm font-medium text-foreground">Follow policy</p>
      </div>
      <div className="relative mt-3 flex-1 rounded-2xl border border-border bg-muted">
        <div className="absolute inset-0 rounded-2xl bg-[image:repeating-linear-gradient(315deg,_var(--pattern-fg)_0,_var(--pattern-fg)_1px,_transparent_0,_transparent_50%)] bg-[size:10px_10px]" />
        <div className="absolute inset-0 h-full w-full translate-x-2 -translate-y-2 rounded-2xl bg-card transition-all duration-300 group-hover:translate-x-0 group-hover:translate-y-0">
          {rows.map((r, i) => (
            <motion.div
              key={r.k}
              initial={{ opacity: 0, x: -8 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ delay: 0.15 + i * 0.12 }}
            >
              <div className="flex items-center justify-between px-4 py-2">
                <div className="flex items-center gap-2">
                  <span className="flex size-4 items-center justify-center rounded-full bg-positive">
                    <IconCheck className="size-2.5 text-white" stroke={3} />
                  </span>
                  <p className="text-xs font-medium text-muted-foreground md:text-sm">{r.k}</p>
                </div>
                <p className="font-mono text-[11px] font-medium text-foreground">{r.v}</p>
              </div>
              <div className="h-px w-full bg-gradient-to-r from-transparent via-border to-transparent" />
            </motion.div>
          ))}
          <div className="flex items-center justify-between px-4 py-2">
            <div className="flex items-center gap-2">
              <span className="flex size-4 items-center justify-center rounded-full bg-brand">
                <IconLoader2 className="size-2.5 animate-spin text-white" />
              </span>
              <p className="text-xs font-medium text-muted-foreground md:text-sm">Confirm with passkey</p>
            </div>
            <IconFingerprint className="size-4 text-brand" />
          </div>
        </div>
      </div>
    </div>
  );
};

/* ---------- 03: latency timeline ---------- */

const TARGET = 0.61;

const SkeletonLatency = () => {
  const ref = React.useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { margin: "-80px" });
  const t = useMotionValue(0);
  const width = useTransform(t, [0, 1], ["0%", "100%"]);
  const label = useTransform(t, (v) => v.toFixed(2));
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    if (!inView) return;
    let cancelled = false;
    const run = async () => {
      while (!cancelled) {
        t.set(0);
        setPhase(0);
        await animate(t, 0.3, { duration: 0.6, ease: "linear" });
        if (cancelled) break;
        setPhase(1);
        await animate(t, 0.55, { duration: 0.5, ease: "linear" });
        if (cancelled) break;
        setPhase(2);
        await animate(t, TARGET, { duration: 0.15, ease: "linear" });
        if (cancelled) break;
        setPhase(3);
        await new Promise((r) => setTimeout(r, 2200));
      }
    };
    run();
    return () => {
      cancelled = true;
      t.stop();
    };
  }, [inView, t]);

  const states = ["Proposed", "Voted", "Finalized"];

  return (
    <div ref={ref} className="relative flex h-full w-full items-center justify-center px-6">
      <DottedGlowBackground
        className="pointer-events-none mask-radial-to-70% mask-radial-at-center"
        opacity={0.5}
        gap={10}
        radius={1.3}
        colorLightVar="--muted-foreground"
        glowColorLightVar="--brand"
        colorDarkVar="--muted-foreground"
        glowColorDarkVar="--brand"
        backgroundOpacity={0}
        speedMin={0.3}
        speedMax={1.6}
        speedScale={1}
      />
      <div className="relative z-10 w-full max-w-sm rounded-2xl border border-border bg-background/90 p-4 shadow-float backdrop-blur">
        <div className="flex items-baseline justify-between">
          <p className="text-xs text-muted-foreground">Leader fill → your copy <span className="opacity-70">· illustrative</span></p>
          <p className="font-mono text-2xl font-semibold tracking-tight text-foreground">
            <motion.span>{label}</motion.span>
            <span className="ml-1 text-sm text-muted-foreground">s</span>
          </p>
        </div>
        <div className="relative mt-4 h-2 rounded-full bg-muted">
          <motion.div
            style={{ width }}
            className={cn(
              "absolute inset-y-0 left-0 rounded-full transition-colors",
              phase === 3 ? "bg-positive" : "bg-brand"
            )}
          />
          {/* markers at 0.3 s (block) and 0.55 s (finality), scale 0 – 1 s */}
          <span className="absolute -top-1 left-[30%] h-4 w-px bg-foreground/30" />
          <span className="absolute -top-1 left-[55%] h-4 w-px bg-foreground/30" />
        </div>
        <div className="relative mt-1.5 h-4 font-mono text-[10px] text-muted-foreground">
          <span className="absolute left-0">0</span>
          <span className="absolute left-[30%] -translate-x-1/2">0.3 block</span>
          <span className="absolute left-[55%] translate-x-[-10%]">0.55 final</span>
          <span className="absolute right-0">1.0 s</span>
        </div>
        <div className="mt-4 flex items-center gap-2">
          {states.map((s, i) => {
            const active = phase > i || (phase === 3 && i === 2);
            return (
              <span
                key={s}
                className={cn(
                  "flex-1 rounded-full border px-2 py-1 text-center text-[10px] font-medium transition-colors duration-300",
                  active
                    ? i === 2
                      ? "border-positive/40 bg-positive/10 text-positive"
                      : "border-brand/40 bg-brand-soft text-brand"
                    : "border-border text-muted-foreground"
                )}
              >
                {s}
              </span>
            );
          })}
        </div>
      </div>
    </div>
  );
};
