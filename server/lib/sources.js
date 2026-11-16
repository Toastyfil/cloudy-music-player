// Multi-source catalog.
//
// Cloudy's own engine (YouTube Music) is the audio backend for every source:
// SoundCloud, Deezer and Apple Music are searched through their public
// catalogs, and a result is matched to a playable audio id the first time it is
// needed — on click, or ahead of time when the list is rendered. That keeps one
// ad-free, gapless player instead of three embedded web views, and it means a
// Deezer search result plays the same full song a YouTube Music search would.
import { TtlCache } from './cache.js';
import { musicSearch } from './youtube.js';
import { canonicalTitle, pureTitle } from './filters.js';

const SEARCH_TTL = 5 * 60 * 1000;
const RESOLVE_TTL = 30 * 24 * 60 * 60 * 1000;

export const SOURCES = [
  { id: 'youtube', name: 'YouTube Music', catalog: 'Full catalog' },
  { id: 'soundcloud', name: 'SoundCloud', catalog: 'Uploads and remixes' },
  { id: 'deezer', name: 'Deezer', catalog: 'Full catalog' },
  { id: 'apple', name: 'Apple Music', catalog: 'Full catalog' },
  // Audius needs no account and streams its own audio, so it is the one source
  // that plays without being matched to a YouTube id first.
  { id: 'audius', name: 'Audius', catalog: 'Independent artists' },
];

export const SOURCE_IDS = new Set(SOURCES.map((source) => source.id));

/** The `source` stamped on every track, matching the search source ids. */
export function trackSourceOf(source) {
  return source === 'youtube' ? 'youtube-music' : source;
}

export function isExternalSource(source) {
  return Boolean(source) && source !== 'youtube' && source !== 'youtube-music';
}

const cache = new TtlCache(SEARCH_TTL);
const resolveCache = new TtlCache(RESOLVE_TTL);

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

async function getJson(url, { timeout = 9_000, headers = {} } = {}) {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(timeout),
    headers: { accept: 'application/json', 'user-agent': USER_AGENT, ...headers },
  });
  if (!res.ok) throw new Error(`Catalog responded ${res.status}`);
  return res.json();
}

async function getText(url, { timeout = 9_000 } = {}) {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(timeout),
    headers: { accept: 'text/html', 'user-agent': USER_AGENT },
  });
  if (!res.ok) throw new Error(`Catalog responded ${res.status}`);
  return res.text();
}

