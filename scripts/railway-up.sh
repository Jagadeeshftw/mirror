#!/usr/bin/env bash
# One-command bring-up of the hosted testnet stack on Railway (project "mirror-testnet"), once the secrets are set
# (scripts/railway-secrets.sh). Uploads from this checkout, in dependency order, then waits for health:
#
#   bash scripts/railway-up.sh            uploads and deploys everything, then checks health
#   bash scripts/railway-up.sh --check    only checks the variables (names only) and health; uploads nothing
#
# Services: hypersync-proxy (indexer/Dockerfile.proxy), indexer-testnet and indexer-mainnet (indexer/Dockerfile;
# ENVIO_CONFIG picks the chain), hasura-testnet / hasura-mainnet (image), Postgres (testnet) / Postgres-eNAd
# (mainnet), engine (engine/Dockerfile, railway.json at the root, volume /data). Values are never printed.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
ENGINE_URL="${ENGINE_URL:-https://engine-production-0fd2.up.railway.app}"
CHECK_ONLY=0
[ "${1:-}" = "--check" ] && CHECK_ONLY=1

railway status >/dev/null 2>&1 || { echo "run 'railway link' (project mirror-testnet) first" >&2; exit 1; }

# Variable names a service must have before it can start (values are not read here, only names).
need() { # service var...
  local svc="$1"; shift
  local names
  names="$(railway variables --service "$svc" --json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(Object.keys(JSON.parse(s)).join(" ")))')"
  local missing=()
  for v in "$@"; do [[ " $names " == *" $v "* ]] || missing+=("$v"); done
  if [ ${#missing[@]} -gt 0 ]; then echo "  $svc: missing ${missing[*]}"; return 1; fi
  echo "  $svc: ok"
}
echo "variables (names only)"
ok=1
need hypersync-proxy ENVIO_API_TOKEN RAILWAY_DOCKERFILE_PATH || ok=0
need hasura-testnet HASURA_GRAPHQL_ADMIN_SECRET HASURA_GRAPHQL_DATABASE_URL || ok=0
need hasura-mainnet HASURA_GRAPHQL_ADMIN_SECRET HASURA_GRAPHQL_DATABASE_URL || ok=0
need indexer-testnet ENVIO_API_TOKEN HASURA_GRAPHQL_ADMIN_SECRET ENVIO_CONFIG ENVIO_PG_HOST ENVIO_MIRROR_FACTORY_ADDRESS || ok=0
need indexer-mainnet ENVIO_API_TOKEN HASURA_GRAPHQL_ADMIN_SECRET ENVIO_CONFIG ENVIO_PG_HOST || ok=0
need engine KEEPER_PRIVATE_KEYS RELAYER_PRIVATE_KEY DEMO_LEADER_PRIVATE_KEY FCM_SERVICE_ACCOUNT_JSON VAPID_PUBLIC_KEY VAPID_PRIVATE_KEY NETWORK DB_PATH || ok=0
[ $ok = 1 ] || { echo "secrets missing: run scripts/railway-secrets.sh first" >&2; exit 1; }

if [ $CHECK_ONLY = 0 ]; then
  echo "deploying"
  railway up indexer --path-as-root --service hypersync-proxy --detach -m "hypersync proxy $(git rev-parse --short HEAD)"
  railway redeploy --service hasura-testnet --yes >/dev/null 2>&1 || true
  railway redeploy --service hasura-mainnet --yes >/dev/null 2>&1 || true
  railway up indexer --path-as-root --service indexer-testnet --detach -m "indexer testnet $(git rev-parse --short HEAD)"
  railway up indexer --path-as-root --service indexer-mainnet --detach -m "indexer mainnet $(git rev-parse --short HEAD)"
  railway up . --service engine --detach -m "engine $(git rev-parse --short HEAD)"
fi

echo "waiting for the engine at $ENGINE_URL/v1/health (up to 10 min)"
for i in $(seq 1 60); do
  code="$(curl -s -o /dev/null -w '%{http_code}' "$ENGINE_URL/v1/health" || true)"
  if [ "$code" = 200 ]; then curl -s "$ENGINE_URL/v1/health"; echo; break; fi
  sleep 10
done
[ "$code" = 200 ] || { echo "engine not healthy (last HTTP $code); see: railway logs --service engine" >&2; exit 1; }
curl -s "$ENGINE_URL/v1/config" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const c=JSON.parse(s);console.log("config: chain",c.chainId,"factory",c.contracts&&c.contracts.factory)})'
railway service status --all 2>/dev/null || railway service list
echo "up. Next: EXPO_PUBLIC_API_BASE=$ENGINE_URL bash web/scripts/deploy.sh"
