import { useEffect } from 'react';
import { audioEngine } from '../engine/audioEngine';
import { usePlayerStore, selectCurrentTrack } from '../store/playerStore';
import { bridge } from '@/shared/api/bridge';
import { updateSystemMediaSession } from '@/features/presence/lib/systemMedia';

/**
 * Bridges the audio element to the player store, then to the OS: media session
 * (Windows SMTC / macOS Now Playing), Discord presence and play counting.
 */
export function useAudioBindings() {
  useEffect(() => {
    const store = usePlayerStore.getState;

    const unsubs = [
      audioEngine.on('loadedmetadata', () => {
        const duration = audioEngine.duration;
        if (duration) store().setDuration(duration);
        store().setBuffering(false);
      }),
      audioEngine.on('durationchange', () => {
        const duration = audioEngine.duration;
        if (duration) store().setDuration(duration);
      }),
      audioEngine.on('timeupdate', () => store().setPosition(audioEngine.currentTime)),
      audioEngine.on('waiting', () => {
        // Only a track that is meant to be playing can be buffering.
        if (store().playing) store().setBuffering(true);
      }),
      audioEngine.on('playing', () => {
        store().setBuffering(false);
        store().setPlaying(true);
      }),
      audioEngine.on('play', () => store().setPlaying(true)),
      audioEngine.on('pause', () => store().setPlaying(false)),
      audioEngine.on('error', () => {
        store().setBuffering(false);
        store().setPlaying(false);
      }),
      audioEngine.on('ended', () => {
        void store().next(false);
      }),
    ];

    return () => unsubs.forEach((off) => off());
  }, []);

  // `timeupdate` only fires about four times a second, which makes anything
  // reading the clock (lyrics above all) step visibly late. While playing we
  // sample the element at ~12 Hz instead, and fall back to the native events
  // when paused.
  const clockPlaying = usePlayerStore((s) => s.playing);

  useEffect(() => {
    if (!clockPlaying) return;
    let frame = 0;
    let last = 0;
    const tick = (now: number) => {
      frame = requestAnimationFrame(tick);
      if (now - last < 80) return;
      last = now;
      usePlayerStore.getState().setPosition(audioEngine.currentTime);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [clockPlaying]);

  // OS media session: metadata, transport handlers and position state.
  const track = usePlayerStore(selectCurrentTrack);
  const playing = usePlayerStore((s) => s.playing);
  const duration = usePlayerStore((s) => s.duration);

  useEffect(() => {
    if (!track) return;
    updateSystemMediaSession(track, {
      play: () => void usePlayerStore.getState().toggle(),
      pause: () => void usePlayerStore.getState().toggle(),
      next: () => void usePlayerStore.getState().next(),
      previous: () => void usePlayerStore.getState().previous(),
      seek: (time: number) => usePlayerStore.getState().seek(time),
      seekBy: (delta: number) => usePlayerStore.getState().seekBy(delta),
    });
  }, [track]);

  useEffect(() => {
    updateSystemMediaSession(null, null, { playing });
  }, [playing]);

  // Discord presence — throttled to one update every 15s while playing.
  useEffect(() => {
    if (!track) return;
    let cancelled = false;
    const send = () => {
      if (cancelled) return;
      const state = usePlayerStore.getState();
      void bridge()
        .presence.update({
          title: track.title,
          artist: track.artist,
          album: track.album?.name ?? null,
          thumbnail: track.thumbnail,
          position: Math.floor(state.position),
          duration: Math.round(state.duration || track.duration || 0),
          playing: state.playing,
        })
        .catch(() => undefined);
    };
    send();
    const interval = setInterval(send, 15_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [track, playing]);

  // Record the play once the listener has actually heard a chunk of it.
  useEffect(() => {
    if (!track) return;
    const timer = setTimeout(() => {
      void bridge()
        .library.markPlayed(track.id, usePlayerStore.getState().position)
        .catch(() => undefined);
    }, 12_000);
    return () => clearTimeout(timer);
  }, [track?.id]);

  // Native thumbar transport (Windows) mirrors play state.
  useEffect(() => {
    void bridge().app.thumbar(playing).catch(() => undefined);
  }, [playing]);

  useEffect(() => {
    if (duration > 0 && 'mediaSession' in navigator) {
      try {
        navigator.mediaSession.setPositionState({
          duration,
          position: Math.min(duration, usePlayerStore.getState().position),
          playbackRate: 1,
        });
      } catch {
        /* position state is best-effort */
      }
    }
  }, [duration]);
}
