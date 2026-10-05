"use client";
import React, { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useInView } from "motion/react";
import {
  IconCheck,
  IconCircleCheckFilled,
  IconPlayerPause,
  IconShieldCheck,
  IconSquareX,
  IconWallet,
  IconX,
} from "@tabler/icons-react";
import { Container } from "./container";
import { Eyebrow, Heading } from "./heading";
import { Subheading } from "./subheading";
import { cn } from "@/lib/utils";
import { BETA_DEPOSIT_CAP } from "@/lib/site";

export const Safety = () => {
  return (
    <section id="safety" className="relative py-20 md:py-28 lg:py-32">
      <Container>
        <div className="max-w-3xl">
          <Eyebrow>Safety model</Eyebrow>
          <Heading>Your contract. Your rules.</Heading>
          <Subheading className="mt-6 max-w-2xl">
            Your AUSD sits in a vault contract that only your passkey controls.
            The copy keeper gets exactly one permission: place orders that pass
            your rules. Every order is checked onchain before it reaches Perpl.
          </Subheading>
        </div>

        <div className="mt-12 grid grid-cols-1 overflow-hidden rounded-3xl border border-border bg-card md:mt-16 md:grid-cols-2">
          <Cell
            className="border-b border-border md:border-r"
            title="It can trade. It can never withdraw."
            description="The keeper key can open and close positions inside your limits. Withdrawals, rule changes and revoking the keeper need your passkey."
          >
            <Permissions />
          </Cell>
          <Cell
            className="border-b border-border"
            title="Rules checked onchain, on every order"
            description="Not in an app server, not in a promise. The contract evaluates each rule before an order can reach Perpl."
          >
            <RuleEngine />
          </Cell>
          <Cell
            className="border-b border-border md:border-b-0 md:border-r"
            title="Blocked by your rule"
            description="If a leader's trade would break a rule, the contract rejects it and the app shows you which rule and the numbers."
          >
            <BlockedFeed />
          </Cell>
          <Cell
            title="Exits are always open"
            description={`Pause, close everything or withdraw in one tap. Gasless, so you never need MON. During beta, deposits are capped at ${BETA_DEPOSIT_CAP} per account because the contract is not yet audited.`}
          >
            <Exits />
          </Cell>
        </div>
      </Container>
    </section>
  );
};

const Cell = ({
  title,
  description,
  children,
  className,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
  className?: string;
}) => (
  <div className={cn("flex flex-col", className)}>
    <div className="p-5 md:p-8">
      <h3 className="text-lg font-semibold tracking-tight text-foreground md:text-xl">
        {title}
      </h3>
      <p className="mt-2 max-w-md text-sm leading-relaxed text-muted-foreground md:text-[15px] text-pretty">
        {description}
      </p>
    </div>
    <div className="relative min-h-72 flex-1 overflow-hidden px-5 pb-6 md:min-h-80 md:px-8 md:pb-8">
      {children}
    </div>
  </div>
);

/* ---------- permissions matrix ---------- */

const Permissions = () => {
  const rows = [
    { k: "Open & close positions", you: true, keeper: true },
    { k: "Change your rules", you: true, keeper: false },
    { k: "Withdraw funds", you: true, keeper: false },
    { k: "Revoke the keeper", you: true, keeper: false },
  ];
  return (
    <div className="rounded-2xl border border-border bg-background">
      <div className="grid grid-cols-[1fr_72px_72px] items-center border-b border-border px-4 py-2.5 text-[11px] font-medium text-muted-foreground">
        <span>Permission</span>
        <span className="text-center">You</span>
        <span className="text-center">Keeper</span>
      </div>
      {rows.map((r, i) => (
        <motion.div
          key={r.k}
          initial={{ opacity: 0, y: 6 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ delay: 0.1 + i * 0.1 }}
          className="grid grid-cols-[1fr_72px_72px] items-center border-b border-border px-4 py-2.5 text-sm last:border-b-0"
        >
          <span className="text-foreground">{r.k}</span>
          <Mark ok={r.you} />
          <Mark ok={r.keeper} />
        </motion.div>
      ))}
      <div className="border-t border-border bg-muted/60 px-4 py-2.5 font-mono text-[11px] text-muted-foreground rounded-b-2xl">
        keeper → <span className="text-foreground">withdraw()</span>{" "}
        <span className="text-negative">reverts: NotOwner</span>
      </div>
    </div>
  );
};

