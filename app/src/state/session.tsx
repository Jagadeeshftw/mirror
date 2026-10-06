import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { loadApiBaseOverride } from "../lib/api";
import { loadAccount, signOutDevice, type StoredAccount } from "../lib/wallet";

interface SessionCtx {
  ready: boolean;
  account: StoredAccount | null;
  setAccount: (a: StoredAccount | null) => void;
  signOut: () => Promise<void>;
}
const Ctx = createContext<SessionCtx>({ ready: false, account: null, setAccount: () => {}, signOut: async () => {} });

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [account, setAccount] = useState<StoredAccount | null>(null);
  useEffect(() => {
    (async () => {
      await loadApiBaseOverride();
      try {
        setAccount(await loadAccount());
      } catch {
        setAccount(null);
      }
      setReady(true);
    })();
  }, []);
  const signOut = useCallback(async () => {
    await signOutDevice();
    setAccount(null);
  }, []);
  const value = useMemo(() => ({ ready, account, setAccount, signOut }), [ready, account, signOut]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession() {
  return useContext(Ctx);
}
