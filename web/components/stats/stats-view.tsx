"use client";
/**
 * Public stats from GET {API_BASE}/v1/stats (team-run excluded), plus the team-run demo
 * accounts from /v1/demo and /v1/config in their own clearly labelled section.
 * No motion. Every number comes from the API; when the API is not live the page says so.
 */
import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  ApiUnavailable,
  fetchJson,
  fetchStats,
  isObj,
  num,
  pick,
  shortHex,
  str,
  toSeconds,
  type CopyRow,
  type Stats,
} from "@/lib/stats";
import { API_CONFIGURED, EXPLORER_ADDRESS, EXPLORER_TX } from "@/lib/site";
import { cn } from "@/lib/utils";
import { CopyQuality } from "./copy-quality";

const PAGE_SIZE = 25;

type State =
  | { kind: "loading" }
  | { kind: "not-configured" }
  | { kind: "unreachable"; reason: string }
  | { kind: "live"; stats: Stats };

const fmtInt = (n: number | null) => (n === null ? "—" : n.toLocaleString("en-US"));
const fmtAusd = (n: number | null) =>
  n === null ? "—" : n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtLatency = (ms: number | null) => (ms === null ? "—" : ms >= 1000 ? `${(ms / 1000).toFixed(2)} s` : `${Math.round(ms)} ms`);
const fmtTime = (s: number | null) =>
  s === null
    ? "—"
    : new Date(s * 1000).toLocaleString("en-GB", {
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        timeZone: "UTC",
        hour12: false,
      }) + " UTC";

export const StatsView = () => {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const [page, setPage] = useState(0);
  const [config, setConfig] = useState<Record<string, unknown> | null>(null);
  const [demo, setDemo] = useState<Record<string, unknown> | null>(null);

  const load = useCallback((cursor: string | null, signal?: AbortSignal) => {
    if (!API_CONFIGURED) {
      setState({ kind: "not-configured" });
      return;
    }
    fetchStats({ cursor, limit: PAGE_SIZE, signal })
      .then((stats) => setState({ kind: "live", stats }))
      .catch((e) => {
        if ((e as Error).name === "AbortError") return;
        setState({ kind: "unreachable", reason: e instanceof ApiUnavailable ? e.message : "Unexpected response" });
      });
  }, []);

  useEffect(() => {
    const ac = new AbortController();
    load(cursors[page], ac.signal);
    return () => ac.abort();
  }, [load, cursors, page]);

  useEffect(() => {
    if (!API_CONFIGURED) return;
    const ac = new AbortController();
    fetchJson("/v1/config", ac.signal).then(setConfig).catch(() => {});
    fetchJson("/v1/demo", ac.signal).then(setDemo).catch(() => {});
    return () => ac.abort();
  }, []);

  const stats = state.kind === "live" ? state.stats : null;
  const keeper =
    stats?.keeper ??
    (isObj(config?.keeper) ? str(pick(config!.keeper as Record<string, unknown>, "address")) : str(config?.keeper)) ??
    stats?.copies.find((c) => c.keeper)?.keeper ??
    null;

  const next = () => {
    if (!stats?.nextCursor) return;
    setCursors((c) => [...c.slice(0, page + 1), stats.nextCursor]);
    setPage((p) => p + 1);
  };
  const prev = () => setPage((p) => Math.max(0, p - 1));

  return (
    <div className="mx-auto max-w-7xl px-4 py-10 md:px-8 md:py-14">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
        <div>
          <p className="mb-3 font-mono text-xs uppercase tracking-[0.12em] text-brand">Public stats</p>
          <h1 className="text-3xl font-semibold tracking-[-0.03em] md:text-[2.5rem]">Every copy, onchain.</h1>
          <p className="mt-3 max-w-2xl text-base leading-relaxed text-muted-foreground">
            Read from Monad mainnet through the Mirror indexer. Team-run demo accounts are excluded from every number
            here and shown separately below.
          </p>
        </div>
        <StatusPill state={state} updatedAt={stats?.updatedAt ?? null} />
      </div>

      {state.kind === "not-configured" && <NotLive />}
      {state.kind === "unreachable" && <Unreachable reason={state.reason} onRetry={() => load(cursors[page])} />}

      <section aria-label="Totals" className="mt-10">
        <div className="grid grid-cols-2 overflow-hidden rounded-3xl border border-border bg-card lg:grid-cols-4">
          <Tile label="Accounts created" value={fmtInt(stats?.accountsCreated ?? null)} i={0} />
          <Tile label="Funded accounts" value={fmtInt(stats?.fundedAccounts ?? null)} i={1} />
          <Tile label="Net AUSD deposited" value={fmtAusd(stats?.netDepositedAusd ?? null)} unit="AUSD" i={2} />
          <Tile label="Copies executed" value={fmtInt(stats?.copiesExecuted ?? null)} i={3} />
          <Tile label="Copies blocked by a rule" value={fmtInt(stats?.copiesBlocked ?? null)} i={4} />
          <Tile label="Median latency" value={fmtLatency(stats?.medianLatencyMs ?? null)} note="leader fill to copy tx" i={5} />
          <Tile label="Active followers, 7 days" value={fmtInt(stats?.activeFollowers7d ?? null)} i={6} />
          <Tile
            label="Keeper"
            value={
              keeper ? (
                <a href={`${EXPLORER_ADDRESS}${keeper}`} className="text-brand hover:underline" target="_blank" rel="noopener noreferrer">
                  {shortHex(keeper)}
                </a>
              ) : (
                "—"
              )
            }
            note="submits every copy"
            small
            i={7}
          />
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          “—” means the figure is not available yet. Nothing on this page is estimated or illustrative.
        </p>
      </section>

      <CopyQuality config={config} />

      <div className="mt-12 grid grid-cols-1 gap-10 lg:grid-cols-[1fr_2fr]">
        <BlockedByRule stats={stats} />
        <CopiesTable stats={stats} page={page} onPrev={prev} onNext={next} />
      </div>

      <TeamRun config={config} demo={demo} stats={stats} configured={API_CONFIGURED} />
    </div>
  );
};

