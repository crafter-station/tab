#!/bin/bash
set -euo pipefail

# Build, sign, and notarize the macOS desktop app.
#
# Signing uses the "Developer ID Application" certificate in the login
# keychain (auto-discovered by electron-builder). Notarization uses an
# App Store Connect API key configured in apps/desktop/.env:
#   APPLE_API_KEY        path to the AuthKey_<id>.p8 file
#   APPLE_API_KEY_ID     the key id
#   APPLE_API_ISSUER     the issuer uuid
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

for var in APPLE_API_KEY APPLE_API_KEY_ID APPLE_API_ISSUER; do
  if [ -z "${!var:-}" ]; then
    echo "ERROR: $var is not set"
    exit 1
  fi
done

bun run dist:mac "$@"
