import type { Track } from '@/shared/api/contracts';

/** The catalogs Cloudy can search. Playback always goes through Cloudy's engine. */
export type CatalogSource = 'youtube' | 'soundcloud' | 'deezer' | 'apple';

export interface CatalogSourceInfo {
  id: CatalogSource;
  label: string;
  hint: string;
  /** The value stamped on `Track.source` for results from this catalog. */
  trackSource: string;
}

export const CATALOG_SOURCES: CatalogSourceInfo[] = [
  { id: 'youtube', label: 'YouTube Music', hint: 'Full catalog · artists, albums and playlists', trackSource: 'youtube-music' },
  { id: 'soundcloud', label: 'SoundCloud', hint: 'Uploads, edits and remixes', trackSource: 'soundcloud' },
  { id: 'deezer', label: 'Deezer', hint: 'Full catalog, matched track by track', trackSource: 'deezer' },
  { id: 'apple', label: 'Apple Music', hint: 'Full catalog, matched track by track', trackSource: 'apple' },
];

export const DEFAULT_SOURCE: CatalogSource = 'youtube';

export function normalizeSource(value: unknown): CatalogSource {
  return CATALOG_SOURCES.some((source) => source.id === value) ? (value as CatalogSource) : DEFAULT_SOURCE;
}

export function sourceInfo(source: CatalogSource): CatalogSourceInfo {
  return CATALOG_SOURCES.find((entry) => entry.id === source) ?? CATALOG_SOURCES[0];
}

/** True for every catalog that needs its audio matched before it can play. */
export function isExternalTrack(track: Pick<Track, 'source'> | null | undefined) {
  return Boolean(track?.source) && track?.source !== 'youtube-music';
}

export function sourceLabel(source: string | null | undefined) {
  if (!source || source === 'youtube-music') return 'YouTube Music';
  const match = CATALOG_SOURCES.find((entry) => entry.trackSource === source);
  return match?.label ?? 'Catalog';
}
