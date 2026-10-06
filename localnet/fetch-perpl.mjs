#!/usr/bin/env node
// Fetches Perpl's exchange implementation and proxy artifacts from Perpl's MIT-licensed dex-sdk (the same
// artifacts its `testing` module deploys), pinned to one commit and checked by SHA-256.
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const COMMIT = "01b9910761755b0a0d9c710c1ede62ab937daa7d"; // perpl-sdk rc_v1.1.7-203-g0e5902dd
const FILES = {
  "Exchange.json": "766fc81326bdf27f243ca582f65c3e2ff72bc639d88674876697a63ae1c47cb3",
  "ERC1967Proxy.json": "0bedd711753a56e8833052cfd9c5533dfaf80f446ac3c9885f5dc627a414ca20",
};
const out = join(HERE, "vendor", "perpl");
mkdirSync(out, { recursive: true });
for (const [name, sha] of Object.entries(FILES)) {
  const dest = join(out, name);
  if (existsSync(dest) && createHash("sha256").update(readFileSync(dest)).digest("hex") === sha) continue;
  const url = `https://raw.githubusercontent.com/PerplFoundation/dex-sdk/${COMMIT}/crates/sdk/abi/dex/${name}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const got = createHash("sha256").update(buf).digest("hex");
  if (got !== sha) throw new Error(`${name}: sha256 ${got}, expected ${sha}`);
  writeFileSync(dest, buf);
  console.log(`fetched ${name} (${buf.length} bytes) from dex-sdk@${COMMIT.slice(0, 7)}`);
}
