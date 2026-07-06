const { notarize } = require("@electron/notarize");

/**
 * electron-builder afterSign hook for macOS notarization.
 *
 * Notarization is skipped when the required Apple credentials are not present,
 * so local/test builds do not fail. Production release builds must set:
 *   APPLE_ID
 *   APPLE_APP_SPECIFIC_PASSWORD
 *   APPLE_TEAM_ID
 */
module.exports = async function notarizing(context) {
  const { electronPlatformName, appOutDir } = context;

  if (electronPlatformName !== "darwin") {
    return;
  }

  const appName = context.packager.appInfo.productFilename;
  const appPath = `${appOutDir}/${appName}.app`;

  const appleId = process.env.APPLE_ID;
  const appleIdPassword = process.env.APPLE_APP_SPECIFIC_PASSWORD;
  const teamId = process.env.APPLE_TEAM_ID;

  if (!appleId || !appleIdPassword || !teamId) {
    console.warn(
      "Skipping notarization: APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, and APPLE_TEAM_ID must all be set.",
    );
    return;
  }

  console.log(`Notarizing ${appPath} ...`);

  await notarize({
    appBundleId: "app.tabb.desktop",
    appPath,
    appleId,
    appleIdPassword,
    teamId,
  });

  console.log("Notarization complete.");
};
