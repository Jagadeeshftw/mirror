"use client";
/**
 * Aceternity UI Pro, Illustrations block "Animated Beam Path Illustration", made reusable:
 * the path, viewBox and colours are props, and every SVG id is unique per instance (the
 * original's fixed ids collide when two beams share a page). The drawing and the
 * travelling-mask animation are the original's. Colours come from CSS variables:
 * --beam-color-1/2/3 and --path-color.
 */
import React, { useEffect, useId, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { cn } from "@/lib/utils";

export function BeamPath({
  path,
  width,
  height,
  className,
  duration = 2,
  delay = 0,
  repeatDelay = 1,
  active = true,
  stretch = false,
}: {
  path: string;
  width: number;
  height: number;
  className?: string;
  duration?: number;
  delay?: number;
  repeatDelay?: number;
  active?: boolean;
  /** Stretch to the container (preserveAspectRatio none) instead of keeping the aspect ratio. */
  stretch?: boolean;
}) {
  const uid = useId().replace(/[:«»]/g, "");
  const reduce = useReducedMotion();
  // The server cannot know the visitor's reduced-motion setting, so the first client render must draw exactly what
  // the server drew; the still version (fewer gradient stops) only after hydration. Rendering it during hydration
  // changed the element count and failed hydration (React #418) for visitors with Reduce Motion on.
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  const id = (k: string) => `${k}-${uid}`;
  const t = { duration, repeat: Infinity, ease: "linear" as const, repeatDelay, delay };
  const still = (hydrated && !!reduce) || !active;

  return (
    <svg
      width={stretch ? undefined : width}
      height={stretch ? undefined : height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio={stretch ? "none" : undefined}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("overflow-visible", className)}
      aria-hidden
    >
      <defs>
        <linearGradient id={id("fade")} x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="black" />
          <stop offset="10%" stopColor="white" />
          <stop offset="90%" stopColor="white" />
          <stop offset="100%" stopColor="black" />
        </linearGradient>
        <linearGradient id={id("beam")} x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="transparent" />
          <stop offset="30%" stopColor="var(--beam-color-1)" />
          <stop offset="50%" stopColor="var(--beam-color-2)" />
          <stop offset="70%" stopColor="var(--beam-color-3)" />
          <stop offset="100%" stopColor="transparent" />
        </linearGradient>
        <filter id={id("glow")} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="4" result="coloredBlur" />
          <feMerge>
            <feMergeNode in="coloredBlur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <mask id={id("ends")}>
          <rect x="0" y="0" width={width} height={height} fill={`url(#${id("fade")})`} />
        </mask>
        <linearGradient id={id("travel")} gradientUnits="userSpaceOnUse" x1="0" y1="0" x2={width} y2="0">
          {still ? (
            <>
              <stop offset="0%" stopColor="white" />
              <stop offset="100%" stopColor="white" />
            </>
          ) : (
            <>
              <motion.stop offset="0%" stopColor="black" animate={{ offset: ["-25%", "100%"] }} transition={t} />
              <motion.stop offset="5%" stopColor="white" animate={{ offset: ["-20%", "105%"] }} transition={t} />
              <motion.stop offset="15%" stopColor="white" animate={{ offset: ["-10%", "115%"] }} transition={t} />
              <motion.stop offset="20%" stopColor="black" animate={{ offset: ["-5%", "120%"] }} transition={t} />
            </>
          )}
        </linearGradient>
        <mask id={id("beammask")}>
          <path d={path} stroke={`url(#${id("travel")})`} strokeWidth="6" strokeLinecap="round" fill="none" />
        </mask>
      </defs>
      <g mask={`url(#${id("ends")})`}>
        <path
          d={path}
          stroke="var(--path-color)"
          strokeWidth="2"
          strokeDasharray="1 6"
          strokeLinecap="round"
          fill="none"
          vectorEffect={stretch ? "non-scaling-stroke" : undefined}
        />
        <g filter={`url(#${id("glow")})`} opacity={still ? 0.35 : 1}>
          <path
            d={path}
            stroke={`url(#${id("beam")})`}
            strokeWidth="3"
            strokeLinecap="round"
            strokeDasharray="1 6"
            fill="none"
            mask={`url(#${id("beammask")})`}
            vectorEffect={stretch ? "non-scaling-stroke" : undefined}
          />
        </g>
      </g>
    </svg>
  );
}
