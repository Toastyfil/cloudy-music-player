import { create } from 'zustand';
import type { Track } from '@/shared/api/contracts';
import { catalogApi, resolveApi } from '@/shared/api/client';
import { bridge } from '@/shared/api/bridge';
import { audioEngine } from '../engine/audioEngine';
import { useSettingsStore } from '@/features/settings/store/settingsStore';

export type RepeatMode = 'off' | 'all' | 'one';

interface PersistedQueue {
  queue: Track[];
  index: number;
  position: number;
  volume: number;
  repeat: RepeatMode;
  shuffle: boolean;
}

interface PlayerState {
  queue: Track[];
  index: number;
  playing: boolean;
  buffering: boolean;
  position: number;
  duration: number;
  volume: number;
  muted: boolean;
  repeat: RepeatMode;
  shuffle: boolean;
  shuffleOrder: number[];
  error: string | null;
  source: 'stream' | 'cache' | null;
  playTracks: (tracks: Track[], startIndex?: number) => Promise<void>;
  playNow: (track: Track) => Promise<void>;
  playAt: (index: number) => Promise<void>;
  toggle: () => Promise<void>;
  next: (userInitiated?: boolean) => Promise<void>;
  previous: () => Promise<void>;
  seek: (seconds: number) => void;
  seekBy: (delta: number) => void;
  setVolume: (value: number) => void;
  adjustVolume: (delta: number) => void;
  toggleMute: () => void;
  cycleRepeat: () => void;
  toggleShuffle: () => void;
  enqueue: (track: Track, position?: 'next' | 'end') => void;
  removeFromQueue: (index: number) => void;
  moveInQueue: (from: number, to: number) => void;
  clearQueue: () => Promise<void>;
  hydrate: () => Promise<void>;
  setDuration: (duration: number) => void;
  setPosition: (position: number) => void;
  setBuffering: (value: boolean) => void;
  setPlaying: (value: boolean) => void;
}

/**
 * A play() promise rejects with AbortError whenever something else calls
 * pause()/load() first — skipping tracks, seeking, or hitting stop. The browser
 * words it as "The play() request was interrupted by a call to pause()", and it
 * includes the media URL, so it must never reach the UI.
 */
export function isPlaybackRace(error: unknown) {
  // DOMException is not always an Error instance, so read the fields directly
  // instead of relying on instanceof.
  const name = (error as { name?: unknown } | null)?.name;
  if (name === 'AbortError') return true;
  const message =
    typeof error === 'string'
      ? error
      : ((error as { message?: unknown } | null)?.message as string | undefined) ?? '';
  return /interrupted by a call to|play\(\) request was interrupted|abort/i.test(message);
}

/**
 * Browser media errors are written for developers ("Failed to load because no
 * supported source was found") and often carry a URL, so they are translated
 * into one short sentence and the original is left in the console.
 */
export function describePlaybackError(error: unknown) {
  if (isPlaybackRace(error)) return null;
  const name = (error as { name?: unknown } | null)?.name;
  const raw = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  if (raw) console.warn('[cloudy] playback failed:', raw);

  if (name === 'NotAllowedError') return 'Playback blocked — press play again';
  if (name === 'NetworkError' || /network|failed to fetch|load failed/i.test(raw)) {
    return 'Network error — could not reach the audio service';
  }
  if (name === 'NotSupportedError' || /no supported source|src not supported|format/i.test(raw)) {
    return 'No playable audio for this track';
  }
  return 'Couldn’t play this track';
}

/** A source the element refused to decode — as opposed to an autoplay block. */
function isSourceFailure(error: unknown) {
  const name = (error as { name?: unknown } | null)?.name;
  const raw = error instanceof Error ? error.message : '';
  return name === 'NotSupportedError' || /no supported source|src not supported|format/i.test(raw);
}

/**
 * The stream route answers with JSON when the source refuses to hand over
 * audio (deleted video, region lock, DRM). Handing that to <audio> only ever
 * surfaces as a decode error, so ask for the first bytes and check that they
 * are actually audio before the element ever sees the URL.
 *
 * A slow first byte is *not* a refusal: a track on a slow connection is still
 * downloading, and the element should buffer on it rather than be declared
 * broken. Only a real answer that is not audio counts against the recording.
 */