const StatusPill = ({ state, updatedAt }: { state: State; updatedAt: number | null }) => {
  const map = {
    loading: { dot: "bg-muted-foreground", text: "Loading…" },
    "not-configured": { dot: "bg-warning", text: "Not live yet" },
    unreachable: { dot: "bg-negative", text: "API unreachable" },
    live: { dot: "bg-positive", text: updatedAt ? `Live · updated ${fmtTime(updatedAt)}` : "Live" },
  }[state.kind];
  return (
    <p
      role="status"
      className="inline-flex w-fit items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground"
    >
      <span className={cn("size-2 rounded-full", map.dot)} aria-hidden />
      {map.text}
    </p>
  );
};

const NotLive = () => (
  <div className="mt-8 rounded-3xl border border-warning/40 bg-warning/[0.06] p-5 md:p-6">
    <p className="font-semibold text-foreground">Not live yet</p>
    <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted-foreground">
      The Mirror contracts are not deployed on Monad mainnet yet and the stats API is not public, so there is nothing
      to count. Once they are live, this page fills in from the indexer: every account, deposit and executed copy, each
      copy with its MonadVision transaction and the keeper that submitted it. Until then, see{" "}
      <Link href="/docs/judges-guide" className="text-brand underline underline-offset-2">
        what can be verified today
      </Link>
      .
    </p>
  </div>
);

const Unreachable = ({ reason, onRetry }: { reason: string; onRetry: () => void }) => (
  <div className="mt-8 flex flex-col gap-3 rounded-3xl border border-negative/40 bg-negative/[0.05] p-5 md:flex-row md:items-center md:justify-between md:p-6">
    <div>
      <p className="font-semibold text-foreground">The stats API is not answering right now</p>
      <p className="mt-1 text-sm text-muted-foreground">
        {reason}. The onchain data is unaffected; this page only reads it. Try again in a moment.
      </p>
    </div>
    <button
      type="button"
      onClick={onRetry}
      className="h-9 w-fit rounded-full border border-border bg-card px-4 text-sm font-medium hover:bg-muted"
    >
      Retry
    </button>
  </div>
);

const Tile = ({
  label,
  value,
  unit,
  note,
  small,
  i,
}: {
  label: string;
  value: React.ReactNode;
  unit?: string;
  note?: string;
  small?: boolean;
  i: number;
}) => (
  <div
    className={cn(
      "border-border p-5 md:p-6",
      i % 2 === 1 ? "border-l" : "border-l-0",
      i % 4 === 0 ? "lg:border-l-0" : "lg:border-l",
      i >= 2 ? "border-t" : "border-t-0",
      i >= 4 ? "lg:border-t" : "lg:border-t-0"
    )}
  >
    <p className="text-sm text-muted-foreground">{label}</p>
    <p className={cn("mt-2 font-mono font-semibold tracking-tight text-foreground", small ? "text-lg md:text-xl" : "text-2xl md:text-3xl")}>
      {value}
      {unit && value !== "—" && <span className="ml-1.5 text-sm font-medium text-muted-foreground">{unit}</span>}
    </p>
    {note && <p className="mt-1 text-xs text-muted-foreground">{note}</p>}
  </div>
);

