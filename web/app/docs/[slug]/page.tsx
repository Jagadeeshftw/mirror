import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getDoc } from "@/lib/docs";
import { DOC_ORDER } from "@/lib/docs-nav";
import { DocPage } from "@/components/docs/doc-page";

export const dynamicParams = false;

export function generateStaticParams() {
  return DOC_ORDER.filter((d) => d.slug).map((d) => ({ slug: d.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const doc = getDoc(slug);
  if (!doc) return {};
  return {
    title: doc.title,
    description: doc.description,
    alternates: { canonical: `/docs/${slug}` },
    openGraph: { title: doc.title, description: doc.description },
  };
}

export default async function DocsSlug({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const doc = getDoc(slug);
  if (!doc) notFound();
  return <DocPage doc={doc} />;
}
