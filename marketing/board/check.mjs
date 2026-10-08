// Counts each post the way X does (twitter-text weighting): URLs and bare domains with a path count as 23, code points
// outside Latin-1 and general punctuation ranges count as 2, everything else 1. Fails above 280.
import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "..", "..");
const posts = JSON.parse(readFileSync(join(here, "posts.json"), "utf8"));
const URL_RE = /(https?:\/\/)?([a-z0-9-]+\.)+(com|xyz|in|io|org|dev)(\/[^\s]*)?/gi;
const weight = (cp) => (cp <= 0x10ff || (cp >= 0x2000 && cp <= 0x200d) || (cp >= 0x2010 && cp <= 0x201f) || (cp >= 0x2032 && cp <= 0x2037) ? 1 : 2);
let bad = 0;
for (const p of posts) {
  const urls = p.text.match(URL_RE) ?? [];
  let rest = p.text.replace(URL_RE, "");
  const n = urls.length * 23 + [...rest].reduce((a, c) => a + weight(c.codePointAt(0)), 0);
  const clip = join(repo, p.clip);
  let dur = "missing";
  if (existsSync(clip)) dur = Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", clip]).toString()).toFixed(2) + " s";
  const ok = n <= 280 && existsSync(clip) && p.who === "@MirrorOnMonad";
  if (!ok) bad++;
  console.log(`${ok ? "OK  " : "FAIL"} ${p.date}  ${String(n).padStart(3)}/280  clip ${dur}  ${p.clip}`);
}
process.exit(bad ? 1 : 0);
