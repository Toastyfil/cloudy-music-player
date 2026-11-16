import { create } from 'zustand';
import type { Track } from '@/shared/api/contracts';
import { fetchLyrics } from '../api/lrclib';
import { useSettingsStore } from '@/features/settings/store/settingsStore';
import { parseLrc, type LyricLine } from '../lib/lrc';

type Status = 'idle' | 'loading' | 'synced' | 'plain' | 'instrumental' | 'empty' | 'error';

interface Snapshot {
  status: Status;
  lines: LyricLine[];
  plain: string | null;
  offset: number;
}

interface LyricsState extends Snapshot {
  trackId: string | null;
  error: string | null;
  /** Per-track fine tuning, in seconds, persisted across sessions. */
  trackOffsets: Record<string, number>;
  load: (track: Track) => Promise<void>;
  setOffset: (offset: number) => void;
  setTrackOffset: (trackId: string, offset: number) => void;
  reset: () => void;
}

const OFFSETS_KEY = 'cloudy:lyric-offsets:v1';

function readOffsets(): Record<string, number> {
  try {
    const parsed = JSON.parse(localStorage.getItem(OFFSETS_KEY) ?? '{}');
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, number>) : {};
  } catch {
    return {};
  }
}

function writeOffsets(map: Record<string, number>) {
  try {
    localStorage.setItem(OFFSETS_KEY, JSON.stringify(map));
  } catch {
    /* quota — the in-memory map still works for this session */
  }
}

/**
 * Parsed lyrics are kept per track id, so opening the panel, switching to
 * fullscreen or coming back to a track never re-parses or re-fetches anything.
 */
const snapshots = new Map<string, Snapshot>();
const pending = new Map<string, Promise<Snapshot>>();

const EMPTY: Snapshot = { status: 'empty', lines: [], plain: null, offset: 0 };

async function resolveLyrics(track: Track): Promise<Snapshot> {
  // "Online lyrics lookup" off means no network call at all, not a cached miss.
  if (!useSettingsStore.getState().onlineLyrics) return EMPTY;
  const result = await fetchLyrics(track);
  if (!result) return EMPTY;
  if (result.instrumental) return { status: 'instrumental', lines: [], plain: null, offset: 0 };

  if (result.syncedLyrics) {
    const parsed = parseLrc(result.syncedLyrics);
    if (parsed.instrumental) return { status: 'instrumental', lines: [], plain: null, offset: 0 };
    if (parsed.lines.length) {
      return { status: 'synced', lines: parsed.lines, plain: null, offset: parsed.offset };
    }
  }
  if (result.plainLyrics) {
    return { status: 'plain', lines: [], plain: result.plainLyrics, offset: 0 };
  }
  return EMPTY;
}

export const useLyricsStore = create<LyricsState>((set, get) => ({
  status: 'idle',
  lines: [],
  plain: null,
  offset: 0,
  trackId: null,
  error: null,
  trackOffsets: readOffsets(),

  async load(track) {
    const cached = snapshots.get(track.id);
    if (cached) {
      const state = get();
      if (state.trackId !== track.id || state.status !== cached.status) {
        set({ ...cached, trackId: track.id, error: null });
      }
      return;
    }

    // Already loading or loaded for this track — nothing to do. Empty and error
    // states are retried, because LRCLIB gains lyrics over time.
    const current = get();
    if (current.trackId === track.id && (current.status === 'loading' || current.status === 'synced' || current.status === 'plain' || current.status === 'instrumental')) {
      return;
    }

    set({ status: 'loading', trackId: track.id, error: null, lines: [], plain: null, offset: 0 });

    try {
      let request = pending.get(track.id);
      if (!request) {
        request = resolveLyrics(track);
        pending.set(track.id, request);
      }
      const snapshot = await request;
      pending.delete(track.id);
      if (snapshot.status === 'synced' || snapshot.status === 'plain' || snapshot.status === 'instrumental') {
        snapshots.set(track.id, snapshot);
      }
      if (get().trackId !== track.id) return;
      set({ ...snapshot, error: null });
    } catch (error) {
      pending.delete(track.id);
      if (get().trackId !== track.id) return;
      set({
        status: 'error',
        error: error instanceof Error ? error.message : 'Lyrics unavailable',
      });
    }
  },

  setOffset(offset) {
    set({ offset });
  },

  setTrackOffset(trackId, offset) {
    const next = { ...get().trackOffsets };
    // A video can carry a long intro or outro relative to the master the LRC was
    // timed against, so this is a real shift, not just a fine nudge.
    const value = Math.max(-45, Math.min(45, Math.round(offset * 100) / 100));
    if (value === 0) delete next[trackId];
    else next[trackId] = value;
    writeOffsets(next);
    set({ trackOffsets: next });
  },

  reset() {
    set({ status: 'idle', lines: [], plain: null, trackId: null, error: null, offset: 0 });
  },
}));
