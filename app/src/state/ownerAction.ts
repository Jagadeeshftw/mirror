// Runs signed owner actions (one passkey prompt for any number of accounts) with UI state.
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { detachWith, executeActions, type OwnerAction } from "../lib/actions";
import { ApiError } from "../lib/api";
import { rearmPolicy } from "../lib/budgets";
import { ACTION, encodeCloseAll, encodePaused, encodeSetPolicy, validatePolicy } from "../lib/contracts";
import { closeMarketAction, resumeMarketsAction, setLevelsAction, stopPlan, type StopChoice } from "../lib/levels";
import type { Level, MirrorAccount, Policy, RelayResult } from "../lib/types";
import { describeError } from "../lib/wallet";
import { useConfig } from "./data";

export function useOwnerAction() {
  const qc = useQueryClient();
  const cfg = useConfig().data;
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [last, setLast] = useState<RelayResult[] | null>(null);

  const fail = (msg: string) => {
    setError(msg);
    return null;
  };
  const run = async (label: string, actions: OwnerAction[]) => {
    if (!cfg || actions.length === 0) return null;
    setBusy(label);
    setError(null);
    try {
      const r = await executeActions(cfg, actions, () => {});
      setLast(r);
      const bad = r.find((x) => x.status !== "success");
      if (bad || r.length < actions.length) setError(`Transaction reverted${bad?.txHash ? ` (${bad.txHash.slice(0, 10)}…)` : ""}`);
      await qc.invalidateQueries({ queryKey: ["owner"] });
      await qc.invalidateQueries({ queryKey: ["feed"] });
      return bad || r.length < actions.length ? null : r;
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

  /** Detach / re-attach (engine) plus owner actions, one passkey prompt. */
  const runDetach = async (label: string, account: MirrorAccount, detached: boolean, actions: { kind: number; data: `0x${string}` }[]) => {
    if (!cfg) return null;
    setBusy(label);
    setError(null);
    try {
      const r = await detachWith(cfg, account, detached, actions);
      setLast(r.results);
      const bad = r.results.find((x) => x.status !== "success");
      if (bad || r.results.length < actions.length) setError(`Transaction reverted${bad?.txHash ? ` (${bad.txHash.slice(0, 10)}…)` : ""}`);
      await qc.invalidateQueries({ queryKey: ["owner"] });
      await qc.invalidateQueries({ queryKey: ["feed"] });
      return bad || r.results.length < actions.length ? null : r;
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
    /** ACTION_SET_LEVELS: one level (or a clear) on one account, one passkey prompt. */
    setLevels: (account: MirrorAccount, levels: Level[]) => run("levels", [{ account, ...setLevelsAction(levels) }]),
    /** ACTION_CLOSE_MARKET: close one position at market (reduce-only IOC within the slippage of mark). */
    closeMarket: (account: MirrorAccount, perpId: number) => run("closeMarket", [{ account, ...closeMarketAction(perpId) }]),
    /** Saves the same limits again, which lifts the halt a fired level put on its market. */
    resumeMarkets: (account: MirrorAccount) => {
      const a = resumeMarketsAction(account);
      return "error" in a ? Promise.resolve(fail(a.error)) : run("resume", [{ account, ...a }]);
    },
    /** Edit budgets (several leaders, one account): ACTION_SET_POLICY with every leader, one passkey prompt. */
    saveBudgets: (account: MirrorAccount, policy: Policy) => {
      const bad = validatePolicy(policy);
      if (bad) return Promise.resolve(fail(bad === "expiry" ? "This follow has expired. Edit limits to set a new end date." : `Invalid limits (${bad})`));
      return run("budgets", [{ account, kind: ACTION.SET_POLICY, data: encodeSetPolicy(policy) }]);
    },
    /** Re-arm a leader its loss stop stopped: the same limits signed again (optionally a new loss stop), one prompt. */
    rearm: (account: MirrorAccount, leaderId: number, lossStopBps?: number) => {
      const p = rearmPolicy(account, leaderId, lossStopBps);
      if (!p) return Promise.resolve(fail("No limits on this account yet"));
      if (Number(p.expiry) <= Math.floor(Date.now() / 1000)) return Promise.resolve(fail("This follow has expired. Edit limits to set a new end date."));
      return run("rearm", [{ account, kind: ACTION.SET_POLICY, data: encodeSetPolicy(p) }]);
    },
    /** Undo "keep my positions": signed detached=false plus unpause, one prompt. */
    followAgain: (account: MirrorAccount) => runDetach("followAgain", account, false, account.paused ? [{ kind: ACTION.SET_PAUSED, data: encodePaused(false) }] : []),
    /** "Stop following, keep my positions" / "Stop and close" for one leader (one passkey prompt). */
    stopFollowing: (account: MirrorAccount, leaderId: number, choice: StopChoice) => {
      const plan = stopPlan(account, leaderId, choice);
      if (plan.error) return Promise.resolve(fail(plan.error));
      if (plan.how === "detach") return runDetach("stopKeep", account, true, plan.actions);
      return run(choice === "keep" ? "stopKeep" : "stopClose", plan.actions.map((x) => ({ account, ...x })));
    },
  };
}
