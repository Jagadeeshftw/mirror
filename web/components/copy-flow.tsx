"use client";
import React from "react";
import { motion } from "motion/react";
import {
  IconArrowUpRight,
  IconBolt,
  IconCheck,
  IconCircleCheckFilled,
  IconShieldCheck,
  IconUser,
} from "@tabler/icons-react";
import { Container } from "./container";
import { Eyebrow, Heading } from "./heading";
import { Subheading } from "./subheading";
import { BeamPath } from "./ui/beam-path";
import { cn } from "@/lib/utils";

const BEAM_VARS =
  "[--beam-color-1:var(--brand)] [--beam-color-2:var(--brand)] [--beam-color-3:var(--positive)] [--path-color:color-mix(in_oklab,var(--muted-foreground)_45%,transparent)]";

const CHECKS = ["Leader", "Market", "Leverage", "Slippage", "Leader target", "Notional", "Loss stops", "Expiry"];

/** Leader fill -> your contract's policy check -> your copy (or a Blocked event). Illustrative values. */
export const CopyFlow = () => {
  return (
    <section id="flow" className="relative border-t border-border py-20 md:py-28 lg:py-32">
      <Container>
        <div className="flex flex-col justify-between gap-6 lg:flex-row lg:items-end">
          <div>
            <Eyebrow>The copy path</Eyebrow>
            <Heading>
              From their fill
              <br className="hidden sm:block" /> to yours, onchain.
            </Heading>
          </div>
          <Subheading>
            The keeper hears the leader&apos;s fill at the Proposed stage and
            submits your copy. Your own contract checks every rule before the
            order reaches Perpl, and records the result either way.
          </Subheading>
        </div>

        <div className={cn("mt-12 md:mt-16", BEAM_VARS)}>
          <div className="grid grid-cols-1 items-stretch lg:grid-cols-[1fr_120px_1.15fr_120px_1fr]">
            <Node step="01" title="Leader fills on Perpl" icon={IconUser} delay={0}>
              <div className="flex items-center justify-between">
                <span className="font-mono text-xs text-foreground">0x7a3e…41f3</span>
                <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
                  Proposed
                </span>
              </div>
              <p className="mt-3 text-lg font-semibold tracking-tight text-foreground">
                BTC long · 2.000 lots · 3x
              </p>
              <p className="mt-1 font-mono text-[11px] text-muted-foreground">
                picked up from monadLogs, block n
              </p>
            </Node>

            <Beam delay={0} />

            <Node step="02" title="Your contract checks your rules" icon={IconShieldCheck} delay={0.15} highlight>
              <div className="flex flex-wrap gap-1.5">
                {CHECKS.map((c, i) => (
                  <motion.span
                    key={c}
                    initial={{ opacity: 0, y: 4 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true, margin: "-60px" }}
                    transition={{ delay: 0.4 + i * 0.07, duration: 0.3 }}
                    className="inline-flex items-center gap-1 rounded-full border border-positive/30 bg-positive/10 px-2 py-0.5 text-[11px] font-medium text-positive"
                  >
                    <IconCheck className="size-3" stroke={3} aria-hidden />
                    {c}
                  </motion.span>
                ))}
              </div>
              <p className="mt-3 font-mono text-[11px] text-muted-foreground">
                MirrorAccount.mirror() · ~278k gas · ≈ $0.001
              </p>
            </Node>

            <Beam delay={1} />

            <Node step="03" title="Your copy fills" icon={IconBolt} delay={0.3}>
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Mirrored event</span>
                <span className="inline-flex items-center gap-1 rounded-full bg-positive/12 px-2 py-0.5 text-[10px] font-medium text-positive">
                  <IconCircleCheckFilled className="size-3" aria-hidden /> Finalized
                </span>
              </div>
              <p className="mt-3 text-lg font-semibold tracking-tight text-foreground">
                BTC long · 1.000 lot · 50%
              </p>
              <p className="mt-1 flex items-center gap-1 font-mono text-[11px] text-brand">
                tx 0x3f9c…a21e <IconArrowUpRight className="size-3" aria-hidden />
              </p>
            </Node>
          </div>

          <motion.div
            initial={{ opacity: 0, y: 12 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-60px" }}
            transition={{ duration: 0.5, delay: 0.5 }}
            className="mx-auto mt-4 max-w-xl rounded-2xl border border-warning/40 bg-warning/[0.06] p-4 lg:mt-6"
          >
            <p className="flex items-center gap-1.5 text-xs font-semibold text-warning">
              <IconShieldCheck className="size-4" aria-hidden /> Or: blocked by your rule
            </p>
            <p className="mt-1.5 text-[15px] font-medium leading-snug text-foreground">
              Leader opened 20x BTC long. Your max leverage is 5x. Not copied.
            </p>
            <p className="mt-1 font-mono text-[11px] text-muted-foreground">
              Blocked(reason: LeverageTooHigh, limit: 500, actual: 2000) · its own tx hash
            </p>
          </motion.div>
          <p className="mt-4 text-center font-mono text-[11px] text-muted-foreground">
            Illustrative values. Event names and fields are the contract&apos;s.
          </p>
        </div>
      </Container>
    </section>
  );
};

const Node = ({
  step,
  title,
  icon: Icon,
  children,
  delay,
  highlight = false,
}: {
  step: string;
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
  delay: number;
  highlight?: boolean;
}) => (
  <motion.div
    initial={{ opacity: 0, y: 16, filter: "blur(6px)" }}
    whileInView={{ opacity: 1, y: 0, filter: "blur(0px)" }}
    viewport={{ once: true, margin: "-60px" }}
    transition={{ duration: 0.55, delay, ease: [0.22, 1, 0.36, 1] }}
    className={cn(
      "relative rounded-3xl border bg-card p-5 shadow-float md:p-6",
      highlight ? "border-brand/40" : "border-border"
    )}
  >
    <div className="mb-4 flex items-center gap-2">
      <span
        className={cn(
          "flex size-8 items-center justify-center rounded-full",
          highlight ? "bg-brand text-primary-foreground" : "bg-muted text-foreground"
        )}
      >
        <Icon className="size-4" />
      </span>
      <div>
        <p className="font-mono text-[10px] text-brand">{step}</p>
        <h3 className="text-sm font-semibold tracking-tight text-foreground">{title}</h3>
      </div>
    </div>
    {children}
  </motion.div>
);

/** Pro animated beam between nodes: horizontal on desktop, turned vertical on mobile. */
const Beam = ({ delay }: { delay: number }) => (
  <div className="relative flex h-16 items-center justify-center lg:h-auto">
    <div className="hidden h-10 w-full lg:block">
      <BeamPath
        path="M 0 20 L 30 20 L 44 8 L 58 32 L 72 20 L 120 20"
        width={120}
        height={40}
        stretch
        className="h-full w-full"
        delay={delay}
        duration={1.6}
        repeatDelay={0.4}
      />
    </div>
    <div className="h-10 w-16 rotate-90 lg:hidden">
      <BeamPath
        path="M 0 20 L 120 20"
        width={120}
        height={40}
        stretch
        className="h-full w-full"
        delay={delay}
        duration={1.6}
        repeatDelay={0.4}
      />
    </div>
  </div>
);
