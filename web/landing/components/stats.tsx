"use client";
import React, { useEffect, useRef } from "react";
import { animate, motion, useInView, useMotionValue, useTransform } from "motion/react";
import { Container } from "./container";

const STATS = [
  { value: 0.61, decimals: 2, prefix: "~", suffix: " s", label: "Median copy latency, leader fill to your fill" },
  { value: 8, decimals: 0, prefix: "", suffix: "", label: "Rules checked onchain on every copied order" },
  { value: 100, decimals: 0, prefix: "", suffix: "%", label: "Of orders pass through your contract first" },
  { value: 0, decimals: 0, prefix: "", suffix: "", label: "Withdrawal rights held by the copy keeper" },
];

export const Stats = () => {
  return (
    <section aria-label="Key figures" className="border-y border-border bg-card">
      <Container className="grid grid-cols-2 lg:grid-cols-4">
        {STATS.map((s, i) => (
          <div
            key={s.label}
            className={[
              "py-10 md:py-14 px-2 md:px-6",
              i % 2 === 1 ? "pl-5 border-l border-border" : "",
              i >= 2 ? "border-t border-border lg:border-t-0" : "",
              i === 2 ? "lg:border-l lg:pl-6" : "",
              i === 0 ? "lg:pl-0" : "",
            ].join(" ")}
          >
            <p className="font-mono text-4xl font-semibold tracking-tight text-foreground md:text-5xl">
              <Counter {...s} />
            </p>
            <p className="mt-3 max-w-[16rem] text-sm leading-snug text-muted-foreground">
              {s.label}
            </p>
          </div>
        ))}
      </Container>
      <Container>
        <p className="border-t border-border py-3 font-mono text-[11px] text-muted-foreground">
          Illustrative figures for the beta design. Live numbers will come from
          the indexer.
        </p>
      </Container>
    </section>
  );
};

const Counter = ({
  value,
  decimals,
  prefix,
  suffix,
}: {
  value: number;
  decimals: number;
  prefix: string;
  suffix: string;
}) => {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: "-40px" });
  const mv = useMotionValue(0);
  const text = useTransform(mv, (v) => v.toFixed(decimals));
  useEffect(() => {
    if (!inView) return;
    const controls = animate(mv, value, { duration: 1.4, ease: [0.22, 1, 0.36, 1] });
    return () => controls.stop();
  }, [inView, mv, value]);
  return (
    <span ref={ref}>
      {prefix && <span className="text-muted-foreground">{prefix}</span>}
      <motion.span>{text}</motion.span>
      {suffix && <span className="ml-0.5 text-2xl text-muted-foreground md:text-3xl">{suffix.trim()}</span>}
    </span>
  );
};
