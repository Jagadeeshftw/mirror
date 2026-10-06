// Post-export safety net: make every asset reference in out/*.html relative so
// the site works from any sub-path (e.g. https://host/some/dir/index.html).
// next.config.ts already sets assetPrefix "./"; this rewrites any leftovers and
// fails the build if a root-absolute src/href survives.
import { readdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { join } from "node:path";

const OUT = new URL("../out/", import.meta.url).pathname;
const walk = (d) =>
  readdirSync(d).flatMap((f) => {
    const p = join(d, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });

let bad = 0;
for (const file of walk(OUT).filter((f) => f.endsWith(".html"))) {
  const depth = file.slice(OUT.length).split("/").length - 1;
  const prefix = depth === 0 ? "./" : "../".repeat(depth);
  let s = readFileSync(file, "utf8");
  s = s
    .replaceAll('"/_next/', `"${prefix}_next/`)
    .replaceAll("'/_next/", `'${prefix}_next/`)
    .replace(/(src|href)="\/(?!\/)/g, `$1="${prefix}`);
  writeFileSync(file, s);
  const left = s.match(/(src|href)="\/(?!\/)[^"]*"/g);
  if (left) {
    bad += left.length;
    console.error(file, left);
  }
}
if (bad) process.exit(1);
console.log("relativize: all HTML asset references are relative");
