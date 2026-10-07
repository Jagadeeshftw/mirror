import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "@/components/site-header";
import { BRAND, DOWNLOAD_URL, STATS_URL } from "@/lib/site";

export const metadata: Metadata = {
  title: "Web app",
  description: `The ${BRAND} web app is not published yet.`,
  robots: { index: false, follow: true },
};

/** Served at /app (and deep links under it) only while public/app has no exported web app. */
export default function WebAppPending() {
  return (
    <>
      <SiteHeader />
      <main id="content" className="flex-1">
        <div className="mx-auto max-w-2xl px-4 py-16 md:px-8 md:py-24">
          <p className="mb-3 font-mono text-xs uppercase tracking-[0.12em] text-brand">Web app</p>
          <h1 className="text-3xl font-semibold tracking-[-0.03em] md:text-4xl">Not published yet</h1>
          <p className="mt-4 text-base leading-relaxed text-muted-foreground">
            The {BRAND} web app will open here, at this address, once its first build is published. Until then you can
            follow the public numbers on the stats page or get the Android app.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Link href={STATS_URL} className="inline-flex h-11 items-center justify-center rounded-full border border-border bg-card px-5 text-sm font-medium hover:bg-muted">
              Public stats
            </Link>
            <Link href={DOWNLOAD_URL} className="inline-flex h-11 items-center justify-center rounded-full bg-primary px-5 text-sm font-medium text-primary-foreground hover:bg-primary/90">
              Android app
            </Link>
          </div>
        </div>
      </main>
    </>
  );
}
