// Runs signed owner actions (one passkey prompt for any number of accounts) with UI state.
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { executeActions, type OwnerAction } from "../lib/actions";
import { ApiError } from "../lib/api";
import { ACTION, encodeCloseAll, encodePaused } from "../lib/contracts";
import type { MirrorAccount, RelayResult } from "../lib/types";
import { describeError } from "../lib/wallet";
import { useConfig } from "./data";

export function useOwnerAction() {
  const qc = useQueryClient();
  const cfg = useConfig().data;
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [last, setLast] = useState<RelayResult[] | null>(null);

  const run = async (label: string, actions: OwnerAction[]) => {
    if (!cfg || actions.length === 0) return null;
    setBusy(label);
    setError(null);
    try {
      const r = await executeActions(cfg, actions, () => {});
      setLast(r);
      await qc.invalidateQueries({ queryKey: ["owner"] });
      await qc.invalidateQueries({ queryKey: ["feed"] });
      return r;
    } catch (e) {
      if (e instanceof ApiError) setError(`${e.message}${e.revertReason ? ` (${e.revertReason})` : ""}`);
      else {
        const d = describeError(e);
        if (!d.cancelled) setError(d.detail || d.title);
      }
      return null;
    } finally {
      setBusy(null);
    }
  };

  return {
    busy,
    error,
    last,
    clearError: () => setError(null),
    setPaused: (accounts: MirrorAccount[], paused: boolean) =>
      run(paused ? "pause" : "resume", accounts.map((a) => ({ account: a, kind: ACTION.SET_PAUSED, data: encodePaused(paused) }))),
    closeAll: (accounts: MirrorAccount[], slippageBps = 100) =>
      run("closeAll", accounts.filter((a) => a.positions.length > 0).map((a) => ({ account: a, kind: ACTION.CLOSE_ALL, data: encodeCloseAll(slippageBps) }))),
  };
}
