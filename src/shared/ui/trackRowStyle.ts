import { cn } from '@/shared/lib/cn';

/**
 * The single definition of a track row's surface. TrackRow and the home list
 * both call this, so radius, hover fill and press feedback cannot drift apart
 * when the "classic rounded rows" switch changes.
 */
export function trackRowSurface({ classic, active = false }: { classic: boolean; active?: boolean }) {
  return cn(
    'group flex items-center gap-3 px-3 transition-all duration-150 focus-ring',
    classic ? 'rounded-[20px] hover:scale-[1.004] active:scale-[0.999]' : 'rounded-[var(--radius-card,8px)]',
    active ? 'bg-accent-soft' : 'hover:bg-surface/70',
  );
}