async function probeStream(url: string): Promise<'audio' | 'silent' | 'unknown'> {
  try {
    const response = await fetch(url, {
      headers: { Range: 'bytes=0-1023' },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return 'silent';
    if (!(response.headers.get('content-type') ?? '').startsWith('audio/')) return 'silent';
    const reader = response.body?.getReader();
    const first = reader ? await reader.read() : null;
    if (reader) await reader.cancel().catch(() => undefined);
    return first?.value && first.value.byteLength > 256 ? 'audio' : 'silent';
  } catch {
    return 'unknown';
  }
}

/**
 * Warm the next two queue entries: resolve their playable id, then ask the
 * service to start a background download. `/stream/:id/info` kicks off the
 * same job playback would, so a later skip is a disk read instead of a search
 * plus a fresh extraction.
 */
function prefetchUpcoming(queue: Track[], index: number, signal: AbortSignal) {
  const upcoming = [queue[index + 1], queue[index + 2]].filter((track): track is Track => Boolean(track));
  for (const track of upcoming) {
    void (async () => {
      try {
        if (signal.aborted) return;
        const id = await resolveApi.playableId(track);
        if (signal.aborted) return;
        await fetch(`${catalogApi.stream(id)}/info`, { signal, priority: 'low' } as RequestInit);
      } catch {
        // Prefetch is a head start, never a requirement: the click path retries.
      }
    })();
  }
}

/** One prefetch batch at a time; a track change cancels the previous one. */
let prefetchAbort: AbortController | null = null;
let prefetchTimer = 0;

function cancelPrefetch() {
  window.clearTimeout(prefetchTimer);
  prefetchAbort?.abort();
  prefetchAbort = null;
}

/**
 * Every load bumps the token, so a rejection from a track the user already
 * skipped away from can never write its state (or its message) onto the UI.
 */
let playToken = 0;

function shuffled(length: number, current: number) {
  const order = Array.from({ length }, (_, i) => i).filter((i) => i !== current);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return [current, ...order];
}

let persistTimer: ReturnType<typeof setTimeout> | null = null;

function persist(get: () => PlayerState) {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    const { queue, index, position, volume, repeat, shuffle } = get();
    void bridge().queue.save({ queue, index, position, volume, repeat, shuffle } satisfies PersistedQueue);
  }, 700);
}

