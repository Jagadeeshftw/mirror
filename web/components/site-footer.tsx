import Link from "next/link";
import React from "react";
import { BETA_DEPOSIT_CAP, BRAND, CONTRACTS_URL, DOCS_URL, DOWNLOAD_URL, GITHUB_URL, PERPL_URL, STATS_URL, X_HANDLE, X_URL } from "@/lib/site";

/** Compact static footer for docs, stats and download. */
export const SiteFooter = () => (
  <footer className="border-t border-border">
    <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-8 text-sm text-muted-foreground md:flex-row md:items-start md:justify-between md:px-8">
      <p className="max-w-2xl text-xs leading-relaxed">
        {BRAND} is beta software. The contracts are unaudited and deposits are capped at {BETA_DEPOSIT_CAP} per
        account. Perpetual futures are leveraged and risky; copying a trader does not guarantee their results.
        Nothing here is financial advice.
      </p>
      <nav aria-label="Footer" className="flex flex-wrap gap-x-5 gap-y-2">
        <Link href="/" className="hover:text-foreground">Home</Link>
        <Link href={DOCS_URL} className="hover:text-foreground">Docs</Link>
        <Link href={CONTRACTS_URL} className="hover:text-foreground">Contracts</Link>
        <Link href={STATS_URL} className="hover:text-foreground">Stats</Link>
        <Link href={PERPL_URL} className="hover:text-foreground">Perpl analytics</Link>
        <Link href={DOWNLOAD_URL} className="hover:text-foreground">Download</Link>
        <a href={GITHUB_URL} className="hover:text-foreground">GitHub</a>
        <a href={X_URL} className="hover:text-foreground">X {X_HANDLE}</a>
      </nav>
    </div>
  </footer>
);
