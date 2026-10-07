#!/usr/bin/env node
// Rate-limited HyperSync proxy. Mirror's HyperSync token is a free one: 15 requests per minute, and only one
// token exists. Envio has no request-rate setting, so the indexer talks to this proxy instead
// (ENVIO_HYPERSYNC_URL=http://127.0.0.1:8930), which forwards to the real endpoint at most HYPERSYNC_RPM requests
// per minute (default 14, one below the limit), queues the rest in order, and backs off on 429.
//
//   ENVIO_API_TOKEN=... node scripts/hypersync-proxy.mjs     (or ENVIO_TOKEN; never logged)
//
// Env: HYPERSYNC_UPSTREAM (default https://143.hypersync.xyz), HYPERSYNC_PROXY_PORT (8930), HYPERSYNC_RPM (14).
import { createServer } from "node:http";

const UPSTREAM = (process.env.HYPERSYNC_UPSTREAM ?? "https://143.hypersync.xyz").replace(/\/$/, "");
const PORT = Number(process.env.HYPERSYNC_PROXY_PORT ?? 8930);
const RPM = Math.max(1, Math.min(15, Number(process.env.HYPERSYNC_RPM ?? 14)));
const TOKEN = process.env.ENVIO_API_TOKEN || process.env.ENVIO_TOKEN || "";
const GAP_MS = Math.ceil(60_000 / RPM);
const BACKOFF_MS = 61_000;

let nextSlot = 0;
let sent = 0;
let throttled = 0;
const queue = [];
let pumping = false;

async function pump() {
  if (pumping) return;
  pumping = true;
  while (queue.length) {
    const wait = nextSlot - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    const job = queue.shift();
    nextSlot = Date.now() + GAP_MS;
    try {
      let res = await forward(job);
      // A 429 means the window is spent: wait a full minute and retry once, keeping the queue's order.
      if (res.status === 429) {
        throttled++;
        nextSlot = Date.now() + BACKOFF_MS;
        await new Promise((r) => setTimeout(r, BACKOFF_MS));
        nextSlot = Date.now() + GAP_MS;
        res = await forward(job);
      }
      sent++;
      job.resolve(res);
    } catch (err) {
      job.reject(err);
    }
  }
  pumping = false;
}

async function forward({ method, path, headers, body }) {
  const h = { ...headers };
  delete h.host;
  delete h["content-length"];
  if (TOKEN) h.authorization = `Bearer ${TOKEN}`;
  const res = await fetch(UPSTREAM + path, { method, headers: h, body: method === "GET" || method === "HEAD" ? undefined : body });
  return { status: res.status, headers: Object.fromEntries(res.headers), body: Buffer.from(await res.arrayBuffer()) };
}

createServer(async (req, res) => {
  if (req.url === "/__proxy/stats") {
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify({ upstream: UPSTREAM, rpm: RPM, queued: queue.length, sent, throttled, token: Boolean(TOKEN) }));
  }
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const job = { method: req.method, path: req.url, headers: req.headers, body: Buffer.concat(chunks) };
  try {
    const out = await new Promise((resolve, reject) => {
      queue.push({ ...job, resolve, reject });
      pump();
    });
    const headers = { ...out.headers };
    delete headers["content-encoding"];
    delete headers["transfer-encoding"];
    delete headers["content-length"];
    res.writeHead(out.status, headers);
    res.end(out.body);
  } catch (err) {
    res.writeHead(502, { "content-type": "text/plain" });
    res.end(`hypersync proxy: ${String(err?.message ?? err).slice(0, 200)}`);
  }
}).listen(PORT, "127.0.0.1", () => {
  console.log(`hypersync proxy on http://127.0.0.1:${PORT} -> ${UPSTREAM}, ${RPM} req/min, token ${TOKEN ? "set" : "missing"}`);
});
