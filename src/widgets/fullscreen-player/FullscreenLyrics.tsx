import { AnimatePresence, motion } from 'framer-motion';
import {
  ChevronDown,
  Heart,
  Minus,
  Pause,
  Play,
  Plus,
  Repeat,
  Repeat1,
  Shuffle,
  SkipBack,
  SkipForward,
} from 'lucide-react';
import { useEffect } from 'react';
import { cn } from '@/shared/lib/cn';
import { WavyProgressRing } from '@/shared/ui/WavyProgressRing';
import { usePlayerStore, selectCurrentTrack } from '@/features/player/store/playerStore';
import { useUiStore } from '@/features/navigation/store/uiStore';
import { LyricsBody } from '@/features/lyrics/ui/LyricsPanel';
import { useLyricsStore } from '@/features/lyrics/store/lyricsStore';
import { useFavoritesStore } from '@/features/favorites/store/favoritesStore';
import { SeekBar } from '@/features/player/ui/SeekBar';
import { VolumeControl } from '@/features/player/ui/VolumeControl';
import { sourceLabel } from '@/shared/config/sources';
import { useSettingsStore } from '@/features/settings/store/settingsStore';

const DARK_ICON = 'text-white/65 hover:bg-white/10 hover:text-white';

/**
 * Now playing, full window: the cover, transport and volume sit in a column on
 * the left, the lyrics run large on the right over a blurred wash of the
 * artwork. Deliberately dark in every theme — this is the one screen that is
 * about the music rather than the app chrome.
 */
