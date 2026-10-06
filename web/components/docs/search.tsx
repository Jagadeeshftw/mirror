"use client";
/**
 * Client-side full-text search over the docs. The index (/docs/search.json) is generated at build
 * time from the same Markdown the pages render, and loaded on first open. No motion.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import MiniSearch, { type SearchResult } from "minisearch";
import type { SearchSection } from "@/lib/docs";
import { cn } from "@/lib/utils";

let indexPromise: Promise<MiniSearch<SearchSection>> | null = null;
function loadIndex() {
  indexPromise ??= fetch("/docs/search.json")
    .then((r) => r.json() as Promise<SearchSection[]>)
    .then((docs) => {
      const ms = new MiniSearch<SearchSection>({
        fields: ["heading", "text", "page"],
        storeFields: ["href", "page", "heading", "text"],
        searchOptions: { boost: { heading: 3, page: 1.5 }, prefix: true, fuzzy: 0.2, combineWith: "AND" },
      });
      ms.addAll(docs);
      return ms;
    })
    .catch((e) => {
      indexPromise = null;
      throw e;
    });
  return indexPromise;
}

function snippet(text: string, terms: string[]) {
  const lower = text.toLowerCase();
  let at = -1;
  for (const t of terms) {
    at = lower.indexOf(t.toLowerCase());
    if (at >= 0) break;
  }
  const start = Math.max(0, at - 60);
  const s = (start > 0 ? "…" : "") + text.slice(start, start + 180) + (text.length > start + 180 ? "…" : "");
  if (!terms.length) return s;
  const re = new RegExp(`(${terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "gi");
  return s.split(re).map((part, i) =>
    i % 2 === 1 ? (
      <mark key={i} className="rounded-sm bg-brand-soft px-0.5 text-brand">
        {part}
      </mark>
    ) : (
      <React.Fragment key={i}>{part}</React.Fragment>
    )
  );
}

export const DocsSearch = () => {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [ms, setMs] = useState<MiniSearch<SearchSection> | null>(null);
  const [error, setError] = useState(false);
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  const openSearch = useCallback(() => {
    setOpen(true);
    loadIndex().then(setMs, () => setError(true));
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = /input|textarea|select/i.test((e.target as HTMLElement)?.tagName ?? "");
      if ((e.key === "k" && (e.metaKey || e.ctrlKey)) || (e.key === "/" && !typing)) {
        e.preventDefault();
        openSearch();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openSearch]);

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  const results: SearchResult[] = useMemo(() => {
    if (!ms || q.trim().length < 2) return [];
    let r = ms.search(q.trim());
    if (!r.length) r = ms.search(q.trim(), { combineWith: "OR" });
    return r.slice(0, 12);
  }, [ms, q]);

  useEffect(() => setSel(0), [q]);

  const go = (href: string) => {
    setOpen(false);
    setQ("");
    router.push(href);
  };

  return (
    <>
      <button
        type="button"
        onClick={openSearch}
        aria-label="Search docs"
        className="flex h-9 w-9 items-center gap-2 rounded-full border border-border bg-card text-sm text-muted-foreground hover:text-foreground md:w-full md:px-3"
      >
        <svg viewBox="0 0 24 24" className="mx-auto size-4 shrink-0 md:mx-0" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" strokeLinecap="round" />
        </svg>
        <span className="hidden md:inline">Search docs</span>
        <kbd className="ml-auto hidden rounded-md border border-border bg-muted px-1.5 font-mono text-[10px] md:inline">⌘K</kbd>
      </button>

      {open && (
        <div className="fixed inset-0 z-[60]" role="dialog" aria-modal="true" aria-label="Search docs">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <div className="relative mx-auto mt-[10vh] w-[min(40rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-border bg-card shadow-float">
            <div className="flex items-center gap-3 border-b border-border px-4">
              <svg viewBox="0 0 24 24" className="size-4 shrink-0 text-muted-foreground" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                <circle cx="11" cy="11" r="7" />
                <path d="m20 20-3.5-3.5" strokeLinecap="round" />
              </svg>
              <input
                ref={inputRef}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") setOpen(false);
                  else if (e.key === "ArrowDown") {
                    e.preventDefault();
                    setSel((s) => Math.min(s + 1, results.length - 1));
                  } else if (e.key === "ArrowUp") {
                    e.preventDefault();
                    setSel((s) => Math.max(s - 1, 0));
                  } else if (e.key === "Enter" && results[sel]) go(results[sel].href as string);
                }}
                placeholder="Search the docs, e.g. keeper, slippage, EIP-712"
                aria-label="Search query"
                aria-controls="docs-search-results"
                aria-activedescendant={results[sel] ? `sr-${sel}` : undefined}
                className="h-12 w-full bg-transparent text-[15px] text-foreground outline-none placeholder:text-muted-foreground"
              />
              <kbd className="rounded-md border border-border bg-muted px-1.5 font-mono text-[10px] text-muted-foreground">Esc</kbd>
            </div>
            <ul id="docs-search-results" role="listbox" className="max-h-[60vh] overflow-y-auto p-2">
              {error && <li className="px-3 py-6 text-center text-sm text-muted-foreground">Search index failed to load.</li>}
              {!error && !ms && <li className="px-3 py-6 text-center text-sm text-muted-foreground">Loading…</li>}
              {ms && q.trim().length < 2 && (
                <li className="px-3 py-6 text-center text-sm text-muted-foreground">Type at least two characters.</li>
              )}
              {ms && q.trim().length >= 2 && results.length === 0 && (
                <li className="px-3 py-6 text-center text-sm text-muted-foreground">No results for “{q}”.</li>
              )}
              {results.map((r, i) => (
                <li key={r.id} id={`sr-${i}`} role="option" aria-selected={i === sel}>
                  <a
                    href={r.href as string}
                    onClick={(e) => {
                      e.preventDefault();
                      go(r.href as string);
                    }}
                    onMouseEnter={() => setSel(i)}
                    className={cn("block rounded-xl px-3 py-2.5", i === sel ? "bg-muted" : "")}
                  >
                    <p className="text-xs text-muted-foreground">{r.page as string}</p>
                    <p className="text-sm font-medium text-foreground">{r.heading as string}</p>
                    <p className="mt-0.5 line-clamp-2 text-[13px] leading-snug text-muted-foreground">
                      {snippet(r.text as string, r.terms)}
                    </p>
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </>
  );
};
