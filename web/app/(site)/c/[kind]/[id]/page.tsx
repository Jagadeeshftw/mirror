/**
 * Share landing page for one card: OG/Twitter meta tags pointing at the card image, the card itself (light and
 * dark), every transaction behind it on MonadVision, and the way into the app.
 */
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { IconExternalLink } from "@tabler/icons-react";
import { SiteHeader } from "@/components/site-header";
import { loadCard } from "@/lib/cards/load";
import { formatOf, imagePath, isKind, landingPath, SIZES, type CardRequest } from "@/lib/cards/types";
import { DOWNLOAD_URL } from "@/lib/site";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ kind: string; id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

async function request({ params, searchParams }: Props): Promise<CardRequest> {
  const { kind, id } = await params;
  if (!isKind(kind)) notFound();
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(await searchParams)) if (typeof v === "string") search.set(k, v);
  return { kind, id: decodeURIComponent(id), search };
}

export async function generateMetadata(props: Props): Promise<Metadata> {
  const req = await request(props);
  const m = await loadCard(req);
  const { width, height } = SIZES[formatOf(req)];
  const image = { url: imagePath(req, "light"), width, height, alt: m.description };
  return {
    title: m.title,
    description: m.description,
    robots: { index: false, follow: true },
    alternates: { canonical: landingPath(req) },
    openGraph: { type: "website", url: landingPath(req), title: m.title, description: m.description, images: [image] },
    twitter: { card: "summary_large_image", title: m.title, description: m.description, images: [image] },
  };
}

export default async function CardPage(props: Props) {
  const req = await request(props);
  const m = await loadCard(req);
  const { width, height } = SIZES[formatOf(req)];
  return (
    <>
      <SiteHeader />
      <main id="content" className="flex-1">
        <div className="mx-auto max-w-5xl px-4 py-10 md:px-8 md:py-14">
          <p className="mb-3 font-mono text-xs uppercase tracking-[0.12em] text-brand">Shared from Mirror</p>
          <h1 className="text-2xl font-semibold tracking-[-0.02em] md:text-4xl" data-testid="card.title">
            {m.title}
          </h1>
          <div className="mt-3 flex flex-wrap gap-2">
            {m.teamRun ? <span className="rounded-full bg-warning/15 px-3 py-1 text-sm font-medium text-warning">{m.teamRun}</span> : null}
            {m.simulation ? <span className="rounded-full border border-dashed border-warning px-3 py-1 text-sm font-medium text-warning">Simulation, not a record of real copies</span> : null}
            {!m.ok ? <span className="rounded-full bg-muted px-3 py-1 text-sm text-muted-foreground">Not available right now</span> : null}
          </div>

          <div className="mt-8 grid grid-cols-1 gap-10 md:grid-cols-[1.5fr_1fr] md:items-start">
            <picture className="block overflow-hidden rounded-2xl border border-border">
              <source media="(prefers-color-scheme: dark)" srcSet={imagePath(req, "dark")} />
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={imagePath(req, "light")} width={width} height={height} alt={m.description} className="h-auto w-full" data-testid="card.image" />
            </picture>

            <section aria-labelledby="proof-h">
              <h2 id="proof-h" className="text-lg font-semibold tracking-tight">
                Onchain proof
              </h2>
              {m.links.length ? (
                <ul className="mt-4 divide-y divide-border rounded-2xl border border-border bg-card" data-testid="card.links">
                  {m.links.map((l) => (
                    <li key={l.href}>
                      <a href={l.href} target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 px-4 py-3 text-sm hover:bg-muted/50">
                        <span className="min-w-0 flex-1">
                          <span className="block font-medium">{l.label}</span>
                          <span className="block truncate font-mono text-xs text-muted-foreground">
                            {l.hash ? `${l.hash.slice(0, 10)}…${l.hash.slice(-6)}` : l.href.replace(/^https?:\/\//, "")}
                            {l.note ? ` · ${l.note}` : ""}
                          </span>
                        </span>
                        <IconExternalLink className="size-4 shrink-0 text-brand" aria-hidden />
                      </a>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-3 text-sm text-muted-foreground">{m.ok ? "No transactions yet." : m.message}</p>
              )}
              <p className="mt-3 text-xs text-muted-foreground">Links open MonadVision, Monad&apos;s block explorer.</p>
              <ul className="mt-4 space-y-1 text-xs text-muted-foreground">
                {m.fine.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
              <div className="mt-6 flex flex-wrap gap-3">
                <a href={m.app.href} className="rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground" data-testid="card.app">
                  {m.app.label}
                </a>
                <Link href={DOWNLOAD_URL} className="rounded-full border border-border px-5 py-2.5 text-sm font-semibold">
                  Get the Android app
                </Link>
              </div>
            </section>
          </div>
        </div>
      </main>
    </>
  );
}
