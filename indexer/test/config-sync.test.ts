import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// config.testnet.yaml must index exactly the same contracts and events as config.yaml; only the chain,
// addresses, start blocks and data sources differ.
const events = (f: string) =>
  readFileSync(join(__dirname, "..", f), "utf8")
    .split("\n")
    .filter((l) => /^\s*-\s*(event|name):/.test(l))
    .map((l) => l.trim());

describe("config.testnet.yaml", () => {
  it("has the same contracts and events as config.yaml", () => {
    expect(events("config.testnet.yaml")).toEqual(events("config.yaml"));
  });
});
