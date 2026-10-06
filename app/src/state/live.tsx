// Live feed over SSE (/v1/stream?account=...): prepends events, updates commit states,
// refreshes balances, and decrypts encrypted push payloads delivered in-app.
import { useQueryClient } from "@tanstack/react-query";
import React, { createContext, useContext, useEffect, useRef, useState } from "react";
import { getApiBase, streamUrl } from "../lib/api";
import { presentEncrypted } from "../lib/push";
import { openSse, type SseHandle } from "../lib/sse";
import type { CommitState, FeedEvent, FeedPage, PushEnvelope } from "../lib/types";
import { useOwner } from "./data";

interface LiveCtx {
  connected: boolean;
  lastEventAt: number;
}
const Ctx = createContext<LiveCtx>({ connected: false, lastEventAt: 0 });

export function applyFeedEvent(qc: ReturnType<typeof useQueryClient>, e: FeedEvent) {
  qc.setQueryData<FeedPage>(["feed", e.account], (old) => {
    const events = old?.events ?? [];
    if (events.some((x) => x.id === e.id)) return old;
    return { events: [e, ...events], cursor: old?.cursor ?? null };
  });
}

export function applyCommit(qc: ReturnType<typeof useQueryClient>, key: string, u: { id: string; commitState: CommitState }) {
  qc.setQueryData<FeedPage>(["feed", key], (old) =>
    old ? { ...old, events: old.events.map((x) => (x.id === u.id ? { ...x, commitState: u.commitState } : x)) } : old,
  );
}

export function LiveProvider({ children }: { children: React.ReactNode }) {
  const qc = useQueryClient();
  const owner = useOwner();
  const [connected, setConnected] = useState(false);
  const [lastEventAt, setLast] = useState(0);
  const accounts = (owner.data?.accounts ?? []).map((a) => a.account).sort().join(",");
  const refresh = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!accounts) return;
    const handles: SseHandle[] = [];
    const open = new Set<string>();
    for (const acct of accounts.split(",")) {
      handles.push(
        openSse(streamUrl(acct), {
          onOpen: () => {
            open.add(acct);
            setConnected(true);
          },
          onError: () => {
            open.delete(acct);
            setConnected(open.size > 0);
          },
          onMessage: (m) => {
            if (m.event === "feed") {
              const e = JSON.parse(m.data) as FeedEvent;
              applyFeedEvent(qc, e);
              setLast(Date.now());
              if (refresh.current) clearTimeout(refresh.current);
              refresh.current = setTimeout(() => qc.invalidateQueries({ queryKey: ["owner"] }), 600);
            } else if (m.event === "commit") {
              applyCommit(qc, acct, JSON.parse(m.data));
            } else if (m.event === "push") {
              void presentEncrypted(JSON.parse(m.data) as PushEnvelope);
            } else if (m.event === "hello") {
              setConnected(true);
            }
          },
        }),
      );
    }
    return () => handles.forEach((h) => h.close());
    // re-open when the account set or API base changes
  }, [accounts, qc, getApiBase()]);

  return <Ctx.Provider value={{ connected, lastEventAt }}>{children}</Ctx.Provider>;
}

export function useLive() {
  return useContext(Ctx);
}
