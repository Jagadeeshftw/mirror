#!/usr/bin/env bash
# Stage-A end-to-end of the native Android app on mirror-a / mirror-b against Perpl's exchange on the localnet.
#
#   devices/run-stage-a-android.sh [--build] [--keep-emulators] [--flow FILE]
#
# 1. Builds app/dist/mirror-<ver>-stagea.apk (scripts/build-apk.sh --stage-a) when missing or with --build.
# 2. Starts the localnet (anvil :8546, faucet :8547) and the engine on :8828 (E2E_ENGINE_PORT; the APK bakes
#    in http://10.0.2.2:<port>) with PUBLIC_RPC_URL=http://10.0.2.2:8546, plus the team-run demo follower.
# 3. Runs devices/e2e/flows/stage-a.flow through run-e2e.sh (boots mirror-a / mirror-b if needed).
# 4. Stops the engine, the localnet and the mirror emulators (unless --keep-emulators).
# Evidence: devices/evidence/stage-a-android-<timestamp>/ (report.json, index.html, screenshots, logs).
# Refuses to start a heavy step while the 1-minute load is above 20. Localnet only, anvil test keys.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(dirname "$HERE")"
export E2E_ENGINE_PORT="${E2E_ENGINE_PORT:-8828}"
BUILD=0; KEEP=0; FLOW="$HERE/e2e/flows/stage-a.flow"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --build) BUILD=1; shift;;
    --keep-emulators) KEEP=1; shift;;
    --flow) FLOW="$2"; shift 2;;
    *) sed -n '2,12p' "$0"; exit 2;;
  esac
done
RUN_ID="stage-a-android-$(date +%Y%m%d-%H%M%S)"
EVID="$HERE/evidence/$RUN_ID"; mkdir -p "$EVID" "$HERE/logs"
VER=$(node -p "require('$ROOT/app/package.json').version")
APK="$ROOT/app/dist/mirror-$VER-stagea.apk"

wait_load() { # label
  for _ in $(seq 1 60); do
    local l; l=$(sysctl -n vm.loadavg | awk '{print int($2)}')
    [[ $l -le 20 ]] && return 0
    echo "load $l > 20: waiting before $1"; sleep 10
  done
  echo "load stayed above 20: not starting $1"; return 1
}

NET=""; ENG=""
cleanup() {
  [[ -n "$ENG" ]] && kill "$ENG" 2>/dev/null && sleep 3
  [[ -n "$NET" ]] && kill "$NET" 2>/dev/null
  pkill -f "anvil --port 8546" 2>/dev/null
  [[ $KEEP == 1 ]] || "$HERE/stop-mirror-emulators.sh"
  echo "stopped engine + localnet${KEEP:+}; evidence: $EVID"
}
trap cleanup EXIT
trap 'exit 130' INT TERM

if [[ $BUILD == 1 || ! -f "$APK" ]]; then
  wait_load "the Gradle build" || exit 2
  echo "building $APK (log: $HERE/logs/build-stagea.log)"
  STAGEA_ENGINE_PORT=$E2E_ENGINE_PORT "$ROOT/app/scripts/build-apk.sh" --stage-a > "$HERE/logs/build-stagea.log" 2>&1 || { tail -20 "$HERE/logs/build-stagea.log"; exit 1; }
fi

for p in 8546 8547 "$E2E_ENGINE_PORT"; do
  lsof -ti tcp:"$p" -sTCP:LISTEN >/dev/null && { echo "port $p busy: stop whatever runs there first"; exit 2; }
done
wait_load "the localnet" || exit 2
(cd "$ROOT/localnet" && exec node start.mjs) > "$EVID/localnet.log" 2>&1 &
NET=$!
for _ in $(seq 1 180); do grep -q "localnet fully up" "$EVID/localnet.log" && break; sleep 1; done
grep -q "localnet fully up" "$EVID/localnet.log" || { echo "localnet failed"; tail -20 "$EVID/localnet.log"; exit 1; }
(cd "$ROOT/localnet" && exec node stage-a-engine.mjs "$EVID") > "$EVID/engine-runner.log" 2>&1 &
ENG=$!
for _ in $(seq 1 150); do grep -qE "stage-a engine ready|failed" "$EVID/engine-runner.log" && break; sleep 1; done
grep -q "stage-a engine ready" "$EVID/engine-runner.log" || { echo "engine failed"; tail -20 "$EVID/engine-runner.log"; exit 1; }
grep "engine up" "$EVID/engine-runner.log"

wait_load "the emulators" || exit 2
export HOOK="node $ROOT/localnet/stage-a-hook.mjs"
"$HERE/run-e2e.sh" "$APK" "$FLOW" --run-id "$RUN_ID"
rc=$?
echo "flow exit $rc"
exit $rc
