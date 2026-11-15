#!/usr/bin/env node
/**
 * Signed Windows build.
 *
 *   npm run dist:win:signed          # certificates/cloudy.pfx, or CSC_LINK + CSC_KEY_PASSWORD
 *   npm run dist:win:signed -- --dev # throwaway self-signed cert, to prove the pipeline works
 *
 * SmartScreen trusts a certificate that chains to a public CA and has picked up
 * download reputation. No build flag replaces that: an unsigned installer always
 * shows "Windows protected your PC", and a self-signed one looks *less* trusted,
 * not more. Put the real certificate in certificates/cloudy.pfx (git-ignored) or
 * export CSC_LINK and CSC_KEY_PASSWORD in the environment.
 *
 * Azure Trusted Signing also works with electron-builder 26 via win.azureSignOptions;
 * set that block in package.json instead of using this script's PFX path.
 */
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const dev = process.argv.includes('--dev');
const certDir = path.join(root, 'certificates');
const defaultPfx = path.join(certDir, 'cloudy.pfx');
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';

function fail(message) {
  console.error(`\n${message}\n`);
  process.exit(1);
}

function run(command, args, env = process.env) {
  console.log(`\n> ${command} ${args.join(' ')}`);
  // .cmd shims (npx) can only be spawned through a shell on Windows.
  if (process.platform === 'win32' && /\.cmd$/i.test(command)) {
    const line = [command, ...args.map((arg) => (/\s/.test(arg) ? `"${arg}"` : arg))].join(' ');
    const result = spawnSync(line, { stdio: 'inherit', env, cwd: root, shell: true });
    if (result.error) fail(result.error.message);
    if (result.status !== 0) process.exit(result.status ?? 1);
    return;
  }
  const result = spawnSync(command, args, { stdio: 'inherit', env, cwd: root });
  if (result.error) fail(result.error.message);
  if (result.status !== 0) process.exit(result.status ?? 1);
}

let certLink = process.env.WIN_CSC_LINK || process.env.CSC_LINK || (fs.existsSync(defaultPfx) ? defaultPfx : '');
let certPassword = process.env.WIN_CSC_KEY_PASSWORD || process.env.CSC_KEY_PASSWORD || '';

if (dev) {
  fs.mkdirSync(certDir, { recursive: true });
  const target = path.join(certDir, 'cloudy-dev.pfx');
  const password = crypto.randomBytes(18).toString('base64url');
  const scriptFile = path.join(certDir, 'make-dev-cert.ps1');
  const escapedTarget = target.replace(/'/g, "''");
  const escapedPassword = password.replace(/'/g, "''");
  fs.writeFileSync(
    scriptFile,
    [
      "$ErrorActionPreference = 'Stop'",
      "$cert = New-SelfSignedCertificate -Type CodeSigningCert -Subject 'CN=Cloudy Development, O=Cloudy' -CertStoreLocation 'Cert:\\CurrentUser\\My' -KeyExportPolicy Exportable -KeyUsage DigitalSignature -NotAfter (Get-Date).AddYears(2)",
      `$password = ConvertTo-SecureString -String '${escapedPassword}' -Force -AsPlainText`,
      `Export-PfxCertificate -Cert $cert -FilePath '${escapedTarget}' -Password $password | Out-Null`,
      'Remove-Item "Cert:\\CurrentUser\\My\\$($cert.Thumbprint)"',
      '',
    ].join('\n'),
    'utf8',
  );
  run('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptFile]);
  fs.rmSync(scriptFile, { force: true });
  certLink = target;
  certPassword = password;
  console.log('\nSelf-signed dev certificate created — the pipeline is signed, Windows still will not trust it.');
} else if (!certLink) {
  fail(
    'No signing certificate found.\n' +
      'Put a .pfx at certificates/cloudy.pfx, or set CSC_LINK and CSC_KEY_PASSWORD.\n' +
      'Use --dev to exercise the pipeline with a throwaway self-signed certificate.',
  );
}

const env = { ...process.env, CSC_LINK: certLink, CSC_KEY_PASSWORD: certPassword };
run(npx, ['tsc', '-b']);
run(npx, ['vite', 'build']);
run(npx, ['electron-builder', '--win', 'nsis', '--publish', 'never', '-c.npmRebuild=false'], env);
console.log(`\nInstaller: ${path.join(root, 'release', 'Cloudy-1.0.0-setup.exe')}`);
