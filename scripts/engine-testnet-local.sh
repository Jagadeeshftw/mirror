#!/usr/bin/env bash
# Runs Mirror's engine on this machine against PUBLIC Monad testnet (chain 10143): the deployed testnet contracts,
# Perpl's testnet exchange, the team-run demo leader (Perpl account 1000). Used for the Stage B end-to-end while the
# hosted engine waits on its secrets; the hosted service runs the same code with the same variables.
#
#   bash scripts/engine-testnet-local.sh [port]        (default 8838; logs and DB under .stage-b/)
#
# Keys: the ops wallet key from .env is passed to the engine process as keeper, relayer and demo leader key. It is
# read here and never printed or written anywhere; the DB and logs contain no keys. Stop with Ctrl-C (or kill the PID).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${1:-8838}"
DIR="$ROOT/.stage-b"
mkdir -p "$DIR"
cd "$ROOT/engine"
pnpm build >/dev/null
OPS_KEY="$(set -a; . "$ROOT/.env"; set +a; printf '%s' "${OPS_PRIVATE_KEY:-}")"
[ -n "$OPS_KEY" ] || { echo "OPS_PRIVATE_KEY missing in .env" >&2; exit 1; }
FCM_JSON=""
[ -f "$ROOT/keys/firebase-adminsdk.json" ] && FCM_JSON="$(node -e 'process.stdout.write(JSON.stringify(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"))))' "$ROOT/keys/firebase-adminsdk.json")"

exec env \
  NODE_ENV=production PORT="$PORT" HOST=0.0.0.0 LOG_LEVEL=info NETWORK=testnet \
  DB_PATH="$DIR/engine.db" \
  KEEPER_PRIVATE_KEYS="$OPS_KEY" RELAYER_PRIVATE_KEY="$OPS_KEY" DEMO_LEADER_PRIVATE_KEY="$OPS_KEY" \
  DEMO_PERP_ID=16 RPC_MAX_RPS="${RPC_MAX_RPS:-12}" \
  TEAM_RUN_ADDRESSES=0x299E77E58DD37607e4890C761924D829F8ACe82C,0x634BFE3c2E4c483e8F7F4f3F3b6B2B7383A74896,0x3abf625be454f8f78e5ada1b4ab627ede6c26c78 \
  TEAM_TEST_ADDRESSES="${TEAM_TEST_ADDRESSES:-0x1bbD7e3333B99E7618C921B267ee246D1425040D,0x513A84F7037Ba8E3663f3f4853cb9637Bd30533e,0x2A1DC222b05B4820Ed921662515c0Da251499da1}" \
  FCM_PROJECT_ID=mirror-c8061 FCM_SERVICE_ACCOUNT_JSON="$FCM_JSON" PUSH_ENABLED=1 \
  PUBLIC_RPC_URL="${PUBLIC_RPC_URL:-https://testnet-rpc.monad.xyz}" \
  node dist/src/index.js >>"$DIR/engine.log" 2>&1
