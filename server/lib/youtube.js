// YouTube Music catalog wrapper.
//
// Everything here goes through the music (REMIX) client so results are the
// structured catalog: songs, artists, albums, playlists. Generic YouTube video
// search is never used for catalog browsing — only as a last-resort stream
// resolver, and never for what the user sees in search.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Innertube, UniversalCache } from 'youtubei.js';
import { TtlCache } from './cache.js';
import { ytDlpPath } from './tools.js';
import { canonicalTitle, dedupeKey, isStudioAlbum, isStudioItem, isStudioTitle, pureTitle, thumbAt } from './filters.js';

const execFileAsync = promisify(execFile);

const SEARCH_TTL = 5 * 60 * 1000;
const ENTITY_TTL = 30 * 60 * 1000;

const cache = new TtlCache(SEARCH_TTL);
const streamCache = new TtlCache(45 * 60 * 1000);

let clientPromise = null;

/** Lazily create one Innertube session for the whole process. */
export async function getClient() {
  if (!clientPromise) {
    clientPromise = Innertube.create({
      cache: new UniversalCache(false),
      generate_session_locally: true,
      retrieve_player: true,
      lang: 'en',
      location: 'US',
    }).catch((err) => {
      clientPromise = null;
      throw err;
    });
  }
  return clientPromise;
}

/**
 * Run a catalog call against the shared session, rebuilding it once if the
 * parser chokes. youtubei.js throws on response shapes it has no class for yet
 * (an unknown badge, a new thumbnail field); a rebuilt session generally gets a
 * parseable response, so one retry keeps a whole tab from failing.
 */
async function withClient(run) {
  try {
    return await run(await getClient());
  } catch (error) {
    clientPromise = null;
    return run(await getClient());
  }
}

function text(value) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  try {
    return value.toString();
  } catch {
    return '';
  }
}

function firstThumb(node) {
  const candidates = [];
  if (Array.isArray(node?.thumbnail)) candidates.push(...node.thumbnail);
  if (Array.isArray(node?.thumbnails)) candidates.push(...node.thumbnails);
  for (const column of node?.flex_columns ?? []) {
    if (Array.isArray(column?.thumbnail)) candidates.push(...column.thumbnail);
    if (column?.thumbnail?.url) candidates.push(column.thumbnail);
  }
  const found = candidates.find((t) => t?.url);
  return found?.url ?? null;
}

function artFor(id, url) {
  if (url) return thumbAt(url, 544);
  // Album art for catalog audio tracks is served from the same asset host; this
  // frame is the square cover for music uploads.
  return id ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : null;
}

function parseDuration(box) {
  if (!box) return 0;
  if (typeof box.seconds === 'number') return box.seconds;
  const label = text(box.text) || text(box);
  const parts = String(label).split(':').map(Number);
  if (parts.some(Number.isNaN)) return 0;
  return parts.reduce((acc, n) => acc * 60 + n, 0);
}

/** Pull a mm:ss / h:mm:ss label out of any text on a shelf row. */
function durationFromRow(node) {
  const direct = parseDuration(node?.duration);
  if (direct) return direct;
  const strings = [
    text(node?.subtitle),
    ...(node?.flex_columns ?? []).map((c) => text(c?.title) || text(c?.text)),
  ];
  for (const value of strings) {
    const match = String(value).match(/\b(\d{1,2}:\d{2}(?::\d{2})?)\b/);
    if (!match) continue;
    const parts = match[1].split(':').map(Number);
    return parts.reduce((acc, n) => acc * 60 + n, 0);
  }
  return 0;
}

function artistList(node) {
  const list = node?.artists ?? node?.authors ?? [];
  const mapped = list
    .map((a) => ({
      id: a?.channel_id ?? a?.id ?? null,
      name: text(a?.name) || text(a?.title) || '',
    }))
    .filter((a) => a.name);
  if (!mapped.length) {
    const fallback = text(node?.author?.name) || text(node?.subtitle);
    if (fallback) mapped.push({ id: null, name: fallback.split('•')[0].trim() });
  }
  return mapped;
}

