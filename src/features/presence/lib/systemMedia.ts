import type { Track } from '@/shared/api/contracts';

/**
 * Windows SMTC / macOS Now Playing come for free through Chromium's Media
 * Session API. Setting metadata and action handlers here is what puts Cloudy in
 * the OS media overlay, the lock screen and the hardware media keys.
 */
type Handlers = {
  play: () => void;
  pause: () => void;
  next: () => void;
  previous: () => void;
  seek: (time: number) => void;
  seekBy?: (delta: number) => void;
};

let handlers: Handlers | null = null;
let bound = false;

function bind() {
  if (!('mediaSession' in navigator) || bound) return;
  const session = navigator.mediaSession;
  const safe = (fn: MediaSessionActionHandler | null, action: MediaSessionAction) => {
    try {
      session.setActionHandler(action, fn);
    } catch {
      /* browser may not support this action */
    }
  };
  safe(() => handlers?.play(), 'play');
  safe(() => handlers?.pause(), 'pause');
  safe(() => handlers?.next(), 'nexttrack');
  safe(() => handlers?.previous(), 'previoustrack');
  safe((details) => {
    if (typeof details.seekTime === 'number') handlers?.seek(details.seekTime);
  }, 'seekto');
  safe(() => handlers?.seekBy?.(5), 'seekforward');
  safe(() => handlers?.seekBy?.(-5), 'seekbackward');
  bound = true;
}

export function updateSystemMediaSession(
  track: Track | null,
  actions: Handlers | null,
  state?: { playing?: boolean },
) {
  if (!('mediaSession' in navigator)) return;
  if (actions) {
    handlers = actions;
    bind();
  }

  if (track) {
    const artwork = track.thumbnail
      ? [
          { src: track.thumbnail, sizes: '96x96', type: 'image/jpeg' },
          { src: track.thumbnail, sizes: '256x256', type: 'image/jpeg' },
          { src: track.thumbnail, sizes: '512x512', type: 'image/jpeg' },
        ]
      : [];
    navigator.mediaSession.metadata = new MediaMetadata({
      title: track.title,
      artist: track.artist,
      album: track.album?.name ?? 'Cloudy',
      artwork,
    });
  }

  if (state?.playing !== undefined) {
    navigator.mediaSession.playbackState = state.playing ? 'playing' : 'paused';
  }
}
