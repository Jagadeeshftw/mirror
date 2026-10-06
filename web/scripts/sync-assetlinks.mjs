// Copies ../devices/assetlinks.json (written by the Android build) into public/.well-known/ when it
// exists, so the deployed site serves the current signing-certificate fingerprints. Runs before
// every build; a no-op when the source is missing (e.g. on Vercel, which only uploads web/).
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const src = new URL("../../devices/assetlinks.json", import.meta.url);
const dst = new URL("../public/.well-known/assetlinks.json", import.meta.url);
if (existsSync(src)) {
  const json = JSON.parse(readFileSync(src, "utf8")); // throws on invalid JSON
  const next = JSON.stringify(json, null, 2) + "\n";
  const prev = existsSync(dst) ? readFileSync(dst, "utf8") : "";
  if (prev !== next) {
    writeFileSync(dst, next);
    console.log("assetlinks: updated public/.well-known/assetlinks.json from devices/");
  } else console.log("assetlinks: up to date");
} else {
  JSON.parse(readFileSync(dst, "utf8"));
  console.log("assetlinks: devices/assetlinks.json not found, keeping the committed copy");
}
