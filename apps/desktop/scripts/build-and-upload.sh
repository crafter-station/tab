#!/bin/bash
set -euo pipefail

# Build, sign, notarize, and publish the macOS desktop app as a GitHub
# Release on this repo: github.com/crafter-station/tab
#
# electron-builder's github publish provider creates a GitHub Release
# (tag v<version>) and uploads the dmg, zip, blockmaps, and latest-mac.yml
# as release ASSETS. The auto-updater (electron-updater) reads
# latest-mac.yml straight from the public repo's releases, so no token is
# needed by clients. Afterwards this script uploads a version-less
# `Tab.dmg` alias (stable download URL for the website) and SHA256SUMS.txt.
#
# Stable download URL:
#   https://github.com/crafter-station/tab/releases/latest/download/Tab.dmg
#
# Requires in apps/desktop/.env:
#   APPLE_API_KEY        path to the App Store Connect AuthKey_<id>.p8
#   APPLE_API_KEY_ID     the key id
#   APPLE_API_ISSUER     the issuer uuid
#   GH_TOKEN             PAT with Contents: write on crafter-station/tab
#
# The .env must be sourced here explicitly: electron-builder runs as a
# subprocess that does not inherit Bun's automatic .env loading.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DESKTOP_DIR="$(dirname "$SCRIPT_DIR")"
cd "$DESKTOP_DIR"

if [ -f .env ]; then
  set -a
  source .env
  set +a
else
  echo "ERROR: .env file not found in $DESKTOP_DIR"
  exit 1
fi

for var in APPLE_API_KEY APPLE_API_KEY_ID APPLE_API_ISSUER GH_TOKEN; do
  if [ -z "${!var:-}" ]; then
    echo "ERROR: $var is not set"
    exit 1
  fi
done

VERSION=$(bun -p 'require("./package.json").version')
echo "==> Version: $VERSION"

if gh release view "v${VERSION}" --repo crafter-station/tab >/dev/null 2>&1; then
  echo "ERROR: release v${VERSION} already exists. Bump the version in apps/desktop/package.json first."
  exit 1
fi

echo "==> Building, signing, notarizing, and publishing to crafter-station/tab..."
# --publish always: upload artifacts to the GitHub Release even on a clean build.
bun run dist:mac -- --publish always

APP="release/mac-universal/Tab.app"
echo "==> Verifying signature, notarization, and architectures..."
codesign --verify --deep --strict --verbose=2 "$APP"
spctl --assess --type execute --verbose=2 "$APP"
xcrun stapler validate "$APP"
lipo -archs "$APP/Contents/Resources/app.asar.unpacked/dist/macos-input-tap" | grep -q "x86_64 arm64"

echo "==> Uploading stable Tab.dmg alias and checksums..."
cp "release/Tab-${VERSION}-universal.dmg" "release/Tab.dmg"
(cd release && shasum -a 256 \
  "Tab.dmg" \
  "Tab-${VERSION}-universal.dmg" \
  "Tab-${VERSION}-universal.zip" \
  "Tab-${VERSION}-universal.zip.blockmap" \
  "latest-mac.yml" \
  > SHA256SUMS.txt)
gh release upload "v${VERSION}" --repo crafter-station/tab --clobber \
  "release/Tab.dmg" \
  "release/SHA256SUMS.txt"

# electron-builder creates the release as a DRAFT (see electron-builder.yml).
# Publishing it here is what creates the v<version> tag on the repo.
echo "==> Publishing the draft release..."
gh release edit "v${VERSION}" --repo crafter-station/tab --draft=false

echo ""
echo "==> Published GitHub Release: https://github.com/crafter-station/tab/releases/tag/v${VERSION}"
echo "==> Download URL: https://github.com/crafter-station/tab/releases/latest/download/Tab.dmg"
