#!/usr/bin/env bash
# Local Gradle release build (no EAS), R8 + resource shrinking on. Signs with
# keys/mirror-release.keystore when keys/mirror-release.env is present, else debug keystore.
#
#   EXPO_PUBLIC_API_BASE=https://<engine> scripts/build-apk.sh
#       -> dist/mirror-<ver>-release.apk  (Mera passkeys only, no dev tools)
#   scripts/build-apk.sh --devtools
#       -> dist/mirror-<ver>-devtools.apk (dev mock http://localhost:8787 + passkey simulator
#          + backend switch, for emulators without a Google account; never ship this)
set -euo pipefail
cd "$(dirname "$0")/.."
export JAVA_HOME="${JAVA_HOME:-/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home}"
export ANDROID_HOME="${ANDROID_HOME:-/opt/homebrew/share/android-commandlinetools}"
VARIANT=release
if [[ "${1:-}" == "--devtools" ]]; then
  VARIANT=devtools
  export EXPO_PUBLIC_MIRROR_DEV_TOOLS=1
  export EXPO_PUBLIC_API_BASE="${EXPO_PUBLIC_API_BASE:-http://localhost:8787}"
else
  unset EXPO_PUBLIC_MIRROR_DEV_TOOLS EXPO_PUBLIC_DEV_PASSKEY EXPO_PUBLIC_DEV_PASSKEY_SEED
  : "${EXPO_PUBLIC_API_BASE:?set EXPO_PUBLIC_API_BASE (https) for a release build}"
  [[ "$EXPO_PUBLIC_API_BASE" == https://* ]] || { echo "release builds need an https API base"; exit 1; }
fi
KEYS="$(cd .. && pwd)/keys"
if [[ -f "$KEYS/mirror-release.env" && -f "$KEYS/mirror-release.keystore" ]]; then
  set -a; source "$KEYS/mirror-release.env"; set +a
  export MIRROR_KEYSTORE_PATH="$KEYS/mirror-release.keystore"
  echo "Signing with the release keystore"
else
  echo "No release keystore: signing with the debug keystore"
fi
# Regenerate native project so build-time flags (cleartext config) and the JS bundle match.
npx expo prebuild --platform android --clean --no-install >/dev/null
cd android
./gradlew assembleRelease -PreactNativeArchitectures="${ARCHS:-arm64-v8a}" -x lintVitalRelease -x lintVitalAnalyzeRelease -x lintVitalReportRelease --no-daemon
cd ..
VER=$(node -p "require('./package.json').version")
mkdir -p dist
cp android/app/build/outputs/apk/release/app-release.apk "dist/mirror-$VER-$VARIANT.apk"
ls -la "dist/mirror-$VER-$VARIANT.apk"
