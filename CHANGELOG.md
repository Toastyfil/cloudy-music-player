# Changelog

What changed in each release of Cloudy, newest first. Every entry matches a git
tag and a GitHub Release; the release pages are generated from the commits in
between, so this file is the human summary of the same history.

## 1.3.0 — 17 November 2026

### Added

- **Mini player.** Minimizing Cloudy now leaves a compact always-on-top window
  with the cover, title and transport instead of dropping it to the taskbar.
- **Now Playing panel.** Artwork, transport and lyrics in one panel, with the
  transport buttons placed under the cover rather than beside it.
- **Draggable layout.** The sidebar rail, the playlist list and the rows inside a
  playlist can be dragged into any order, and the order is remembered.
- **Riff settings sections.** You, Interface, Appearance, Banners, Tracks,
  Playback, Audio, Shortcuts, Advanced, Storage and About are now real, working
  switches rather than previews.

### Changed

- Floating panels have their own blur strength, so the now-playing panel and the
  lyrics panel no longer have to match the rest of the interface.
- Track lists, settings preview rows and the player bar share one row surface, so
  spacing, hover states and artwork size stay identical across the app.
- The interface, theme and banner lists were rebuilt from the Riff design, and
  the layout preview screen was removed now that the switches apply for real.

### Docs

- README rewritten around the five catalogs, with a new 25-second tour video and
  fresh screenshots from this update.

## 1.2.3 and earlier

Earlier releases are listed on the
[Releases page](https://github.com/Toastyfil/cloudy-music-player/releases).
