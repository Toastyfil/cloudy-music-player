import { Heart } from 'lucide-react';
import { cn } from '@/shared/lib/cn';

/** The heart toggle used on artist and album pages, next to Play. */
export function FavoriteButton({
  active,
  label,
  activeLabel,
  onToggle,
  className,
}: {
  active: boolean;
  label: string;
  activeLabel: string;
  onToggle: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onToggle}
      className={cn(
        'inline-flex h-9 select-none items-center gap-2 rounded-full border px-4 text-sm transition-colors duration-200 focus-ring',
        active
          ? 'border-accent/50 bg-accent-soft text-accent'
          : 'border-line text-text/85 hover:bg-surface hover:text-text',
        className,
      )}
    >
      <Heart size={15} className={active ? 'fill-accent' : ''} />
      {active ? activeLabel : label}
    </button>
  );
}
