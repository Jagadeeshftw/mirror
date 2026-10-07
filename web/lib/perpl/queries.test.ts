import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { QUERIES } from "./queries";

const norm = (s: string) => s.replace(/#[^\n]*/g, "").replace(/\s+/g, " ").trim();

describe("analytics queries", () => {
  it("match indexer/queries/analytics.graphql", () => {
    const file = readFileSync(join(__dirname, "../../../indexer/queries/analytics.graphql"), "utf8");
    const ops = [...file.matchAll(/^query (\w+)[\s\S]*?^\}/gm)].map((m) => [m[1], m[0]] as const);
    expect(ops.map(([n]) => n).sort()).toEqual(Object.keys(QUERIES).sort());
    for (const [name, text] of ops) expect(norm(QUERIES[name as keyof typeof QUERIES])).toBe(norm(text));
  });
});
