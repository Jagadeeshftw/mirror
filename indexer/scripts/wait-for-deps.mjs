#!/usr/bin/env node
// Waits until Postgres accepts connections and Hasura answers /healthz, then exits 0 (the container then runs
// `envio start`). Envio tracks its tables in Hasura only on its first start; if Hasura is not reachable at that
// moment the tables are created but never tracked, and every GraphQL query fails until someone re-tracks them by
// hand. Found in the local dry run of the hosted stack. Gives up after WAIT_FOR_DEPS_SEC (default 300).
import net from "node:net";

const deadline = Date.now() + Number(process.env.WAIT_FOR_DEPS_SEC ?? 300) * 1000;
const pgHost = process.env.ENVIO_PG_HOST ?? "localhost";
const pgPort = Number(process.env.ENVIO_PG_PORT ?? 5432);
const hasura = (process.env.HASURA_GRAPHQL_ENDPOINT ?? "").replace(/\/v1\/metadata\/?$/, "");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const pgUp = () => new Promise((resolve) => {
  const s = net.connect({ host: pgHost, port: pgPort, timeout: 3000 }, () => { s.end(); resolve(true); });
  s.on("error", () => resolve(false));
  s.on("timeout", () => { s.destroy(); resolve(false); });
});
const hasuraUp = async () => {
  if (!hasura) return true; // no Hasura configured: nothing to wait for
  try { return (await fetch(`${hasura}/healthz`, { signal: AbortSignal.timeout(3000) })).ok; } catch { return false; }
};

for (;;) {
  const [p, h] = [await pgUp(), await hasuraUp()];
  if (p && h) { console.log(`deps ready: postgres ${pgHost}:${pgPort}${hasura ? `, hasura ${hasura}` : ""}`); process.exit(0); }
  if (Date.now() > deadline) { console.error(`deps not ready: postgres ${p ? "up" : "down"}, hasura ${h ? "up" : "down"}`); process.exit(1); }
  console.log(`waiting for ${p ? "" : "postgres "}${h ? "" : "hasura"}`.trim());
  await sleep(3000);
}
