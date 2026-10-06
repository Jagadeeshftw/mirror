"use client";
import React, { useEffect, useState } from "react";
import type { Heading } from "@/lib/docs";
import { cn } from "@/lib/utils";

/** "On this page": highlights the section in view. No motion. */
export const Toc = ({ headings }: { headings: Heading[] }) => {
  const [active, setActive] = useState<string | null>(headings[0]?.id ?? null);

  useEffect(() => {
    const els = headings.map((h) => document.getElementById(h.id)).filter(Boolean) as HTMLElement[];
    if (!els.length) return;
    const onScroll = () => {
      let current = els[0].id;
      for (const el of els) {
        if (el.getBoundingClientRect().top <= 96) current = el.id;
      }
      setActive(current);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [headings]);

  if (!headings.length) return null;
  return (
    <nav aria-label="On this page" className="text-sm">
      <p className="mb-3 font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground">On this page</p>
      <ul className="flex flex-col gap-1.5 border-l border-border">
        {headings.map((h) => (
          <li key={h.id}>
            <a
              href={`#${h.id}`}
              className={cn(
                "-ml-px block border-l py-0.5 leading-snug",
                h.depth === 3 ? "pl-6" : "pl-3",
                active === h.id
                  ? "border-brand font-medium text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              {h.text}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
};
