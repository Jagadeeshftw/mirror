import "server-only";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkRehype from "remark-rehype";
import rehypeSlug from "rehype-slug";
import rehypeAutolinkHeadings from "rehype-autolink-headings";
import rehypeStringify from "rehype-stringify";
import { visit } from "unist-util-visit";
import { toString as hastToString } from "hast-util-to-string";
import type { Element, Root, RootContent } from "hast";
import { CONTRACTS, EXPLORER_ADDRESS } from "./site";
import { DOC_ORDER } from "./docs-nav";

export type Heading = { id: string; text: string; depth: 2 | 3 };
export type SearchSection = { id: string; href: string; page: string; heading: string; text: string };
export type Doc = {
  slug: string;
  title: string;
  description: string;
  html: string;
  headings: Heading[];
  sections: SearchSection[];
};

const DIR = join(process.cwd(), "content", "docs");

function addressesTable(): string {
  const rows = CONTRACTS.map(
    (c) =>
      `| ${c.name} | ${c.address ? `[\`${c.address}\`](${EXPLORER_ADDRESS}${c.address})` : "pending (not deployed yet)"} | ${c.note} |`
  );
  return ["| Contract | Address | Notes |", "|---|---|---|", ...rows].join("\n");
}

function parseFrontmatter(src: string) {
  const m = src.match(/^---\n([\s\S]*?)\n---\n/);
  const meta: Record<string, string> = {};
  if (m) {
    for (const line of m[1].split("\n")) {
      const i = line.indexOf(":");
      if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim();
    }
  }
  return { meta, body: m ? src.slice(m[0].length) : src };
}

const isEl = (n: RootContent | undefined): n is Element => !!n && n.type === "element";

/** Collects h2/h3 headings, wraps tables for horizontal scroll, marks external links. */
function rehypeDocs(out: { headings: Heading[] }) {
  return () => (tree: Root) => {
    visit(tree, "element", (node: Element, index, parent) => {
      if ((node.tagName === "h2" || node.tagName === "h3") && node.properties?.id) {
        out.headings.push({
          id: String(node.properties.id),
          text: hastToString(node).replace(/#$/, "").trim(),
          depth: node.tagName === "h2" ? 2 : 3,
        });
      }
      if (node.tagName === "a") {
        const href = String(node.properties?.href ?? "");
        if (/^https?:\/\//.test(href)) {
          node.properties = { ...node.properties, target: "_blank", rel: ["noopener", "noreferrer"] };
        }
      }
      if (node.tagName === "table" && parent && typeof index === "number") {
        const wrapper: Element = {
          type: "element",
          tagName: "div",
          properties: { className: ["table-wrap"], tabIndex: 0, role: "region", ariaLabel: "Table" },
          children: [node],
        };
        (parent as Element).children[index] = wrapper;
        return "skip";
      }
    });
  };
}

/** Splits the rendered tree into searchable sections at each h2/h3. */
function sectionsOf(tree: Root, slug: string, title: string): SearchSection[] {
  const href = slug ? `/docs/${slug}` : "/docs";
  const out: SearchSection[] = [];
  let cur: SearchSection = { id: `${slug || "index"}#`, href, page: title, heading: title, text: "" };
  for (const child of tree.children) {
    if (isEl(child) && (child.tagName === "h2" || child.tagName === "h3")) {
      if (cur.text.trim() || cur.heading === title) out.push(cur);
      const id = String(child.properties?.id ?? "");
      cur = {
        id: `${slug || "index"}#${id}`,
        href: `${href}#${id}`,
        page: title,
        heading: hastToString(child).replace(/#$/, "").trim(),
        text: "",
      };
    } else {
      cur.text += " " + hastToString(child as Element);
    }
  }
  out.push(cur);
  return out.map((s) => ({ ...s, text: s.text.replace(/\s+/g, " ").trim() }));
}

const cache = new Map<string, Doc>();

export function getDoc(slug: string): Doc | null {
  if (cache.has(slug)) return cache.get(slug)!;
  if (!DOC_ORDER.some((d) => d.slug === slug)) return null;
  const src = readFileSync(join(DIR, `${slug || "index"}.md`), "utf8");
  const { meta, body } = parseFrontmatter(src);
  const md = body.replace("<!-- addresses-table -->", addressesTable());
  const title = meta.title ?? slug;
  const collected = { headings: [] as Heading[] };
  let sections: SearchSection[] = [];

  const processor = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkRehype)
    .use(rehypeSlug)
    .use(rehypeDocs(collected))
    .use(() => (tree: Root) => {
      sections = sectionsOf(tree, slug, title);
    })
    .use(rehypeAutolinkHeadings, {
      behavior: "append",
      test: ["h2", "h3"],
      properties: { className: ["heading-anchor"], ariaHidden: "true", tabIndex: -1 },
      content: { type: "text", value: "#" },
    })
    .use(rehypeStringify);

  const html = String(processor.processSync(md));
  const doc: Doc = {
    slug,
    title,
    description: meta.description ?? "",
    html,
    headings: collected.headings,
    sections,
  };
  cache.set(slug, doc);
  return doc;
}

export function allSections(): SearchSection[] {
  return DOC_ORDER.flatMap((d) => getDoc(d.slug)?.sections ?? []);
}
