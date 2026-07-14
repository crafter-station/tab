# Tab macOS Release Checklist

This checklist covers producing a signed, notarized, direct-download macOS build of Tab and verifying the end-to-end install, launch, onboarding, and update path.

## Prerequisites

- macOS machine with Xcode command-line tools.
- Valid Apple Developer ID Application certificate installed in Keychain Access.
- Apple ID, app-specific password, and Team ID for notarization.
- `TAB_MAC_DOWNLOAD_URL` and `TAB_DESKTOP_LATEST_VERSION` set for the web surface.

For GitHub releases, configure these Actions secrets:

- `MACOS_CERTIFICATE`: base64-encoded Developer ID Application `.p12` certificate.
- `MACOS_CERTIFICATE_PASSWORD`: password for the `.p12` certificate.
- `APPLE_API_KEY`: contents of the App Store Connect API key `.p8` file.
- `APPLE_API_KEY_ID`: the API key id.
- `APPLE_API_ISSUER`: the API key issuer uuid.

## Environment variables

Local releases read credentials from `apps/desktop/.env` (gitignored):

```sh
APPLE_API_KEY="./AuthKey_<id>.p8"   # App Store Connect API key, next to .env
APPLE_API_KEY_ID="<key id>"
APPLE_API_ISSUER="<issuer uuid>"
GH_TOKEN="<PAT with Contents: write on crafter-station/tab>"
```

For the web surface, also set `TAB_MAC_DOWNLOAD_URL` and `TAB_DESKTOP_LATEST_VERSION`.

## Build and package

1. Install dependencies:
   ```sh
   bun install
   ```
2. Run type checks and tests:
   ```sh
   bun run typecheck
   bun run test
   ```
3. Build and package the macOS app:
   ```sh
   cd apps/desktop
   bun run dist:mac
   ```
4. Verify artifacts exist in `apps/desktop/release/`:
   - `Tab-0.1.0-universal.dmg`
   - `Tab-0.1.0-universal.zip`

## Signing and notarization

- The `electron-builder.yml` sets `hardenedRuntime: true`, `gatekeeperAssess: false`, `notarize: true`, and points to `build/entitlements.mac.plist`.
- The entitlements file intentionally does **not** request Screen Recording (`kTCCServiceScreenCapture`) or Full Disk Access (`kTCCServiceSystemPolicyAllFiles`).
- electron-builder's built-in notarization uses the App Store Connect API key credentials `APPLE_API_KEY`/`APPLE_API_KEY_ID`/`APPLE_API_ISSUER` — locally from `apps/desktop/.env`, in CI from the Actions secrets (the workflow writes `APPLE_API_KEY_CONTENT` to a temp `.p8` file).
- If credentials are missing, electron-builder logs a warning and skips notarization so local builds still succeed. Note that bare `bun run dist:mac` does NOT pass `.env` through to electron-builder — use `scripts/build-signed.sh` (build only) or `scripts/build-and-upload.sh` (build + publish), which source `.env` explicitly.
- Stapling happens automatically after notarization.
- Verify code signature and notarization:
  ```sh
  codesign -dv --verbose=4 "release/mac-universal/Tab.app"
  spctl -a -v "release/mac-universal/Tab.app"
  xcrun stapler validate "release/mac-universal/Tab.app"
  ```

## Download surface

1. Upload the universal DMG as both its versioned filename and `Tab.dmg`. The stable production URL is `https://github.com/crafter-station/tab/releases/latest/download/Tab.dmg`.
2. Confirm the web download page shows the current version:
   ```sh
   curl -I https://tab.app/download/tab.dmg
   # Expected: 302 redirect to the artifact URL
   ```
3. Confirm the desktop update feed is reachable:
   ```sh
   curl https://tab.app/download/latest.json
   # Expected: { "version": "0.1.0", "url": "...", "notes": "" }
   ```

## Install, launch, and onboarding

1. Download `Tab.dmg` from `/download/tab.dmg` on a clean macOS machine.
2. Open the DMG and drag `Tab.app` to `/Applications`.
3. Launch Tab from `/Applications`.
4. Onboarding should appear and explain:
   - Accessibility is needed to paste accepted suggestions.
   - Input Monitoring is needed to observe typing context and Option+Tab.
   - Screen Recording and Full Disk Access are **not** requested.
5. Complete onboarding and verify the tray icon appears.

## Runtime verification

- Type in TextEdit, Notes, Mail, Slack, and Ghostty; confirm the suggestion overlay appears after a pause.
- Accept a suggestion with Option+Tab and by clicking the overlay.
- Confirm suggestions hide on app switch, secure input, and pause.
- Confirm pause/resume works from the tray menu.
- Confirm sign-in via browser handoff completes and the device appears in the web account surface.

## Update behavior

1. Publish a new version by updating `apps/desktop/package.json`. Update `TAB_DESKTOP_LATEST_VERSION` separately for the public web download feed.
2. Confirm the GitHub release contains the DMG, ZIP, ZIP blockmap, and `latest-mac.yml`. The release workflow publishes these together from a draft.
3. Launch the previous installed build and select **Check for Updates** from the tray menu (or wait for the periodic hourly check).
4. Confirm the tray and **Settings > Updates** show the new version without downloading it automatically.
5. Select **Download Update**, confirm progress appears, and keep using the app while the ZIP downloads.
6. Select **Restart and Install**, then confirm Tab relaunches on the new version. Also verify that postponing the restart installs the downloaded update on the next normal quit.
7. Confirm the public download page still links to the stable `Tab.dmg` asset and `/download/latest.json` reports the current public version.

## Post-release

- Tag the release in Git.
- Attach the DMG and ZIP artifacts to the GitHub release notes.
- Note any blockers or follow-ups in the release issue.

## Publishing a release

There are two publish paths. Both end with a GitHub Release `v<version>` on `crafter-station/tab` containing the DMG, ZIP, blockmap, `latest-mac.yml`, the stable `Tab.dmg` alias, and `SHA256SUMS.txt`.

### From a dev machine (default)

1. Bump the patch version in `apps/desktop/package.json`, commit, and push to `main`.
2. Run:
   ```sh
   apps/desktop/scripts/build-and-upload.sh
   ```
   It builds, signs, notarizes, publishes via `electron-builder --publish always`, verifies the signed app, and uploads the `Tab.dmg` alias and checksums. Credentials come from `apps/desktop/.env`.
3. The tag push fires `.github/workflows/release-desktop.yml`, whose guard job detects the existing release and skips the CI build.

### From CI

After the required Actions secrets are configured, publish by pushing a tag that matches the desktop package version:

```sh
git tag v0.1.0
git push origin v0.1.0
```

`.github/workflows/release-desktop.yml` validates the tag, runs the full checks, builds a universal app, signs and notarizes it, verifies Gatekeeper and stapling, creates a draft GitHub release with the installer and updater metadata, and publishes the release only after every asset uploads. Missing signing secrets fail the workflow before packaging or publishing.
