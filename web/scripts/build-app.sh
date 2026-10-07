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
#
# public/app is build output: it is gitignored and replaced on every run. Vercel's CLI does not read
# .gitignore (only .vercelignore), so `vercel deploy` from this machine uploads it.
set -euo pipefail

WEB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_DIR="$(cd "$WEB_DIR/../app" && pwd)"
OUT_DIR="$WEB_DIR/public/app"

export EXPO_BASE_URL="${EXPO_BASE_URL:-/app}"
export EXPO_PUBLIC_API_BASE="${EXPO_PUBLIC_API_BASE:-${NEXT_PUBLIC_API_BASE:-}}"
if [ -z "$EXPO_PUBLIC_API_BASE" ]; then
  echo "warning: EXPO_PUBLIC_API_BASE is not set; the web app will have no API base" >&2
fi

rm -rf "$OUT_DIR"
echo "expo export -p web -> $OUT_DIR (base $EXPO_BASE_URL, api ${EXPO_PUBLIC_API_BASE:-<none>})"
(cd "$APP_DIR" && npx expo export -p web --output-dir "$OUT_DIR")

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

# PWA: link the /app-scoped manifest (public/app.webmanifest) unless the app ships its own.
if ! grep -qi 'rel="manifest"' "$INDEX"; then
  node -e '
    const fs = require("fs"); const f = process.argv[1];
    const html = fs.readFileSync(f, "utf8").replace("</head>", "<link rel=\"manifest\" href=\"/app.webmanifest\"></head>");
    fs.writeFileSync(f, html);
  ' "$INDEX"
fi

echo "done: $(find "$OUT_DIR" -type f | wc -l | tr -d ' ') files in public/app"
