"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import React from "react";
import { DOC_GROUPS, docHref } from "@/lib/docs-nav";
import { cn } from "@/lib/utils";

export const DocsNav = ({ onNavigate }: { onNavigate?: () => void }) => {
  const pathname = (usePathname() ?? "/docs").replace(/\/$/, "") || "/docs";
  return (
    <nav aria-label="Docs" className="flex flex-col gap-6 text-sm">
      {DOC_GROUPS.map((g) => (
        <div key={g.title}>
          <p className="mb-2 px-3 font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
            {g.title}
          </p>
          <ul className="flex flex-col gap-0.5">
            {g.items.map((item) => {
              const href = docHref(item.slug);
              const active = pathname === href;
              return (
                <li key={href}>
                  <Link
                    href={href}
                    onClick={onNavigate}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "block rounded-lg px-3 py-1.5",
                      active
                        ? "bg-brand-soft font-medium text-brand"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground"
                    )}
                  >
                    {item.title}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
};

/** Mobile drawer. No motion: it appears and disappears without transitions. */
export const DocsDrawer = () => {
  const [open, setOpen] = React.useState(false);
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open]);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open docs navigation"
        aria-expanded={open}
        className="-ml-1 flex size-9 items-center justify-center rounded-full text-foreground hover:bg-muted lg:hidden"
      >
        <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
          <path d="M4 7h16M4 12h16M4 17h10" strokeLinecap="round" />
        </svg>
      </button>
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Docs navigation">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0 flex w-[min(20rem,85vw)] flex-col border-r border-border bg-background">
            <div className="flex h-14 items-center justify-between border-b border-border px-4">
              <span className="text-sm font-semibold">Documentation</span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close docs navigation"
                className="flex size-9 items-center justify-center rounded-full hover:bg-muted"
              >
                <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
                  <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
                </svg>
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-3">
              <DocsNav onNavigate={() => setOpen(false)} />
              <div className="mt-6 border-t border-border pt-4">
                <p className="mb-2 px-3 font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground">Site</p>
                {[
                  { href: "/", title: "Product" },
                  { href: "/stats", title: "Public stats" },
                  { href: "/download", title: "Download" },
                ].map((l) => (
                  <Link
                    key={l.href}
                    href={l.href}
                    onClick={() => setOpen(false)}
                    className="block rounded-lg px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
                  >
                    {l.title}
                  </Link>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