function formatDuration(seconds = 0) {
  if (!seconds || Number.isNaN(seconds)) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** Every source speaks the same Track shape, so the UI never branches on it. */
function makeTrack(source, { id, title, artist, album, duration, thumbnail, explicit = false, year = null }) {
  const seconds = Math.max(0, Math.round(Number(duration) || 0));
  const cleanTitle = String(title ?? '').trim();
  const cleanArtist = String(artist ?? '').trim() || 'Unknown artist';
  if (!cleanTitle) return null;
  return {
    id: `${source}:${id}`,
    videoId: null,
    title: cleanTitle,
    displayTitle: canonicalTitle(cleanTitle) || cleanTitle,
    artists: [{ id: null, name: cleanArtist }],
    artist: cleanArtist,
    album: album?.name ? { id: album.id ?? null, name: album.name } : null,
    duration: seconds,
    durationText: formatDuration(seconds),
    thumbnail: thumbnail ?? null,
    year,
    explicit: Boolean(explicit),
    source: source === 'youtube' ? 'youtube-music' : source,
  };
}

function upgradeArtwork(url, size = 500) {
  if (!url) return null;
  return String(url)
    .replace(/-large\./, `-t${size}x${size}.`)
    .replace(/\/\d+x\d+bb\./, `/${size}x${size}bb.`);
}

/* ------------------------------------------------------------- soundcloud --- */

// SoundCloud's public API wants a client id from their own web bundle. It is
// public, rotates occasionally, and is cached until it stops working.
let soundcloudCredential = { clientId: null, expiresAt: 0 };

async function soundcloudClientId(force = false) {
  if (!force && soundcloudCredential.clientId && Date.now() < soundcloudCredential.expiresAt) {
    return soundcloudCredential.clientId;
  }
  const html = await getText('https://soundcloud.com/');
  const scripts = [...html.matchAll(/src="(https:\/\/[^"]+\.js)"/g)].map((match) => match[1]).slice(-10);
  for (const script of scripts) {
    const bundle = await getText(script, { timeout: 8_000 }).catch(() => '');
    const found = bundle.match(/client_id\s*[:=]\s*"([a-zA-Z0-9]{32})"/);
    if (found) {
      soundcloudCredential = { clientId: found[1], expiresAt: Date.now() + 6 * 60 * 60 * 1000 };
      return found[1];
    }
  }
  throw new Error('SoundCloud is not offering a public session right now');
}

async function soundcloudSearch(query, limit = 25) {
  const run = async (force) => {
    const clientId = await soundcloudClientId(force);
    return getJson(
      `https://api-v2.soundcloud.com/search/tracks?q=${encodeURIComponent(query)}&limit=${limit}&client_id=${clientId}`,
    );
  };

  let data;
  try {
    data = await run(false);
  } catch {
    data = await run(true);
  }

  return (data?.collection ?? [])
    .filter((item) => item?.id && item?.title && !item?.policy?.includes('BLOCK'))
    .map((item) =>
      makeTrack('soundcloud', {
        id: item.id,
        title: item.title,
        artist: item.user?.username ?? item.user?.full_name,
        duration: Math.round((Number(item.full_duration) || Number(item.duration) || 0) / 1000),
        thumbnail: upgradeArtwork(item.artwork_url) ?? upgradeArtwork(item.user?.avatar_url, 200),
        year: item?.release_date ? Number(String(item.release_date).slice(0, 4)) || null : null,
      }),
    )
    .filter(Boolean);
}

/* ----------------------------------------------------------------- deezer --- */

/* ---------------------------------------------------------------- audius --- */

async function audiusSearch(query, limit = 25) {
  const data = await getJson(
    `https://api.audius.co/v1/tracks/search?query=${encodeURIComponent(query)}&app_name=Cloudy&limit=${limit}`,
  );
  return (data?.data ?? [])
    // Only streamable tracks: gated or delisted ones 404 on the stream endpoint,
    // so they would show up as unplayable rows.
    .filter((item) => item?.id && item?.title && !item.is_delete && item.is_streamable && !item.is_stream_gated)
    .map((item) => {
      const track = makeTrack('audius', {
        id: item.id,
        title: item.title,
        artist: item.user?.name || item.user?.handle || 'Audius artist',
        album: null,
        duration: item.duration,
        thumbnail: item.artwork?.['480x480'] ?? item.artwork?.['150x150'] ?? null,
      });
      // Self-playing: the audio id is the Audius track, not a YouTube match.
      if (track) track.videoId = `audius_${item.id}`;
      return track;
    })
    .filter(Boolean);
}

async function deezerSearch(query, limit = 25) {
  const data = await getJson(`https://api.deezer.com/search?q=${encodeURIComponent(query)}&limit=${limit}`);
  return (data?.data ?? [])
    .filter((item) => item?.id && item?.title && item?.readable !== false)
    .map((item) =>
      makeTrack('deezer', {
        id: item.id,
        title: item.title,
        artist: item.artist?.name,
        album: item.album?.title ? { id: item.album.id ?? null, name: item.album.title } : null,
        duration: item.duration,
        thumbnail: item.album?.cover_big ?? item.album?.cover_medium ?? item.album?.cover,
        explicit: item.explicit_lyrics,
      }),
    )
    .filter(Boolean);
}

/* ------------------------------------------------------------------ apple --- */

async function appleSearch(query, limit = 25) {
  const data = await getJson(
    `https://itunes.apple.com/search?term=${encodeURIComponent(query)}&media=music&entity=song&limit=${limit}`,
  );
  return (data?.results ?? [])
    .filter((item) => item?.trackId && item?.trackName)
    .map((item) =>
      makeTrack('apple', {
        id: item.trackId,
        title: item.trackName,
        artist: item.artistName,
        album: item.collectionName ? { id: item.collectionId ?? null, name: item.collectionName } : null,
        duration: Math.round((Number(item.trackTimeMillis) || 0) / 1000),
        thumbnail: upgradeArtwork(item.artworkUrl100, 600),
        explicit: item.trackExplicitness === 'explicit',
        year: item.releaseDate ? Number(String(item.releaseDate).slice(0, 4)) || null : null,
      }),
    )
    .filter(Boolean);
}

/* ----------------------------------------------------------------- search --- */

const SEARCHERS = {
  soundcloud: soundcloudSearch,
  deezer: deezerSearch,
  apple: appleSearch,
  audius: audiusSearch,
};

/** Catalog search for one source. YouTube Music keeps its own house rules. */
export async function searchSource(source, query, type = 'song') {
  const wanted = String(source ?? 'youtube').toLowerCase();
  if (!SOURCE_IDS.has(wanted)) throw new Error(`Unknown source: ${wanted}`);
  if (wanted === 'youtube') return musicSearch(query, type);
  // The external catalogs are song catalogs: artists/albums stay on YouTube
  // Music, where Cloudy has real artist and album pages to show.
  if (type !== 'song' && type !== 'songs' && type !== 'video') return [];

  const key = `source:${wanted}:${query.toLowerCase()}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const results = await SEARCHERS[wanted](query).catch((error) => {
    console.warn(`[cloudy-api] ${wanted} search failed:`, error.message);
    return [];
  });
  return cache.set(key, results, SEARCH_TTL);
}

/**
 * Every catalog at once, round-robin: a search shows all four providers instead
 * of burying three of them under a long YouTube Music list. Duplicate songs
 * (same title and artist across catalogs) keep the first, higher-priority hit.
 */
export async function searchAllSources(query, { limit = 30 } = {}) {
  const lists = await Promise.all(
    SOURCES.map((source) => searchSource(source.id, query, 'song').catch(() => [])),
  );
  const seen = new Set();
  const merged = [];
  const longest = Math.max(0, ...lists.map((list) => list.length));

  for (let index = 0; index < longest && merged.length < limit; index += 1) {
    for (const list of lists) {
      const track = list[index];
      if (!track) continue;
      const key = `${normalize(track.title)}|${normalize(track.artist)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(track);
      if (merged.length >= limit) break;
    }
  }

  return merged;
}

