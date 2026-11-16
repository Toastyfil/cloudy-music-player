// Local library store. Everything Cloudy remembers lives here: saved tracks,
// user playlists, play history and settings. better-sqlite3 runs synchronously
// in the main process, which keeps the IPC surface trivial.
import Database from 'better-sqlite3';
import path from 'node:path';
import type {
  AlbumSummary,
  ArtistSummary,
  FavoriteAlbum,
  FavoriteArtist,
  LibraryPlaylist,
  LibraryTrack,
  Track,
} from '../src/shared/api/contracts';

type Row = Record<string, unknown>;

let db: Database.Database | null = null;

export function initDatabase(userDataPath: string) {
  // A distinct filename keeps Cloudy's library away from any other database that
  // happens to live in the same application-data folder.
  const file = path.join(userDataPath, 'cloudy-library.db');
  db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS tracks (
      id TEXT PRIMARY KEY,
      video_id TEXT NOT NULL,
      title TEXT NOT NULL,
      artist TEXT NOT NULL,
      artists TEXT NOT NULL DEFAULT '[]',
      album_id TEXT,
      album_name TEXT,
      duration INTEGER NOT NULL DEFAULT 0,
      thumbnail TEXT,
      year INTEGER,
      explicit INTEGER NOT NULL DEFAULT 0,
      source TEXT NOT NULL DEFAULT 'youtube-music',
      added_at INTEGER NOT NULL,
      play_count INTEGER NOT NULL DEFAULT 0,
      last_played_at INTEGER,
      cached_path TEXT
    );

    CREATE TABLE IF NOT EXISTS favorites (
      track_id TEXT PRIMARY KEY REFERENCES tracks(id) ON DELETE CASCADE,
      added_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS favorite_artists (
      artist_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      thumbnail TEXT,
      added_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS favorite_albums (
      album_id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      artist TEXT NOT NULL DEFAULT '',
      thumbnail TEXT,
      year INTEGER,
      added_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS playlists (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      cover TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      source TEXT
    );

    CREATE TABLE IF NOT EXISTS playlist_tracks (
      playlist_id TEXT NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
      track_id TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
      position INTEGER NOT NULL,
      added_at INTEGER NOT NULL,
      PRIMARY KEY (playlist_id, track_id)
    );

    CREATE TABLE IF NOT EXISTS plays (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      track_id TEXT NOT NULL,
      played_at INTEGER NOT NULL,
      seconds INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS queue_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      payload TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_tracks_added ON tracks(added_at DESC);
    CREATE INDEX IF NOT EXISTS idx_favorites_added ON favorites(added_at DESC);
    CREATE INDEX IF NOT EXISTS idx_fav_artists_added ON favorite_artists(added_at DESC);
    CREATE INDEX IF NOT EXISTS idx_fav_albums_added ON favorite_albums(added_at DESC);
    CREATE INDEX IF NOT EXISTS idx_tracks_played ON tracks(last_played_at DESC);
    CREATE INDEX IF NOT EXISTS idx_plays_at ON plays(played_at DESC);
    CREATE INDEX IF NOT EXISTS idx_playlist_pos ON playlist_tracks(playlist_id, position);
  `);

  // Libraries created before multi-source search have no `source` column.
  try {
    db.exec("ALTER TABLE tracks ADD COLUMN source TEXT NOT NULL DEFAULT 'youtube-music'");
  } catch {
    /* already present */
  }

  return db;
}

function requireDb() {
  if (!db) throw new Error('Database not initialised');
  return db;
}

function toLibraryTrack(row: Row): LibraryTrack {
  return {
    id: String(row.id),
    videoId: String(row.video_id),
    title: String(row.title),
    artist: String(row.artist),
    artists: safeParse<{ id: string | null; name: string }[]>(String(row.artists ?? '[]'), []),
    album: row.album_name ? { id: (row.album_id as string) ?? null, name: String(row.album_name) } : null,
    duration: Number(row.duration ?? 0),
    durationText: formatDuration(Number(row.duration ?? 0)),
    thumbnail: (row.thumbnail as string) ?? null,
    year: row.year == null ? null : Number(row.year),
    explicit: Boolean(row.explicit),
    source: (row.source as string) ?? 'youtube-music',
    addedAt: Number(row.added_at ?? 0),
    playCount: Number(row.play_count ?? 0),
    lastPlayedAt: row.last_played_at == null ? null : Number(row.last_played_at),
    cachedPath: (row.cached_path as string) ?? null,
  };
}

function safeParse<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function formatDuration(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export const library = {
  all(sort: 'recent' | 'title' | 'artist' | 'length' = 'recent'): LibraryTrack[] {
    const order =
      sort === 'title'
        ? 'title COLLATE NOCASE ASC'
        : sort === 'artist'
          ? 'artist COLLATE NOCASE ASC, title COLLATE NOCASE ASC'
          : sort === 'length'
            ? 'duration DESC'
            : 'added_at DESC';
    return requireDb().prepare(`SELECT * FROM tracks ORDER BY ${order}`).all().map((r) => toLibraryTrack(r as Row));
  },

  search(query: string): LibraryTrack[] {
    const q = `%${query.trim().toLowerCase()}%`;
    return requireDb()
      .prepare(
        `SELECT * FROM tracks
         WHERE lower(title) LIKE ? OR lower(artist) LIKE ? OR lower(COALESCE(album_name,'')) LIKE ?
         ORDER BY added_at DESC LIMIT 100`,
      )
      .all(q, q, q)
      .map((r) => toLibraryTrack(r as Row));
  },

  add(track: Track): LibraryTrack {
    const now = Date.now();
    const database = requireDb();
    database
      .prepare(
        `INSERT INTO tracks (id, video_id, title, artist, artists, album_id, album_name, duration, thumbnail, year, explicit, source, added_at, play_count, last_played_at, cached_path)
         VALUES (@id, @videoId, @title, @artist, @artists, @albumId, @albumName, @duration, @thumbnail, @year, @explicit, @source, @addedAt, 0, NULL, NULL)
         ON CONFLICT(id) DO UPDATE SET
           title = excluded.title,
           artist = excluded.artist,
           artists = excluded.artists,
           album_id = excluded.album_id,
           album_name = excluded.album_name,
           duration = excluded.duration,
           source = excluded.source,
           thumbnail = COALESCE(excluded.thumbnail, tracks.thumbnail)`,
      )
      .run({
        id: track.id,
        videoId: track.videoId ?? track.id,
        title: track.title,
        artist: track.artist,
        artists: JSON.stringify(track.artists ?? []),
        albumId: track.album?.id ?? null,
        albumName: track.album?.name ?? null,
        duration: Math.round(track.duration ?? 0),
        thumbnail: track.thumbnail ?? null,
        year: track.year ?? null,
        explicit: track.explicit ? 1 : 0,
        source: track.source ?? 'youtube-music',
        addedAt: now,
      });
    const row = database.prepare('SELECT * FROM tracks WHERE id = ?').get(track.id) as Row;
    return toLibraryTrack(row);
  },

  remove(id: string) {
    requireDb().prepare('DELETE FROM tracks WHERE id = ?').run(id);
  },

  has(id: string) {
    const row = requireDb().prepare('SELECT 1 FROM tracks WHERE id = ?').get(id);
    return Boolean(row);
  },

  markPlayed(id: string, seconds: number) {
    const database = requireDb();
    const now = Date.now();
    database
      .prepare('UPDATE tracks SET play_count = play_count + 1, last_played_at = ? WHERE id = ?')
      .run(now, id);
    database.prepare('INSERT INTO plays (track_id, played_at, seconds) VALUES (?, ?, ?)').run(id, now, Math.round(seconds));
  },

  setCachedPath(id: string, cachedPath: string | null) {
    requireDb().prepare('UPDATE tracks SET cached_path = ? WHERE id = ?').run(cachedPath, id);
  },

  recentlyPlayed(limit = 20): LibraryTrack[] {
    return requireDb()
      .prepare(
        `SELECT * FROM tracks WHERE last_played_at IS NOT NULL
         ORDER BY last_played_at DESC LIMIT ?`,
      )
      .all(limit)
      .map((r) => toLibraryTrack(r as Row));
  },

  mostPlayed(limit = 20): LibraryTrack[] {
    return requireDb()
      .prepare('SELECT * FROM tracks WHERE play_count > 0 ORDER BY play_count DESC, last_played_at DESC LIMIT ?')
      .all(limit)
      .map((r) => toLibraryTrack(r as Row));
  },
};

export const favorites = {
  ids(): string[] {
    const rows = requireDb()
      .prepare('SELECT track_id FROM favorites ORDER BY added_at DESC')
      .all() as { track_id: string }[];
    return rows.map((row) => row.track_id);
  },

  all(): LibraryTrack[] {
    return requireDb()
      .prepare(
        `SELECT t.* FROM favorites f JOIN tracks t ON t.id = f.track_id
         ORDER BY f.added_at DESC`,
      )
      .all()
      .map((row) => toLibraryTrack(row as Row));
  },

  has(trackId: string) {
    return Boolean(requireDb().prepare('SELECT 1 FROM favorites WHERE track_id = ?').get(trackId));
  },

  add(track: Track) {
    library.add(track);
    requireDb()
      .prepare('INSERT INTO favorites (track_id, added_at) VALUES (?, ?) ON CONFLICT(track_id) DO NOTHING')
      .run(track.id, Date.now());
  },

  remove(trackId: string) {
    requireDb().prepare('DELETE FROM favorites WHERE track_id = ?').run(trackId);
  },

  artists(): FavoriteArtist[] {
    return requireDb()
      .prepare('SELECT * FROM favorite_artists ORDER BY added_at DESC')
      .all()
      .map((row) => {
        const record = row as Row;
        return {
          id: String(record.artist_id),
          name: String(record.name),
          thumbnail: (record.thumbnail as string) ?? null,
          kind: 'artist' as const,
          addedAt: Number(record.added_at),
        };
      });
  },

  artistIds(): string[] {
    const rows = requireDb().prepare('SELECT artist_id FROM favorite_artists').all() as { artist_id: string }[];
    return rows.map((row) => row.artist_id);
  },

  addArtist(artist: ArtistSummary) {
    requireDb()
      .prepare(
        `INSERT INTO favorite_artists (artist_id, name, thumbnail, added_at) VALUES (?,?,?,?)
         ON CONFLICT(artist_id) DO UPDATE SET
           name = excluded.name,
           thumbnail = COALESCE(excluded.thumbnail, favorite_artists.thumbnail)`,
      )
      .run(artist.id, artist.name, artist.thumbnail ?? null, Date.now());
  },

  removeArtist(artistId: string) {
    requireDb().prepare('DELETE FROM favorite_artists WHERE artist_id = ?').run(artistId);
  },

  albums(): FavoriteAlbum[] {
    return requireDb()
      .prepare('SELECT * FROM favorite_albums ORDER BY added_at DESC')
      .all()
      .map((row) => {
        const record = row as Row;
        return {
          id: String(record.album_id),
          title: String(record.title),
          artist: String(record.artist ?? ''),
          artists: [{ id: null, name: String(record.artist ?? '') }],
          year: record.year == null ? null : Number(record.year),
          thumbnail: (record.thumbnail as string) ?? null,
          kind: 'album' as const,
          addedAt: Number(record.added_at),
        };
      });
  },

  albumIds(): string[] {
    const rows = requireDb().prepare('SELECT album_id FROM favorite_albums').all() as { album_id: string }[];
    return rows.map((row) => row.album_id);
  },

  addAlbum(album: AlbumSummary) {
    requireDb()
      .prepare(
        `INSERT INTO favorite_albums (album_id, title, artist, thumbnail, year, added_at) VALUES (?,?,?,?,?,?)
         ON CONFLICT(album_id) DO UPDATE SET
           title = excluded.title,
           artist = excluded.artist,
           thumbnail = COALESCE(excluded.thumbnail, favorite_albums.thumbnail),
           year = excluded.year`,
      )
      .run(album.id, album.title, album.artist ?? '', album.thumbnail ?? null, album.year ?? null, Date.now());
  },

  removeAlbum(albumId: string) {
    requireDb().prepare('DELETE FROM favorite_albums WHERE album_id = ?').run(albumId);
  },
};

export const playlists = {
  all(): LibraryPlaylist[] {
    const rows = requireDb()
      .prepare(
        `SELECT p.*, (SELECT COUNT(*) FROM playlist_tracks pt WHERE pt.playlist_id = p.id) AS track_count
         FROM playlists p ORDER BY p.updated_at DESC`,
      )
      .all() as Row[];
    return rows.map((row) => ({
      id: String(row.id),
      name: String(row.name),
      description: String(row.description ?? ''),
      cover: (row.cover as string) ?? null,
      trackCount: Number(row.track_count ?? 0),
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
      source: (row.source as string) ?? null,
    }));
  },

  create(name: string, description = '', source: string | null = null): LibraryPlaylist {
    const id = `pl_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
    const now = Date.now();
    requireDb()
      .prepare('INSERT INTO playlists (id, name, description, cover, created_at, updated_at, source) VALUES (?,?,?,?,?,?,?)')
      .run(id, name, description, null, now, now, source);
    return { id, name, description, cover: null, trackCount: 0, createdAt: now, updatedAt: now, source };
  },

  rename(id: string, name: string) {
    requireDb().prepare('UPDATE playlists SET name = ?, updated_at = ? WHERE id = ?').run(name, Date.now(), id);
  },

  remove(id: string) {
    requireDb().prepare('DELETE FROM playlists WHERE id = ?').run(id);
  },

  addTrack(playlistId: string, track: Track) {
    library.add(track);
    const database = requireDb();
    const max = database
      .prepare('SELECT COALESCE(MAX(position), -1) AS pos FROM playlist_tracks WHERE playlist_id = ?')
      .get(playlistId) as { pos: number };
    database
      .prepare(
        `INSERT INTO playlist_tracks (playlist_id, track_id, position, added_at) VALUES (?,?,?,?)
         ON CONFLICT(playlist_id, track_id) DO NOTHING`,
      )
      .run(playlistId, track.id, max.pos + 1, Date.now());
    database.prepare('UPDATE playlists SET updated_at = ? WHERE id = ?').run(Date.now(), playlistId);
  },

  removeTrack(playlistId: string, trackId: string) {
    requireDb().prepare('DELETE FROM playlist_tracks WHERE playlist_id = ? AND track_id = ?').run(playlistId, trackId);
  },

  /** Drop a track at a new index and renumber every row around it. */
  moveTrack(playlistId: string, trackId: string, toIndex: number) {
    const database = requireDb();
    const rows = database
      .prepare('SELECT track_id FROM playlist_tracks WHERE playlist_id = ? ORDER BY position ASC')
      .all(playlistId) as { track_id: string }[];
    const ids = rows.map((row) => String(row.track_id));
    const from = ids.indexOf(trackId);
    if (from < 0) return;
    ids.splice(from, 1);
    ids.splice(Math.max(0, Math.min(ids.length, Math.round(toIndex))), 0, trackId);
    const update = database.prepare('UPDATE playlist_tracks SET position = ? WHERE playlist_id = ? AND track_id = ?');
    database.transaction(() => {
      ids.forEach((id, index) => update.run(index, playlistId, id));
    })();
    database.prepare('UPDATE playlists SET updated_at = ? WHERE id = ?').run(Date.now(), playlistId);
  },

  tracks(playlistId: string): LibraryTrack[] {
    return requireDb()
      .prepare(
        `SELECT t.* FROM playlist_tracks pt JOIN tracks t ON t.id = pt.track_id
         WHERE pt.playlist_id = ? ORDER BY pt.position ASC`,
      )
      .all(playlistId)
      .map((r) => toLibraryTrack(r as Row));
  },

  cover(playlistId: string): string | null {
    const row = requireDb()
      .prepare(
        `SELECT t.thumbnail FROM playlist_tracks pt JOIN tracks t ON t.id = pt.track_id
         WHERE pt.playlist_id = ? AND t.thumbnail IS NOT NULL ORDER BY pt.position ASC LIMIT 1`,
      )
      .get(playlistId) as { thumbnail?: string } | undefined;
    return row?.thumbnail ?? null;
  },
};

export const settings = {
  get<T>(key: string, fallback: T): T {
    const row = requireDb().prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value?: string } | undefined;
    if (!row?.value) return fallback;
    return safeParse<T>(row.value, fallback);
  },
  set(key: string, value: unknown) {
    requireDb()
      .prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run(key, JSON.stringify(value));
  },
  all(): Record<string, unknown> {
    const rows = requireDb().prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[];
    return Object.fromEntries(rows.map((r) => [r.key, safeParse<unknown>(r.value, null)]));
  },
};

export const queueState = {
  save(payload: unknown) {
    requireDb()
      .prepare('INSERT INTO queue_state (id, payload) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET payload = excluded.payload')
      .run(JSON.stringify(payload));
  },
  load<T>(): T | null {
    const row = requireDb().prepare('SELECT payload FROM queue_state WHERE id = 1').get() as { payload?: string } | undefined;
    return row?.payload ? safeParse<T>(row.payload, null as unknown as T) : null;
  },
};

export function databaseStats() {
  const database = requireDb();
  const tracks = (database.prepare('SELECT COUNT(*) AS n FROM tracks').get() as { n: number }).n;
  const playlistCount = (database.prepare('SELECT COUNT(*) AS n FROM playlists').get() as { n: number }).n;
  return { tracks, playlists: playlistCount };
}

export function closeDatabase() {
  db?.close();
  db = null;
}