export const usePlayerStore = create<PlayerState>((set, get) => ({
  queue: [],
  index: -1,
  playing: false,
  buffering: false,
  position: 0,
  duration: 0,
  volume: 0.8,
  muted: false,
  repeat: 'off',
  shuffle: false,
  shuffleOrder: [],
  error: null,
  source: null,

  async playTracks(tracks, startIndex = 0) {
    if (!tracks.length) return;
    set({
      queue: tracks,
      index: startIndex,
      shuffleOrder: get().shuffle ? shuffled(tracks.length, startIndex) : [],
      error: null,
    });
    await get().playAt(startIndex);
  },

  async playNow(track) {
    const { queue, index } = get();
    const existing = queue.findIndex((t) => t.id === track.id);
    if (existing >= 0 && existing === index) {
      await get().toggle();
      return;
    }
    if (existing >= 0) {
      await get().playAt(existing);
      return;
    }
    const insertAt = index >= 0 ? index + 1 : 0;
    const nextQueue = [...queue];
    nextQueue.splice(insertAt, 0, track);
    set({ queue: nextQueue });
    await get().playAt(insertAt);
  },

  async playAt(index) {
    const { queue } = get();
    const track = queue[index];
    if (!track) return;
    const token = ++playToken;
    // Every newer load invalidates any play() still resolving on the old one,
    // and kills the prefetch that would otherwise compete for the new stream.
    audioEngine.setPlayToken(token);
    cancelPrefetch();
    // Drop the old source entirely: pausing alone lets a late play() from the
    // previous track resume for a moment once its promise settles.
    audioEngine.halt();
    set({ index, buffering: true, error: null, position: 0, duration: track.duration || 0 });

    try {
      // SoundCloud / Deezer / Apple Music results carry no audio id of their
      // own; the service matches them to the catalog once and remembers it.
      let playableId: string;
      try {
        playableId = await resolveApi.playableId(track);
      } catch {
        // A catalog miss is usually a missed match rather than a missing song,
        // so ask for another recording before calling the track unavailable.
        const recovered = await resolveApi.fallback(track, null);
        if (token !== playToken) return;
        if (!recovered) {
          set({ buffering: false, playing: false, error: 'This track isn’t available to stream' });
          persist(get);
          return;
        }
        playableId = recovered;
      }
      if (token !== playToken) return;

      let url: string | null = null;
      let source: 'stream' | 'cache' = 'stream';
      try {
        url = await bridge().cache.path(playableId);
      } catch {
        url = null;
      }
      if (url) source = 'cache';
      else url = catalogApi.stream(playableId);

      // Cached files are already verified audio. A stream is checked for a
      // real answer, but a slow one simply buffers; only an answer that is not
      // audio sends us looking for a different recording of the same song.
      if (source === 'stream' && (await probeStream(url)) === 'silent') {
        const alternative = await resolveApi.fallback(track, playableId);
        if (token !== playToken) return;
        const alternativeUrl = alternative ? catalogApi.stream(alternative) : null;
        const alternativeProbe = alternativeUrl ? await probeStream(alternativeUrl) : 'silent';
        if (!alternative || !alternativeUrl || alternativeProbe === 'silent') {
          set({
            buffering: false,
            playing: false,
            error: 'Track unavailable',
          });
          persist(get);
          return;
        }
        playableId = alternative;
        url = alternativeUrl;
      }
      if (token !== playToken) return;

      set({ source });
      try {
        await audioEngine.load(url);
        if (token !== playToken) return;
        audioEngine.fadeIn(useSettingsStore.getState().fadeMs);
        await audioEngine.play();
      } catch (error) {
        if (token !== playToken) return;
        // The element refused this source outright. One more recording is worth
        // a try; autoplay blocks and interrupted loads are not source failures.
        const alternative =
          source === 'stream' && isSourceFailure(error) ? await resolveApi.fallback(track, playableId) : null;
        if (token !== playToken) return;
        if (!alternative) throw error;
        playableId = alternative;
        url = catalogApi.stream(alternative);
        await audioEngine.load(url);
        if (token !== playToken) return;
        audioEngine.fadeIn(useSettingsStore.getState().fadeMs);
        await audioEngine.play();
      }
      if (token !== playToken) return;
      set({ playing: true, buffering: false });
      // Only warm the queue once this track is actually streaming, so the
      // prefetch never steals bandwidth from the track the user is waiting on.
      const controller = new AbortController();
      prefetchAbort = controller;
      prefetchTimer = window.setTimeout(() => {
        if (prefetchAbort !== controller || controller.signal.aborted) return;
        const state = get();
        if (state.buffering || !state.playing || state.error) return;
        prefetchUpcoming(queue, index, controller.signal);
      }, 3000);

      // Audio is already persisted by the streaming service, so playback never
      // waits on a second copy. Tracks explicitly cached by the user are served
      // from cloudy-media:// above.
    } catch (error) {
      // Skipping, seeking or pausing while a track is still loading makes the
      // browser reject the pending play() promise. That is normal, not a
      // failure, and must never surface as an error in the player bar — and a
      // superseded track must not touch the current track's state at all.
      if (token !== playToken) return;
      set({ buffering: false, playing: false, error: describePlaybackError(error) });
    }
    persist(get);
  },

  async toggle() {
    const { playing, queue, index, error } = get();
    if (!queue.length) return;
    if (index < 0) {
      await get().playAt(0);
      return;
    }
    if (playing) {
      audioEngine.fadeOutThenPause(useSettingsStore.getState().fadeMs);
      set({ playing: false, buffering: false, error: null });
      return;
    }

    // After a failed load the element still points at a source it could not
    // decode, and play() on it can never succeed — so play means "load and try
    // this track again" rather than nudging a dead element.
    if (error) {
      await get().playAt(index);
      return;
    }

    try {
      audioEngine.fadeIn(useSettingsStore.getState().fadeMs);
      await audioEngine.play();
      set({ playing: true, error: null });
    } catch (playError) {
      if (isPlaybackRace(playError)) return;
      const name = (playError as { name?: unknown } | null)?.name;
      const raw = playError instanceof Error ? playError.message : '';
      // A source that never decoded is worth one full reload before giving up.
      if (name === 'NotSupportedError' || /no supported source|src not supported/i.test(raw)) {
        await get().playAt(index);
        return;
      }
      const message = describePlaybackError(playError);
      if (message) set({ playing: false, error: message });
    }
  },

  async next(userInitiated = true) {
    const { queue, index, repeat, shuffle, shuffleOrder } = get();
    if (!queue.length) return;
    if (repeat === 'one' && !userInitiated) {
      audioEngine.seek(0);
      await audioEngine.play();
      return;
    }
    let target = index + 1;
    if (shuffle && shuffleOrder.length) {
      const position = shuffleOrder.indexOf(index);
      target = shuffleOrder[(position + 1) % shuffleOrder.length];
    }
    if (target >= queue.length) {
      if (repeat === 'all' || userInitiated) target = 0;
      else {
        audioEngine.pause();
        set({ playing: false });
        return;
      }
    }
    await get().playAt(target);
  },

  async previous() {
    const { index, position } = get();
    if (position > 4) {
      audioEngine.seek(0);
      set({ position: 0 });
      return;
    }
    const target = index - 1;
    if (target < 0) {
      audioEngine.seek(0);
      set({ position: 0 });
      return;
    }
    await get().playAt(target);
  },

  seek(seconds) {
    audioEngine.seek(seconds);
    set({ position: Math.max(0, seconds), buffering: false });
  },

  seekBy(delta) {
    const { position, duration } = get();
    const next = Math.max(0, Math.min(duration || Infinity, position + delta));
    audioEngine.seek(next);
    set({ position: next });
  },

  setVolume(value) {
    const volume = Math.max(0, Math.min(1, value));
    audioEngine.setVolume(volume);
    set({ volume, muted: volume === 0 });
    persist(get);
  },

  adjustVolume(delta) {
    get().setVolume(get().volume + delta);
  },

  toggleMute() {
    const muted = !get().muted;
    audioEngine.setMuted(muted);
    set({ muted });
  },

  cycleRepeat() {
    const order: RepeatMode[] = ['off', 'all', 'one'];
    const repeat = order[(order.indexOf(get().repeat) + 1) % order.length];
    set({ repeat });
    persist(get);
  },

  toggleShuffle() {
    const shuffle = !get().shuffle;
    set({ shuffle, shuffleOrder: shuffle ? shuffled(get().queue.length, get().index) : [] });
    persist(get);
  },

  enqueue(track, position = 'end') {
    const { queue, index } = get();
    const nextQueue = [...queue];
    if (queue.some((t) => t.id === track.id)) return;
    if (position === 'next') nextQueue.splice(index + 1, 0, track);
    else nextQueue.push(track);
    set({ queue: nextQueue, shuffleOrder: get().shuffle ? shuffled(nextQueue.length, get().index) : [] });
    persist(get);
  },

  removeFromQueue(removeIndex) {
    const { queue, index } = get();
    const nextQueue = queue.filter((_, i) => i !== removeIndex);
    let nextIndex = index;
    if (removeIndex < index) nextIndex -= 1;
    if (removeIndex === index) nextIndex = Math.max(0, index - 0);
    set({
      queue: nextQueue,
      index: nextQueue.length ? Math.min(nextIndex, nextQueue.length - 1) : -1,
    });
    persist(get);
  },

  moveInQueue(from, to) {
    const { queue, index } = get();
    if (from === to || from < 0 || to < 0 || from >= queue.length || to >= queue.length) return;
    const nextQueue = [...queue];
    const [moved] = nextQueue.splice(from, 1);
    nextQueue.splice(to, 0, moved);
    let nextIndex = index;
    if (from === index) nextIndex = to;
    else if (from < index && to >= index) nextIndex = index - 1;
    else if (from > index && to <= index) nextIndex = index + 1;
    set({ queue: nextQueue, index: nextIndex });
    persist(get);
  },

  async clearQueue() {
    audioEngine.pause();
    set({ queue: [], index: -1, playing: false, position: 0, duration: 0, error: null });
    persist(get);
  },

  async hydrate() {
    try {
      const saved = (await bridge().queue.load()) as PersistedQueue | null;
      if (!saved?.queue?.length) return;
      set({
        queue: saved.queue,
        index: saved.index,
        volume: saved.volume ?? 0.8,
        repeat: saved.repeat ?? 'off',
        shuffle: saved.shuffle ?? false,
        duration: saved.queue[saved.index]?.duration ?? 0,
      });
      audioEngine.setVolume(saved.volume ?? 0.8);
      const track = saved.queue[saved.index];
      if (track) {
        const playableId = await resolveApi.playableId(track).catch(() => null);
        if (!playableId) return;
        const local = await bridge().cache.path(playableId).catch(() => null);
        await audioEngine.load(local ?? catalogApi.stream(playableId));
        audioEngine.seek(saved.position ?? 0);
        set({ position: saved.position ?? 0, source: local ? 'cache' : 'stream' });
      }
    } catch {
      /* a fresh install has nothing to restore */
    }
  },

  setDuration(duration) {
    set({ duration });
  },
  setPosition(position) {
    set({ position });
  },
  setBuffering(value) {
    set({ buffering: value });
  },
  setPlaying(value) {
    set({ playing: value });
  },
}));

/** Convenience selectors. */
export const selectCurrentTrack = (state: PlayerState): Track | null => state.queue[state.index] ?? null;