const Mark = ({ ok }: { ok: boolean }) => (
  <span className="flex justify-center">
    {ok ? (
      <span className="flex size-5 items-center justify-center rounded-full bg-positive/12 text-positive">
        <IconCheck className="size-3" stroke={3} />
      </span>
    ) : (
      <span className="flex size-5 items-center justify-center rounded-full bg-negative/12 text-negative">
        <IconX className="size-3" stroke={3} />
      </span>
    )}
  </span>
);

/* ---------- rule engine (template SkeletonFour pattern) ---------- */

const RULES = [
  { title: "Allocation", check: "open + copy ≤ 20.00 AUSD", now: "11.40 + 3.00 = 14.40" },
  { title: "Sizing", check: "size = leader.size × 50%", now: "6.00 × 50% = 3.00 AUSD" },
  { title: "Max leverage", check: "leverage ≤ 5x", now: "3x" },
  { title: "Max notional", check: "notional(SOL) ≤ 10.00 AUSD", now: "3.00 AUSD" },
  { title: "Allowed markets", check: "market ∈ {BTC, ETH, SOL, MON, HYPE}", now: "SOL" },
  { title: "Daily loss stop", check: "pnl(today) > −5%", now: "+1.77%" },
  { title: "High-water mark", check: "equity ≥ 85% × peak", now: "24.18 ≥ 20.89" },
  { title: "Expiry", check: "now < 31 Dec 2026", now: "5 Oct 2026" },
];

const RuleEngine = () => {
  const [i, setI] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref);
  useEffect(() => {
    if (!inView) return;
    const id = setInterval(() => setI((v) => (v + 1) % RULES.length), 1800);
    return () => clearInterval(id);
  }, [inView]);
  const rule = RULES[i];
  return (
    <div ref={ref}>
      <div className="flex flex-wrap gap-1.5">
        {RULES.map((r, idx) => (
          <button
            type="button"
            key={r.title}
            onClick={() => setI(idx)}
            className={cn(
              "relative cursor-pointer rounded-full border px-2.5 py-1 text-xs transition-colors",
              idx === i
                ? "border-brand/40 text-brand"
                : idx < i
                  ? "border-border text-foreground"
                  : "border-border text-muted-foreground"
            )}
          >
            {idx === i && (
              <motion.span
                layoutId="rule-active"
                className="absolute inset-0 rounded-full bg-brand-soft"
                transition={{ type: "spring", stiffness: 400, damping: 32 }}
              />
            )}
            <span className="relative flex items-center gap-1">
              {idx < i && <IconCheck className="size-3 text-positive" stroke={3} />}
              {r.title}
            </span>
          </button>
        ))}
      </div>
      <div className="mt-5 rounded-2xl border border-border bg-background p-4">
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">
            Order: copy SOL long 4x · rule {i + 1} of {RULES.length}
          </p>
          <span className="flex items-center gap-1 rounded-full bg-positive/12 px-2 py-0.5 text-[11px] font-medium text-positive">
            <IconCircleCheckFilled className="size-3" /> pass
          </span>
        </div>
        <AnimatePresence mode="wait">
          <motion.div
            key={rule.title}
            initial={{ opacity: 0, y: 6, filter: "blur(4px)" }}
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            exit={{ opacity: 0, y: -6, filter: "blur(4px)" }}
            transition={{ duration: 0.25 }}
          >
            <p className="mt-3 text-base font-semibold text-foreground">{rule.title}</p>
            <p className="mt-2 rounded-lg border border-dashed border-border px-3 py-2 font-mono text-[12px] text-foreground">
              require({rule.check})
            </p>
            <p className="mt-2 font-mono text-[11px] text-muted-foreground">
              this order: {rule.now}
            </p>
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
};

/* ---------- blocked feed (template "Recent activity" pattern) ---------- */

