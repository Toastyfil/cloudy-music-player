// Lyrics lookup, proxied and cached by the app's own service.
//
// The renderer used to call LRCLIB directly. That meant every panel open paid
// the full round trip, a restart forgot it, and a slow network showed as a
// spinner in the middle of a song. Here the lookup happens once: memory first,
// then a small JSON file per track, then LRCLIB. Repeat plays are instant.
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const BASE = 'https://lrclib.net/api';
const CLIENT = 'Cloudy v1.0.0 (https://cloudy.app)';
const HIT_TTL = 30 * 24 * 60 * 60 * 1000;
const MISS_TTL = 10 * 60 * 1000;

const memory = new Map();
let cacheDir =
  process.env.CLOUDY_LYRICS_DIR ?? path.join(os.homedir(), '.cloudy', 'lyrics');

export function initLyricsCache(dir) {
  cacheDir = dir;
  try {
    fs.mkdirSync(cacheDir, { recursive: true });
  } catch {
    /* a read-only home still gets the in-memory cache */
  }
}

function keyFor({ artist, title, album, duration }) {
  const raw = [artist, title, album, duration ? Math.round(Number(duration)) : '']
    .map((part) => String(part ?? '').trim().toLowerCase())
    .join('|');
  return crypto.createHash('sha1').update(raw).digest('hex');
}

async function readDisk(key) {
  try {
    const raw = await fsp.readFile(path.join(cacheDir, `${key}.json`), 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed?.savedAt || Date.now() - parsed.savedAt > HIT_TTL) return undefined;
    return parsed.result ?? null;
  } catch {
    return undefined;
  }
}

async function writeDisk(key, result) {
  if (!result) return;
  try {
    await fsp.mkdir(cacheDir, { recursive: true });
    await fsp.writeFile(
      path.join(cacheDir, `${key}.json`),
      JSON.stringify({ savedAt: Date.now(), result }),
      'utf8',
    );
  } catch {
    /* cache writes are best-effort */
  }
}

async function getJson(url, timeout = 9_000) {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(timeout),
    headers: { accept: 'application/json', 'Lrclib-Client': CLIENT },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`LRCLIB ${res.status}`);
  return res.json();
}

function usable(result) {
  return Boolean(result && (result.syncedLyrics || result.plainLyrics || result.instrumental));
}

/** Prefer word-synced, then synced, then plain; then the closest duration. */
function pickBest(list, duration) {
  const usableList = (list ?? []).filter(usable);
  if (!usableList.length) return null;
  // A cover or live cut can share a title and artist but not the recording, and
  // its lyrics drift immediately. Prefer same-length masters; only fall back to
  // loose matches when nothing is close.
  const near =
    duration && Number(duration) > 30
      ? usableList.filter(
          (item) => !item.duration || Math.abs(Number(item.duration) - Number(duration)) <= 8,
        )
      : usableList;
  const candidates = near.length ? near : usableList;
  const rank = (item) => {
    let score = 0;
    if (item.syncedLyrics) score += item.hasWordSync ? 40 : 30;
    else if (item.plainLyrics) score += 10;
    if (item.instrumental) score += 6;
    if (duration && item.duration) {
      const diff = Math.abs(Number(item.duration) - Number(duration));
      if (diff <= 2) score += 20;
      else if (diff <= 6) score += 12;
      else if (diff <= 15) score += 4;
    }
    return score;
  };
  return candidates.reduce((best, item) => (rank(item) > rank(best) ? item : best), candidates[0]);
}

function shape(result) {
  if (!result) return null;
  return {
    id: result.id ?? null,
    trackName: result.trackName ?? result.name ?? '',
    artistName: result.artistName ?? '',
    albumName: result.albumName ?? '',
    duration: result.duration ?? null,
    instrumental: Boolean(result.instrumental),
    plainLyrics: result.plainLyrics ?? null,
    syncedLyrics: result.syncedLyrics ?? null,
    hasWordSync: Boolean(result.hasWordSync ?? /<\d{1,3}:\d{1,2}/.test(result.syncedLyrics ?? '')),
  };
}

/** Find lyrics for a track. Returns null when LRCLIB has nothing. */
export async function findLyrics({ artist, title, album, duration }) {
  const query = { artist, title, album, duration };
  if (!title) return null;
  const key = keyFor(query);

  const mem = memory.get(key);
  if (mem && Date.now() - mem.at < (mem.result ? HIT_TTL : MISS_TTL)) return mem.result;

  const disk = await readDisk(key);
  if (disk !== undefined) {
    memory.set(key, { at: Date.now(), result: disk });
    return disk;
  }

  const params = new URLSearchParams({ artist_name: String(artist ?? ''), track_name: String(title) });
  if (album) params.set('album_name', String(album));
  if (duration) params.set('duration', String(Math.round(Number(duration))));

  let result = null;
  try {
    result = shape(await getJson(`${BASE}/get?${params.toString()}`));
  } catch {
    result = null;
  }

  if (!usable(result)) {
    const attempts = [
      `${BASE}/search?${new URLSearchParams({
        track_name: String(title),
        artist_name: String(artist ?? ''),
      }).toString()}`,
      `${BASE}/search?${new URLSearchParams({ q: `${title} ${artist ?? ''}`.trim() }).toString()}`,
      `${BASE}/search?${new URLSearchParams({ q: String(title) }).toString()}`,
    ];
    for (const url of attempts) {
      const list = await getJson(url).catch(() => null);
      const found = pickBest(list, duration);
      if (found) {
        result = shape(found);
        break;
      }
    }
  }

  memory.set(key, { at: Date.now(), result });
  if (result) void writeDisk(key, result);
  return result;
}

export function clearLyricsCache() {
  memory.clear();
  try {
    fs.rmSync(cacheDir, { recursive: true, force: true });
    fs.mkdirSync(cacheDir, { recursive: true });
  } catch {
    /* ignore */
  }
}
