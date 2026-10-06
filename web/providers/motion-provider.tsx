"use client";
import { MotionConfig } from "motion/react";
import React from "react";

/** Landing page only: motion respects the reader's reduced-motion setting. */
export const MotionProvider = ({ children }: { children: React.ReactNode }) => (
  <MotionConfig reducedMotion="user">{children}</MotionConfig>
);
