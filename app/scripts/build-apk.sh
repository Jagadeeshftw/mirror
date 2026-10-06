#!/usr/bin/env bash
# Local Gradle release build (no EAS). Signs with keys/mirror-release.keystore when
# keys/mirror-release.env is present; otherwise falls back to the debug keystore.
#   EXPO_PUBLIC_API_BASE=https://<engine> scripts/build-apk.sh        # real engine
#   EXPO_PUBLIC_API_BASE=http://localhost:8787 scripts/build-apk.sh   # dev mock (adb reverse tcp:8787 tcp:8787)
set -euo pipefail
cd "$(dirname "$0")/.."
export JAVA_HOME="${JAVA_HOME:-/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home}"
export ANDROID_HOME="${ANDROID_HOME:-/opt/homebrew/share/android-commandlinetools}"
KEYS="$(cd .. && pwd)/keys"
if [[ -f "$KEYS/mirror-release.env" && -f "$KEYS/mirror-release.keystore" ]]; then
  set -a; source "$KEYS/mirror-release.env"; set +a
  export MIRROR_KEYSTORE_PATH="$KEYS/mirror-release.keystore"
  echo "Signing with the release keystore"
else
  echo "No release keystore: signing with the debug keystore"
fi
[[ -d android ]] || npx expo prebuild --platform android --clean --no-install
cd android
./gradlew assembleRelease -PreactNativeArchitectures="${ARCHS:-arm64-v8a}" -x lintVitalRelease -x lintVitalAnalyzeRelease -x lintVitalReportRelease --no-daemon
ls -la app/build/outputs/apk/release/
