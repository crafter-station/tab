# Tab macOS Release Checklist

This checklist covers producing a signed, notarized, direct-download macOS build of Tab and verifying the end-to-end install, launch, onboarding, and update path.

## Prerequisites

- macOS machine with Xcode command-line tools.
- Valid Apple Developer ID Application certificate installed in Keychain Access.
- Apple ID, app-specific password, and Team ID for notarization.
- `TAB_MAC_DOWNLOAD_URL` and `TAB_DESKTOP_LATEST_VERSION` set for the web surface.

## Environment variables

```sh
export APPLE_ID="developer@example.com"
export APPLE_APP_SPECIFIC_PASSWORD="xxxx-xxxx-xxxx-xxxx"
export APPLE_TEAM_ID="TEAM_ID"
export TAB_MAC_DOWNLOAD_URL="https://downloads.tab.app/Tab-0.1.0.dmg"
export TAB_DESKTOP_LATEST_VERSION="0.1.0"
```

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
   - `Tab-0.1.0-x64.dmg`
   - `Tab-0.1.0-arm64.dmg`
   - `Tab-0.1.0-x64.zip`
   - `Tab-0.1.0-arm64.zip`

## Signing and notarization

- The `electron-builder.yml` sets `hardenedRuntime: true`, `gatekeeperAssess: false`, and points to `build/entitlements.mac.plist`.
- The entitlements file intentionally does **not** request Screen Recording (`kTCCServiceScreenCapture`) or Full Disk Access (`kTCCServiceSystemPolicyAllFiles`).
- The `scripts/notarize.cjs` afterSign hook notarizes the `.app` when `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, and `APPLE_TEAM_ID` are present.
- If credentials are missing, the hook logs a warning and skips notarization so local builds still succeed.
- After packaging, staple the app:
  ```sh
  xcrun stapler staple "release/mac/Tab.app"
  ```
- Verify code signature:
  ```sh
  codesign -dv --verbose=4 "release/mac/Tab.app"
  spctl -a -v "release/mac/Tab.app"
  ```

## Download surface

1. Upload the DMG artifact to the location configured in `TAB_MAC_DOWNLOAD_URL`.
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

1. Publish a new version by updating `apps/desktop/package.json` version and `TAB_DESKTOP_LATEST_VERSION`.
2. Build and upload the new DMG to `TAB_MAC_DOWNLOAD_URL`.
3. Launch the old build and select **Check for Updates** from the tray menu (or wait for the periodic hourly check).
4. The tray should show **Update Available**; selecting it opens `/download` in the default browser.
5. Confirm the download page links to the latest DMG and that `/download/latest.json` returns the new version.

## Post-release

- Tag the release in Git.
- Attach the DMG and ZIP artifacts to the GitHub release notes.
- Note any blockers or follow-ups in the release issue.
