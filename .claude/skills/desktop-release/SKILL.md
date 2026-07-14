---
name: desktop-release
description: Ship a new version of the Tab macOS desktop app — bump version, build, sign, notarize, and publish to GitHub Releases on crafter-station/tab. Use when the user says "release the desktop app", "ship a new version", "publish tab", "desktop release", or "bump and release".
---

# Tab Desktop Release

Ship a signed, notarized macOS build of Tab as a GitHub Release on the
public repo `crafter-station/tab` (releases live in the SAME repo as the
source). Two paths exist:

## Path A: Ship from this machine (default, maca-style)

1. **Bump the version** in `apps/desktop/package.json`. Pre-v1 we bump the
   patch version (`0.1.0` → `0.1.1` → `0.1.2` ...). Do NOT jump to `1.0.0`
   until explicitly decided.
2. **Commit and push** the version bump to `main` first, so the release tag
   (created on the default branch HEAD) points at the built code.
3. **Run the ship script**:
   ```sh
   apps/desktop/scripts/build-and-upload.sh
   ```
   This builds a universal app, signs it with the Developer ID certificate
   in the keychain, notarizes via the App Store Connect API key, publishes
   the GitHub Release `v<version>` (dmg, zip, blockmaps, `latest-mac.yml`),
   verifies signature/stapling/architectures, and uploads the stable
   `Tab.dmg` alias plus `SHA256SUMS.txt`.
4. **The CI workflow will fire** on the new `v*` tag but its guard job sees
   the release already exists and skips — a skipped run is expected, not a
   failure.
5. **Verify**: `https://github.com/crafter-station/tab/releases/latest/download/Tab.dmg`
   downloads, and an older installed build offers the update (tray →
   Check for Updates).

## Path B: Ship from CI

Push a tag matching the desktop version and let
`.github/workflows/release-desktop.yml` build, sign, notarize, and publish:

```sh
git tag v<version> && git push origin v<version>
```

All required Actions secrets are configured (as of 2026-07-14):
`MACOS_CERTIFICATE`, `MACOS_CERTIFICATE_PASSWORD`, `APPLE_API_KEY`,
`APPLE_API_KEY_ID`, `APPLE_API_ISSUER`.

IMPORTANT: when shipping via CI, do NOT also run the local ship script for
the same version — the guard job skips CI whenever the release already
exists, so a local publish silently preempts the CI run (and vice versa,
the local script refuses to run once CI has published).

## Credentials (Path A)

`apps/desktop/.env` (gitignored) must contain:

- `APPLE_API_KEY` — path to the App Store Connect `AuthKey_<id>.p8` (also
  gitignored, sits next to the .env)
- `APPLE_API_KEY_ID`, `APPLE_API_ISSUER` — the key id and issuer uuid
- `GH_TOKEN` — PAT with `Contents: write` on `crafter-station/tab`

Signing uses the "Developer ID Application: KEBO SOFWARE S A S (477PL8P3CL)"
certificate from the login keychain (auto-discovered by electron-builder).

## Troubleshooting

- `The timestamp service is not available` from codesign — Apple's
  timestamp server flaked; just re-run the script.
- `skipped macOS notarization: notarize options were unable to be
  generated` — the `APPLE_API_*` env vars didn't reach electron-builder;
  run via the ship script (it sources `.env` explicitly), not bare
  `bun run dist:mac`.
- Release already exists — bump the version; the script refuses to
  overwrite an existing release.

See `docs/release-checklist.md` for the full manual verification checklist
(install, onboarding, permissions, update flow).
