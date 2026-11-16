import { RotateCcw } from 'lucide-react';
import {
  CloudHeart,
  CloudLyrics,
  CloudNext,
  CloudPause,
  CloudPlay,
  CloudPrev,
  CloudQueue,
  CloudRepeat,
  CloudShuffle,
} from '@/shared/ui/CloudyIcons';
import { memo, type CSSProperties } from 'react';
import { cn } from '@/shared/lib/cn';
import { WavyProgressRing } from '@/shared/ui/WavyProgressRing';
import { IconButton } from '@/shared/ui/Button';
import { Visualizer } from '@/shared/ui/Visualizer';
import { usePlayerStore, selectCurrentTrack } from '@/features/player/store/playerStore';
import { resolveApi } from '@/shared/api/client';
import { SeekBar } from '@/features/player/ui/SeekBar';
import { VolumeControl } from '@/features/player/ui/VolumeControl';
import { useUiStore } from '@/features/navigation/store/uiStore';
import { useSettingsStore } from '@/features/settings/store/settingsStore';
import { useFavoritesStore } from '@/features/favorites/store/favoritesStore';
import { useT } from '@/shared/lib/i18n';

export const PlayerBar = memo(function PlayerBar() {
  const t = useT();
  const playButtonBackground = useSettingsStore((s) => s.playButtonBackground);
  const track = usePlayerStore(selectCurrentTrack);
  const playing = usePlayerStore((s) => s.playing);
  const buffering = usePlayerStore((s) => s.buffering);
  const repeat = usePlayerStore((s) => s.repeat);
  const shuffle = usePlayerStore((s) => s.shuffle);
  const toggle = usePlayerStore((s) => s.toggle);
  const next = usePlayerStore((s) => s.next);
  const previous = usePlayerStore((s) => s.previous);
  const cycleRepeat = usePlayerStore((s) => s.cycleRepeat);
  const index = usePlayerStore((s) => s.index);
  const playAt = usePlayerStore((s) => s.playAt);
  const toggleShuffle = usePlayerStore((s) => s.toggleShuffle);
  const error = usePlayerStore((s) => s.error);

  const lyricsOpen = useUiStore((s) => s.lyricsOpen);
  const queueOpen = useUiStore((s) => s.queueOpen);
  const toggleLyrics = useUiStore((s) => s.toggleLyrics);
  const toggleQueue = useUiStore((s) => s.toggleQueue);

  const favorite = useFavoritesStore((s) => Boolean(track && s.ids.includes(track.id)));
  const toggleFavorite = useFavoritesStore((s) => s.toggle);

  return (
    <footer className="relative z-30 flex h-[72px] shrink-0 items-center gap-4 border-t border-line bg-[color:var(--bg)]/88 px-4 backdrop-blur-xl">
      {/* Track */}
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <WavyProgressRing
          src={track?.thumbnail}
          alt={track?.title ?? ''}
          size={54}
          thickness={3}
          playing={playing}
          interactive={false}
        />
        <div className="min-w-0 flex-1">
          <p className={cn('truncate text-[13.5px] font-medium', !track && 'text-muted')}>
            {track ? track.title : t('nothingPlaying')}
          </p>
          <p className="flex min-w-0 items-center gap-1.5 text-[11.5px] text-muted">
            {error ? (
              <span className="flex min-w-0 flex-1 items-center gap-1.5">
                <span className="min-w-[64px] flex-1 truncate text-red-400" title={error}>
                  {error}
                </span>
                {track ? (
                  <button
                    onClick={() => {
                      resolveApi.forget(track);
                      void playAt(index);
                    }}
                    aria-label="Retry track"
                    title="Try loading this track again"
                    className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-red-400/90 transition-colors hover:bg-red-500/15 hover:text-red-300"
                  >
                    <RotateCcw size={12} />
                  </button>
                ) : null}
              </span>
            ) : track ? (
              <span className="min-w-0 truncate" title={track.artist}>
                {track.artist}
              </span>
            ) : (
              t('pickSomething')
            )}
          </p>
        </div>
        {track && !error ? (
          <button
            onClick={() => void toggleFavorite(track)}
            aria-label={favorite ? 'Remove from favorites' : 'Add to favorites'}
            aria-pressed={favorite}
            title={favorite ? 'Remove from favorites' : 'Add to favorites'}
            className={cn(
              'relative ml-1 hidden h-7 w-7 items-center justify-center rounded-full transition-colors sm:flex',
              favorite ? 'text-accent' : 'text-faint hover:bg-surface hover:text-text',
            )}
          >
            <span key={String(favorite)} className={cn('relative inline-flex', favorite && 'animate-heart-pop')}>
              <CloudHeart size={15} filled={favorite} active={favorite} />
              {favorite
                ? [
                    [-7, -8],
                    [7, -6],
                    [-5, 6],
                    [6, 7],
                  ].map(([tx, ty], index) => (
                    <span
                      key={index}
                      aria-hidden
                      className="pointer-events-none absolute left-1/2 top-1/2 h-[2.5px] w-[2.5px] animate-heart-particle rounded-full bg-accent"
                      style={{ '--tx': `${tx}px`, '--ty': `${ty}px` } as CSSProperties}
                    />
                  ))
                : null}
            </span>
          </button>
        ) : null}
      </div>

      {/* Transport */}
      <div className="flex w-[40%] max-w-[560px] flex-col items-center gap-1.5">
        <div className="flex items-center gap-1.5">
          <IconButton
            label="Shuffle"
            onClick={toggleShuffle}
            className={shuffle ? 'text-accent' : undefined}
          >
            <CloudShuffle size={16} active={shuffle} animated={shuffle} />
          </IconButton>
          <IconButton label="Previous" onClick={() => void previous()}>
            <CloudPrev size={18} />
          </IconButton>
          <button
            onClick={() => void toggle()}
            disabled={!track}
            aria-label={playing ? 'Pause' : 'Play'}
            title={playing ? 'Pause' : 'Play'}
            className={cn(
              'relative mx-1 flex h-9 w-9 items-center justify-center rounded-full transition-transform duration-150 hover:scale-[1.04] active:scale-95 disabled:opacity-40',
              playButtonBackground ? 'bg-text text-black' : 'text-text hover:text-accent',
            )}
          >
            {/* The icon never disappears; buffering shows as a ring around it. */}
            {playing ? <CloudPause size={18} /> : <CloudPlay size={18} className="ml-[2px]" />}
            {buffering ? (
              <span
                aria-hidden
                className="absolute inset-0 animate-spin rounded-full border-2 border-transparent border-t-accent"
              />
            ) : null}
          </button>
          <IconButton label="Next" onClick={() => void next()}>
            <CloudNext size={18} />
          </IconButton>
          <IconButton
            label={repeat === 'one' ? 'Repeat one' : repeat === 'all' ? 'Repeat all' : 'Repeat off'}
            onClick={cycleRepeat}
            className={repeat !== 'off' ? 'text-accent' : undefined}
          >
            <CloudRepeat size={16} active={repeat !== 'off'} one={repeat === 'one'} />
          </IconButton>
        </div>
        <SeekBar />
      </div>

      {/* Right controls */}
      <div className="flex flex-1 items-center justify-end gap-1">
        <div className="mr-1.5 hidden items-center xl:flex">
          <Visualizer playing={playing} className="w-[76px]" />
        </div>
        <IconButton
          label="Lyrics"
          onClick={() => toggleLyrics()}
          className={lyricsOpen ? 'text-accent' : undefined}
        >
          <CloudLyrics size={17} active={lyricsOpen} />
        </IconButton>
        <IconButton
          label="Queue"
          onClick={() => toggleQueue()}
          className={queueOpen ? 'text-accent' : undefined}
        >
          <CloudQueue size={17} active={queueOpen} />
        </IconButton>
        <VolumeControl />
      </div>
    </footer>
  );
});
