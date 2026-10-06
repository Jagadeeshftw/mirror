import React from "react";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { DocsDrawer, DocsNav } from "@/components/docs/sidebar";
import { DocsSearch } from "@/components/docs/search";
import { DOCS_URL } from "@/lib/site";

/** GitBook-style shell: top bar with search, left sidebar, centered content, right TOC. No motion. */
export default function DocsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <SiteHeader active={DOCS_URL} center={<DocsSearch />} leading={<DocsDrawer />} wide mobileMenu={false} />
      <div className="mx-auto grid max-w-[90rem] grid-cols-1 lg:grid-cols-[17rem_minmax(0,1fr)]">
        <aside className="sticky top-14 hidden h-[calc(100dvh-3.5rem)] overflow-y-auto border-r border-border px-4 py-8 lg:block">
          <DocsNav />
        </aside>
        <div id="content" className="min-w-0">
          {children}
        </div>
      </div>
      <SiteFooter />
    </div>
  );
}
