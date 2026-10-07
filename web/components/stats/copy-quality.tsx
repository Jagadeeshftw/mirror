"use client";
/**
 * "Copy quality" section of /stats (design/proposal-2, section 02): GET {API_BASE}/v1/stats/copy-quality.
 * Team-run copies are shown in their own card and never counted in the public figures.
 * When the API is not configured or not answering, every figure is "—" and the cards say why.
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { IconUsers } from "@tabler/icons-react";
import {
  BLOCK_BUCKETS,
  DEV_BUCKETS,
  PERIODS,
  bucketize,
  fetchCopyQuality,
  marketsFromConfig,
  toCsv,
  type CopyQuality as Quality,
  type Period,
} from "@/lib/copy-quality";
import { ApiUnavailable } from "@/lib/stats";
import { API_CONFIGURED, CONTRACTS_URL, MEASURED } from "@/lib/site";
import { cn } from "@/lib/utils";
import { Card, CardHead, DASH, Empty, HBars, Histogram, RecentCopies, Stat, fmtBlocks, fmtBps, fmtN, fmtSec } from "./quality-parts";

type State = { kind: "loading" } | { kind: "off" } | { kind: "error"; reason: string } | { kind: "live"; q: Quality };

export const CopyQuality = ({ config }: { config: Record<string, unknown> | null }) => {
  const [period, setPeriod] = useState<Period>("30d");
  const [state, setState] = useState<State>(API_CONFIGURED ? { kind: "loading" } : { kind: "off" });

  const load = useCallback((p: Period, signal?: AbortSignal) => {
    if (!API_CONFIGURED) return;
    setState({ kind: "loading" });
    fetchCopyQuality(p, signal)
      .then((q) => setState({ kind: "live", q }))
      .catch((e) => {
        if ((e as Error).name === "AbortError") return;
        setState({ kind: "error", reason: e instanceof ApiUnavailable ? e.message : "Unexpected response" });
      });
  }, []);

  useEffect(() => {
    const ac = new AbortController();
    load(period, ac.signal);
    return () => ac.abort();
  }, [load, period]);

  const q = state.kind === "live" ? state.q : null;
  const markets = useMemo(() => marketsFromConfig(config), [config]);
  const keeperRows = (q?.recent ?? []).filter((c) => !c.matchNow);
  const devs = keeperRows.map((c) => c.deviationBps).filter((d): d is number => d !== null);
  const blocks = keeperRows.map((c) => c.latencyBlocks).filter((b): b is number => b !== null);
  const noData = q ? "No copies in this period yet." : state.kind === "loading" ? "Loading…" : "Not available yet.";
  const sample = (n: number) => (q?.copies && q.copies > n ? `latest ${n} of ${fmtN(q.copies)} copies` : `${fmtN(n)} copies`);

  const downloadCsv = () => {
    if (!q?.recent.length) return;
    const url = URL.createObjectURL(new Blob([toCsv(q.recent, markets)], { type: "text/csv" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: `mirror-copy-quality-${period}.csv` });
    a.click();
    URL.revokeObjectURL(url);
  };

  const tr = q?.teamRun ?? null;
  const teamRun = (
    <div className="flex items-start gap-3 rounded-xl border border-border p-3">
      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-warning/15 px-2 py-0.5 text-xs font-medium text-warning">
        <IconUsers className="size-3.5" aria-hidden /> Team-run
      </span>
      <p className="text-xs leading-relaxed text-muted-foreground">
        {tr
          ? `Demo follower: ${fmtN(tr.copies)} copies, median ${fmtSec(tr.latencyMs.median)}, ${fmtN(tr.blocked)} blocked. Shown separately, never counted above.`
          : "Demo follower and demo leader copies are shown here, separately, and never counted above."}
      </p>
    </div>
  );

  return (
    <section id="copy-quality" aria-labelledby="cq-h" className="mt-14 scroll-mt-20">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <h2 id="cq-h" className="shrink-0 whitespace-nowrap text-2xl font-semibold tracking-tight">Copy quality</h2>
        <p className="text-sm text-muted-foreground lg:grow">
          How close copies land to the leader, and how fast. Derived from the Mirrored and Blocked events of each MirrorAccount on Monad.
          Team-run excluded.
        </p>
        <div role="group" aria-label="Period" className="inline-flex w-full rounded-full border border-border bg-card p-1 lg:w-auto">
          {PERIODS.map((p) => (
            <button
              key={p.id}
              type="button"
              aria-pressed={period === p.id}
              onClick={() => setPeriod(p.id)}
              className={cn(
                "h-8 flex-1 rounded-full px-4 text-sm font-medium lg:flex-none",
                period === p.id ? "bg-brand-soft text-brand" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {state.kind !== "live" && state.kind !== "loading" && (
        <p className="mt-4 rounded-2xl border border-border bg-muted/50 px-4 py-3 text-sm text-muted-foreground">
          {state.kind === "off"
            ? "Not live yet: the stats API is not public, so there are no copies to measure. Nothing here is estimated."
            : `The stats API is not answering (${state.reason}). No figures are shown rather than old or estimated ones.`}
          {state.kind === "error" && (
            <button type="button" onClick={() => load(period)} className="ml-2 font-medium text-brand hover:underline">
              Retry
            </button>
          )}
        </p>
      )}

      <Card className="mt-5 grid grid-cols-2 gap-x-4 gap-y-5 lg:hidden">
        <Stat label="Median, Proposed → copy" value={fmtSec(q?.latencyMs.median ?? null)} sub={fmtBlocks(q?.latencyBlocks.median ?? null)} />
        <Stat label="p90" value={fmtSec(q?.latencyMs.p90 ?? null)} sub={fmtBlocks(q?.latencyBlocks.p90 ?? null)} />
        <Stat label="Median deviation" value={fmtBps(q?.deviation.median ?? null)} sub="vs leader fill" />
        <Stat label="p90 deviation" value={fmtBps(q?.deviation.p90 ?? null)} sub={q ? `${fmtN(q.deviation.samples)} copies` : null} />
      </Card>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:mt-5 lg:grid-cols-[1.15fr_1fr_1fr]">
        <Card>
          <CardHead title="Deviation from leader fill" aside={`bps · + is worse${devs.length ? ` · ${sample(devs.length)}` : ""}`} />
          {devs.length ? <Histogram buckets={bucketize(devs, DEV_BUCKETS)} label="Deviation from leader fill, bps" /> : <Empty>{noData}</Empty>}
          <p className="mt-3 hidden gap-4 text-xs text-muted-foreground lg:flex">
            <span>Median <b className="font-mono font-semibold text-foreground">{fmtBps(q?.deviation.median ?? null)}</b></span>
            <span>p90 <b className="font-mono font-semibold text-foreground">{fmtBps(q?.deviation.p90 ?? null)}</b></span>
            {q?.deviation.worseThanLeader != null && q.deviation.samples ? (
              <span>Worse than leader <b className="font-mono font-semibold text-foreground">{fmtN(q.deviation.worseThanLeader)}</b> of {fmtN(q.deviation.samples)}</span>
            ) : null}
          </p>
        </Card>

        <Card>
          <CardHead title={<><span className="lg:hidden">Blocks between leader and copy</span><span className="hidden lg:inline">Leader fill Proposed → copy</span></>} />
          <div className="mt-3 hidden grid-cols-2 gap-4 lg:grid">
            <Stat big label="Median" value={fmtSec(q?.latencyMs.median ?? null)} sub={fmtBlocks(q?.latencyBlocks.median ?? null)} />
            <Stat big label="p90" value={fmtSec(q?.latencyMs.p90 ?? null)} sub={fmtBlocks(q?.latencyBlocks.p90 ?? null)} />
          </div>
          {blocks.length ? <HBars rows={bucketize(blocks, BLOCK_BUCKETS)} pct /> : <Empty>{noData}</Empty>}
          <p className="mt-3 text-xs text-muted-foreground">
            Monad blocks are about {MEASURED.blockMs} ms; finality follows about {MEASURED.finalityAfterProposedMs} ms after Proposed.
            {blocks.length ? ` Shares over the ${sample(blocks.length)}.` : ""}
          </p>
        </Card>

        <Card className="flex flex-col">
          <CardHead title="Blocked by reason" aside={<span className="font-mono">{q ? `${fmtN(q.blocked)} total` : DASH}</span>} />
          {q?.blockedByReason.length ? (
            <HBars rows={q.blockedByReason.map((r) => ({ label: r.label, count: r.count }))} />
          ) : (
            <Empty>{q ? "No copies blocked in this period." : noData}</Empty>
          )}
          <div className="mt-auto hidden pt-4 lg:block">{teamRun}</div>
        </Card>
        <div className="lg:hidden">{teamRun}</div>
      </div>

      <Card className="mt-4">
        <CardHead
          title="Recent copies"
          aside={
            q?.recent.length ? (
              <button type="button" onClick={downloadCsv} className="text-sm font-medium text-brand hover:underline">
                Download CSV
              </button>
            ) : undefined
          }
        />
        <p className="mt-1 text-xs text-muted-foreground">Leader fill against the follower&apos;s fill, newest first. Each row links to its transaction.</p>
        <RecentCopies rows={q?.recent ?? []} markets={markets} empty={noData} />
      </Card>

      <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
        Every number in this section is derived from onchain events (Mirrored and Blocked, emitted by each MirrorAccount) on Monad
        {q?.source ? `, read through the ${q.source === "indexer" ? "Mirror indexer" : "Mirror engine"}` : ""}. Latency in ms is
        the engine&apos;s clock; blocks are onchain. ·{" "}
        <Link href={CONTRACTS_URL} className="text-brand hover:underline">
          Contracts
        </Link>
      </p>
    </section>
  );
};
