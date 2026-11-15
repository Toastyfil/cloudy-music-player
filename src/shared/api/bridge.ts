// Single access point for everything that lives in the Electron main process.
//
// When Cloudy runs in a browser (design previews, tests) the same surface is
// emulated on top of localStorage, so features never branch on the runtime.
import type {
  AlbumSummary,
  ArtistSummary,
  FavoriteAlbum,
  FavoriteArtist,
  LibraryPlaylist,
  LibraryTrack,
  Track,
} from './contracts';

/** The exact surface exposed by electron/preload.ts. */
export interface Bridge {
  window: {
    minimize(): Promise<void>;
    toggleMaximize(): Promise<boolean>;
    close(): Promise<void>;
    quit(): Promise<void>;
    isMaximized(): Promise<boolean>;
    onState(cb: (state: { maximized: boolean }) => void): () => void;
  };
  library: {
    all(sort?: string): Promise<LibraryTrack[]>;
    search(query: string): Promise<LibraryTrack[]>;
    add(track: Track): Promise<LibraryTrack>;
    remove(id: string): Promise<void>;
    has(id: string): Promise<boolean>;
    markPlayed(id: string, seconds: number): Promise<void>;
    recent(limit?: number): Promise<LibraryTrack[]>;
    mostPlayed(limit?: number): Promise<LibraryTrack[]>;
  };
  favorites: {
    ids(): Promise<string[]>;
    all(): Promise<LibraryTrack[]>;
    has(id: string): Promise<boolean>;
    add(track: Track): Promise<void>;
    remove(id: string): Promise<void>;
    artists(): Promise<FavoriteArtist[]>;
    artistIds(): Promise<string[]>;
    addArtist(artist: ArtistSummary): Promise<void>;
    removeArtist(id: string): Promise<void>;
    albums(): Promise<FavoriteAlbum[]>;
    albumIds(): Promise<string[]>;
    addAlbum(album: AlbumSummary): Promise<void>;
    removeAlbum(id: string): Promise<void>;
  };
  playlists: {
    all(): Promise<LibraryPlaylist[]>;
    create(name: string, description?: string, source?: string | null): Promise<LibraryPlaylist>;
    rename(id: string, name: string): Promise<void>;
    remove(id: string): Promise<void>;
    addTrack(id: string, track: Track): Promise<void>;
    removeTrack(id: string, trackId: string): Promise<void>;
    tracks(id: string): Promise<Track[]>;
    cover(id: string): Promise<string | null>;
  };
  settings: {
    all(): Promise<Record<string, unknown>>;
    set(key: string, value: unknown): Promise<boolean>;
  };
  queue: {
    save(payload: unknown): Promise<boolean>;
    load(): Promise<unknown>;
  };
  cache: {
    track(videoId: string, streamUrl: string): Promise<string | null>;
    path(videoId: string): Promise<string | null>;
    stats(): Promise<{ files: number; bytes: number; directory: string }>;
    clear(): Promise<{ files: number; bytes: number; directory: string }>;
    remove(videoId: string): Promise<boolean>;
  };
  presence: {
    update(payload: unknown): Promise<{ ok: boolean; reason?: string }>;
    clear(): Promise<{ ok: boolean }>;
    setEnabled(value: boolean): Promise<{ ok: boolean; enabled?: boolean }>;
  };
  shell: { openExternal(url: string): Promise<unknown> };
  app: {
    info(): Promise<{ version: string; platform: string; apiOrigin: string; userData: string }>;
    dbStats(): Promise<{ tracks: number; playlists: number }>;
    thumbar(playing: boolean): Promise<unknown>;
  };
  events: {
    onMediaAction(cb: (action: string) => void): () => void;
    onDeeplink(cb: (route: string) => void): () => void;
  };
  updates: {
    state(): Promise<UpdateStatus>;
    check(quiet?: boolean): Promise<UpdateStatus>;
    install(): Promise<{ ok: boolean; error?: string }>;
    onState(cb: (status: UpdateStatus) => void): () => void;
  };
  isElectron: boolean;
}

export type UpdatePhase = 'idle' | 'checking' | 'downloading' | 'ready' | 'installing' | 'error' | 'current';

export interface UpdateStatus {
  phase: UpdatePhase;
  version?: string;
  notes?: string;
  progress?: number;
  bytes?: number;
  total?: number;
  error?: string;
  /** When the last successful or failed check finished. */
  checkedAt?: number;
}

declare global {
  interface Window {
    cloudy?: Bridge;
  }
}

export const isElectron = () => Boolean(window.cloudy?.isElectron);

/* ------------------------------------------------------------- fallback ---- */

const LS_PREFIX = 'cloudy:';

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(LS_PREFIX + key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(LS_PREFIX + key, JSON.stringify(value));
  } catch {
    /* storage can be full or blocked */
  }
}

function toLibraryTrack(track: Track, addedAt = Date.now()): LibraryTrack {
  return { ...track, addedAt, playCount: 0, lastPlayedAt: null, cachedPath: null };
}

