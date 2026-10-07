import type { MetadataRoute } from "next";
import { DOC_ORDER, docHref } from "@/lib/docs-nav";
import { SITE_URL } from "@/lib/site";

export const dynamic = "force-static";

export default function sitemap(): MetadataRoute.Sitemap {
  const paths = ["/", "/download", "/stats", "/perpl", ...DOC_ORDER.map((d) => docHref(d.slug))];
  return paths.map((p) => ({ url: `${SITE_URL}${p === "/" ? "" : p}`, changeFrequency: "weekly", priority: p === "/" ? 1 : 0.7 }));
}
