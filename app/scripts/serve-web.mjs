#!/usr/bin/env node
// Serves the web export (dist-web) under /app like mirror.0xo.in does, with SPA fallback.
//   EXPO_BASE_URL=/app npx expo export -p web --output-dir dist-web && node scripts/serve-web.mjs   # :8790
import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = process.env.WEB_ROOT ?? fileURLToPath(new URL("../dist-web/", import.meta.url));
const BASE = process.env.WEB_BASE ?? "/app";
const PORT = Number(process.env.WEB_PORT ?? 8790);
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".webmanifest": "application/manifest+json", ".png": "image/png", ".svg": "image/svg+xml", ".ttf": "font/ttf", ".ico": "image/x-icon", ".map": "application/json" };

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, "http://x");
    if (url.pathname === "/" ) {
      res.writeHead(302, { Location: `${BASE}/` });
      return res.end();
    }
    if (!url.pathname.startsWith(BASE)) {
      res.writeHead(404);
      return res.end("not found");
    }
    let rel = normalize(decodeURIComponent(url.pathname.slice(BASE.length))).replace(/^(\.\.[/\\])+/, "");
    let file = join(ROOT, rel);
    try {
      if ((await stat(file)).isDirectory()) file = join(file, "index.html");
    } catch {
      file = join(ROOT, "index.html");
    }
    try {
      const body = await readFile(file);
      res.writeHead(200, { "Content-Type": TYPES[extname(file)] ?? "application/octet-stream", "Cache-Control": "no-cache" });
      res.end(body);
    } catch {
      res.writeHead(404);
      res.end("not found");
    }
  })
  .listen(PORT, () => console.log(`Mirror web on http://localhost:${PORT}${BASE}/`));
