#!/usr/bin/env node
/**
 * Runs every operation in queries/engine.graphql against a running indexer and writes the responses
 * to samples/. Usage: GRAPHQL_URL=http://localhost:8080/v1/graphql node scripts/export-samples.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const url = process.env.GRAPHQL_URL ?? "http://localhost:8080/v1/graphql";
const doc = readFileSync(join(root, "queries/engine.graphql"), "utf8");
const outDir = join(root, "samples");
mkdirSync(outDir, { recursive: true });

async function gql(operationName, variables = {}) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query: doc, operationName, variables }),
  });
  const body = await res.json();
  if (body.errors) throw new Error(`${operationName}: ${JSON.stringify(body.errors)}`);
  return body.data;
}

const now = Math.floor(Date.now() / 1000);
const today = Math.floor(now / 86400);
const save = (name, data) => writeFileSync(join(outDir, `${name}.json`), JSON.stringify(data, null, 2) + "\n");

const status = await gql("IndexerStatus");
save("indexer-status", status);

const board = {};
for (const window of ["D7", "D30", "D90"]) {
  board[window] = (await gql("Leaderboard", { window, minTrades: 3, limit: 10 })).LeaderWindowStats;
}
save("leaderboard", board);

const top = board.D7[0]?.accountId;
if (top) save("leader-profile", await gql("LeaderProfile", { id: String(top), sinceDay: today - 90, trades: 10 }));
if (top) save("leader-followers", await gql("LeaderFollowers", { leaderAccountId: String(top) }));

save("markets", await gql("Markets"));
save("stats", await gql("Stats", { sinceDay: today - 30, activeSince: now - 7 * 86400 }));
save("owner-accounts", await gql("OwnerAccounts", { owner: "0x0000000000000000000000000000000000000000" }));
save("account-feed", await gql("AccountFeed", { account: "0x0000000000000000000000000000000000000000", limit: 10 }));

// Raw trade history sample: the most recent decoded Perpl position events.
const recent = await fetch(url, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    query: `{ PositionEvent(order_by: [{blockNumber: desc}, {logIndex: desc}], limit: 25) {
      id kind accountId perpId side lotsBeforeLNS lotsAfterLNS lotsTradedLNS pricePNS priceSource entryPricePNS
      notionalCNS realizedPnlCNS fundingCNS feeCNS netPnlCNS leverageHdths blockNumber timestamp txHash logIndex
      market { symbol } account { address } } }`,
  }),
}).then((r) => r.json());
save("position-events", recent.data);
console.log(`wrote samples to ${outDir} (indexer at block ${status._meta[0]?.progressBlock})`);
