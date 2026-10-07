/** Docs navigation: order, grouping and titles. `slug` "" is the overview at /docs. */
export type DocLink = { slug: string; title: string };
export type DocGroup = { title: string; items: DocLink[] };

export const DOC_GROUPS: DocGroup[] = [
  {
    title: "Getting started",
    items: [
      { slug: "", title: "Overview" },
      { slug: "quickstart", title: "Quickstart" },
      { slug: "judges-guide", title: "Judges guide" },
    ],
  },
  {
    title: "Product",
    items: [
      { slug: "how-copying-works", title: "How copying works" },
      { slug: "safety-model", title: "Safety model" },
      { slug: "adversarial-walkthrough", title: "Adversarial walk-through" },
      { slug: "fees", title: "Fees" },
      { slug: "policy-reference", title: "Policy reference" },
      { slug: "why-monad", title: "Why Monad" },
    ],
  },
  {
    title: "Reference",
    items: [
      { slug: "contracts", title: "Contracts" },
      { slug: "api-reference", title: "API reference" },
      { slug: "indexer", title: "Indexer" },
      { slug: "run-the-tests", title: "Run the tests" },
    ],
  },
  {
    title: "More",
    items: [
      { slug: "faq", title: "FAQ" },
      { slug: "team-run-accounts", title: "Team-run accounts" },
    ],
  },
];

export const DOC_ORDER: DocLink[] = DOC_GROUPS.flatMap((g) => g.items);
export const docHref = (slug: string) => (slug ? `/docs/${slug}` : "/docs");
