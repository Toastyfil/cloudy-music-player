# Signing and notarizing the macOS build

The macOS DMGs from `macos-dmg.yml` are unsigned by default, so Gatekeeper shows
“Cloudy can’t be opened because Apple cannot check it for malicious software”.
Fixing that needs an **Apple Developer Program** membership (99 USD/year) and a
**Developer ID Application** certificate — there is no way to sign or notarize an
app without one.

Once the secrets below exist on the repository, the same workflow signs and
notarizes automatically. No code change is needed.

## 1. Create the certificate

1. In the Apple Developer portal, create a **Developer ID Application**
   certificate (Certificates → + → Developer ID Application). An Account Holder
   or Admin must do this.
2. Download it and install it in your Mac's login keychain.
3. Export it from Keychain Access as a `.p12` **with a password** — you need the
   private key, so export the certificate *and* its key, not just the cert file.
4. Base64-encode it so it can live in a secret:

   ```sh
   base64 -i DeveloperID.p12 | pbcopy      # macOS, copies to clipboard
   ```

## 2. Create an app-specific password

Notarization needs an Apple ID with two-factor authentication and an
app-specific password: <https://appleid.apple.com> → Sign-In and Security →
App-Specific Passwords. Save the generated password; the Apple ID itself and
your **Team ID** (Membership page, 10 characters) are the other two values.

## 3. Add the repository secrets

GitHub → the `glow` repo → Settings → Secrets and variables → Actions → **New
repository secret**:

| Secret | Value |
| --- | --- |
| `APPLE_CERTIFICATE` | the base64 `.p12` from step 1 |
| `APPLE_CERTIFICATE_PASSWORD` | the password you set when exporting it |
| `APPLE_ID` | your Apple ID email |
| `APPLE_APP_SPECIFIC_PASSWORD` | the password from step 2 |
| `APPLE_TEAM_ID` | your 10-character Team ID |

Or from a terminal, which keeps the values out of shell history and chat:

```sh
gh secret set APPLE_CERTIFICATE < DeveloperID.p12.b64
gh secret set APPLE_CERTIFICATE_PASSWORD
gh secret set APPLE_ID
gh secret set APPLE_APP_SPECIFIC_PASSWORD
gh secret set APPLE_TEAM_ID
```

`gh secret set` prompts for the value (or reads stdin), so nothing is echoed.

## 4. Build

Push a tag or run the workflow manually:

```sh
git tag v1.0.1 && git push origin v1.0.1
```

With `APPLE_CERTIFICATE` present, electron-builder imports the certificate into a
temporary keychain, signs the app with the hardened runtime, and notarizes it
via `notarytool` using the Apple ID credentials. The workflow then verifies the
result with `codesign --verify --deep --strict` and `spctl --assess`, which is the
same check Gatekeeper performs.

Notarization talks to Apple's service, so the job takes a few extra minutes.
Without the secrets the workflow logs a notice and produces an unsigned DMG.

## Notes

- The `.p12` and its password are signing keys. Keep them in GitHub secrets (or a
  password manager), never in the repository.
- `APPLE_API_KEY`, `APPLE_API_KEY_ID` and `APPLE_API_ISSUER` (an App Store
  Connect API key) are supported by electron-builder as an alternative to the
  Apple ID trio and avoid storing an app-specific password. The key is a `.p8`
  file, so CI has to write it to disk from a secret before building.
- A signed DMG is a signed app inside an unsigned disk image. Gatekeeper checks
  the app, so launching works; if you also want the `.dmg` itself signed, pass
  `--mac dmg` with signing enabled — electron-builder signs the image too.
- An unsigned local build can still be opened once with right-click → Open, or
  `xattr -dr com.apple.quarantine /Applications/Cloudy.app`.
