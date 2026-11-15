# Releasing Cloudy

`.github/workflows/release.yml` builds every installer and publishes them on a
GitHub Release. It runs on any tag starting with `v`, and can also be started by
hand from the Actions tab (a manual run builds the installers but does not
publish).

## Cutting a release

1. Bump `version` in `package.json` — the installers are named from it, so
   `1.0.1` produces `Cloudy-1.0.1-setup.exe`, `Cloudy-1.0.1-arm64.dmg` and
   `Cloudy-1.0.1-x64.dmg`.
2. Commit, then tag and push:

   ```sh
   git tag v1.0.1
   git push origin v1.0.1
   ```

3. The workflow runs three build jobs in parallel:

   | Job | Runner | Output |
   | --- | --- | --- |
   | Windows installer | `windows-latest` | NSIS `.exe` |
   | macOS DMG (arm64) | `macos-15` | Apple Silicon `.dmg` |
   | macOS DMG (x64) | `macos-15-intel` | Intel `.dmg` |

   Each bundles the matching `yt-dlp` binary into `resources/bin`, so playback
   works without a separate install.

4. A final **Publish release** job collects the artifacts and creates the
   release with all three files attached, using GitHub's generated notes.

Builds stay available as workflow artifacts for 14 days even when the release
job does not run.

## Signing secrets

All signing is optional: without the secrets the workflow logs a notice and
builds unsigned installers instead of failing. With them it signs and notarizes
automatically.

**macOS** — `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_ID`,
`APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`. See
[macos-signing.md](macos-signing.md) for how to create each one.

**Windows** — `WIN_CSC_LINK` and `WIN_CSC_KEY_PASSWORD`:

| Secret | Value |
| --- | --- |
| `WIN_CSC_LINK` | base64 `.pfx` code-signing certificate, or a URL to it |
| `WIN_CSC_KEY_PASSWORD` | the `.pfx` password |

Export the certificate from the Windows certificate store as a `.pfx` including
its private key, then:

```sh
base64 -w0 Cloudy.pfx > Cloudy.pfx.b64
gh secret set WIN_CSC_LINK < Cloudy.pfx.b64
gh secret set WIN_CSC_KEY_PASSWORD
```

A standard OV/EV code-signing certificate costs money and, since 2023, ships on
a hardware token or cloud HSM. Signing removes the "Unknown publisher" line from
the installer; SmartScreen's reputation warning fades only after enough clean
downloads, so a brand-new certificate can still warn at first.
