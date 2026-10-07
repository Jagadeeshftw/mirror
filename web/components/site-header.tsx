import Link from "next/link";
import React from "react";
import { IconBrandAndroid, IconMenu2, IconWorld } from "@tabler/icons-react";
import { Logo } from "./logo";
import { ModeToggle } from "./mode-toggle";
import { DOCS_URL, DOWNLOAD_URL, PERPL_URL, STATS_URL, WEB_APP_URL } from "@/lib/site";
import { cn } from "@/lib/utils";

const LINKS = [
  { title: "Product", href: "/" },
  { title: "Docs", href: DOCS_URL },
  { title: "Stats", href: STATS_URL },
  { title: "Perpl analytics", href: PERPL_URL },
  { title: "Download", href: DOWNLOAD_URL },
];

/**
 * Static header for docs, stats and download. No motion: no transitions, no animated menus.
 * `center` renders between the logo and the links (docs search). `active` highlights a link.
 */
export const SiteHeader = ({
  active,
  center,
  leading,
  wide = false,
  mobileMenu = true,
}: {
  active?: string;
  center?: React.ReactNode;
  leading?: React.ReactNode;
  wide?: boolean;
  /** Docs put the site links in their own drawer, so they hide this menu. */
  mobileMenu?: boolean;
}) => {
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/95 supports-[backdrop-filter]:bg-background/85 supports-[backdrop-filter]:backdrop-blur">
      <div
        className={cn(
          "mx-auto flex h-14 items-center gap-3 px-4 md:px-6",
          wide ? "max-w-[90rem]" : "max-w-7xl md:px-8"
        )}
      >
        {leading}
        <Logo />
        {center && <div className="mx-2 hidden min-w-0 flex-1 md:block md:max-w-md lg:ml-8">{center}</div>}
        <nav aria-label="Site" className="ml-auto hidden items-center gap-6 md:flex">
          {LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              aria-current={active === l.href ? "page" : undefined}
              className={cn(
                "text-sm font-medium hover:text-foreground",
                active === l.href ? "text-foreground" : "text-muted-foreground"
              )}
            >
              {l.title}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2 md:ml-4">
          {center && <div className="md:hidden">{center}</div>}
          <ModeToggle still />
          <a
            href={WEB_APP_URL}
            className="hidden h-9 items-center gap-2 rounded-full border border-border bg-card px-4 text-sm font-medium text-foreground hover:bg-muted lg:inline-flex"
          >
            <IconWorld className="size-4" aria-hidden /> Open web app
          </a>
          <Link
            href={DOWNLOAD_URL}
            className="hidden h-9 items-center gap-2 rounded-full bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 lg:inline-flex"
          >
            <IconBrandAndroid className="size-4" aria-hidden /> Get the app
          </Link>
          <details className={cn("group relative md:hidden", !mobileMenu && "hidden")}>
            <summary
              aria-label="Open site menu"
              className="flex size-9 cursor-pointer list-none items-center justify-center rounded-full border border-border bg-card [&::-webkit-details-marker]:hidden"
            >
              <IconMenu2 className="size-4" aria-hidden />
            </summary>
            <div className="absolute right-0 top-11 z-50 w-48 rounded-2xl border border-border bg-card p-2 shadow-float">
              {LINKS.map((l) => (
                <Link
                  key={l.href}
                  href={l.href}
                  className={cn(
                    "block rounded-xl px-3 py-2 text-sm hover:bg-muted",
                    active === l.href ? "font-medium text-foreground" : "text-muted-foreground"
                  )}
                >
                  {l.title}
                </Link>
              ))}
              <a href={WEB_APP_URL} className="block rounded-xl px-3 py-2 text-sm font-medium text-brand hover:bg-muted">
                Open web app
              </a>
            </div>
          </details>
        </div>
      </div>
    </header>
  );
};
