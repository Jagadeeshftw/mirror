#!/usr/bin/env bash
# Sets the secret variables of the Railway project "mirror-testnet" from files on this machine. Run it once,
# yourself, from the repo root:
#
#   bash scripts/railway-secrets.sh
#
# Nothing is printed: every value goes to Railway over stdin (railway variables --set-from-stdin), never on a
# command line, in the shell history or in the repository. What it sets:
#   engine            KEEPER_PRIVATE_KEYS, RELAYER_PRIVATE_KEY, DEMO_LEADER_PRIVATE_KEY (the ops wallet key from .env;
#                     testnet only), FCM_SERVICE_ACCOUNT_JSON (keys/firebase-adminsdk.json), VAPID key pair (new)
#   hypersync-proxy   ENVIO_API_TOKEN (ENVIO_TOKEN from .env)
#   indexer-testnet, indexer-mainnet   ENVIO_API_TOKEN, HASURA_GRAPHQL_ADMIN_SECRET
#   hasura-testnet, hasura-mainnet     HASURA_GRAPHQL_ADMIN_SECRET (new random value, one per Hasura)
# Re-running it replaces the VAPID pair (browsers re-subscribe) and the Hasura secrets; the rest is unchanged.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

[ -f .env ] || { echo "missing .env" >&2; exit 1; }
[ -f keys/firebase-adminsdk.json ] || { echo "missing keys/firebase-adminsdk.json" >&2; exit 1; }
git check-ignore -q .env && git check-ignore -q keys/firebase-adminsdk.json || { echo "refusing: a secret file is not gitignored" >&2; exit 1; }
railway status >/dev/null 2>&1 || { echo "run 'railway link' to the mirror-testnet project first" >&2; exit 1; }

envval() { (set -a; . ./.env; set +a; eval "printf '%s' \"\${$1:-}\""); }
put() { # service key  (value on stdin)
  railway variables --service "$1" --skip-deploys --set-from-stdin "$2" >/dev/null
  echo "  set $2 on $1"
}

OPS_KEY="$(envval OPS_PRIVATE_KEY)"
TOKEN="$(envval ENVIO_TOKEN)"
[ -n "$OPS_KEY" ] && [ -n "$TOKEN" ] || { echo "OPS_PRIVATE_KEY or ENVIO_TOKEN missing in .env" >&2; exit 1; }

echo "engine"
printf '%s' "$OPS_KEY" | put engine KEEPER_PRIVATE_KEYS
printf '%s' "$OPS_KEY" | put engine RELAYER_PRIVATE_KEY
printf '%s' "$OPS_KEY" | put engine DEMO_LEADER_PRIVATE_KEY
node -e 'process.stdout.write(JSON.stringify(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))))' keys/firebase-adminsdk.json | put engine FCM_SERVICE_ACCOUNT_JSON
VAPID="$(cd engine && node -e 'const w=require("web-push");const k=w.generateVAPIDKeys();process.stdout.write(k.publicKey+" "+k.privateKey)')"
printf '%s' "${VAPID%% *}" | put engine VAPID_PUBLIC_KEY
printf '%s' "${VAPID##* }" | put engine VAPID_PRIVATE_KEY

echo "hypersync-proxy and indexers"
for s in hypersync-proxy indexer-testnet indexer-mainnet; do printf '%s' "$TOKEN" | put "$s" ENVIO_API_TOKEN; done

echo "hasura"
for n in testnet mainnet; do
  SECRET="$(node -e 'process.stdout.write(require("crypto").randomBytes(24).toString("hex"))')"
  printf '%s' "$SECRET" | put "hasura-$n" HASURA_GRAPHQL_ADMIN_SECRET
  printf '%s' "$SECRET" | put "indexer-$n" HASURA_GRAPHQL_ADMIN_SECRET
done
unset OPS_KEY TOKEN VAPID SECRET
echo "done. Tell Claude 'secrets set'; it deploys the services next."
