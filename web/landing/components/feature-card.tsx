import { cn } from "@/lib/utils";
import React from "react";

/* Card primitives from the Agenforce template's features section, recoloured to tokens. */

export const Card = ({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) => {
  return (
    <div
      className={cn(
        "relative w-full overflow-hidden bg-card border border-border rounded-2xl",
        className
      )}
    >
      {children}
    </div>
  );
};

export const CardContent = ({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) => {
  return <div className={cn("px-5 md:px-7 pb-6 md:pb-8", className)}>{children}</div>;
};

export const CardStep = ({ children }: { children: React.ReactNode }) => (
  <span className="font-mono text-xs text-brand">{children}</span>
);

export const CardTitle = ({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) => {
  return (
    <h3
      className={cn(
        "mt-1 text-lg md:text-xl font-semibold tracking-tight text-foreground",
        className
      )}
    >
      {children}
    </h3>
  );
};

export const CardDescription = ({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) => {
  return (
    <p className={cn("mt-2 text-sm md:text-[15px] leading-relaxed text-muted-foreground text-pretty", className)}>
      {children}
    </p>
  );
};

export const CardSkeleton = ({
  className,
  children,
}: {
  className?: string;
  children?: React.ReactNode;
}) => {
  return (
    <div
      className={cn(
        "relative h-72 md:h-80 overflow-hidden perspective-distant",
        className
      )}
    >
      {children}
    </div>
  );
};
