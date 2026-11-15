# bin/

The yt-dlp binary lives here at build time and is copied into the app bundle as
`resources/bin/` (`extraResources` in `package.json`). The server looks for it
there before falling back to `yt-dlp` on `PATH` (see `server/lib/tools.js`), so a
Mac user does not need Homebrew.

Put the platform build in this folder before packaging:

- macOS: `yt-dlp_macos` from the yt-dlp releases, saved as `bin/yt-dlp`, `chmod +x`
- Windows: `yt-dlp.exe` saved as `bin/yt-dlp.exe`
- Linux: `yt-dlp_linux` saved as `bin/yt-dlp`, `chmod +x`

The binaries are git-ignored; the macOS CI workflow downloads the right one for
each architecture automatically. `CLOUDY_YTDLP=/path/to/yt-dlp` overrides
everything for local testing.
