import React from "react";
import Link from "next/link";
import { IconExternalLink } from "@tabler/icons-react";
import { EXPLORER_TX } from "@/lib/site";
import { shortHex } from "@/lib/perpl/format";
import { cn } from "@/lib/utils";

export const walletHref = (account: number | string) => `/perpl/wallet/${account}`;

export const Panel = ({
  title,
  meta,
  children,
  className,
  id,
}: {
  title: string;
  meta?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  id?: string;
}) => (
  <section aria-labelledby={id ? `${id}-h` : undefined} className={cn("min-w-0 rounded-2xl border border-border bg-card p-4 md:p-5", className)}>
    <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
      <h2 id={id ? `${id}-h` : undefined} className="text-[15px] font-semibold tracking-tight">
        {title}
      </h2>
      {meta && <div className="text-xs text-muted-foreground">{meta}</div>}
    </div>
    {children}
  </section>
);

export const Tile = ({
  label,
  value,
  note,
  tone,
}: {
  label: string;
  value: React.ReactNode;
  note?: React.ReactNode;
  tone?: "positive" | "negative" | "warning";
}) => (
  <div className="min-w-0 rounded-2xl border border-border bg-card p-4">
    <p className="text-[13px] text-muted-foreground">{label}</p>
    <p
      className={cn(
        "mt-1.5 truncate font-mono text-2xl font-semibold tracking-tight md:text-[1.75rem]",
        tone === "positive" && "text-positive",
        tone === "negative" && "text-negative",
        tone === "warning" && "text-warning"
      )}
    >
      {value}
    </p>
    {note && <p className="mt-1 truncate font-mono text-xs text-muted-foreground">{note}</p>}
  </div>
);

/** First line of an error, capped: RPC errors can carry kilobytes of calldata that would stretch the page. */
export const shortReason = (reason: string) => {
  const line = reason.split("\n").find((l) => l.trim()) ?? "";
  return line.length > 140 ? `${line.slice(0, 140)}…` : line;
};

/** Honest empty state: the source and why it is not available. Never a placeholder number. */
export const NotAvailable = ({ source, reason, className }: { source: string; reason?: string; className?: string }) => (
  <div className={cn("min-w-0 rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground", className)}>
    <p className="font-medium text-foreground">Not available</p>
    <p className="mt-1 break-words [overflow-wrap:anywhere]">
      {source}
      {reason ? `: ${shortReason(reason)}` : ""}.
    </p>
  </div>
);

export const Estimate = ({ children = "estimate" }: { children?: React.ReactNode }) => (
  <span className="rounded-full border border-warning/50 bg-warning/10 px-2 py-0.5 text-[11px] font-medium text-warning">{children}</span>
);

export const SideBadge = ({ side }: { side: "long" | "short" }) => (
  <span
    className={cn(
      "rounded-md px-1.5 py-0.5 text-[11px] font-medium",
      side === "long" ? "bg-positive/10 text-positive" : "bg-negative/10 text-negative"
    )}
  >
    {side === "long" ? "Long" : "Short"}
  </span>
);

export const TxLink = ({ hash }: { hash: string }) => (
  <a
    href={`${EXPLORER_TX}${hash}`}
    target="_blank"
    rel="noopener noreferrer"
    className="inline-flex items-center gap-1 font-mono text-xs text-brand hover:underline"
    title={`Transaction ${hash} on MonadVision`}
  >
    {shortHex(hash, 6, 4)}
    <IconExternalLink className="size-3" aria-hidden />
  </a>
);

export const AccountLink = ({ id, className }: { id: number | string; className?: string }) => (
  <Link href={walletHref(id)} className={cn("font-mono font-medium text-brand hover:underline", className)}>
    #{id}
  </Link>
);

export const Th = ({ children, right, className }: { children: React.ReactNode; right?: boolean; className?: string }) => (
  <th scope="col" className={cn("whitespace-nowrap px-2 pb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground", right ? "text-right" : "text-left", className)}>
    {children}
  </th>
);

export const Td = ({ children, right, className }: { children: React.ReactNode; right?: boolean; className?: string }) => (
  <td className={cn("whitespace-nowrap border-t border-border px-2 py-2.5", right && "text-right font-mono", className)}>{children}</td>
);

export const SourceLine = ({ children }: { children: React.ReactNode }) => <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">{children}</p>;

export const signTone = (n: number | null | undefined) => (n === null || n === undefined || n === 0 ? undefined : n > 0 ? "text-positive" : "text-negative");
