#!/usr/bin/env bash
# Stage-B end-to-end of the Android app on PUBLIC Monad testnet, on mirror-a / mirror-b.
#
#   devices/run-stage-b-android.sh [--build] [--keep-emulators] [--flow FILE]
#   devices/run-stage-b-android.sh --hosted [--keep-emulators] [--flow FILE]
#       against the HOSTED engine with the release APK (app/dist/mirror-<ver>-release.apk, built with
#       EXPO_PUBLIC_API_BASE=$ENGINE_URL); default flow devices/e2e/flows/stage-b-hosted.flow
#
# 1. Builds app/dist/mirror-<ver>-stageb.apk (app/scripts/build-apk.sh --stage-b) when missing or with --build.
# 2. Uses the engine on :8838 if it is already up (scripts/engine-testnet-local.sh), else starts it and stops it after.
# 3. Runs devices/e2e/flows/stage-b.flow through run-e2e.sh (boots mirror-a / mirror-b if needed).
# 4. Stops the mirror emulators (unless --keep-emulators) and an engine it started.
# Evidence: devices/evidence/stage-b-android-<timestamp>/. Refuses heavy steps while the 1-minute load is above 20.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
BUILD=0; KEEP=0; HOSTED=0; FLOW=""; PORT=8838
ENGINE_URL_HOSTED="${ENGINE_URL:-https://engine-production-0fd2.up.railway.app}"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --build) BUILD=1; shift;;
    --keep-emulators) KEEP=1; shift;;
    --flow) FLOW="$2"; shift 2;;
    --hosted) HOSTED=1; shift;;
    *) sed -n '2,12p' "$0"; exit 2;;
  esac
done
if [[ -z "$FLOW" ]]; then [[ $HOSTED == 1 ]] && FLOW="$HERE/e2e/flows/stage-b-hosted.flow" || FLOW="$HERE/e2e/flows/stage-b.flow"; fi
RUN_ID="stage-b$([[ $HOSTED == 1 ]] && echo -hosted)-android-$(date +%Y%m%d-%H%M%S)"
EVID="$HERE/evidence/$RUN_ID"; mkdir -p "$EVID" "$HERE/logs"
VER=$(node -p "require('$ROOT/app/package.json').version")
APK="$ROOT/app/dist/mirror-$VER-stageb.apk"
[[ $HOSTED == 1 ]] && APK="$ROOT/app/dist/mirror-$VER-release.apk"

wait_load() {
  for _ in $(seq 1 60); do
    local l; l=$(sysctl -n vm.loadavg | awk '{print int($2)}')
    [[ $l -le 20 ]] && return 0
    echo "load $l > 20: waiting before $1"; sleep 10
  done
  echo "load stayed above 20: not starting $1"; return 1
}
adb_() { "${ANDROID_HOME:-/opt/homebrew/share/android-commandlinetools}/platform-tools/adb" "$@"; }
ENG=""
cleanup() {
  [[ -n "$ENG" ]] && kill "$ENG" 2>/dev/null
  if [[ $KEEP != 1 ]]; then
    for d in $(adb_ devices | awk '/^emulator/{print $1}'); do
      n=$(adb_ -s "$d" emu avd name 2>/dev/null | head -1 | tr -d '\r')
      case "$n" in mirror-a|mirror-b) adb_ -s "$d" emu kill >/dev/null && echo "stopped $n ($d)";; esac
    done
  fi
  for f in "$EVID"/*.log "$EVID"/*.txt "$EVID"/*.json "$EVID"/*.xml; do
    [[ -f "$f" ]] && sed -E -i '' 's/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/<google-account>/g' "$f"
  done
  echo "evidence: $EVID"
}
trap cleanup EXIT
trap 'exit 130' INT TERM

if [[ $HOSTED == 1 ]]; then
  [[ -f "$APK" ]] || { echo "missing $APK: build it with EXPO_PUBLIC_API_BASE=$ENGINE_URL_HOSTED app/scripts/build-apk.sh"; exit 1; }
  curl -sf -m 20 "$ENGINE_URL_HOSTED/v1/health" | grep -q '"ready":true' || { echo "hosted engine not ready"; exit 1; }
  curl -s "$ENGINE_URL_HOSTED/v1/health" > "$EVID/engine-health.json"
  wait_load "the emulators" || exit 2
  export HOOK="node $ROOT/localnet/stage-b-hook.mjs" ENGINE_URL="$ENGINE_URL_HOSTED"
  "$HERE/run-e2e.sh" "$APK" "$FLOW" --run-id "$RUN_ID"
  rc=$?
  echo "flow exit $rc"
  exit $rc
fi
if [[ $BUILD == 1 || ! -f "$APK" ]]; then
  wait_load "the Gradle build" || exit 2
  STAGEB_ENGINE_PORT=$PORT "$ROOT/app/scripts/build-apk.sh" --stage-b > "$HERE/logs/build-stageb.log" 2>&1 || { tail -20 "$HERE/logs/build-stageb.log"; exit 1; }
fi
if ! curl -sf -m 5 "http://127.0.0.1:$PORT/v1/health" | grep -q '"ready":true'; then
  bash "$ROOT/scripts/engine-testnet-local.sh" "$PORT" &
  ENG=$!
  for _ in $(seq 1 120); do curl -sf -m 3 "http://127.0.0.1:$PORT/v1/health" | grep -q '"ready":true' && break; sleep 10; done
  curl -sf -m 3 "http://127.0.0.1:$PORT/v1/health" | grep -q '"ready":true' || { echo "engine not ready"; exit 1; }
fi
curl -s "http://127.0.0.1:$PORT/v1/health" > "$EVID/engine-health.json"
wait_load "the emulators" || exit 2
export HOOK="node $ROOT/localnet/stage-b-hook.mjs" STAGEB_ENGINE_PORT=$PORT
"$HERE/run-e2e.sh" "$APK" "$FLOW" --run-id "$RUN_ID"
rc=$?
echo "flow exit $rc"
exit $rc
