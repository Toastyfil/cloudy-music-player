import { Heart, Music2, Pause } from 'lucide-react';
import { useSettingsStore } from '@/features/settings/store/settingsStore';
import { trackRowSurface } from '@/shared/ui/trackRowStyle';
import { cn } from '@/shared/lib/cn';

/**
 * A miniature of the two places settings are hardest to judge from a slider:
 * one track row and the player bar. Everything here reads the live store, so
 * the sample moves while a control is being dragged instead of after a reload.
 */
export function SettingsPreview() {
  const classicCards = useSettingsStore((s) => s.classicCards);
  const playButtonBackground = useSettingsStore((s) => s.playButtonBackground);
  const showTrackNumbers = useSettingsStore((s) => s.showTrackNumbers);
  const showDurationColumn = useSettingsStore((s) => s.showDurationColumn);
  const showAlbumColumn = useSettingsStore((s) => s.showAlbumColumn);
  const showFavoriteColumn = useSettingsStore((s) => s.showFavoriteColumn);
  const iconRoundness = useSettingsStore((s) => s.iconRoundness);
  const accentSaturation = useSettingsStore((s) => s.accentSaturation);
  const accentLightness = useSettingsStore((s) => s.accentLightness);
  const accentHue = useSettingsStore((s) => s.accentHue);

  return (
    <div className="sticky top-0 z-20 mb-5 rounded-[var(--radius-xl2,18px)] border border-line bg-[color:var(--bg)]/85 p-3 backdrop-blur-md">
      <div className="mb-2 flex items-baseline justify-between">
        <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-faint">Preview</p>
        <p className="text-[10.5px] text-faint">
          accent {accentHue}° · {accentSaturation}% · {accentLightness}%
        </p>
      </div>

      <div
        aria-label="Track row preview"
        className={cn(trackRowSurface({ classic: classicCards, active: true }), 'w-full text-left')}
        style={{ height: 'var(--row-h, 56px)' }}
      >
        {showTrackNumbers ? (
          <span className="w-4 shrink-0 text-right text-[11px] tabular-nums text-faint">1</span>
        ) : null}
        <span className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-card,12px)] bg-accent/15 text-accent">
          <Music2 size={15} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-semibold leading-tight text-accent">Sample track</span>
          <span className="mt-0.5 flex items-center gap-1.5 truncate text-[11.5px] text-muted">
            <span className="truncate">Sample artist</span>
            {showAlbumColumn ? <span className="truncate text-faint">· Sample album</span> : null}
          </span>
        </span>
        {showDurationColumn ? (
          <span className="w-9 shrink-0 text-right text-[11.5px] tabular-nums text-muted">3:36</span>
        ) : null}
        {showFavoriteColumn ? <Heart size={13} className="shrink-0 fill-accent text-accent" /> : null}
      </div>

      <div className="mt-2 flex h-12 items-center gap-2 rounded-[var(--radius-card,12px)] border border-line bg-surface/70 px-2">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-card,12px)] bg-accent/20 text-accent">
          <Music2 size={13} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[11px] font-medium leading-tight">Sample track</span>
          <span className="block truncate text-[10px] text-muted">Sample artist</span>
        </span>
        <span className="flex flex-1 items-center gap-1.5">
          <span className="relative h-[3px] flex-1 rounded-full bg-surface">
            <span className="absolute inset-y-0 left-0 w-[42%] rounded-full bg-accent" />
          </span>
          <span className="text-[9.5px] tabular-nums text-faint">1:31</span>
        </span>
        <span
          className={cn(
            'flex h-6 w-6 shrink-0 items-center justify-center',
            iconRoundness === 'round' ? 'rounded-full' : 'rounded-[6px]',
            playButtonBackground ? 'bg-text text-black' : 'text-text',
          )}
        >
          <Pause size={10} className="fill-current" />
        </span>
      </div>
    </div>
  );
}
