// Playlist import: read a public playlist from another service, then match each
// entry against the YouTube Music catalog so the library only ever holds real
// catalog tracks.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { musicSearch, getPlaylistPage } from './youtube.js';
import { canonicalTitle, dedupeKey } from './filters.js';
import { ytDlpPath } from './tools.js';

const execFileAsync = promisify(execFile);
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

const SOURCE_PATTERNS = [
  { source: 'spotify', re: /open\.spotify\.com\/(?:intl-[a-z-]+\/)?(playlist|album|track|user)\/([A-Za-z0-9]+)/i },
  { source: 'apple', re: /music\.apple\.com\/[a-z]{2}\/(playlist|album|artist)\/[^/]*\/(?:pl\.)?([A-Za-z0-9._-]+)/i },
  { source: 'deezer', re: /deezer\.com\/(?:[a-z]{2}\/)?(playlist|album|track)\/(\d+)/i },
  { source: 'soundcloud', re: /soundcloud\.com\/([^/]+)\/sets\/([^/?#]+)/i },
  { source: 'youtube', re: /(?:music\.)?youtube\.com\/(?:playlist\?list=|playlist\/)([A-Za-z0-9_-]+)/i },
];

export function detectSource(url = '') {
  for (const { source, re } of SOURCE_PATTERNS) {
    const m = url.match(re);
    if (m) return { source, kind: m[1] ?? 'playlist', id: m[2] ?? m[1] };
  }
  return null;
}

async function fetchText(url) {
  const res = await fetch(url, { headers: { 'user-agent': UA, accept: 'text/html,application/json' } });
  if (!res.ok) throw new Error(`Fetch failed (${res.status}) for ${url}`);
  return res.text();
}

/* ------------------------------------------------------------------ Spotify */

async function spotifyTracks(id, kind) {
  const embedType = kind === 'album' ? 'album' : kind === 'track' ? 'track' : 'playlist';
  const html = await fetchText(`https://open.spotify.com/embed/${embedType}/${id}`);
  const match = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
  if (!match) throw new Error('Spotify embed changed: no __NEXT_DATA__');
  const data = JSON.parse(match[1]);
  const entity = data?.props?.pageProps?.state?.data?.entity ?? data?.props?.pageProps?.state?.data;
  const list = entity?.trackList ?? entity?.tracks ?? [];
  const name = entity?.name ?? entity?.title ?? 'Imported playlist';
  const tracks = list
    .map((t) => {
      const artists = (t.artists ?? []).map((a) => a.name).filter(Boolean);
      const title = t.title ?? t.name;
      if (!title) return null;
      // The public embed exposes the performer as `subtitle`, not always as artists.
      const artist = artists[0] ?? String(t.subtitle ?? '').split(',')[0].trim();
      return { title, artist, artists: artist ? [artist, ...artists.slice(1)] : artists, duration: t.duration ? Math.round(t.duration / 1000) : null };
    })
    .filter(Boolean);
  return { name, tracks, source: 'spotify' };
}

export async function spotifyProfilePlaylists(userId) {
  const html = await fetchText(`https://open.spotify.com/user/${userId}`);
  const ids = new Set();
  for (const m of html.matchAll(/open\.spotify\.com\/playlist\/([A-Za-z0-9]{22})/g)) ids.add(m[1]);
  const out = [];
  for (const id of ids) {
    try {
      const data = await spotifyTracks(id, 'playlist');
      out.push({ id, name: data.name, trackCount: data.tracks.length });
    } catch {
      out.push({ id, name: `Spotify playlist ${id}`, trackCount: 0 });
    }
  }
  return out;
}

/* ------------------------------------------------------------------- Deezer */

async function deezerTracks(id) {
  const raw = await fetchText(`https://api.deezer.com/playlist/${id}`);
  const data = JSON.parse(raw);
  if (data.error) throw new Error(`Deezer: ${data.error.message}`);
  const tracks = (data.tracks?.data ?? []).map((t) => ({
    title: t.title,
    artist: t.artist?.name ?? '',
    artists: t.artist?.name ? [t.artist.name] : [],
    duration: t.duration ?? null,
    album: t.album?.title ?? null,
  }));
  return { name: data.title ?? 'Deezer playlist', tracks, source: 'deezer' };
}

/* -------------------------------------------------------------- Apple Music */

async function appleTracks(id, kind, url) {
  const html = await fetchText(url);
  const blocks = [...html.matchAll(/<script[^>]*id="serialized-server-data"[^>]*>([\s\S]*?)<\/script>/g)];
  const tracks = [];
  let name = '';
  for (const block of blocks) {
    let data;
    try {
      data = JSON.parse(block[1]);
    } catch {
      continue;
    }
    const walk = (node) => {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) return node.forEach(walk);
      if (node.title && !name && /playlist|album/i.test(node.kind ?? '')) name = node.title;
      const song = node.title && (node.subtitleLinks || node.artistName);
      if (song) {
        const artist = node.artistName ?? node.subtitleLinks?.[0]?.title ?? '';
        if (node.title && artist) tracks.push({ title: node.title, artist, artists: artist ? [artist] : [], duration: node.durationInMillis ? Math.round(node.durationInMillis / 1000) : null });
      }
      for (const key of ['data', 'items', 'tracks', 'seoData', 'sections']) walk(node[key]);
    };
    walk(data);
  }
  const seen = new Set();
  const unique = tracks.filter((t) => {
    const k = `${t.title}::${t.artist}`.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  if (!unique.length) throw new Error('Apple Music page had no readable track list');
  return { name: name || 'Apple Music playlist', tracks: unique, source: 'apple' };
}

/* --------------------------------------------------------------- SoundCloud */

async function soundcloudTracks(url) {
  const { stdout } = await execFileAsync(
    ytDlpPath(),
    ['--flat-playlist', '--dump-single-json', '--no-warnings', url],
    { timeout: 120_000, maxBuffer: 32 * 1024 * 1024 },
  );
  const data = JSON.parse(stdout);
  const entries = data.entries ?? [];
  const tracks = entries
    .map((e) => {
      if (!e?.title) return null;
      const artist = e.uploader ?? e.artist ?? (e.fulltitle?.includes(' - ') ? e.fulltitle.split(' - ')[0] : '');
      return { title: e.title, artist: artist ?? '', artists: artist ? [artist] : [], duration: e.duration ?? null };
    })
    .filter(Boolean);
  return { name: data.title ?? 'SoundCloud set', tracks, source: 'soundcloud' };
}

/* ---------------------------------------------------------------- resolution */

export async function readPlaylist(url) {
  const detected = detectSource(url);
  if (!detected) throw new Error('Unrecognised playlist link. Supported: Spotify, Apple Music, YouTube, SoundCloud, Deezer.');

  switch (detected.source) {
    case 'spotify':
      if (detected.kind === 'user') {
        const playlists = await spotifyProfilePlaylists(detected.id);
        return { source: 'spotify', kind: 'profile', name: `Spotify profile ${detected.id}`, playlists, tracks: [] };
      }
      return { ...(await spotifyTracks(detected.id, detected.kind)), kind: detected.kind };
    case 'deezer':
      return { ...(await deezerTracks(detected.id)), kind: detected.kind };
    case 'apple':
      return { ...(await appleTracks(detected.id, detected.kind, url)), kind: detected.kind };
    case 'soundcloud':
      return { ...(await soundcloudTracks(url)), kind: 'playlist' };
    case 'youtube': {
      const playlist = await getPlaylistPage(detected.id);
      return {
        source: 'youtube',
        kind: 'playlist',
        name: playlist.title,
        tracks: playlist.tracks.map((t) => ({ title: t.title, artist: t.artist, artists: t.artists, duration: t.duration, matched: t })),
      };
    }
    default:
      throw new Error('Unsupported source');
  }
}

const norm = (s = '') =>
  canonicalTitle(String(s)).toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();

/** Match a foreign track entry to the best YouTube Music catalog result. */
export async function matchEntry(entry) {
  const query = [entry.title, entry.artist].filter(Boolean).join(' ');
  let candidates = [];
  try {
    candidates = await musicSearch(query, 'song');
  } catch {
    candidates = [];
  }
  if (!candidates.length && entry.artist) {
    try {
      candidates = await musicSearch(entry.title, 'song');
    } catch {
      candidates = [];
    }
  }
  if (!candidates.length) return { ...entry, matched: null, confidence: 0 };

  const wantTitle = norm(entry.title);
  const wantArtist = norm(entry.artist);
  const wantKey = dedupeKey(entry.title, entry.artist);

  let best = null;
  let bestScore = -1;
  for (const candidate of candidates) {
    let score = 0;
    if (dedupeKey(candidate.title, candidate.artist) === wantKey) score = 3;
    else if (norm(candidate.title) === wantTitle) score = 2;
    else if (norm(candidate.title).includes(wantTitle) || wantTitle.includes(norm(candidate.title))) score = 1;
    if (wantArtist && norm(candidate.artist).includes(wantArtist)) score += 1.5;
    if (entry.duration && candidate.duration && Math.abs(entry.duration - candidate.duration) <= 4) score += 1;
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  const confidence = Math.min(1, Math.max(0, bestScore / 5.5));
  return { ...entry, matched: confidence >= 0.4 ? best : null, confidence };
}

export async function resolveImport(url, { limit = 200 } = {}) {
  const playlist = await readPlaylist(url);
  if (playlist.kind === 'profile') return { ...playlist, resolved: [] };

  const entries = playlist.tracks.slice(0, limit);
  const resolved = [];
  // Small concurrency so a 100-track import finishes in a few seconds without
  // hammering the upstream catalog.
  const workers = Math.min(4, entries.length || 1);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: workers }, async () => {
      while (cursor < entries.length) {
        const index = cursor++;
        const entry = entries[index];
        if (entry.matched) {
          resolved[index] = { ...entry, matched: entry.matched, confidence: 1 };
          continue;
        }
        try {
          resolved[index] = await matchEntry(entry);
        } catch {
          resolved[index] = { ...entry, matched: null, confidence: 0 };
        }
      }
    }),
  );

  return {
    source: playlist.source,
    kind: playlist.kind,
    name: playlist.name,
    total: entries.length,
    matchedCount: resolved.filter((r) => r.matched).length,
    tracks: resolved,
  };
}