// A browser preview has no installer to run, so `?updateDemo=1` plays the whole
// download → ready sequence locally to design and test the prompt.
const updateListeners = new Set<(status: UpdateStatus) => void>();
let previewUpdate: UpdateStatus = { phase: 'idle' };

function emitUpdate(next: UpdateStatus) {
  previewUpdate = next;
  for (const listener of updateListeners) listener(next);
}

function runUpdateDemo() {
  if (typeof location === 'undefined' || !new URLSearchParams(location.search).has('updateDemo')) return;
  emitUpdate({ phase: 'downloading', version: '1.1.2', progress: 0.34, notes: '' });
  let progress = 0.34;
  const tick = window.setInterval(() => {
    progress = Math.min(1, progress + 0.16);
    if (progress >= 1) {
      window.clearInterval(tick);
      emitUpdate({
        phase: 'ready',
        version: '1.1.2',
        progress: 1,
        notes: 'Lyrics stay on the beat, the queue remembers where you were, and the player starts a little faster.',
      });
      return;
    }
    emitUpdate({ phase: 'downloading', version: '1.1.2', progress, notes: '' });
  }, 420);
}

const browserBridge: Bridge = {
  window: {
    minimize: async () => undefined,
    toggleMaximize: async () => false,
    close: async () => undefined,
    quit: async () => undefined,
    isMaximized: async () => false,
    onState: () => () => undefined,
  },
  library: {
    all: async (sort?: string) => {
      const tracks = read<LibraryTrack[]>('library', []);
      const sorted = [...tracks];
      if (sort === 'title') sorted.sort((a, b) => a.title.localeCompare(b.title));
      else if (sort === 'artist') sorted.sort((a, b) => a.artist.localeCompare(b.artist));
      else if (sort === 'length') sorted.sort((a, b) => b.duration - a.duration);
      else sorted.sort((a, b) => b.addedAt - a.addedAt);
      return sorted;
    },
    search: async (q: string) => {
      const needle = q.toLowerCase();
      return read<LibraryTrack[]>('library', []).filter(
        (t) =>
          t.title.toLowerCase().includes(needle) ||
          t.artist.toLowerCase().includes(needle) ||
          (t.album?.name ?? '').toLowerCase().includes(needle),
      );
    },
    add: async (track: Track) => {
      const tracks = read<LibraryTrack[]>('library', []);
      const existing = tracks.find((t) => t.id === track.id);
      if (existing) return existing;
      const record = toLibraryTrack(track);
      write('library', [record, ...tracks]);
      return record;
    },
    remove: async (id: string) => {
      write('library', read<LibraryTrack[]>('library', []).filter((t) => t.id !== id));
    },
    has: async (id: string) => read<LibraryTrack[]>('library', []).some((t) => t.id === id),
    markPlayed: async (id: string, seconds: number) => {
      const tracks = read<LibraryTrack[]>('library', []).map((t) =>
        t.id === id
          ? { ...t, playCount: t.playCount + 1, lastPlayedAt: Date.now(), duration: t.duration }
          : t,
      );
      write('library', tracks);
      const plays = read<{ trackId: string; at: number; seconds: number }[]>('plays', []);
      write('plays', [{ trackId: id, at: Date.now(), seconds }, ...plays].slice(0, 500));
    },
    recent: async (limit = 20) =>
      read<LibraryTrack[]>('library', [])
        .filter((t) => t.lastPlayedAt)
        .sort((a, b) => (b.lastPlayedAt ?? 0) - (a.lastPlayedAt ?? 0))
        .slice(0, limit),
    mostPlayed: async (limit = 20) =>
      read<LibraryTrack[]>('library', [])
        .filter((t) => t.playCount > 0)
        .sort((a, b) => b.playCount - a.playCount)
        .slice(0, limit),
  },
  favorites: {
    ids: async () => read<string[]>('favorites', []),
    all: async () => {
      const ids = new Set(read<string[]>('favorites', []));
      return read<LibraryTrack[]>('library', []).filter((track) => ids.has(track.id));
    },
    has: async (id: string) => read<string[]>('favorites', []).includes(id),
    add: async (track: Track) => {
      await browserBridge.library.add(track);
      const ids = read<string[]>('favorites', []);
      if (!ids.includes(track.id)) write('favorites', [track.id, ...ids]);
    },
    remove: async (id: string) => {
      write(
        'favorites',
        read<string[]>('favorites', []).filter((trackId) => trackId !== id),
      );
    },
    artists: async () => read<FavoriteArtist[]>('favoriteArtists', []),
    artistIds: async () => read<FavoriteArtist[]>('favoriteArtists', []).map((artist) => artist.id),
    addArtist: async (artist: ArtistSummary) => {
      const list = read<FavoriteArtist[]>('favoriteArtists', []);
      if (list.some((entry) => entry.id === artist.id)) return;
      write('favoriteArtists', [{ ...artist, addedAt: Date.now() }, ...list]);
    },
    removeArtist: async (id: string) => {
      write(
        'favoriteArtists',
        read<FavoriteArtist[]>('favoriteArtists', []).filter((artist) => artist.id !== id),
      );
    },
    albums: async () => read<FavoriteAlbum[]>('favoriteAlbums', []),
    albumIds: async () => read<FavoriteAlbum[]>('favoriteAlbums', []).map((album) => album.id),
    addAlbum: async (album: AlbumSummary) => {
      const list = read<FavoriteAlbum[]>('favoriteAlbums', []);
      if (list.some((entry) => entry.id === album.id)) return;
      write('favoriteAlbums', [{ ...album, addedAt: Date.now() }, ...list]);
    },
    removeAlbum: async (id: string) => {
      write(
        'favoriteAlbums',
        read<FavoriteAlbum[]>('favoriteAlbums', []).filter((album) => album.id !== id),
      );
    },
  },
  playlists: {
    all: async () => read<LibraryPlaylist[]>('playlists', []),
    create: async (name: string, description = '', source: string | null = null) => {
      const now = Date.now();
      const playlist: LibraryPlaylist = {
        id: `pl_${now.toString(36)}`,
        name,
        description,
        cover: null,
        trackCount: 0,
        createdAt: now,
        updatedAt: now,
        source,
      };
      write('playlists', [playlist, ...read<LibraryPlaylist[]>('playlists', [])]);
      return playlist;
    },
    rename: async (id: string, name: string) => {
      write(
        'playlists',
        read<LibraryPlaylist[]>('playlists', []).map((p) => (p.id === id ? { ...p, name, updatedAt: Date.now() } : p)),
      );
    },
    remove: async (id: string) => {
      write('playlists', read<LibraryPlaylist[]>('playlists', []).filter((p) => p.id !== id));
      write(`playlist:${id}`, []);
    },
    addTrack: async (id: string, track: Track) => {
      const key = `playlist:${id}`;
      const tracks = read<Track[]>(key, []);
      if (!tracks.some((t) => t.id === track.id)) write(key, [...tracks, track]);
      await browserBridge.library.add(track);
      write(
        'playlists',
        read<LibraryPlaylist[]>('playlists', []).map((p) =>
          p.id === id ? { ...p, trackCount: tracks.length + (tracks.some((t) => t.id === track.id) ? 0 : 1), updatedAt: Date.now() } : p,
        ),
      );
    },
    removeTrack: async (id: string, trackId: string) => {
      const key = `playlist:${id}`;
      const tracks = read<Track[]>(key, []).filter((t) => t.id !== trackId);
      write(key, tracks);
      write(
        'playlists',
        read<LibraryPlaylist[]>('playlists', []).map((p) => (p.id === id ? { ...p, trackCount: tracks.length } : p)),
      );
    },
    tracks: async (id: string) => read<Track[]>(`playlist:${id}`, []) as LibraryTrack[],
    cover: async (id: string) => read<Track[]>(`playlist:${id}`, []).find((t) => t.thumbnail)?.thumbnail ?? null,
  },
  settings: {
    all: async () => read<Record<string, unknown>>('settings', {}),
    set: async (key: string, value: unknown) => {
      write('settings', { ...read<Record<string, unknown>>('settings', {}), [key]: value });
      return true;
    },
  },
  queue: {
    save: async (payload: unknown) => {
      write('queue', payload);
      return true;
    },
    load: async () => read('queue', null),
  },
  cache: {
    track: async () => null,
    path: async () => null,
    stats: async () => ({ files: 0, bytes: 0, directory: 'browser' }),
    clear: async () => ({ files: 0, bytes: 0, directory: 'browser' }),
    remove: async () => true,
  },
  presence: {
    update: async () => ({ ok: false, reason: 'browser' }),
    clear: async () => ({ ok: true }),
    setEnabled: async (value: boolean) => ({ ok: true, enabled: value }),
  },
  shell: {
    openExternal: async (url: string) => {
      window.open(url, '_blank', 'noopener,noreferrer');
      return true;
    },
  },
  updates: {
    state: async () => previewUpdate,
    check: async () => {
      runUpdateDemo();
      return previewUpdate;
    },
    install: async () => ({ ok: false, error: 'Updates install in the desktop app' }),
    onState: (cb) => {
      updateListeners.add(cb);
      return () => updateListeners.delete(cb);
    },
  },
  app: {
    info: async () => ({ version: '1.1.1', platform: 'browser', apiOrigin: 'http://127.0.0.1:3456', userData: 'browser' }),
    dbStats: async () => ({ tracks: read<unknown[]>('library', []).length, playlists: read<unknown[]>('playlists', []).length }),
    thumbar: async () => false,
  },
  events: {
    onMediaAction: () => () => undefined,
    onDeeplink: () => () => undefined,
  },
  isElectron: true,
};

export function bridge(): Bridge {
  return window.cloudy ?? browserBridge;
}

export type { Track, LibraryTrack, LibraryPlaylist };
