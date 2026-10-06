#!/usr/bin/env bash
# Mirror Android E2E runner.
#
#   devices/run-e2e.sh <apk> [flow] [options]
#
#   flow            default: devices/e2e/flows/mirror-full.flow
#   --avd NAME      primary AVD (default mirror-a -> emulator-5554)
#   --avd-b NAME    secondary AVD for restore steps (default mirror-b -> emulator-5556)
#   --wipe          FULL wipe: cold-boot the primary AVD with -wipe-data, then re-provision
#                   PIN + fingerprint. This also REMOVES the Google sign-in, so passkey
#                   steps will fail until the user signs in again. Use for no-account tests.
#   --headless      boot any emulator that is not running with -no-window
#   --run-id ID     evidence folder name (default: <flow>-<timestamp>)
#
# Default (no --wipe) "clean" = boot the AVD if needed, uninstall the app on every
# device the flow uses, then install the APK fresh. The Google account, screen lock
# and fingerprint survive, which passkey creation needs.
#
# Evidence: devices/evidence/<run-id>/ (step screenshots, run.log, report.json, logcat.txt)
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export ANDROID_HOME="${ANDROID_HOME:-/opt/homebrew/share/android-commandlinetools}"
export JAVA_HOME="${JAVA_HOME:-/opt/homebrew/opt/openjdk@17}"
ADB="$ANDROID_HOME/platform-tools/adb"
EMU="$ANDROID_HOME/emulator/emulator"

APK="${1:-}"; [[ -n "$APK" && -f "$APK" ]] || { sed -n '2,20p' "$0"; echo "error: APK path required" >&2; exit 2; }
shift
FLOW="$HERE/e2e/flows/mirror-full.flow"
if [[ $# -gt 0 && "$1" != --* ]]; then FLOW="$1"; shift; fi
AVD_A=mirror-a; AVD_B=mirror-b; WIPE=0; HEADLESS=0; RUN_ID=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --avd) AVD_A="$2"; shift 2;;
    --avd-b) AVD_B="$2"; shift 2;;
    --wipe) WIPE=1; shift;;
    --headless) HEADLESS=1; shift;;
    --run-id) RUN_ID="$2"; shift 2;;
    *) echo "unknown option $1" >&2; exit 2;;
  esac
done

port_for() { case "$1" in mirror-a) echo 5554;; mirror-b) echo 5556;; *) echo "${PORT_OVERRIDE:-5558}";; esac; }
SER_A="emulator-$(port_for "$AVD_A")"; SER_B="emulator-$(port_for "$AVD_B")"
RUN_ID="${RUN_ID:-$(basename "$FLOW" .flow)-$(date +%Y%m%d-%H%M%S)}"
EVID="$HERE/evidence/$RUN_ID"; mkdir -p "$EVID"
echo "run $RUN_ID  apk=$APK  flow=$FLOW  a=$AVD_A($SER_A) b=$AVD_B($SER_B)  wipe=$WIPE" | tee "$EVID/run.log"

running() { "$ADB" devices | grep -q "^$1[[:space:]]"; }
boot() { # avd serial extra-args...
  local avd="$1" ser="$2"; shift 2
  local win=(); [[ $HEADLESS == 1 ]] && win=(-no-window)
  echo "booting $avd on $ser $*"
  nohup "$EMU" -avd "$avd" -port "${ser#emulator-}" -no-snapshot -no-boot-anim -gpu host "${win[@]}" "$@" \
    > "$HERE/logs/emulator-$avd.log" 2>&1 < /dev/null & disown
  "$ADB" -s "$ser" wait-for-device
  until [[ "$("$ADB" -s "$ser" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" == 1 ]]; do sleep 3; done
}
stop_emu() { "$ADB" -s "$1" emu kill >/dev/null 2>&1 || true; while running "$1"; do sleep 2; done; }

mkdir -p "$HERE/logs"
if [[ $WIPE == 1 ]]; then
  echo "WARNING: --wipe removes the Google account on $AVD_A" | tee -a "$EVID/run.log"
  running "$SER_A" && stop_emu "$SER_A"
  boot "$AVD_A" "$SER_A" -wipe-data
  python3 "$HERE/e2e/provision.py" "$SER_A" --evidence "$EVID" | tee -a "$EVID/run.log"
else
  running "$SER_A" || boot "$AVD_A" "$SER_A"
fi
# Second device only if the flow uses it.
if grep -Eq '^[[:space:]]*device[[:space:]]+b\b' "$FLOW"; then running "$SER_B" || boot "$AVD_B" "$SER_B"; fi

PKG="$("$ANDROID_HOME"/build-tools/$(ls "$ANDROID_HOME/build-tools" | sort | tail -1)/aapt2 dump badging "$APK" | sed -n "s/^package: name='\([^']*\)'.*/\1/p")"
for s in "$SER_A" "$SER_B"; do running "$s" && "$ADB" -s "$s" uninstall "$PKG" >/dev/null 2>&1 || true; done
"$ADB" -s "$SER_A" install -r -g "$APK"
"$ADB" -s "$SER_A" logcat -c || true

set +e
python3 "$HERE/e2e/flow.py" "$FLOW" --apk "$APK" --evidence "$EVID" --device "a=$SER_A" --device "b=$SER_B"
rc=$?
set -e
for s in "$SER_A" "$SER_B"; do running "$s" && "$ADB" -s "$s" logcat -d > "$EVID/logcat-$s.txt" 2>/dev/null || true; done
echo "exit $rc  evidence: $EVID"
exit $rc
