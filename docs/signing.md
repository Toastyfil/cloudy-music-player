# Code signing

Bitdefender, SmartScreen and Gatekeeper all judge Cloudy by its signature. An
unsigned build is an unknown publisher, so antivirus heuristics lean towards
flagging it — especially because Cloudy is an app that downloads and installs
its own updates. Signing the executables is what makes those warnings stop.

The release workflow already signs when the certificates are present and builds
unsigned (with a notice in the log) when they are not.

## Windows

You need an Authenticode certificate, from a CA or from Azure Trusted Signing.
An **OV** certificate works and is cheaper; **EV** certificates get SmartScreen
reputation immediately, OV builds it over weeks.

### Azure Trusted Signing (no certificate file, ~10 €/month)

Set these repository secrets and nothing else — the workflow's
"Configure code signing" step writes `win.azureSignOptions` before packaging,
and electron-builder signs `cloudy.exe` and the installer through Trusted
Signing:

| Secret | Value |
| --- | --- |
| `AZURE_TENANT_ID` | Entra ID tenant of the service principal |
| `AZURE_CLIENT_ID` | service principal application ID |
| `AZURE_CLIENT_SECRET` | service principal secret |
| `AZURE_TRUSTED_SIGNING_ENDPOINT` | account endpoint, e.g. `https://eus.codesigning.azure.net/` |
| `AZURE_TRUSTED_SIGNING_ACCOUNT` | Trusted Signing account name |
| `AZURE_TRUSTED_SIGNING_PROFILE` | certificate profile name |
| `AZURE_TRUSTED_SIGNING_PUBLISHER` | certificate subject, e.g. `CN=Your Name, O=Your Company, C=DE` |

The service principal needs the *Trusted Signing Certificate Profile Signer*
role on the account. Locally:

```sh
AZURE_TENANT_ID=… AZURE_CLIENT_ID=… AZURE_CLIENT_SECRET=… \
AZURE_TRUSTED_SIGNING_ENDPOINT=… AZURE_TRUSTED_SIGNING_ACCOUNT=… \
AZURE_TRUSTED_SIGNING_PROFILE=… AZURE_TRUSTED_SIGNING_PUBLISHER="CN=…" \
  node scripts/azure-signing.mjs && npx electron-builder --win nsis
```

Both paths are optional: with no secrets the workflow builds an unsigned
installer and says so in the log.

### PFX certificate

1. Export the certificate as a `.pfx` with its password.
2. Base64-encode it:

   ```sh
   # macOS / Linux
   base64 -w 0 certificate.pfx > certificate.b64

   # Windows PowerShell
   [Convert]::ToBase64String([IO.File]::ReadAllBytes("certificate.pfx")) | Set-Content certificate.b64
   ```

3. Add the repository secrets:

   | Secret | Value |
   | --- | --- |
   | `WIN_CSC_LINK` | contents of `certificate.b64` |
   | `WIN_CSC_KEY_PASSWORD` | the `.pfx` password |

electron-builder signs `cloudy.exe` and the NSIS installer during packaging.
Verify a build with:

```powershell
Get-AuthenticodeSignature .\release\Cloudy-1.2.0-setup.exe | Format-List Status, SignerCertificate
```

## macOS

You need a paid Apple Developer account.

1. Create a **Developer ID Application** certificate in the Apple Developer
   portal and install it in Keychain, then export it as `.p12` with a password.
2. Base64-encode the `.p12` the same way as above.
3. Create an app-specific password for your Apple ID (appleid.apple.com).
4. Add the repository secrets:

   | Secret | Value |
   | --- | --- |
   | `APPLE_CERTIFICATE` | contents of the base64 `.p12` |
   | `APPLE_CERTIFICATE_PASSWORD` | the `.p12` password |
   | `APPLE_ID` | your Apple ID email |
   | `APPLE_APP_SPECIFIC_PASSWORD` | the app-specific password |
   | `APPLE_TEAM_ID` | your 10-character team ID |

The build runs with the hardened runtime and `build/entitlements.mac.plist`,
then `scripts/notarize.mjs` submits the app to Apple when the three notarization
variables are set. Verify with:

```sh
codesign --verify --deep --strict --verbose=2 Cloudy.app
spctl --assess --type execute --verbose=4 Cloudy.app
```

## What signing does and does not fix

- It removes "unknown publisher" warnings and gives the binaries a reputable
  publisher, which is what antivirus heuristics key on.
- A brand-new certificate still has no reputation, so the first releases can
  trip heuristics while the publisher builds trust. EV certificates skip that
  wait on Windows.
- If Bitdefender still quarantines a specific file, submit it as a false
  positive (bitdefender.com → Support → False positive) with the file's SHA-256.
  The release notes list the checksums of every artifact.
