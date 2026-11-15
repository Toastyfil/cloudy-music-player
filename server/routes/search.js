import { Router } from 'express';
import { musicSearch } from '../lib/youtube.js';
import { SOURCE_IDS, searchAllSources, searchSource } from '../lib/sources.js';

const router = Router();

const PUBLIC_TYPES = new Set(['songs', 'artists', 'albums', 'playlists']);

/** `all` (the default) searches every catalog at once. */
function readSource(value) {
  const source = String(value ?? 'all').toLowerCase();
  if (source === 'all') return 'all';
  return SOURCE_IDS.has(source) ? source : null;
}

router.get('/', async (req, res, next) => {
  const q = String(req.query.q ?? '').trim();
  const type = String(req.query.type ?? 'songs').toLowerCase();
  const source = readSource(req.query.source);
  if (!q) return res.status(400).json({ error: 'Missing q', results: [] });
  if (!source) return res.status(400).json({ error: 'Unsupported source' });
  if (!PUBLIC_TYPES.has(type)) {
    return res.status(400).json({ error: `Unsupported type. Use ${[...PUBLIC_TYPES].join(', ')}` });
  }

  try {
    if (type === 'songs') {
      if (source === 'all') {
        const songs = await searchAllSources(q, { limit: 30 });
        return res.json({ type, query: q, source, count: songs.length, results: songs });
      }
      if (source !== 'youtube') {
        const songs = await searchSource(source, q, 'song');
        return res.json({ type, query: q, source, count: songs.length, results: songs });
      }
      const songs = await musicSearch(q, 'song');
      return res.json({ type, query: q, source, count: songs.length, results: songs });
    }

    // Artists, albums and playlists are Cloudy pages, and those only exist for
    // the catalog Cloudy plays from.
    if (source !== 'youtube' && source !== 'all') {
      return res.json({ type, query: q, source, count: 0, results: [] });
    }

    const results =
      type === 'artists'
        ? await musicSearch(q, 'artist')
        : type === 'albums'
          ? await musicSearch(q, 'album')
          : await musicSearch(q, 'playlist');
    return res.json({ type, query: q, source, count: results.length, results });
  } catch (err) {
    next(err);
  }
});

/** Everything at once for the "All" tab: songs from every catalog, plus pages. */
router.get('/all', async (req, res, next) => {
  const q = String(req.query.q ?? '').trim();
  if (!q) return res.status(400).json({ error: 'Missing q' });
  try {
    const [songs, artists, albums, playlists] = await Promise.all([
      searchAllSources(q, { limit: 12 }),
      musicSearch(q, 'artist').catch(() => []),
      musicSearch(q, 'album').catch(() => []),
      musicSearch(q, 'playlist').catch(() => []),
    ]);
    res.json({
      query: q,
      songs: songs.slice(0, 12),
      artists: artists.slice(0, 6),
      albums: albums.slice(0, 6),
      playlists: playlists.slice(0, 6),
    });
  } catch (err) {
    next(err);
  }
});

export default router;
