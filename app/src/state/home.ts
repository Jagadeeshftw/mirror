// Which Home to show, shared by the phone and laptop compositions.
import { useState } from "react";
import { useBackendPhase, useRpcHealth } from "./conn";
import { useConfig, useTotals, useWallet } from "./data";

export function useHomeState() {
  const cfg = useConfig().data;
  const { totals } = useTotals();
  const wallet = useWallet();
  const { phase, waitedMs, retry } = useBackendPhase();
  const rpc = useRpcHealth();
  const [watchAnyway, setWatchAnyway] = useState(false);
  const walletCNS = totals ? totals.wallet : wallet.source === "rpc" ? wallet.cns : null;
  const mode: "skeleton" | "slow" | "watch" | "watchDown" | "funded" = totals
    ? totals.accounts.length
      ? "funded"
      : phase === "down"
        ? "watchDown"
        : "watch"
    : phase === "connecting"
      ? "skeleton"
      : phase === "slow"
        ? watchAnyway
          ? "watch"
          : "slow"
        : "watchDown";
  return { cfg, totals, walletCNS, phase, waitedMs, retry, rpc, mode, watch: () => setWatchAnyway(true) };
}
