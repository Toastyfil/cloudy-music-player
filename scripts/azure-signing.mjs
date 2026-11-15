#!/usr/bin/env node
/**
 * Azure Trusted Signing for the Windows build.
 *
 * Runs before electron-builder: when the signing secrets are present it writes
 * `build.win.azureSignOptions` into package.json, which switches electron-builder
 * from signtool to Trusted Signing. Without the secrets it does nothing and the
 * installer stays unsigned, so a fork or a fresh clone still builds.
 *
 * Required secrets: AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET,
 * AZURE_TRUSTED_SIGNING_ENDPOINT, AZURE_TRUSTED_SIGNING_ACCOUNT,
 * AZURE_TRUSTED_SIGNING_PROFILE, AZURE_TRUSTED_SIGNING_PUBLISHER.
 *
 * The endpoint is the account's regional URI, e.g.
 * https://eus.codesigning.azure.net/. The publisher must match the certificate
 * profile's subject exactly ("CN=Your Name, O=Your Company, ...").
 *
 *   node scripts/azure-signing.mjs && npx electron-builder --win nsis
 */
import fs from 'node:fs';
import path from 'node:path';

const pkgPath = path.join(process.cwd(), 'package.json');
const env = process.env;

const variables = {
  AZURE_TENANT_ID: 'Azure AD tenant',
  AZURE_CLIENT_ID: 'service principal application ID',
  AZURE_CLIENT_SECRET: 'service principal secret',
  AZURE_TRUSTED_SIGNING_ENDPOINT: 'Trusted Signing account endpoint',
  AZURE_TRUSTED_SIGNING_ACCOUNT: 'Trusted Signing account name',
  AZURE_TRUSTED_SIGNING_PROFILE: 'certificate profile name',
  AZURE_TRUSTED_SIGNING_PUBLISHER: 'publisher name from the certificate',
};

const missing = Object.entries(variables)
  .filter(([name]) => !env[name]?.trim())
  .map(([name]) => name);

if (missing.length > 0) {
  // A half-configured pipeline must not quietly ship an unsigned installer.
  const started = Object.keys(variables).some((name) => env[name]?.trim());
  if (started) {
    console.error(`Azure Trusted Signing is partially configured. Missing:\n  ${missing.join('\n  ')}`);
    process.exit(1);
  }
  console.log('::notice::Azure Trusted Signing is not configured - the installer stays unsigned.');
  process.exit(0);
}

const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
pkg.build ??= {};
pkg.build.win ??= {};
pkg.build.win.azureSignOptions = {
  publisherName: env.AZURE_TRUSTED_SIGNING_PUBLISHER.trim(),
  endpoint: env.AZURE_TRUSTED_SIGNING_ENDPOINT.trim(),
  codeSigningAccountName: env.AZURE_TRUSTED_SIGNING_ACCOUNT.trim(),
  certificateProfileName: env.AZURE_TRUSTED_SIGNING_PROFILE.trim(),
};
fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
console.log(
  `::notice::Signing with Azure Trusted Signing (${pkg.build.win.azureSignOptions.endpoint}, profile ${pkg.build.win.azureSignOptions.certificateProfileName}).`,
);