const ACTIVITY = [
  { m: "BTC long 3x", d: "Copied in 0.61 s", s: "FINALIZED" },
  { m: "BTC long 20x", d: "Max leverage 5x", s: "BLOCKED" },
  { m: "ETH short 2x", d: "Copied in 0.58 s", s: "FINALIZED" },
  { m: "PUMP long 3x", d: "Market not allowed", s: "BLOCKED" },
  { m: "SOL long 4x", d: "Copied in 0.64 s", s: "FINALIZED" },
];

const BlockedFeed = () => (
  <div className="relative h-full">
    <div className="rounded-2xl border border-border bg-background mask-b-from-60%">
      <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
        <span className="size-1.5 rounded-full bg-positive" />
        <p className="text-xs font-semibold text-foreground">Recent activity</p>
      </div>
      {ACTIVITY.map((a, i) => (
        <motion.div
          key={a.m}
          initial={{ opacity: 0, y: 8 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.4, delay: i * 0.08 }}
          className="flex items-center justify-between gap-3 border-b border-border px-4 py-2.5 last:border-b-0"
        >
          <div className="min-w-0">
            <p className="text-sm text-foreground">{a.m}</p>
            <p className="font-mono text-[11px] text-muted-foreground">{a.d}</p>
          </div>
          <span
            className={cn(
              "shrink-0 rounded-md border px-1.5 py-0.5 text-[10px] font-semibold",
              a.s === "BLOCKED"
                ? "border-warning/30 bg-warning/10 text-warning"
                : "border-positive/30 bg-positive/10 text-positive"
            )}
          >
            {a.s}
          </span>
        </motion.div>
      ))}
    </div>
    <motion.div
      initial={{ opacity: 0, y: 24, scale: 0.96 }}
      whileInView={{ opacity: 1, y: 0, scale: 1 }}
      viewport={{ once: true, margin: "-40px" }}
      transition={{ duration: 0.5, delay: 0.6, ease: [0.22, 1, 0.36, 1] }}
      className="absolute inset-x-2 bottom-0 rounded-2xl border border-warning/40 bg-card p-4 shadow-float md:inset-x-6"
    >
      <p className="flex items-center gap-1.5 text-xs font-semibold text-warning">
        <IconShieldCheck className="size-4" /> Blocked by your rule · Max leverage
      </p>
      <p className="mt-1.5 text-[15px] font-medium leading-snug text-foreground">
        Leader opened 20x BTC long. Your max leverage is 5x. Not copied.
      </p>
    </motion.div>
  </div>
);

/* ---------- exits ---------- */

const Exits = () => {
  const actions = [
    { icon: IconPlayerPause, label: "Pause following", note: "Stops new copies" },
    { icon: IconSquareX, label: "Close all positions", note: "Market close" },
    { icon: IconWallet, label: "Withdraw 24.18 AUSD", note: "Gas covered", primary: true },
  ];
  return (
    <div className="flex h-full flex-col justify-start gap-2.5">
      {actions.map((a, i) => (
        <motion.div
          key={a.label}
          initial={{ opacity: 0, x: 16 }}
          whileInView={{ opacity: 1, x: 0 }}
          viewport={{ once: true }}
          transition={{ delay: 0.1 + i * 0.12, duration: 0.4 }}
          whileHover={{ x: 4 }}
          className={cn(
            "flex items-center justify-between rounded-2xl border px-4 py-3.5",
            a.primary
              ? "border-transparent bg-primary text-primary-foreground shadow-brand"
              : "border-border bg-background text-foreground"
          )}
        >
          <span className="flex items-center gap-3 text-sm font-medium">
            <a.icon className="size-4" />
            {a.label}
          </span>
          <span
            className={cn(
              "text-xs",
              a.primary ? "text-primary-foreground/80" : "text-muted-foreground"
            )}
          >
            {a.note}
          </span>
        </motion.div>
      ))}
      <p className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
        <span className="rounded-full border border-warning/40 bg-warning/10 px-2 py-0.5 font-medium text-warning">
          Beta
        </span>
        Deposit limit {BETA_DEPOSIT_CAP} per account · contract unaudited
      </p>
    </div>
  );
};
