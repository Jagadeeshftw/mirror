// Shared links and suggestions for the owner's accounts (sealed owner list, opened on this device), plus the owner
// actions on them with UI state. The account's live stream sends a content-free "share" event on every change.
import { useQueries, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { ApiError } from "../lib/api";
import { createShareLink, declineSuggestion, fetchShareList, revokeShareLink } from "../lib/shareActions";
import type { ShareList, Suggestion } from "../lib/shareLink";
import type { Address, Hex, MirrorAccount } from "../lib/types";
import { describeError } from "../lib/wallet";
import { useConfig, useOwner } from "./data";
import { useSession } from "./session";

export function useShareLists() {
  const { account } = useSession();
  const owner = account?.address as Address | undefined;
  const accts = (useOwner().data?.accounts ?? []).filter((a) => a.deployed !== false && !a.teamRun);
  const results = useQueries({
    queries: accts.map((a) => ({
      queryKey: ["share", a.account],
      queryFn: () => fetchShareList(owner!, a.account),
      enabled: !!owner,
      refetchInterval: 20_000,
      retry: 1,
    })),
  });
  const stamp = results.map((r) => r.dataUpdatedAt).join(",");
  return useMemo(() => {
    const byAccount = new Map<string, ShareList>();
    for (const r of results) if (r.data) byAccount.set(r.data.list.account.toLowerCase(), r.data.list);
    const pending: (Suggestion & { account: Address })[] = [];
    for (const l of byAccount.values()) for (const s of l.suggestions) if (s.status === "pending") pending.push({ ...s, account: l.account });
    pending.sort((a, b) => b.createdMs - a.createdMs);
    return { byAccount, pending, isLoading: results.some((r) => r.isLoading), error: results.find((r) => r.error)?.error ?? null };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stamp]);
}

export function useShareList(account: string | undefined) {
  const all = useShareLists();
  return account ? all.byAccount.get(account.toLowerCase()) : undefined;
}

const message = (e: unknown) => {
  if (e instanceof ApiError) return typeof (e.body as any)?.error === "string" ? (e.body as any).error : e.message;
  const d = describeError(e);
  return d.cancelled ? null : d.detail || d.title;
};

export function useShareActions() {
  const qc = useQueryClient();
  const cfg = useConfig().data;
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = async <T>(label: string, account: Address, fn: () => Promise<T>): Promise<T | null> => {
    if (!cfg) return null;
    setBusy(label);
    setError(null);
    try {
      const r = await fn();
      await qc.invalidateQueries({ queryKey: ["share", account] });
      return r;
    } catch (e) {
      setError(message(e));
      return null;
    } finally {
      setBusy(null);
    }
  };
  return {
    busy,
    error,
    clearError: () => setError(null),
    create: (a: MirrorAccount, perpId: number) => run("create", a.account, () => createShareLink(cfg!, a.account, perpId)),
    revoke: (a: MirrorAccount, linkId: Hex) => run("revoke", a.account, () => revokeShareLink(cfg!, a.account, linkId)),
    decline: (a: MirrorAccount, id: number) => run("decline", a.account, () => declineSuggestion(cfg!, a.account, id)),
    fail: setError,
  };
}