const BlockedByRule = ({ stats }: { stats: Stats | null }) => {
  const rows = stats?.blockedByRule ?? [];
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <section aria-labelledby="blocked-h">
      <h2 id="blocked-h" className="text-lg font-semibold tracking-tight">
        Copies blocked, per rule
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Each block is a <code className="font-mono text-[0.85em]">Blocked</code> event in its own transaction.
      </p>
      <div className="mt-4 rounded-2xl border border-border bg-card p-4">
        {rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">{stats ? "No copies blocked yet." : "Not available yet."}</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {rows.map((r) => (
              <li key={r.reason} title={`${r.label}: ${r.count.toLocaleString("en-US")}`}>
                <div className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="text-foreground">{r.label}</span>
                  <span className="font-mono text-muted-foreground">{r.count.toLocaleString("en-US")}</span>
                </div>
                <div className="mt-1.5 h-2 rounded-full bg-muted">
                  <div className="h-2 rounded-full bg-brand" style={{ width: `${Math.max(2, (r.count / max) * 100)}%` }} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
};

const CopiesTable = ({
  stats,
  page,
  onPrev,
  onNext,
}: {
  stats: Stats | null;
  page: number;
  onPrev: () => void;
  onNext: () => void;
}) => {
  const rows = stats?.copies ?? [];
  return (
    <section aria-labelledby="copies-h" className="min-w-0">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h2 id="copies-h" className="text-lg font-semibold tracking-tight">
            Every executed copy
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Newest first{stats?.totalCopies !== null && stats?.totalCopies !== undefined ? ` · ${fmtInt(stats.totalCopies)} total` : ""}.
            Links open on MonadVision.
          </p>
        </div>
      </div>
      <div className="mt-4 overflow-x-auto rounded-2xl border border-border bg-card" tabIndex={0} role="region" aria-label="Executed copies">
        <table className="w-full min-w-[56rem] text-sm">
          <thead>
            <tr className="border-b border-border bg-muted text-left text-xs text-muted-foreground">
              {["Time", "Market", "Action", "Size", "Leverage", "Latency", "Follower", "Leader", "Keeper", "Transaction"].map((h) => (
                <th key={h} scope="col" className="whitespace-nowrap px-3 py-2.5 font-semibold">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={10} className="px-3 py-10 text-center text-muted-foreground">
                  {stats ? "No copies executed yet." : "Not available yet."}
                </td>
              </tr>
            ) : (
              rows.map((r: CopyRow) => (
                <tr key={r.txHash + r.market + r.action} className="border-b border-border last:border-b-0">
                  <td className="whitespace-nowrap px-3 py-2.5 font-mono text-xs text-muted-foreground">{fmtTime(r.timestamp)}</td>
                  <td className="px-3 py-2.5 font-medium">{r.market}</td>
                  <td className="whitespace-nowrap px-3 py-2.5">
                    {r.action}
                    {r.matchNow && <span className="ml-1.5 rounded-full bg-brand-soft px-1.5 py-0.5 text-[10px] font-medium text-brand">match now</span>}
                  </td>
                  <td className="px-3 py-2.5 font-mono">{r.size ?? "—"}</td>
                  <td className="px-3 py-2.5 font-mono">{r.leverage ?? "—"}</td>
                  <td className="px-3 py-2.5 font-mono">{fmtLatency(r.latencyMs)}</td>
                  <td className="px-3 py-2.5 font-mono text-xs">
                    {r.account ? <AddrLink a={r.account} /> : "—"}
                  </td>
                  <td className="px-3 py-2.5 font-mono text-xs">{r.leader ? (r.leader.startsWith("0x") ? <AddrLink a={r.leader} /> : `#${r.leader}`) : "—"}</td>
                  <td className="px-3 py-2.5 font-mono text-xs">{r.keeper ? <AddrLink a={r.keeper} /> : "—"}</td>
                  <td className="px-3 py-2.5 font-mono text-xs">
                    <a href={`${EXPLORER_TX}${r.txHash}`} target="_blank" rel="noopener noreferrer" className="text-brand hover:underline">
                      {shortHex(r.txHash, 8, 6)} ↗
                    </a>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <div className="mt-3 flex items-center justify-between text-sm">
        <span className="text-muted-foreground">Page {page + 1}</span>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onPrev}
            disabled={page === 0}
            className="h-9 rounded-full border border-border bg-card px-4 font-medium hover:bg-muted disabled:opacity-40"
          >
            Previous
          </button>
          <button
            type="button"
            onClick={onNext}
            disabled={!stats?.nextCursor}
            className="h-9 rounded-full border border-border bg-card px-4 font-medium hover:bg-muted disabled:opacity-40"
          >
            Next
          </button>
        </div>
      </div>
    </section>
  );
};

const AddrLink = ({ a }: { a: string }) => (
  <a href={`${EXPLORER_ADDRESS}${a}`} target="_blank" rel="noopener noreferrer" className="hover:text-brand hover:underline">
    {shortHex(a)}
  </a>
);

/** Team-run demo leader / follower, never counted above. */
const TeamRun = ({
  config,
  demo,
  stats,
  configured,
}: {
  config: Record<string, unknown> | null;
  demo: Record<string, unknown> | null;
  stats: Stats | null;
  configured: boolean;
}) => {
  const tr = (isObj(config?.teamRun) ? config!.teamRun : {}) as Record<string, unknown>;
  const leaderObj = (isObj(demo?.leader) ? demo!.leader : {}) as Record<string, unknown>;
  const followerObj = (isObj(demo?.follower) ? demo!.follower : {}) as Record<string, unknown>;
  const leaderAddr = str(pick(leaderObj, "address")) ?? str(pick(tr, "demoLeaderAddress"));
  const leaderId = str(pick(leaderObj, "accountId")) ?? str(pick(tr, "demoLeaderAccountId"));
  const followerAddr = str(pick(followerObj, "account", "address")) ?? str(pick(tr, "demoFollowerAccount"));
  const followerBal = num(pick(followerObj, "balanceUsd", "equityUsd", "balanceDisplay"));
  const cyclesRaw = pick(demo ?? {}, "cycles", "recentCycles", "recent");
  const cycles = (Array.isArray(cyclesRaw) ? cyclesRaw : []).filter(isObj).slice(0, 10);

  return (
    <section aria-labelledby="teamrun-h" className="mt-14 rounded-3xl border border-dashed border-border p-5 md:p-8">
      <div className="flex flex-col justify-between gap-2 md:flex-row md:items-baseline">
        <h2 id="teamrun-h" className="text-lg font-semibold tracking-tight">
          Team-run (excluded from counts)
        </h2>
        <Link href="/docs/team-run-accounts" className="text-sm text-brand hover:underline">
          Disclosure →
        </Link>
      </div>
      <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted-foreground">
        The demo leader and the demo follower are run by the Mirror team so anyone can trigger a real copy and a real
        blocked copy on demand. They are flagged <code className="font-mono text-[0.85em]">teamRun</code> and are not part
        of any figure above. Team capital across them is capped at 30 USD.
      </p>
      <div className="mt-6 grid grid-cols-1 gap-3 md:grid-cols-2">
        <div className="rounded-2xl border border-border bg-card p-4">
          <p className="text-sm text-muted-foreground">Demo leader (Perpl account)</p>
          <p className="mt-1 font-mono text-sm">
            {leaderAddr ? <AddrLink a={leaderAddr} /> : "pending"}
            {leaderId && <span className="ml-2 text-muted-foreground">#{leaderId}</span>}
          </p>
        </div>
        <div className="rounded-2xl border border-border bg-card p-4">
          <p className="text-sm text-muted-foreground">Demo follower (MirrorAccount)</p>
          <p className="mt-1 font-mono text-sm">
            {followerAddr ? <AddrLink a={followerAddr} /> : "pending"}
            {followerBal !== null && <span className="ml-2 text-muted-foreground">{fmtAusd(followerBal)} AUSD</span>}
          </p>
        </div>
      </div>
      <div className="mt-6">
        <h3 className="text-sm font-semibold">Recent demo cycles</h3>
        {cycles.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">
            {configured && (demo || stats) ? "No demo cycles yet." : "Not live yet."}
          </p>
        ) : (
          <div className="mt-3 overflow-x-auto rounded-2xl border border-border bg-card" tabIndex={0} role="region" aria-label="Demo cycles">
            <table className="w-full min-w-[40rem] text-sm">
              <thead>
                <tr className="border-b border-border bg-muted text-left text-xs text-muted-foreground">
                  {["Time", "Kind", "Result", "Latency", "Transaction"].map((h) => (
                    <th key={h} scope="col" className="px-3 py-2.5 font-semibold">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {cycles.map((c, i) => {
                  const tx = str(pick(c, "copyTx", "copyTxHash", "txHash", "blockedTx"));
                  return (
                    <tr key={str(pick(c, "id")) ?? i} className="border-b border-border last:border-b-0">
                      <td className="whitespace-nowrap px-3 py-2.5 font-mono text-xs text-muted-foreground">
                        {fmtTime(toSeconds(pick(c, "startedAt", "timestamp", "at")))}
                      </td>
                      <td className="px-3 py-2.5">{str(pick(c, "kind", "type")) ?? "—"}</td>
                      <td className="px-3 py-2.5">{str(pick(c, "status", "result", "blockedReason")) ?? "—"}</td>
                      <td className="px-3 py-2.5 font-mono">{fmtLatency(num(pick(c, "latencyMs")))}</td>
                      <td className="px-3 py-2.5 font-mono text-xs">
                        {tx ? (
                          <a href={`${EXPLORER_TX}${tx}`} target="_blank" rel="noopener noreferrer" className="text-brand hover:underline">
                            {shortHex(tx, 8, 6)} ↗
                          </a>
                        ) : (
                          "—"
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
};
