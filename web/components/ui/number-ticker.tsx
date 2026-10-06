"use client";
/**
 * Aceternity UI Pro, Stats Sections block "Stats With Number Ticker": the AnimatedNumber spring
 * counter, lifted out of the block so any stat can use it.
 * Changes from the original: formatting is a prop (decimals, en-US grouping), the final value
 * reserves its width so nothing shifts while counting, and it never moves under reduced motion.
 */
import React, { useEffect, useRef } from "react";
import { motion, useInView, useReducedMotion, useSpring, useTransform } from "motion/react";

export function NumberTicker({
  value,
  decimals = 0,
  initial = 0,
  once = true,
  className,
}: {
  value: number;
  decimals?: number;
  initial?: number;
  once?: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const isInView = useInView(ref, { once, margin: "-40px" });
  const reduce = useReducedMotion();
  const fmt = (n: number) =>
    n.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });

  const spring = useSpring(initial, { mass: 0.8, stiffness: 75, damping: 15 });
  const display = useTransform(spring, (current) => fmt(current));

  useEffect(() => {
    if (reduce) spring.jump(value);
    else if (isInView) spring.set(value);
    else spring.jump(initial);
  }, [isInView, reduce, spring, value, initial]);

  return (
    <span className={`relative inline-block tabular-nums ${className ?? ""}`}>
      <span className="invisible" aria-hidden>
        {fmt(value)}
      </span>
      <span className="sr-only">{fmt(value)}</span>
      <motion.span ref={ref} aria-hidden className="absolute inset-y-0 left-0">
        {display}
      </motion.span>
    </span>
  );
}
