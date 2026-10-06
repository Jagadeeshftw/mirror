"use client";
import React, { useEffect, useState } from "react";
import Link from "next/link";
import { IconArrowRight } from "@tabler/icons-react";
import { Container } from "./container";
import { NumberTicker } from "./ui/number-ticker";
import { fetchStats, type Stats as LiveStats } from "@/lib/stats";
import { API_CONFIGURED, MEASURED, STATS_URL } from "@/lib/site";

type Item = { value: number; decimals: number; prefix?: string; suffix?: string; label: string };

/** Real numbers only: measured chain and test figures until the live API answers, then live traction. */
const MEASURED_ITEMS: Item[] = [
  { value: MEASURED.blockMs, decimals: 0, prefix: "~", suffix: "ms", label: "Monad block time, measured on mainnet" },
  { value: MEASURED.finalityAfterProposedMs, decimals: 0, prefix: "~", suffix: "ms", label: "From Proposed to Finalized, measured on mainnet" },
  { value: 278, decimals: 0, prefix: "~", suffix: "k gas", label: "Per copied open with every policy check, about $0.001" },
  { value: MEASURED.tests, decimals: 0, suffix: "", label: "Passing contract tests, incl. fork tests on live Perpl" },
];

function liveItems(s: LiveStats): Item[] | null {
  if (s.accountsCreated === null || s.copiesExecuted === null) return null;
  const items: Item[] = [
    { value: s.accountsCreated, decimals: 0, label: "Mirror accounts created (team-run excluded)" },
    { value: s.copiesExecuted, decimals: 0, label: "Copies executed onchain" },
    { value: s.copiesBlocked ?? 0, decimals: 0, label: "Copies blocked by a follower's rule, each with its own tx" },
  ];
  if (s.medianLatencyMs !== null)
    items.push({ value: s.medianLatencyMs / 1000, decimals: 2, suffix: "s", label: "Median latency, leader fill to copy tx" });
  else if (s.fundedAccounts !== null) items.push({ value: s.fundedAccounts, decimals: 0, label: "Funded accounts" });
  return items;
}

export const Stats = () => {
  const [live, setLive] = useState<Item[] | null>(null);

  useEffect(() => {
    if (!API_CONFIGURED) return;
    const ac = new AbortController();
    fetchStats({ limit: 1, signal: ac.signal })
      .then((s) => setLive(liveItems(s)))
      .catch(() => {});
    return () => ac.abort();
  }, []);

  const items = live ?? MEASURED_ITEMS;

  return (
    <section aria-label="Key figures" className="border-y border-border bg-card">
      <Container className="grid grid-cols-2 lg:grid-cols-4">
        {items.map((s, i) => (
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
              {s.prefix && <span className="text-muted-foreground">{s.prefix}</span>}
              <NumberTicker value={s.value} decimals={s.decimals} />
              {s.suffix && (
                <span className="ml-1 text-xl text-muted-foreground md:text-2xl">{s.suffix}</span>
              )}
            </p>
            <p className="mt-3 max-w-[16rem] text-sm leading-snug text-muted-foreground">{s.label}</p>
          </div>
        ))}
      </Container>
      <Container>
        <div className="flex flex-col gap-2 border-t border-border py-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="font-mono text-[11px] text-muted-foreground">
            {live
              ? "Live from the Mirror indexer. Team-run demo accounts are excluded."
              : "Measured on Monad mainnet and a mainnet fork. Live traction numbers appear here once the contracts are live."}
          </p>
          <Link
            href={STATS_URL}
            className="inline-flex items-center gap-1 font-mono text-[11px] text-brand hover:underline"
          >
            Public stats <IconArrowRight className="size-3" />
          </Link>
        </div>
      </Container>
    </section>
  );
};
