import { cn } from "@/lib/utils";
import React from "react";

export const Heading = ({
  children,
  className,
  as = "h2",
}: {
  children: React.ReactNode;
  className?: string;
  as?: "h1" | "h2";
}) => {
  const Tag = as;

  return (
    <Tag
      className={cn(
        "text-[2rem] leading-[1.08] md:text-5xl lg:text-[3.5rem] tracking-[-0.035em] font-display font-semibold text-balance text-foreground",
        className
      )}
    >
      {children}
    </Tag>
  );
};

export const Eyebrow = ({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) => {
  return (
    <p
      className={cn(
        "font-mono text-xs uppercase tracking-[0.14em] text-brand mb-4 flex items-center gap-2",
        className
      )}
    >
      <span className="inline-block h-px w-6 bg-brand/60" />
      {children}
    </p>
  );
};