export function FullscreenLyrics() {
  const open = useUiStore((s) => s.fullscreenLyrics);
  const toggle = useUiStore((s) => s.toggleFullscreenLyrics);
  const track = usePlayerStore(selectCurrentTrack);
  const index = usePlayerStore((s) => s.index);
  const length = usePlayerStore((s) => s.queue.length);
  const playing = usePlayerStore((s) => s.playing);
  const shapedCoversNowPlaying = useSettingsStore((s) => s.shapedCoversNowPlaying);
  const titleAlign = useSettingsStore((s) => s.nowPlayingTitleAlign);
  const toolbarPosition = useSettingsStore((s) => s.nowPlayingToolbarPosition);
  const buffering = usePlayerStore((s) => s.buffering);
  const repeat = usePlayerStore((s) => s.repeat);
  const shuffle = usePlayerStore((s) => s.shuffle);
  const togglePlay = usePlayerStore((s) => s.toggle);
  const next = usePlayerStore((s) => s.next);
  const previous = usePlayerStore((s) => s.previous);
  const cycleRepeat = usePlayerStore((s) => s.cycleRepeat);
  const toggleShuffle = usePlayerStore((s) => s.toggleShuffle);
  const load = useLyricsStore((s) => s.load);

  const favorite = useFavoritesStore((s) => Boolean(track && s.ids.includes(track.id)));
  const toggleFavorite = useFavoritesStore((s) => s.toggle);

  // Same per-track offset as the side panel, so a nudge made in either place
  // applies to this song and nowhere else.
  const offset = useLyricsStore((s) => (track ? (s.trackOffsets[track.id] ?? 0) : 0));
  const nudge = (delta: number) => {
    if (!track) return;
    const state = useLyricsStore.getState();
    state.setTrackOffset(track.id, Math.round(((state.trackOffsets[track.id] ?? 0) + delta) * 100) / 100);
  };

  useEffect(() => {
    if (open && track) void load(track);
  }, [open, track, load]);

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          initial={{ opacity: 0, scale: 0.99 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.995 }}
          transition={{ duration: 0.26, ease: [0.22, 1, 0.36, 1] }}
          className="fixed inset-0 z-[60] overflow-hidden bg-black text-white"
        >
          {/* The artwork, blown up and blurred into the room. */}
          <div className="pointer-events-none absolute inset-0">
            {track?.thumbnail ? (
              <img
                src={track.thumbnail}
                alt=""
                aria-hidden
                className="h-full w-full scale-150 object-cover opacity-70 blur-[110px] saturate-[1.6]"
              />
            ) : null}
            <div className="absolute inset-0 bg-gradient-to-br from-black/55 via-black/40 to-black/80" />
            <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(255,255,255,0.06),transparent_60%)]" />
          </div>

          <div className="relative flex h-full flex-col">
            <header className="drag flex h-12 shrink-0 items-center justify-between px-5">
              <button
                onClick={() => toggle(false)}
                aria-label="Exit fullscreen lyrics"
                title="Exit (Esc)"
                className="no-drag flex h-8 w-8 items-center justify-center rounded-full text-white/60 transition-colors hover:bg-white/10 hover:text-white"
              >
                <ChevronDown size={18} />
              </button>

              <div className="no-drag flex items-center gap-2.5 rounded-full border border-white/10 bg-black/25 py-1 pl-3.5 pr-2 text-[11.5px] backdrop-blur-md">
                <span className="font-medium text-white/80">{sourceLabel(track?.source)}</span>
                <span className="text-white/25">·</span>
                <span className="tabular-nums text-white/55">
                  {index >= 0 && length ? `${index + 1} / ${length}` : '—'}
                </span>
                <span className="mx-0.5 h-4 w-px bg-white/10" />
                <button
                  onClick={() => nudge(-0.25)}
                  aria-label="Lyrics 0.25s earlier"
                  className="flex h-5 w-5 items-center justify-center rounded-full text-white/45 transition-colors hover:bg-white/10 hover:text-white"
                >
                  <Minus size={12} />
                </button>
                <span className="w-9 text-center tabular-nums text-white/65">
                  {offset === 0 ? '0.0s' : `${offset > 0 ? '+' : ''}${offset.toFixed(2)}s`}
                </span>
                <button
                  onClick={() => nudge(0.25)}
                  aria-label="Lyrics 0.25s later"
                  className="flex h-5 w-5 items-center justify-center rounded-full text-white/45 transition-colors hover:bg-white/10 hover:text-white"
                >
                  <Plus size={12} />
                </button>
              </div>

              <div className="w-8" />
            </header>

            <div className="grid min-h-0 flex-1 grid-cols-[320px_minmax(0,1fr)] gap-12 pb-8 pl-16 pr-10">
              <aside className="flex min-h-0 flex-col justify-center gap-4">
                <div className={cn(shapedCoversNowPlaying && 'cloudy-cover-shape self-center')}>
                  <WavyProgressRing
                    src={track?.thumbnail}
                    alt={track?.title ?? ''}
                    size={320}
                    thickness={11}
                    playing={playing}
                    className="drop-shadow-[0_30px_80px_rgba(0,0,0,0.75)]"
                  />
                </div>

                <div className={cn('flex items-start justify-between gap-4', titleAlign === 'center' && 'justify-center text-center')}>
                  <div className="min-w-0">
                    <h1 className="truncate text-[19px] font-semibold tracking-[-0.01em] text-white">
                      {track?.title ?? 'Nothing playing'}
                    </h1>
                    <p className="mt-0.5 truncate text-[12.5px] text-white/55">
                      {track?.artist ?? 'Pick something to play'}
                    </p>
                  </div>
                  {track ? (
                    <button
                      onClick={() => void toggleFavorite(track)}
                      aria-label={favorite ? 'Remove from favorites' : 'Add to favorites'}
                      aria-pressed={favorite}
                      title={favorite ? 'Remove from favorites' : 'Add to favorites'}
                      className={cn(
                        'mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-white/15 bg-white/5 transition-colors hover:bg-white/10',
                        favorite ? 'text-accent' : 'text-white/70 hover:text-white',
                      )}
                    >
                      <Heart size={15} className={favorite ? 'fill-accent' : ''} />
                    </button>
                  ) : null}
                </div>

                <SeekBar onDark />

                <div
                  className={cn(
                    'flex items-center gap-3 pt-1',
                    toolbarPosition.endsWith('left')
                      ? 'justify-start'
                      : toolbarPosition.endsWith('right')
                        ? 'justify-end'
                        : 'justify-center',
                    toolbarPosition.startsWith('top') && 'order-first',
                  )}
                >
                  <button
                    onClick={toggleShuffle}
                    aria-label="Shuffle"
                    title="Shuffle"
                    className={cn(
                      'flex h-9 w-9 items-center justify-center rounded-full transition-colors',
                      shuffle ? 'text-accent' : DARK_ICON,
                    )}
                  >
                    <Shuffle size={16} />
                  </button>
                  <button
                    onClick={() => void previous()}
                    aria-label="Previous"
                    title="Previous"
                    className={cn('flex h-9 w-9 items-center justify-center rounded-full transition-colors', DARK_ICON)}
                  >
                    <SkipBack size={18} className="fill-current" />
                  </button>
                  <button
                    onClick={() => void togglePlay()}
                    disabled={!track}
                    aria-label={playing ? 'Pause' : 'Play'}
                    title={playing ? 'Pause' : 'Play'}
                    className="relative mx-1 flex h-12 w-12 items-center justify-center rounded-full bg-white text-black transition-transform duration-150 hover:scale-[1.04] active:scale-95 disabled:opacity-40"
                  >
                    {playing ? (
                      <Pause size={18} strokeWidth={2.4} className="fill-current" />
                    ) : (
                      <Play size={18} strokeWidth={2.4} className="ml-[2px] fill-current" />
                    )}
                    {buffering ? (
                      <span
                        aria-hidden
                        className="absolute inset-0 animate-spin rounded-full border-2 border-transparent border-t-accent"
                      />
                    ) : null}
                  </button>
                  <button
                    onClick={() => void next()}
                    aria-label="Next"
                    title="Next"
                    className={cn('flex h-9 w-9 items-center justify-center rounded-full transition-colors', DARK_ICON)}
                  >
                    <SkipForward size={18} className="fill-current" />
                  </button>
                  <button
                    onClick={cycleRepeat}
                    aria-label={repeat === 'one' ? 'Repeat one' : repeat === 'all' ? 'Repeat all' : 'Repeat off'}
                    title={repeat === 'one' ? 'Repeat one' : repeat === 'all' ? 'Repeat all' : 'Repeat off'}
                    className={cn(
                      'flex h-9 w-9 items-center justify-center rounded-full transition-colors',
                      repeat !== 'off' ? 'text-accent' : DARK_ICON,
                    )}
                  >
                    {repeat === 'one' ? <Repeat1 size={16} /> : <Repeat size={16} />}
                  </button>
                </div>

                <div className="flex items-center justify-center pt-1">
                  <VolumeControl onDark />
                </div>
              </aside>

              <div className="relative min-h-0">
                <LyricsBody fullscreen onDark />
              </div>
            </div>
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