/* ---------------------------------------------------------------- resolve --- */

function normalize(value = '') {
  return String(value)
    .toLowerCase()
    .replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function scoreCandidate(track, target) {
  const title = normalize(target.title);
  const artist = normalize(target.artist);
  const candidateTitle = normalize(pureTitle(track.title) || track.title);
  const candidateArtist = normalize(track.artist);

  let score = 0;
  if (candidateTitle && candidateTitle === title) score += 60;
  else if (title && (candidateTitle.includes(title) || title.includes(candidateTitle))) score += 34;
  else {
    const wanted = new Set(title.split(' ').filter(Boolean));
    const got = new Set(candidateTitle.split(' ').filter(Boolean));
    let shared = 0;
    for (const word of wanted) if (got.has(word)) shared += 1;
    score += wanted.size ? (shared / wanted.size) * 24 : 0;
  }

  if (artist && candidateArtist === artist) score += 32;
  else if (artist && (candidateArtist.includes(artist) || artist.includes(candidateArtist))) score += 18;

  if (target.duration) {
    const diff = Math.abs(Number(target.duration) - Number(track.duration || 0));
    if (diff <= 3) score += 20;
    else if (diff <= 10) score += 10;
    else if (diff <= 25) score += 3;
  }
  return score;
}

/**
 * Match an external catalog entry to a playable audio id.
 * The best studio recording with a matching title and artist wins; the resolved
 * id is kept for a month, so replaying a favourite costs nothing.
 */
export async function resolveToPlayable(track) {
  if (!isExternalSource(track?.source)) {
    const id = track?.videoId ?? track?.id ?? null;
    return id ? { videoId: String(id), source: 'youtube-music' } : null;
  }

  const key = `${track.source}:${track.id}`;
  const hit = resolveCache.get(key);
  if (hit) return hit;

  const queries = [`${track.title} ${track.artist}`, track.title].filter(Boolean);
  let best = null;
  let bestScore = 0;

  for (const query of queries) {
    const candidates = await musicSearch(query, 'song').catch(() => []);
    for (const candidate of candidates) {
      const id = candidate?.videoId ?? candidate?.id;
      if (!id) continue;
      const score = scoreCandidate(candidate, track);
      if (score > bestScore) {
        bestScore = score;
        best = candidate;
      }
    }
    if (bestScore >= 90) break;
  }

  if (!best || bestScore < 45) return null;

  const resolved = {
    videoId: String(best.videoId ?? best.id),
    source: 'youtube-music',
    title: best.title,
    artist: best.artist,
    duration: best.duration ?? null,
  };
  return resolveCache.set(key, resolved, RESOLVE_TTL);
}

/**
 * Other recordings of the same song, best first. Used when the id we have
 * cannot deliver audio (deleted, region-locked, DRM) so playback can recover
 * instead of dead-ending on "this track isn't available".
 */
export async function findAlternatives(track, { exclude = null, limit = 5 } = {}) {
  const queries = [`${track.title} ${track.artist}`, track.title].filter(Boolean);
  const seen = new Set();
  const scored = [];

  for (const query of queries) {
    const candidates = await musicSearch(query, 'song').catch(() => []);
    for (const candidate of candidates) {
      const id = candidate?.videoId ?? candidate?.id;
      if (!id) continue;
      const key = String(id);
      if (exclude && key === String(exclude)) continue;
      if (seen.has(key)) continue;
      seen.add(key);
      const score = scoreCandidate(candidate, track);
      if (score < 45) continue;
      scored.push({
        videoId: key,
        source: 'youtube-music',
        title: candidate.title,
        artist: candidate.artist,
        duration: candidate.duration ?? null,
        score,
      });
    }
  }

  return scored.sort((a, b) => b.score - a.score).slice(0, limit);
}

export function clearSourceCaches() {
  cache.clear();
  soundcloudCredential = { clientId: null, expiresAt: 0 };
}
