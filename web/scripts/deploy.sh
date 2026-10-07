#!/usr/bin/env bash
# Deploys the site with the web app to production, then runs the post-deploy check against the public URL.
# A deploy is not done until that check passes; if it fails, this exits non-zero with the report path.
#
#   EXPO_PUBLIC_API_BASE=https://<engine> bash scripts/deploy.sh
#
# Env: EXPO_PUBLIC_API_BASE (required; baked into the web app), SITE_URL (default https://mirror.0xo.in).
set -euo pipefail
WEB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SITE_URL="${SITE_URL:-https://mirror.0xo.in}"
: "${EXPO_PUBLIC_API_BASE:?set EXPO_PUBLIC_API_BASE to the engine URL}"
cd "$WEB_DIR"

bash scripts/build-app.sh
npm run build
vercel deploy --prod --yes
echo "deployed; running the post-deploy check against $SITE_URL"
node scripts/postdeploy-check.mjs --url "$SITE_URL" --own "$EXPO_PUBLIC_API_BASE" --out "$WEB_DIR/postdeploy-evidence/$(date -u +%Y%m%dT%H%M%SZ)"