/** A catalog song, normalised to Cloudy's Track shape. */
export function toTrack(node, albumHint = null) {
  const id = node?.id ?? node?.video_id ?? node?.endpoint?.payload?.videoId ?? null;
  if (!id) return null;
  const artists = artistList(node);
  const album = node?.album?.name
    ? { id: node.album.id ?? null, name: text(node.album.name) }
    : albumHint
      ? { id: albumHint.id ?? null, name: albumHint.name ?? albumHint.title ?? '' }
      : null;
  const title = canonicalTitle(text(node?.title)) || text(node?.title);
  const seconds = durationFromRow(node);
  return {
    id,
    videoId: id,
    title: text(node?.title),
    displayTitle: title,
    artists,
    artist: artists[0]?.name ?? 'Unknown artist',
    album: album && album.name ? album : null,
    duration: seconds,
    durationText: text(node?.duration?.text) || formatDuration(seconds),
    thumbnail: artFor(id, firstThumb(node)),
    year: node?.year ? Number(text(node.year)) || null : null,
    explicit: Boolean(node?.badges?.some?.((b) => /explicit/i.test(text(b?.label)))),
    source: 'youtube-music',
  };
}

export function formatDuration(seconds = 0) {
  if (!seconds || Number.isNaN(seconds)) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function toArtist(node) {
  const id = node?.id ?? node?.channel_id ?? node?.endpoint?.payload?.browseId ?? null;
  if (!id) return null;
  return {
    id,
    name: text(node?.title) || text(node?.name) || '',
    thumbnail: firstThumb(node),
    subscribers: text(node?.subscribers) || null,
    kind: 'artist',
  };
}

function toAlbum(node) {
  const id = node?.id ?? node?.endpoint?.payload?.browseId ?? null;
  if (!id) return null;
  const artists = artistList(node);
  return {
    id,
    title: text(node?.title) || text(node?.name) || '',
    artists,
    artist: artists[0]?.name ?? '',
    year: node?.year ? Number(text(node.year)) || null : null,
    thumbnail: artFor(id, firstThumb(node)),
    trackCount: node?.item_count ?? null,
    kind: 'album',
  };
}

function toPlaylist(node) {
  const id = node?.id ?? node?.endpoint?.payload?.browseId ?? null;
  if (!id) return null;
  return {
    id,
    title: text(node?.title) || text(node?.name) || '',
    author: text(node?.author?.name) || artistList(node)[0]?.name || '',
    thumbnail: artFor(id, firstThumb(node)),
    trackCount: node?.item_count ?? null,
    kind: 'playlist',
  };
}

/** Flatten a music search response into shelves of typed items. */
function shelvesOf(response) {
  const shelves = [];
  for (const node of response?.contents ?? []) {
    if (node?.type === 'MusicShelf') shelves.push(node);
    else if (Array.isArray(node?.contents)) {
      for (const inner of node.contents) if (inner?.type === 'MusicShelf') shelves.push(inner);
    }
  }
  if (!shelves.length && response?.songs) return [response.songs];
  return shelves;
}

const TYPE_MAP = { song: 'song', songs: 'song', artist: 'artist', artists: 'artist', album: 'album', albums: 'album', playlist: 'playlist', playlists: 'playlist', video: 'video', videos: 'video' };

/** Structured catalog search. Returns raw nodes grouped by kind, filtered. */
export async function musicSearch(query, type = 'song') {
  const wanted = TYPE_MAP[type] ?? 'song';
  const key = `search:${wanted}:${query.toLowerCase()}`;
  const hit = cache.get(key);
  if (hit) return hit;

  let response;
  try {
    response = await withClient((yt) => yt.music.search(query, { type: wanted }));
  } catch (error) {
    // The album shelf carries item shapes the bundled parser rejects for some
    // queries. Song results already name their album, so build the list from
    // those rather than failing the whole tab.
    if (wanted === 'album') return cache.set(key, await albumsFromSongs(query), SEARCH_TTL);
    throw error;
  }
  const nodes = shelvesOf(response).flatMap((shelf) => shelf.contents ?? []);

  let result;
  if (wanted === 'song' || wanted === 'video') {
    result = collectTracks(nodes, wanted);
    result = collapseSongTitleQuery(query, result);
  } else if (wanted === 'artist') {
    result = nodes.map(toArtist).filter(Boolean);
  } else if (wanted === 'album') {
    result = nodes
      .map(toAlbum)
      .filter(Boolean)
      .filter((a) => isStudioAlbum(a.title, a.artist));
  } else {
    result = nodes.map(toPlaylist).filter(Boolean);
  }

  return cache.set(key, result, SEARCH_TTL);
}

/** Albums implied by song results, used when the album shelf cannot parse. */
async function albumsFromSongs(query) {
  const tracks = await musicSearch(query, 'song').catch(() => []);
  const albums = new Map();
  for (const track of tracks) {
    const name = track.album?.name;
    const id = track.album?.id;
    if (!name || !id || !isStudioAlbum(name, track.artist)) continue;
    const key = `${name.toLowerCase()}|${track.artist.toLowerCase()}`;
    if (albums.has(key)) continue;
    albums.set(key, {
      id,
      title: name,
      artists: track.artists ?? [],
      artist: track.artist,
      year: track.year ?? null,
      thumbnail: track.thumbnail,
      trackCount: null,
      kind: 'album',
    });
  }
  return [...albums.values()];
}

/**
 * Turn raw song nodes into a clean, de-duplicated studio list.
 * Two recordings of the same song by the same primary artist collapse into one,
 * keeping the version that looks most like the canonical studio release.
 */
export function collectTracks(nodes, wanted = 'song') {
  const buckets = new Map();
  for (const node of nodes) {
    if (!node) continue;
    if (wanted === 'song' && node.item_type && node.item_type !== 'song') continue;
    if (!isStudioItem(node)) continue;
    const track = toTrack(node);
    if (!track || !track.title) continue;
    if (!track.duration) continue;
    // A cover always announces itself on its album, even when the title is clean.
    if (track.album?.name && !isStudioAlbum(track.album.name, track.artist)) continue;
    const key = dedupeKey(track.title, track.artist);
    const existing = buckets.get(key);
    if (!existing) {
      buckets.set(key, track);
      continue;
    }
    buckets.set(key, betterVersion(existing, track));
  }
  return [...buckets.values()];
}

/**
 * When someone searches a song title, they want the song — not every cover,
 * remix and re-recording. When the query is an artist or a loose phrase, the
 * full catalog list stays.
 *
 * The top catalog hit is the authority: if the query reads as that song's name,
 * only versions of that song survive, and only the canonical one is returned.
 */
export function collapseSongTitleQuery(query, tracks) {
  if (tracks.length < 2) return tracks;
  const top = tracks[0];
  const normalizedQuery = query.toLowerCase().replace(/\s+/g, ' ').trim();
  const words = normalizedQuery.split(' ').filter(Boolean);
  if (words.length < 2) return tracks;

  const topTitle = pureTitle(top.title);
  const looksLikeTitle = topTitle === normalizedQuery || topTitle.startsWith(normalizedQuery);
  if (!looksLikeTitle) return tracks;

  const versions = tracks.filter((t) => pureTitle(t.title) === topTitle);
  if (versions.length < 2) return tracks;

  // Exact song-title query: one canonical result, which is what the user asked for.
  if (topTitle === normalizedQuery) {
    const canonical = versions.reduce((best, candidate) => betterVersion(best, candidate), versions[0]);
    return [canonical];
  }

  // Looser query: canonical version first, other songs still available below it.
  const canonical = versions.reduce((best, candidate) => betterVersion(best, candidate), versions[0]);
  const rest = tracks.filter((t) => pureTitle(t.title) !== topTitle);
  return [canonical, ...rest];
}

/** Prefer the plainest title with the most real metadata attached. */
function betterVersion(a, b) {
  const score = (t) => {
    let s = 0;
    if (t.thumbnail && !t.thumbnail.includes('i.ytimg.com')) s += 2;
    if (t.album) s += 2;
    if (t.displayTitle === t.title) s += 1;
    s -= Math.max(0, t.title.length - t.displayTitle.length) / 40;
    return s;
  };
  return score(b) > score(a) ? b : a;
}

/** Artist page: popular tracks, studio albums, singles, related artists. */
export async function getArtistPage(channelId) {
  const key = `artist:${channelId}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const yt = await getClient();
  const page = await yt.music.getArtist(channelId);
  const sections = page?.sections ?? [];

  const albums = [];
  const singles = [];
  const popular = [];
  const related = [];
  let name = text(page?.header?.title) || text(page?.header?.name) || text(page?.header?.strapline_text_one);
  let thumbnail = page?.header?.thumbnail?.[0]?.url ?? null;

  for (const section of sections) {
    const header = text(section?.header?.title) || text(section?.header?.straight_texts?.[0]);
    const contents = section?.contents ?? [];
    if (!thumbnail && section?.type === 'MusicShelf' && contents.length) {
      thumbnail = firstThumb(contents[0]) ?? null;
    }
    if (section?.type === 'MusicShelf') {
      // These come straight from the artist's own page, so they are studio
      // releases by definition; remixes here belong to the artist.
      for (const item of contents) {
        const track = toTrack(item);
        if (track && track.title) popular.push(track);
      }
      continue;
    }
    const label = header.toLowerCase();
    if (label.includes('album')) {
      for (const item of contents) {
        const album = toAlbum(item);
        if (album && isStudioTitle(album.title)) albums.push(album);
      }
    } else if (label.includes('single') || label.includes('ep')) {
      for (const item of contents) {
        const album = toAlbum(item);
        if (album && isStudioTitle(album.title)) singles.push(album);
      }
    } else if (label.includes('fans') || label.includes('similar') || label.includes('related')) {
      for (const item of contents) {
        const artist = toArtist(item);
        if (artist?.name) related.push(artist);
      }
    }
    // Videos / live performances / featured-on shelves are deliberately skipped.
  }

  if (!name) name = popular[0]?.artist ?? 'Artist';

  // YouTube Music caps the Popular shelf at five rows. Top the list up from the
  // artist's own catalog so "Popular" always holds ten real studio tracks.
  if (popular.length < 10 && name) {
    try {
      const extra = await musicSearch(name, 'song');
      const seen = new Set(popular.map((t) => dedupeKey(t.title, t.artist)));
      const wants = name.toLowerCase();
      for (const track of extra) {
        if (popular.length >= 10) break;
        const who = `${track.artist}`.toLowerCase();
        // Only the artist's own recordings, not someone else's song about them.
        const own = who.includes(wants) || wants.includes(who);
        if (!own) continue;
        const k = dedupeKey(track.title, track.artist);
        if (seen.has(k)) continue;
        seen.add(k);
        popular.push(track);
      }
    } catch {
      // the shelf alone is still a valid page
    }
  }

  const top = popular.slice(0, 10);
  await hydrateDurations(top);

  const payload = {
    id: channelId,
    name,
    thumbnail,
    popular: top,
    albums: albums.slice(0, 20),
    singles: singles.slice(0, 20),
    related: related.slice(0, 12),
  };
  return cache.set(key, payload, ENTITY_TTL);
}

/** Album page with tracks in catalog order. */
export async function getAlbumPage(albumId) {
  const key = `album:${albumId}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const yt = await getClient();
  const album = await yt.music.getAlbum(albumId);
  const header = album?.header ?? {};
  const title = text(header.title) || text(album?.title);
  const artistName = text(header.strapline_text_one) || text(album?.artist?.name);
  const metaLine = text(header.subtitle); // "Album • 2020"
  const year = Number(metaLine.match(/\b(19|20)\d{2}\b/)?.[0]) || null;
  const artists = artistName ? [{ id: album?.artist?.id ?? null, name: artistName }] : [];
  const hint = { id: albumId, name: title };

  const tracks = (album?.contents ?? [])
    .map((node, index) => ({ node, index }))
    .map(({ node, index }) => {
      const track = toTrack(node, hint);
      if (!track) return null;
      // Album rows often carry no per-track artist; the album's artist applies.
      const artist = track.artist === 'Unknown artist' && artistName ? artistName : track.artist;
      return {
        ...track,
        artist,
        artists: track.artist === artist ? track.artists : artist ? [{ id: null, name: artist }] : track.artists,
        trackNumber: Number(text(node?.index)) || index + 1,
      };
    })
    .filter(Boolean);

  const payload = {
    id: albumId,
    title,
    artist: artistName ?? '',
    artists,
    year,
    // Album ids are browse ids (MPREb_…), so a /vi/ thumbnail would 404. When
    // the header carries no art, borrow the cover from the first track.
    thumbnail: header?.thumbnail?.[0]?.url
      ? artFor(albumId, header.thumbnail[0].url)
      : (tracks[0]?.thumbnail ?? null),
    trackCount: tracks.length,
    duration: tracks.reduce((sum, t) => sum + (t.duration || 0), 0),
    subtitle: text(header.second_subtitle),
    tracks,
  };
  return cache.set(key, payload, ENTITY_TTL);
}

/** Playlist page (YouTube Music playlist id). */
export async function getPlaylistPage(playlistId) {
  const key = `playlist:${playlistId}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const yt = await getClient();
  const playlist = await yt.music.getPlaylist(playlistId);
  const seen = new Set();
  const tracks = [];
  for (const node of playlist?.items ?? []) {
    const track = toTrack(node, { id: null, name: text(playlist?.title) });
    if (!track || !track.title) continue;
    const key2 = dedupeKey(track.title, track.artist);
    if (seen.has(key2)) continue;
    seen.add(key2);
    tracks.push(track);
  }
  const payload = {
    id: playlistId,
    title: text(playlist?.header?.title) || text(playlist?.title),
    author: text(playlist?.author?.name),
    thumbnail: artFor(playlistId, firstThumb(playlist?.header) ?? firstThumb(playlist?.items?.[0])),
    trackCount: tracks.length,
    tracks,
  };
  return cache.set(key, payload, ENTITY_TTL);
}

/** Single track metadata (no stream URL) for the track endpoint. */
export async function getTrackInfo(videoId) {
  const key = `track:${videoId}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const yt = await getClient();
  const info = await yt.getInfo(videoId, { client: 'IOS' });
  const base = info?.basic_info ?? {};
  // Auto-generated art-track channels are named "<Artist> - Topic".
  const cleanArtist = String(base.author ?? '').replace(/\s*-\s*Topic$/i, '').trim();
  const payload = {
    id: videoId,
    videoId,
    title: canonicalTitle(base.title) || base.title || '',
    artist: cleanArtist,
    artists: [{ id: base.channel_id ?? null, name: cleanArtist }],
    album: null,
    duration: Number(base.duration) || 0,
    durationText: formatDuration(Number(base.duration) || 0),
    thumbnail: artFor(videoId, base.thumbnail?.[0]?.url),
    source: 'youtube-music',
  };
  return cache.set(key, payload, ENTITY_TTL);
}

/**
 * Resolve a playable audio URL.
 *
 * Order matters: iOS/Android clients hand back direct URLs most reliably, and
 * yt-dlp is the safety net when Innertube's player response is rotated or the
 * signature can't be deciphered. Audio only — never video.
 */
export async function resolveStream(videoId) {
  const hit = streamCache.get(videoId);
  if (hit) return hit;

  const attempts = ['IOS', 'ANDROID', 'TV', 'WEB'];
  const yt = await getClient();

  for (const client of attempts) {
    try {
      const info = await yt.getInfo(videoId, { client });
      const format = info.chooseFormat({ type: 'audio', quality: 'best' });
      if (!format) continue;
      const url = await format.decipher(yt.session.player);
      if (!url) continue;
      const resolved = {
        url,
        mimeType: format.mime_type ?? 'audio/mp4',
        bitrate: format.bitrate ?? null,
        quality: format.audio_quality ?? null,
        expiresAt: Date.now() + 45 * 60 * 1000,
        client,
      };
      return streamCache.set(videoId, resolved, 30 * 60 * 1000);
    } catch {
      // try the next client
    }
  }

  const fallback = await resolveWithYtDlp(videoId);
  return streamCache.set(videoId, fallback, 20 * 60 * 1000);
}

async function resolveWithYtDlp(videoId) {
  const { stdout } = await execFileAsync(
    ytDlpPath(),
    [
      '-f', 'bestaudio[acodec=opus]/bestaudio',
      '--no-warnings',
      '--no-playlist',
      '--get-url',
      '--get-format',
      `https://music.youtube.com/watch?v=${videoId}`,
    ],
    { timeout: 45_000, maxBuffer: 8 * 1024 * 1024 },
  );
  const lines = stdout.trim().split(/\r?\n/).filter(Boolean);
  const url = lines.find((l) => /^https?:\/\//.test(l));
  if (!url) throw new Error('yt-dlp returned no audio URL');
  const formatLine = lines.find((l) => !/^https?:\/\//.test(l)) ?? '';
  return {
    url,
    mimeType: /opus|webm/i.test(formatLine) ? 'audio/webm' : 'audio/mp4',
    bitrate: null,
    quality: formatLine || 'yt-dlp',
    expiresAt: Date.now() + 20 * 60 * 1000,
    client: 'yt-dlp',
  };
}

/** Artist shelf rows carry no runtime; fill them in from the video metadata. */
async function hydrateDurations(tracks) {
  const pending = tracks.filter((t) => !t.duration);
  if (!pending.length) return;
  const yt = await getClient();
  await Promise.allSettled(
    pending.map(async (track) => {
      try {
        const info = await yt.getInfo(track.id, { client: 'IOS' });
        const seconds = Number(info?.basic_info?.duration) || 0;
        if (seconds) {
          track.duration = seconds;
          track.durationText = formatDuration(seconds);
        }
      } catch {
        // leave the duration blank rather than failing the page
      }
    }),
  );
}

export function clearCaches() {
  cache.clear();
  streamCache.clear();
}

export { cache, streamCache };
