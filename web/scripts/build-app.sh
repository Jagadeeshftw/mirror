#!/usr/bin/env bash
# Exports the Expo app (../app) for web into public/app, served by Next under /app (see next.config.ts).
#
#   EXPO_PUBLIC_API_BASE=https://<api> npm run build:app      # then: npm run build / vercel deploy
#
# Env:
#   EXPO_PUBLIC_API_BASE   API base baked into the web bundle (falls back to NEXT_PUBLIC_API_BASE)
#   EXPO_BASE_URL          base path, default /app. The app config must set `experiments.baseUrl` to it
#                          (e.g. `baseUrl: process.env.EXPO_BASE_URL`); the script checks the output.
#   MERA_RP_ID             passed through to app.config.ts (default there: mirror.0xo.in)
#   EXPO_PUBLIC_NETWORK    mainnet | testnet | localnet, default testnet (for now: the contracts are live on Monad
#                          testnet). The app reads /v1/config whenever Mirror's service answers; this picks the
#                          bundled fallback from shared/config.json networks[...] (RPC, contracts, markets,
#                          explorer, demo follower) for devices that have never reached the service. Set it to
#                          mainnet once the mainnet deployment is the one served.
#
# public/app is build output: it is gitignored and replaced on every run. Vercel's CLI does not read
# .gitignore (only .vercelignore), so `vercel deploy` from this machine uploads it.
set -euo pipefail

WEB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_DIR="$(cd "$WEB_DIR/../app" && pwd)"
OUT_DIR="$WEB_DIR/public/app"

export EXPO_BASE_URL="${EXPO_BASE_URL:-/app}"
export EXPO_PUBLIC_NETWORK="${EXPO_PUBLIC_NETWORK:-testnet}"
case "$EXPO_PUBLIC_NETWORK" in
  mainnet|testnet|localnet) ;;
  *) echo "error: EXPO_PUBLIC_NETWORK must be mainnet, testnet or localnet (got '$EXPO_PUBLIC_NETWORK')" >&2; exit 1 ;;
esac
export EXPO_PUBLIC_API_BASE="${EXPO_PUBLIC_API_BASE:-${NEXT_PUBLIC_API_BASE:-}}"
if [ -z "$EXPO_PUBLIC_API_BASE" ]; then
  echo "warning: EXPO_PUBLIC_API_BASE is not set; the web app will have no API base" >&2
fi

rm -rf "$OUT_DIR"
echo "expo export -p web -> $OUT_DIR (base $EXPO_BASE_URL, api ${EXPO_PUBLIC_API_BASE:-<none>}, network $EXPO_PUBLIC_NETWORK)"
(cd "$APP_DIR" && npx expo export -p web --clear --output-dir "$OUT_DIR")

INDEX="$OUT_DIR/index.html"
if [ ! -f "$INDEX" ]; then
  echo "error: $INDEX was not produced" >&2
  exit 1
fi
if ! grep -q "$EXPO_BASE_URL/_expo/" "$INDEX"; then
  echo "error: index.html does not load bundles from $EXPO_BASE_URL/_expo/. Set experiments.baseUrl to" >&2
  echo "       \"$EXPO_BASE_URL\" in app/app.config.ts, otherwise deep links under /app cannot load the bundle." >&2
  exit 1
fi

# The bundle must carry the API base asked for (a cached Metro build once kept an old one).
if [ -n "$EXPO_PUBLIC_API_BASE" ] && ! grep -rqF "$EXPO_PUBLIC_API_BASE" "$OUT_DIR/_expo/static/js"; then
  echo "error: the exported bundle does not contain EXPO_PUBLIC_API_BASE ($EXPO_PUBLIC_API_BASE)" >&2
  exit 1
fi

# No asset may live under a path containing node_modules: Vercel (and other hosts) do not serve or upload such
# paths, and a missing font or image there once left a deployed app blank. Expo exports package assets (for
# example expo-router's icons) under assets/node_modules/; move them to assets/vendor/ and rewrite references.
if [ -d "$OUT_DIR/assets/node_modules" ]; then
  mv "$OUT_DIR/assets/node_modules" "$OUT_DIR/assets/vendor"
  { grep -rlF "assets/node_modules/" "$OUT_DIR" --include='*.js' --include='*.html' --include='*.json' --include='*.css' --include='*.map' || true; } \
    | while read -r f; do
        node -e 'const fs=require("fs");const f=process.argv[1];fs.writeFileSync(f,fs.readFileSync(f,"utf8").split("assets/node_modules/").join("assets/vendor/"))' "$f"
      done
fi
bad_paths="$(cd "$OUT_DIR" && find . -path '*node_modules*' | head -5)"
bad_refs="$( (grep -rlF "node_modules/" "$OUT_DIR" --include='*.html' --include='*.css' 2>/dev/null; grep -rlE '"[^"]*/assets/[^"]*node_modules/[^"]*"' "$OUT_DIR" --include='*.js' 2>/dev/null) | head -5 || true)"
if [ -n "$bad_paths" ] || [ -n "$bad_refs" ]; then
  echo "error: exported web app still has node_modules asset paths:" >&2
  [ -n "$bad_paths" ] && echo "$bad_paths" >&2
  [ -n "$bad_refs" ] && echo "referenced from: $bad_refs" >&2
  exit 1
fi

# Error recorder for the post-deploy check (lib/diag-snippet.mjs), first thing in <head>.
node --input-type=module -e '
  import { readFileSync, writeFileSync } from "node:fs";
  const { DIAG_SNIPPET } = await import(process.argv[1]);
  const f = process.argv[2];
  const html = readFileSync(f, "utf8");
  if (!html.includes("__mirrorDiag")) writeFileSync(f, html.replace(/<head>/i, "<head><script>" + DIAG_SNIPPET + "</script>"));
' "$WEB_DIR/lib/diag-snippet.mjs" "$INDEX"

# PWA: link the /app-scoped manifest (public/app.webmanifest) unless the app ships its own.
if ! grep -qi 'rel="manifest"' "$INDEX"; then
  node -e '
    const fs = require("fs"); const f = process.argv[1];
    const html = fs.readFileSync(f, "utf8").replace("</head>", "<link rel=\"manifest\" href=\"/app.webmanifest\"></head>");
    fs.writeFileSync(f, html);
  ' "$INDEX"
fi

echo "done: $(find "$OUT_DIR" -type f | wc -l | tr -d ' ') files in public/app"
