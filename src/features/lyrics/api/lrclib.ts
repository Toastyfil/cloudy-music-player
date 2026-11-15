import type { LyricsMatch, Track } from '@/shared/api/contracts';
import { apiOrigin } from '@/shared/api/client';

const BASE = 'https://lrclib.net/api';
const CLIENT = 'Cloudy v1.0.0 (https://cloudy.app)';

export type LrclibResult = LyricsMatch;

const cache = new Map<string, LrclibResult | null>();

function keyFor(track: Track) {
  return `${track.artist.toLowerCase()}::${track.title.toLowerCase()}`;
}

// Lyrics are tiny and change rarely, so they live on disk too: a track you have
// played once shows its lyrics instantly next time, even when LRCLIB is slow.
const STORAGE_PREFIX = 'cloudy:lyrics:v3:';
const STORAGE_TTL = 1000 * 60 * 60 * 24 * 30;

function readStored(key: string): LrclibResult | null | undefined {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + key);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as { savedAt: number; result: LrclibResult };
    if (!parsed?.result || Date.now() - parsed.savedAt > STORAGE_TTL) return undefined;
    return parsed.result;
  } catch {
    return undefined;
  }
}

function writeStored(key: string, result: LrclibResult | null) {
  // A miss is never persisted: LRCLIB gains lyrics over time, so we retry later.
  if (!result) return;
  try {
    localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify({ savedAt: Date.now(), result }));
  } catch {
    /* quota or private mode — the in-memory cache still works */
  }
}

async function getJson<T>(url: string, timeout = 12_000): Promise<T | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { accept: 'application/json', 'Lrclib-Client': CLIENT },
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`LRCLIB ${res.status}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The bundled backend keeps lyrics in memory and on disk, so this is a local
 * request after the first play. It throws when the backend is unreachable, which
 * is the signal to ask LRCLIB directly.
 */
async function backendLookup(track: Track): Promise<LrclibResult | null> {
  const params = new URLSearchParams({ title: track.title, artist: track.artist });
  if (track.album?.name) params.set('album', track.album.name);
  if (track.duration) params.set('duration', String(Math.round(track.duration)));

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);
  try {
    const res = await fetch(`${apiOrigin()}/lyrics?${params.toString()}`, { signal: controller.signal });
    if (!res.ok) throw new Error(`Cloudy lyrics ${res.status}`);
    const body = (await res.json()) as { result: LrclibResult | null };
    return body?.result ?? null;
  } finally {
    clearTimeout(timer);
  }
}

/** Exact lookup, then the fuzzy search endpoint, then a title-only search. */
async function directLookup(track: Track): Promise<LrclibResult | null> {
  const params = new URLSearchParams({ artist_name: track.artist, track_name: track.title });
  if (track.album?.name) params.set('album_name', track.album.name);
  if (track.duration) params.set('duration', String(Math.round(track.duration)));

  let result = await getJson<LrclibResult>(`${BASE}/get?${params.toString()}`).catch(() => null);
  if (result?.syncedLyrics || result?.plainLyrics || result?.instrumental) return result;

  // Lyrics for the wrong recording are worse than no lyrics: they drift the
  // moment the song starts. Keep only results whose length matches this track.
  const near = (item: LrclibResult) =>
    !track.duration || !item.duration || Math.abs(Number(item.duration) - Number(track.duration)) <= 8;
  const searchParams = new URLSearchParams({ track_name: track.title, artist_name: track.artist });
  const list = await getJson<LrclibResult[]>(`${BASE}/search?${searchParams.toString()}`).catch(() => null);
  const usable = (list ?? []).filter((item) => (item.syncedLyrics || item.plainLyrics || item.instrumental) && near(item));
  result = usable.find((item) => item.syncedLyrics) ?? usable[0] ?? null;
  if (result) return result;

  const byTitle = await getJson<LrclibResult[]>(
    `${BASE}/search?${new URLSearchParams({ track_name: track.title }).toString()}`,
  ).catch(() => null);
  return (byTitle ?? []).find((item) => item.syncedLyrics && near(item)) ?? null;
}

/** Returns null when nothing matches. Never throws for a missing match. */
export async function fetchLyrics(track: Track): Promise<LrclibResult | null> {
  const cacheKey = keyFor(track);
  if (cache.has(cacheKey)) return cache.get(cacheKey) ?? null;

  const stored = readStored(cacheKey);
  if (stored !== undefined) {
    cache.set(cacheKey, stored);
    return stored;
  }

  let result: LrclibResult | null | undefined;
  try {
    result = await backendLookup(track);
  } catch {
    result = undefined;
  }
  if (result === undefined) {
    result = await directLookup(track).catch(() => null);
  }

  cache.set(cacheKey, result ?? null);
  writeStored(cacheKey, result ?? null);
  return result ?? null;
}

/** Warm the cache for tracks that are about to play, so skips show lyrics at once. */
export async function prefetchLyrics(tracks: Track[]) {
  await Promise.all(
    tracks.slice(0, 5).map(async (track) => {
      const key = keyFor(track);
      if (cache.has(key) || readStored(key) !== undefined) return;
      try {
        await fetchLyrics(track);
      } catch {
        /* prefetch is best-effort */
      }
    }),
  );
}

export function hasCachedLyrics(track: Track) {
  const key = keyFor(track);
  return cache.has(key) || readStored(key) !== undefined;
}

export function clearLyricsCache() {
  cache.clear();
  try {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith(STORAGE_PREFIX)) localStorage.removeItem(key);
    }
  } catch {
    /* ignore */
  }
}
