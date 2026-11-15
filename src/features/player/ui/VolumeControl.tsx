import { Volume1, Volume2, VolumeX } from 'lucide-react';
import { useCallback } from 'react';
import { cn } from '@/shared/lib/cn';
import { IconButton } from '@/shared/ui/Button';
import { usePlayerStore } from '../store/playerStore';

export function VolumeControl({ onDark = false }: { onDark?: boolean }) {
  const volume = usePlayerStore((s) => s.volume);
  const muted = usePlayerStore((s) => s.muted);
  const setVolume = usePlayerStore((s) => s.setVolume);
  const toggleMute = usePlayerStore((s) => s.toggleMute);

  const effective = muted ? 0 : volume;
  const Icon = effective === 0 ? VolumeX : effective < 0.5 ? Volume1 : Volume2;

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const target = event.currentTarget;
      const update = (clientX: number) => {
        const rect = target.getBoundingClientRect();
        setVolume((clientX - rect.left) / rect.width);
      };
      update(event.clientX);
      const move = (e: PointerEvent) => update(e.clientX);
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    },
    [setVolume],
  );

  return (
    <div className="flex items-center gap-1">
      <IconButton
        label={muted ? 'Unmute' : 'Mute'}
        onClick={toggleMute}
        className={onDark ? 'text-white/65 hover:bg-white/10 hover:text-white' : undefined}
      >
        <Icon size={16} />
      </IconButton>
      <div
        onPointerDown={onPointerDown}
        role="slider"
        aria-label="Volume"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(effective * 100)}
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.key === 'ArrowRight') setVolume(volume + 0.05);
          if (event.key === 'ArrowLeft') setVolume(volume - 0.05);
        }}
        className={cn('group relative flex h-4 cursor-pointer items-center', onDark ? 'w-36' : 'w-20')}
      >
        <div className="relative h-[3px] w-full overflow-hidden rounded-full bg-white/12">
          <div
            className={cn('absolute inset-y-0 left-0 rounded-full', onDark ? 'bg-white' : 'bg-white/70')}
            style={{ width: `${effective * 100}%` }}
          />
        </div>
      </div>
    </div>
  );
}
