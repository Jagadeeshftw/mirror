import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getDoc } from "@/lib/docs";
import { DocPage } from "@/components/docs/doc-page";

export const metadata: Metadata = {
  title: "Docs",
  description: "How Mirror works: copying, the safety model, the policy, contracts and API.",
  alternates: { canonical: "/docs" },
};

export default function DocsIndex() {
  const doc = getDoc("");
  if (!doc) notFound();
  return <DocPage doc={doc} />;
}
