const { notarize } = require("@electron/notarize");

/**
 * electron-builder afterSign hook for macOS notarization.
 *
 * Notarization is skipped when the required Apple credentials are not present,
 * so local/test builds do not fail. Production release builds use either an
 * App Store Connect API key or Apple ID credentials.
 */
module.exports = async function notarizing(context) {
  const { electronPlatformName, appOutDir } = context;

  if (electronPlatformName !== "darwin") {
    return;
  }

  const appName = context.packager.appInfo.productFilename;
  const appPath = `${appOutDir}/${appName}.app`;

  const apiKey = process.env.APPLE_API_KEY;
  const apiKeyId = process.env.APPLE_API_KEY_ID;
  const apiIssuer = process.env.APPLE_API_ISSUER;
  const appleId = process.env.APPLE_ID;
  const appleIdPassword = process.env.APPLE_APP_SPECIFIC_PASSWORD;
  const teamId = process.env.APPLE_TEAM_ID;
  const apiKeyCredentials = apiKey && apiKeyId
    ? {
        appleApiKey: apiKey,
        appleApiKeyId: apiKeyId,
        ...(apiIssuer && { appleApiIssuer: apiIssuer }),
      }
    : undefined;
  const passwordCredentials = appleId && appleIdPassword && teamId
    ? { appleId, appleIdPassword, teamId }
    : undefined;

  if (!apiKeyCredentials && !passwordCredentials) {
    console.warn(
      "Skipping notarization: configure APPLE_API_KEY and APPLE_API_KEY_ID, or Apple ID credentials.",
    );
    return;
  }

  console.log(`Notarizing ${appPath} ...`);

  await notarize({
    appBundleId: "app.tab.desktop",
    appPath,
    ...(apiKeyCredentials ?? passwordCredentials),
  });

  console.log("Notarization complete.");
};
