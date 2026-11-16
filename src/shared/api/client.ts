import type {
  AlbumPage,
  AlbumSummary,
  ArtistPage,
  ArtistSummary,
  ImportResult,
  PlaylistPage,
  PlaylistSummary,
  SearchAll,
  Track,
  TrackDetail,
} from './contracts';
import { isExternalTrack, type CatalogSource } from '@/shared/config/sources';

/**
 * The desktop app talks to its bundled service on loopback. A browser preview
 * has no loopback access to it, so it reaches the same service through the dev
 * server's `/api` proxy instead.
 */
function defaultOrigin() {
  if (typeof window === 'undefined') return 'http://127.0.0.1:3456';
  return window.cloudy ? 'http://127.0.0.1:3456' : '/api';
}

let origin = defaultOrigin();

export function setApiOrigin(next: string) {
  origin = next.replace(/\/$/, '');
}

export function apiOrigin() {
  return origin;
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

/** Waits for a service that is still starting rather than failing the first paint. */
const READY_TIMEOUT = 15_000;

async function fetchWhenReady(url: string, init?: RequestInit) {
  const deadline = Date.now() + READY_TIMEOUT;
  for (;;) {
    try {
      return await fetch(url, init);
    } catch (error) {
      // A refused connection means the bundled service is not listening yet;
      // an abort or a real network error must surface immediately.
      const refused = error instanceof TypeError && !init?.signal?.aborted;
      if (!refused || Date.now() >= deadline) throw error;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25_000);
  try {
    const res = await fetchWhenReady(`${origin}${path}`, {
      ...init,
      signal: init?.signal ?? controller.signal,
      headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
    });
    if (!res.ok) {
      let message = `Request failed (${res.status})`;
      try {
        const body = (await res.json()) as { error?: string };
        if (body?.error) message = body.error;
      } catch {
        /* keep the status message */
      }
      throw new ApiError(message, res.status);
    }
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

export const searchApi = {
  /** No source means every catalog at once; the backend interleaves them. */
  songs: (q: string, source?: CatalogSource) =>
    request<{ count: number; results: Track[] }>(
      `/search?q=${encodeURIComponent(q)}&type=songs${source ? `&source=${source}` : ''}`,
    ),
  artists: (q: string) =>
    request<{ results: ArtistSummary[] }>(`/search?q=${encodeURIComponent(q)}&type=artists`),
  albums: (q: string) =>
    request<{ results: AlbumSummary[] }>(`/search?q=${encodeURIComponent(q)}&type=albums`),
  playlists: (q: string) =>
    request<{ results: PlaylistSummary[] }>(`/search?q=${encodeURIComponent(q)}&type=playlists`),
  all: (q: string) => request<SearchAll>(`/search/all?q=${encodeURIComponent(q)}`),
};

export const catalogApi = {
  artist: (id: string) => request<ArtistPage>(`/artist/${encodeURIComponent(id)}`),
  album: (id: string) => request<AlbumPage>(`/album/${encodeURIComponent(id)}`),
  playlist: (id: string) => request<PlaylistPage>(`/playlist/${encodeURIComponent(id)}`),
  track: (id: string) => request<TrackDetail>(`/track/${encodeURIComponent(id)}`),
  stream: (id: string) => `${origin}/stream/${encodeURIComponent(id)}`,
  health: () => request<{ ok: boolean; catalog: string }>('/health'),
};

const resolved = new Map<string, string>();

/**
 * Maps a SoundCloud / Deezer / Apple Music result to the audio id Cloudy plays.
 * The first click pays for the match; the answer is remembered for the session
 * and the backend keeps it for a month, so replays and skips are instant.
 */
export const resolveApi = {
  known(track: Track): string | null {
    if (!isExternalTrack(track)) return track.videoId ?? track.id;
    // Audius plays its own audio, so its catalog results already carry the id.
    if (track.source === 'audius' && track.videoId) return track.videoId;
    return resolved.get(track.id) ?? null;
  },
  /** Forget a session match so the next attempt asks the service again. */
  forget(track: Track) {
    resolved.delete(track.id);
  },
  /** Pin a track to an id we already know plays, e.g. a recovered alternative. */
  remember(track: Track, videoId: string) {
    resolved.set(track.id, videoId);
  },
  /**
   * Ask for another recording of the same song. Returns null when the service
   * has nothing else to offer, which is a normal answer rather than an error.
   */
  async fallback(track: Track, exclude?: string | null): Promise<string | null> {
    try {
      const match = await request<{ videoId?: string }>('/resolve/fallback', {
        method: 'POST',
        body: JSON.stringify({
          title: track.title,
          artist: track.artist,
          duration: track.duration,
          exclude: exclude ?? null,
        }),
      });
      const videoId = match?.videoId;
      if (!videoId) return null;
      resolved.set(track.id, videoId);
      return videoId;
    } catch {
      return null;
    }
  },
  async playableId(track: Track): Promise<string> {
    const cached = resolved.get(track.id);
    if (cached) return cached;
    // Audius brings its own audio id; nothing to match, nothing to wait for.
    if (track.source === 'audius' && track.videoId) return track.videoId;
    if (!isExternalTrack(track)) return track.videoId ?? track.id;
    const match = await request<{ videoId: string }>('/resolve', {
      method: 'POST',
      body: JSON.stringify({
        id: track.id,
        source: track.source,
        title: track.title,
        artist: track.artist,
        duration: track.duration,
      }),
    });
    if (!match?.videoId) throw new ApiError('Not available in the catalog Cloudy plays from', 404);
    resolved.set(track.id, match.videoId);
    return match.videoId;
  },
};

export const importApi = {
  resolve: (url: string) =>
    request<ImportResult>('/import/resolve', { method: 'POST', body: JSON.stringify({ url }) }),
};
