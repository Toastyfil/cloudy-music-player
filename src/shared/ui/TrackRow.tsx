import { useState, type ReactNode } from 'react';
import { Heart, Play } from 'lucide-react';
import { cn } from '@/shared/lib/cn';
import { formatTime } from '@/shared/lib/format';
import { sourceLabel, isExternalTrack } from '@/shared/config/sources';
import { useFavoritesStore } from '@/features/favorites/store/favoritesStore';
import { useSettingsStore } from '@/features/settings/store/settingsStore';
import { AlbumArt } from './AlbumArt';
import type { Track } from '@/shared/api/contracts';

function FavoriteToggle({ track }: { track: Track }) {
  const favorite = useFavoritesStore((s) => s.ids.includes(track.id));
  const toggle = useFavoritesStore((s) => s.toggle);

  return (
    <button
      type="button"
      aria-label={favorite ? 'Remove from favorites' : 'Add to favorites'}
      aria-pressed={favorite}
      onClick={(event) => {
        event.stopPropagation();
        void toggle(track);
      }}
      onKeyDown={(event) => event.stopPropagation()}
      className={cn(
        'flex h-7 w-7 items-center justify-center rounded-full transition-colors',
        favorite ? 'text-accent' : 'text-faint hover:text-text',
      )}
    >
      <Heart size={14} className={favorite ? 'fill-accent' : ''} />
    </button>
  );
}

export function TrackRow({
  track,
  index,
  active = false,
  playing = false,
  onPlay,
  right,
  showArt = true,
  showAlbum = true,
  showFavorite = true,
  subtitleOverride,
  className,
}: {
  track: Track;
  index?: number;
  active?: boolean;
  playing?: boolean;
  onPlay: () => void;
  right?: ReactNode;
  showArt?: boolean;
  showAlbum?: boolean;
  showFavorite?: boolean;
  subtitleOverride?: string;
  className?: string;
}) {
  const [hovered, setHovered] = useState(false);
  const favorite = useFavoritesStore((s) => s.ids.includes(track.id));
  const showExplicit = useSettingsStore((s) => s.showExplicitTag);
  const classicCards = useSettingsStore((s) => s.classicCards);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onPlay}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onPlay();
        }
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className={cn(
        'group flex h-14 w-full items-center gap-3 px-3 text-left transition-colors duration-150 focus-ring',
        classicCards ? 'rounded-[20px] hover:scale-[1.004] hover:bg-surface/80 active:scale-[0.999]' : 'rounded-lg',
        active ? 'bg-accent-soft' : 'hover:bg-surface/70',
        className,
      )}
    >
      {(index !== undefined || showArt) && (
        <span className="relative flex h-10 w-10 shrink-0 items-center justify-center">
          {showArt ? (
            <>
              <AlbumArt src={track.thumbnail} alt={track.title} size={40} rounded="md" className={cn(hovered && 'opacity-25')} />
              {(hovered || active) && (
                <span className="absolute inset-0 flex items-center justify-center">
                  {active && playing ? (
                    <span className="flex items-end gap-[2px]">
                      {[0, 1, 2].map((bar) => (
                        <span
                          key={bar}
                          className="w-[2.5px] rounded-full bg-accent"
                          style={{
                            height: 10,
                            animation: `cloudy-eq 900ms ${bar * 130}ms ease-in-out infinite alternate`,
                          }}
                        />
                      ))}
                    </span>
                  ) : (
                    <Play size={14} className="fill-text text-text" />
                  )}
                </span>
              )}
            </>
          ) : (
            <span className="text-[13px] tabular-nums text-faint">{hovered ? <Play size={13} /> : (index ?? 0) + 1}</span>
          )}
        </span>
      )}

      <span className="min-w-0 flex-1">
        <span className={cn('block truncate text-[14px] leading-tight', active ? 'font-semibold text-accent' : 'font-medium')}>
          {track.title}
          {showExplicit && track.explicit ? (
            <span
              title="Explicit"
              className="ms-1.5 inline-flex h-[13px] w-[13px] items-center justify-center rounded-[3px] bg-surface text-[9px] font-semibold leading-none text-faint align-[1px]"
            >
              E
            </span>
          ) : null}
        </span>
        <span className="mt-0.5 flex items-center gap-1.5 truncate text-[12.5px] text-muted">
          <span className="truncate">{subtitleOverride ?? track.artist}</span>
          {showAlbum && track.album?.name ? <span className="truncate text-faint">· {track.album.name}</span> : null}
          {isExternalTrack(track) ? (
            <span
              className="shrink-0 rounded bg-surface px-1.5 py-[1px] text-[9.5px] font-medium uppercase tracking-[0.08em] text-faint"
              title={`Catalog result from ${sourceLabel(track.source)}`}
            >
              {sourceLabel(track.source)}
            </span>
          ) : null}
        </span>
      </span>

      <span className="w-12 shrink-0 text-right text-[12.5px] tabular-nums text-muted">
        {track.duration ? formatTime(track.duration) : '—'}
      </span>
      {showFavorite ? (
        <span className={cn('shrink-0 transition-opacity', favorite ? 'opacity-100' : 'opacity-0 group-hover:opacity-100')}>
          <FavoriteToggle track={track} />
        </span>
      ) : null}
      <span className="flex w-7 shrink-0 items-center justify-end opacity-0 transition-opacity duration-150 group-hover:opacity-100 focus-within:opacity-100">
        {right}
      </span>

      <style>{`@keyframes cloudy-eq { from { height: 3px } to { height: 12px } }`}</style>
    </div>
  );
}
