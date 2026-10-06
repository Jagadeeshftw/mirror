import Link from "next/link";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <SiteHeader />
      <main id="content" className="mx-auto flex w-full max-w-3xl flex-1 flex-col items-start justify-center px-4 py-24">
        <p className="font-mono text-sm text-brand">404</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">This page does not exist.</h1>
        <p className="mt-3 text-muted-foreground">It may have moved. Try the docs or the home page.</p>
        <div className="mt-6 flex gap-3">
          <Link href="/" className="rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">Home</Link>
          <Link href="/docs" className="rounded-full border border-border bg-card px-4 py-2 text-sm font-medium">Docs</Link>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
