import { notarize } from '@electron/notarize';

/**
 * Runs after electron-builder signs the macOS app. Without the Apple
 * credentials a build stays unsigned (and unnotarised) instead of failing, so
 * local and fork builds keep working.
 */
export default async function notarizeApp(context) {
  const { electronPlatformName, appOutDir, packager } = context;
  if (electronPlatformName !== 'darwin') return;

  const appleId = process.env.APPLE_ID;
  const appleIdPassword = process.env.APPLE_APP_SPECIFIC_PASSWORD;
  const teamId = process.env.APPLE_TEAM_ID;
  if (!appleId || !appleIdPassword || !teamId) {
    console.log('[notarize] Apple credentials not set — skipping notarization.');
    return;
  }

  const appName = packager.appInfo.productFilename;
  const appPath = `${appOutDir}/${appName}.app`;
  console.log(`[notarize] submitting ${appPath}`);
  await notarize({ appPath, appleId, appleIdPassword, teamId });
  console.log('[notarize] done');
}
