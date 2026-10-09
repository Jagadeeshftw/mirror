#!/usr/bin/env bash
# Deploys the site with the web app to production, then runs the post-deploy check against the public URL.
# A deploy is not done until that check passes; if it fails, this exits non-zero with the report path.
#
#   EXPO_PUBLIC_API_BASE=https://<engine> bash scripts/deploy.sh
#
# Env: EXPO_PUBLIC_API_BASE (required; baked into the web app), SITE_URL (default https://mirror.0xo.in),
#      EXPO_PUBLIC_NETWORK (bundled fallback network, default testnet; see scripts/build-app.sh),
#      POSTDEPLOY_ONLY=chrome to skip the local Safari half (it cannot open Safari while the Mac's screen is locked;
#      the GitHub workflow started below checks Safari either way).
set -euo pipefail
WEB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SITE_URL="${SITE_URL:-https://mirror.0xo.in}"
: "${EXPO_PUBLIC_API_BASE:?set EXPO_PUBLIC_API_BASE to the engine URL}"
cd "$WEB_DIR"

bash scripts/build-app.sh
npm run build
vercel deploy --prod --yes
# The same check on GitHub Actions (macOS runner: Chrome and Safari), started only as Jagadeeshftw.
if command -v gh >/dev/null && [ "$(gh api user --jq .login 2>/dev/null)" = "Jagadeeshftw" ]; then
  WF_ARGS=(-f url="$SITE_URL")
  [ "${ENGINE_DOWN:-0}" = 1 ] && WF_ARGS+=(-f down="$EXPO_PUBLIC_API_BASE")
  gh workflow run postdeploy.yml --repo Jagadeeshftw/mirror "${WF_ARGS[@]}" && echo "started the post-deploy workflow on GitHub"
fi
echo "deployed; running the post-deploy check against $SITE_URL"
DOWN_ARGS=(); [ "${ENGINE_DOWN:-0}" = 1 ] && DOWN_ARGS=(--down "$EXPO_PUBLIC_API_BASE")
[ -n "${POSTDEPLOY_ONLY:-}" ] && DOWN_ARGS+=(--only "$POSTDEPLOY_ONLY")
node scripts/postdeploy-check.mjs --url "$SITE_URL" --own "$EXPO_PUBLIC_API_BASE" ${DOWN_ARGS[@]+"${DOWN_ARGS[@]}"} --out "$WEB_DIR/postdeploy-evidence/$(date -u +%Y%m%dT%H%M%SZ)"
