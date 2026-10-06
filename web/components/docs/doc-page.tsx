import Link from "next/link";
import React from "react";
import type { Doc } from "@/lib/docs";
import { DOC_GROUPS, DOC_ORDER, docHref } from "@/lib/docs-nav";
import { Toc } from "./toc";

export const DocPage = ({ doc }: { doc: Doc }) => {
  const i = DOC_ORDER.findIndex((d) => d.slug === doc.slug);
  const prev = i > 0 ? DOC_ORDER[i - 1] : null;
  const next = i < DOC_ORDER.length - 1 ? DOC_ORDER[i + 1] : null;
  const group = DOC_GROUPS.find((g) => g.items.some((it) => it.slug === doc.slug));

  return (
    <div className="xl:grid xl:grid-cols-[minmax(0,1fr)_15rem]">
      <article className="mx-auto w-full max-w-3xl px-4 py-10 md:px-10 md:py-14">
        {group && <p className="mb-3 font-mono text-xs uppercase tracking-[0.12em] text-brand">{group.title}</p>}
        <h1 className="text-3xl font-semibold tracking-[-0.03em] text-foreground md:text-[2.5rem] md:leading-tight">
          {doc.title}
        </h1>
        {doc.description && <p className="mt-3 text-lg leading-relaxed text-muted-foreground">{doc.description}</p>}
        {doc.headings.length > 0 && (
          <details className="mt-6 rounded-xl border border-border bg-card px-4 py-3 xl:hidden">
            <summary className="cursor-pointer text-sm font-medium text-foreground">On this page</summary>
            <ul className="mt-3 flex flex-col gap-1.5 text-sm">
              {doc.headings.map((h) => (
                <li key={h.id} className={h.depth === 3 ? "pl-4" : ""}>
                  <a href={`#${h.id}`} className="text-muted-foreground hover:text-foreground">
                    {h.text}
                  </a>
                </li>
              ))}
            </ul>
          </details>
        )}
        <div className="docs-prose mt-8" dangerouslySetInnerHTML={{ __html: doc.html }} />

        <nav aria-label="Pagination" className="mt-14 grid grid-cols-1 gap-3 border-t border-border pt-8 sm:grid-cols-2">
          {prev ? (
            <Link href={docHref(prev.slug)} className="rounded-2xl border border-border bg-card p-4 hover:border-brand/40">
              <p className="text-xs text-muted-foreground">Previous</p>
              <p className="mt-1 font-medium text-foreground">← {prev.title}</p>
            </Link>
          ) : (
            <span />
          )}
          {next && (
            <Link
              href={docHref(next.slug)}
              className="rounded-2xl border border-border bg-card p-4 text-right hover:border-brand/40"
            >
              <p className="text-xs text-muted-foreground">Next</p>
              <p className="mt-1 font-medium text-foreground">{next.title} →</p>
            </Link>
          )}
        </nav>
      </article>
      <aside className="hidden xl:block">
        <div className="sticky top-14 max-h-[calc(100dvh-3.5rem)] overflow-y-auto py-14 pr-6">
          <Toc headings={doc.headings} />
        </div>
      </aside>
    </div>
  );
};
