# Releasing Cloudy

`.github/workflows/release.yml` builds every installer and publishes them on a
GitHub Release. It runs on any tag starting with `v`, and can also be started by
hand from the Actions tab (a manual run builds the installers but does not
publish).

## Cutting a release

1. Bump `version` in `package.json` — the installers are named from it, so
   `1.0.1` produces `Cloudy-1.0.1-setup.exe`, `Cloudy-1.0.1-arm64.dmg`,
   `Cloudy-1.0.1-x64.dmg`, `Cloudy-1.0.1-x86_64.AppImage` and `Cloudy-1.0.1-amd64.deb`.
   The Linux files use electron-builder's Debian arch spellings (`x86_64`,
   `amd64`), so quote those names exactly in the notes instead of `x64`.
2. Add the same version to `CHANGELOG.md` under a `## 1.0.1 — <date>` heading,
   with **Added**, **Changed** and **Fixed** bullets: what a user would notice,
   not which files were touched.
3. Commit, then tag and push:

   ```sh
   git commit -am "1.0.1"
   git tag v1.0.1
   git push origin main --tags
   ```

4. The workflow runs four build jobs in parallel:

   | Job | Runner | Output |
   | --- | --- | --- |
   | Windows installer | `windows-latest` | NSIS `.exe` |
   | macOS DMG (arm64) | `macos-15` | Apple Silicon `.dmg` |
   | macOS DMG (x64) | `macos-15-intel` | Intel `.dmg` |
   | Linux AppImage and deb | `ubuntu-22.04` | `.AppImage` and `.deb` |

   Each bundles the matching `yt-dlp` binary into `resources/bin`, so playback
   works without a separate install. The Linux job deliberately builds on 22.04:
   a newer runner would link the AppImage against a newer glibc and it would
   refuse to start on older distributions.

5. A final **Publish release** job collects the artifacts and creates the
   release with every built file attached and the notes described below. It
   waits for all four build jobs, so a failing Linux build blocks the release
   rather than publishing an incomplete one.

Builds stay available as workflow artifacts for 14 days even when the release
job does not run.

## Release notes

Nobody writes the release page by hand. The publish job checks out the full
history and builds a **What's new** section with
`git log --no-merges --pretty='- %s' <previous tag>..<this tag>`, so every
release lists what changed since the previous one, with a compare link.

That makes the commit subject the line a user reads, so write it as a change:

- `Add a mini player while Cloudy is minimized` — good, it is the bullet users see.
- `wip`, `fix stuff`, merge commits — dropped or useless in the notes.

Anything worth a paragraph (a new catalog, a redesign, a behaviour change) also
goes into `CHANGELOG.md`, which the notes link to. The two together are the
update story: the release page for the details of one version, the changelog for
reading the history in order.

Notes are attached after the intro paragraph and before **Downloads**, so the
first thing on the page is what changed, then how to install.

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
