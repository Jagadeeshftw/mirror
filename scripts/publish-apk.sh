#!/usr/bin/env bash
# Publishes a release APK as a GitHub Release with notes, and points the site's download page at it.
#
#   bash scripts/publish-apk.sh app/dist/mirror-1.0.0-release.apk docs/releases/1.0.0-testnet.md
#
# 1. Reads the APK's real versionName / versionCode (apkanalyzer), size and SHA-256.
# 2. Creates the GitHub Release v<version>-testnet on Jagadeeshftw/mirror with the notes file (size and hash appended)
#    and the APK attached (as mirror-<version>-testnet.apk).
# 3. Writes web/public/release.json (available, version, versionCode, size, sha256, url = the release asset, date).
# The site picks it up on its next deploy (web/scripts/deploy.sh).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APK="$1"
NOTES="$2"
[ -f "$APK" ] && [ -f "$NOTES" ] || { echo "usage: publish-apk.sh <apk> <notes.md>" >&2; exit 1; }
REPO="Jagadeeshftw/mirror"

export JAVA_HOME="${JAVA_HOME:-/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home}"
export ANDROID_HOME="${ANDROID_HOME:-/opt/homebrew/share/android-commandlinetools}"
command -v apkanalyzer >/dev/null || { echo "apkanalyzer not found (Android SDK cmdline-tools)" >&2; exit 1; }
VERSION="$(apkanalyzer manifest version-name "$APK")"
CODE="$(apkanalyzer manifest version-code "$APK")"
PKG="$(apkanalyzer manifest application-id "$APK")"
[ "$PKG" = "com.zeroxo.mirror" ] || { echo "unexpected package $PKG" >&2; exit 1; }
SIZE="$(stat -f %z "$APK")"
SHA="$(shasum -a 256 "$APK" | cut -d' ' -f1)"
TAG="v${VERSION}-testnet"
ASSET="mirror-${VERSION}-testnet.apk"
DATE="$(date -u +%Y-%m-%d)"
echo "apk $PKG $VERSION ($CODE), $SIZE bytes, sha256 $SHA"

TMP="$(mktemp -d)"
cp "$APK" "$TMP/$ASSET"
{ cat "$NOTES"; printf '\n\n---\n\n- File: `%s`\n- Version: %s (versionCode %s)\n- Size: %s bytes\n- SHA-256: `%s`\n' "$ASSET" "$VERSION" "$CODE" "$SIZE" "$SHA"; } > "$TMP/notes.md"

export GH_TOKEN="$(gh auth token --user Jagadeeshftw)"
if gh release view "$TAG" --repo "$REPO" >/dev/null 2>&1; then
  gh release upload "$TAG" "$TMP/$ASSET" --repo "$REPO" --clobber
  gh release edit "$TAG" --repo "$REPO" --notes-file "$TMP/notes.md"
else
  gh release create "$TAG" "$TMP/$ASSET" --repo "$REPO" --title "Mirror $VERSION (Monad testnet beta)" --notes-file "$TMP/notes.md" --prerelease --target main
fi
URL="https://github.com/$REPO/releases/download/$TAG/$ASSET"

# Check the published asset is byte-identical before pointing the site at it.
curl -sL "$URL" -o "$TMP/check.apk"
[ "$(shasum -a 256 "$TMP/check.apk" | cut -d' ' -f1)" = "$SHA" ] || { echo "published asset hash differs" >&2; exit 1; }

node -e '
  const [f, version, code, size, sha, url, date] = process.argv.slice(1);
  const r = { available: true, version, channel: "testnet beta", versionCode: Number(code), size: Number(size), sha256: sha, url, date };
  require("fs").writeFileSync(f, JSON.stringify(r, null, 2) + "\n");
' "$ROOT/web/public/release.json" "$VERSION" "$CODE" "$SIZE" "$SHA" "$URL" "$DATE"
rm -rf "$TMP"
echo "published $URL; wrote web/public/release.json"
