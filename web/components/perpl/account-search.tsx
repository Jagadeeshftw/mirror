"use client";
import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { IconSearch } from "@tabler/icons-react";

/** Any Perpl account: a numeric id or a 0x address. Plain form, no motion. */
export const AccountSearch = ({ initial = "", className = "" }: { initial?: string; className?: string }) => {
  const router = useRouter();
  const [q, setQ] = useState(initial);
  const [err, setErr] = useState<string | null>(null);
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const v = q.trim().replace(/^#/, "");
    if (!/^\d{1,9}$/.test(v) && !/^0x[0-9a-fA-F]{40}$/.test(v)) {
      setErr("Enter a Perpl account id (e.g. 2291) or a 0x address.");
      return;
    }
    setErr(null);
    router.push(`/perpl/wallet/${v}`);
  };
  return (
    <form onSubmit={submit} role="search" className={className}>
      <label htmlFor="perpl-account" className="sr-only">
        Perpl account id or address
      </label>
      <div className="flex h-11 items-center gap-2 rounded-xl border border-border bg-card px-3 focus-within:ring-2 focus-within:ring-ring">
        <IconSearch className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <input
          id="perpl-account"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Any Perpl account: id or 0x address"
          autoComplete="off"
          spellCheck={false}
          className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        />
        <button type="submit" className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90">
          Open
        </button>
      </div>
      {err && (
        <p role="alert" className="mt-1.5 text-xs text-negative">
          {err}
        </p>
      )}
    </form>
  );
};
