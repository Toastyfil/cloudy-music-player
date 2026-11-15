import type { ReactNode } from 'react';
import { cn } from '@/shared/lib/cn';

/**
 * Cloudy's own icon set: 24px grid, 1.5 stroke, rounded joins. Replaces the flat
 * Material-ish line icons in the chrome with shapes that read as sound — a lens
 * with a spectrum, a tray that is a waveform, a gear that is a dial.
 */
export interface CloudIconProps {
  size?: number;
  className?: string;
  strokeWidth?: number;
  /** Selected state: accent tint plus a soft accent glow. */
  active?: boolean;
  /** Extra motion, e.g. shuffle drift or queue oscillation. */
  animated?: boolean;
}

function Svg({
  size = 24,
  className,
  strokeWidth = 1.5,
  children,
}: {
  size?: number;
  className?: string;
  strokeWidth?: number;
  children: ReactNode;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn('shrink-0', className)}
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

const glow = 'drop-shadow-[0_0_7px_var(--accent)]';

/** Home: a house with soft rounded corners and a deep doorway. */
export function CloudHouse({ size, className, active }: CloudIconProps) {
  return (
    <Svg size={size} className={cn(active && glow, className)}>
      <path d="M3.4 10.4 12 3.2l8.6 7.2" strokeWidth="1.7" />
      <path d="M5.7 9.2v9.3A2.1 2.1 0 0 0 7.8 20.6h8.4a2.1 2.1 0 0 0 2.1-2.1V9.2" />
      <path d="M10.1 20.5v-4.3a1.9 1.9 0 0 1 3.8 0v4.3" />
    </Svg>
  );
}

/** Home, compact: the same house without the doorway detail. */
export function CloudHome({ size, className, active }: CloudIconProps) {
  return (
    <Svg size={size} className={cn(active && glow, className)}>
      <path d="M3.4 10.4 12 3.2l8.6 7.2" strokeWidth="1.7" />
      <path d="M5.7 9.2v9.3A2.1 2.1 0 0 0 7.8 20.6h8.4a2.1 2.1 0 0 0 2.1-2.1V9.2" />
      <path d="M9.6 13.2h4.8M9.6 16.4h4.8" opacity="0.55" strokeWidth="1.3" />
    </Svg>
  );
}

/** Search: a lens showing a mini spectrum, with a scan line on hover. */
export function CloudSearch({ size, className, animated }: CloudIconProps) {
  return (
    <Svg size={size} className={cn('group-hover/search:scale-105', className)}>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="M10.5 15.4 19 21" transform="translate(-1.6 -1.9)" />
      <path d="M8.3 12.2v-2.1M10.5 12.6V8.1M12.7 12.2v-2.9" strokeWidth="1.4" />
      <path
        d="M5.4 10.5h10.2"
        strokeWidth="1"
        opacity="0.75"
        className={animated ? 'origin-center animate-scan' : 'animate-scan'}
      />
    </Svg>
  );
}

/** Favourite: a liquid heart with a soft inner core. */
export function CloudHeart({
  size,
  className,
  active,
  filled,
}: CloudIconProps & { filled?: boolean }) {
  return (
    <Svg size={size} className={cn(active && glow, className)}>
      <path
        d="M12 20.3c-.4-.2-7.3-4.2-7.3-9.2A4.2 4.2 0 0 1 12 8.2a4.2 4.2 0 0 1 7.3 2.9c0 5-6.9 9-7.3 9.2Z"
        fill={filled ? 'currentColor' : 'none'}
        fillOpacity={filled ? 0.92 : 0}
      />
      <path d="M9.1 11.6a2.2 2.2 0 0 1 1.9-1.6" opacity={filled ? 0.55 : 0.9} />
    </Svg>
  );
}

/** Library: an isometric album tile. */
export function CloudAlbum({ size, className, active }: CloudIconProps) {
  return (
    <Svg size={size} className={cn(active && glow, className)}>
      <path d="M12 3.6 20.2 8v8L12 20.4 3.8 16V8Z" />
      <path d="M12 3.6V11l8.2 4.9M12 11 3.8 16" opacity="0.55" />
      <circle cx="12" cy="11" r="1.5" fill="currentColor" stroke="none" />
    </Svg>
  );
}

/** Playlists: waveform segments stacked like a list. */
export function CloudPlaylist({ size, className, active }: CloudIconProps) {
  return (
    <Svg size={size} className={cn(active && glow, className)}>
      <path d="M4 6.2h2.4l1.8-1.6 1.8 1.6H20" />
      <path d="M4 12h1.8l1.7 1.6 1.7-1.6H20" opacity="0.8" />
      <path d="M4 17.8h2.2l1.7-1.5 1.7 1.5H20" opacity="0.6" />
    </Svg>
  );
}

/** Queue: three rows whose segments gently oscillate while the panel is open. */
export function CloudQueue({ size, className, active }: CloudIconProps) {
  return (
    <Svg size={size} className={cn(active && glow, className)}>
      <path d="M4 6.5h4.5M11 6.5h9" strokeWidth="1.6" />
      <path
        d="M4 12h3M9.4 12h2.4M14.4 12h5.6"
        strokeWidth="1.6"
        className={active ? 'origin-left animate-queue-wave' : undefined}
      />
      <path d="M4 17.5h6M13 17.5h7" strokeWidth="1.6" opacity="0.8" />
    </Svg>
  );
}

/** Play: a rounded triangle with a soft gradient, never a flat glyph. */
export function CloudPlay({ size, className }: CloudIconProps) {
  return (
    <Svg size={size} className={className}>
      <defs>
        <linearGradient id="cloudyPlayFill" x1="7" y1="4" x2="19" y2="19" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="currentColor" />
          <stop offset="1" stopColor="currentColor" stopOpacity="0.68" />
        </linearGradient>
      </defs>
      <path
        d="M8.1 5.7c0-1 1.1-1.6 1.9-1.1l8.9 6.3c.7.5.7 1.6 0 2.1l-8.9 6.3c-.8.6-1.9 0-1.9-1Z"
        fill="url(#cloudyPlayFill)"
        stroke="currentColor"
        strokeWidth="1.1"
      />
    </Svg>
  );
}

/** Pause: bevelled bars. */
export function CloudPause({ size, className }: CloudIconProps) {
  return (
    <Svg size={size} className={className}>
      <rect x="6.6" y="4.8" width="3.9" height="14.4" rx="1.9" fill="currentColor" stroke="none" />
      <rect x="13.5" y="4.8" width="3.9" height="14.4" rx="1.9" fill="currentColor" opacity="0.78" stroke="none" />
    </Svg>
  );
}

/** Next: chevron with trailing speed lines. */
export function CloudNext({ size, className }: CloudIconProps) {
  return (
    <Svg size={size} className={className}>
      <path d="M7 5.2 15.2 12 7 18.8" strokeWidth="1.8" />
      <path d="M17.6 5.6v2.2M19.9 9.4v1.4M17.6 16.2v2.2" opacity="0.5" strokeWidth="1.4" />
    </Svg>
  );
}

/** Previous: mirrored chevron with trailing speed lines. */
export function CloudPrev({ size, className }: CloudIconProps) {
  return (
    <Svg size={size} className={className}>
      <path d="M17 5.2 8.8 12 17 18.8" strokeWidth="1.8" />
      <path d="M6.4 5.6v2.2M4.1 9.4v1.4M6.4 16.2v2.2" opacity="0.5" strokeWidth="1.4" />
    </Svg>
  );
}

/** Shuffle: crossing arrows that drift apart while active. */
export function CloudShuffle({ size, className, active }: CloudIconProps) {
  return (
    <Svg size={size} className={cn(active && glow, className)}>
      <g className={active ? 'origin-center animate-shuffle-drift' : undefined}>
        <path d="M3.5 7h2.9c1.2 0 2.3.6 3 1.6L15 17h3.4" />
        <path d="M3.5 17h2.9c1.2 0 2.3-.6 3-1.6L15 7h3.4" opacity="0.85" />
      </g>
      <path d="M16.2 4.6 18.9 7l-2.7 2.4M16.2 14.6 18.9 17l-2.7 2.4" />
    </Svg>
  );
}

/** Repeat: circular arrow with a dot that pulses when looping. */
export function CloudRepeat({ size, className, active, one }: CloudIconProps & { one?: boolean }) {
  return (
    <Svg size={size} className={cn(active && glow, className)}>
      <path d="M6 8.2A6.4 6.4 0 0 1 18 10M18 15.8A6.4 6.4 0 0 1 6 14" />
      <path d="M16 5.6 18.4 8l-2.6 2M8 18.4 5.6 16l2.6-2" />
      {one ? (
        <path d="M12 10.4v3.4M10.9 11.6l1.1-.9" strokeWidth="1.3" />
      ) : (
        <circle
          cx="12"
          cy="12"
          r="1.4"
          fill="currentColor"
          stroke="none"
          className={active ? 'animate-repeat-pulse' : undefined}
        />
      )}
    </Svg>
  );
}

/** Settings: three mixer sliders with solid grips — reads at 15px, unlike a dial. */
export function CloudSettings({ size, className }: CloudIconProps) {
  return (
    <Svg size={size} className={className}>
      <path d="M3.4 6.6h17.2M3.4 12h17.2M3.4 17.4h17.2" opacity="0.45" strokeWidth="1.6" />
      <circle cx="15.2" cy="6.6" r="2.4" fill="currentColor" stroke="none" />
      <circle cx="8.6" cy="12" r="2.4" fill="currentColor" stroke="none" />
      <circle cx="16.4" cy="17.4" r="2.4" fill="currentColor" stroke="none" />
    </Svg>
  );
}

/** Lyrics: a speech bubble holding a waveform instead of dots. */
export function CloudLyrics({ size, className, active }: CloudIconProps) {
  return (
    <Svg size={size} className={cn(active && glow, className)}>
      <path d="M4 11.4a6.4 6.4 0 0 1 6.4-6.4h3.2a6.4 6.4 0 0 1 6.4 6.4v.6a6.4 6.4 0 0 1-6.4 6.4H9.2L5 20.4l.4-3.2A6.4 6.4 0 0 1 4 12Z" />
      <path d="M8.4 12.2v-1.1M10.6 13.4V9.9M12.8 13.8v-4.4M15 12.6v-2.4" strokeWidth="1.4" />
    </Svg>
  );
}

/** Download: an arrow into a tray shaped like a waveform, with a progress arc. */
export function CloudDownload({ size, className, progress }: CloudIconProps & { progress?: number }) {
  const pct = Math.max(0, Math.min(1, progress ?? 0));
  return (
    <Svg size={size} className={className}>
      {pct > 0 ? (
        <circle
          cx="12"
          cy="12"
          r="10.2"
          strokeWidth="1.6"
          opacity="0.85"
          strokeDasharray={`${pct * 64} 64`}
          strokeLinecap="round"
          transform="rotate(-90 12 12)"
        />
      ) : null}
      <path d="M12 3.6v10.2M8.4 10.2 12 13.9l3.6-3.7" />
      <path d="M3.6 16.4c1.8 0 1.8 2 3.6 2s1.8-2 3.6-2 1.8 2 3.6 2 1.8-2 3.6-2 1.8 2 2.4 2" strokeWidth="1.4" />
    </Svg>
  );
}

/** Downloaded: a waveform line with a check crossing it. */
export function CloudDownloaded({ size, className }: CloudIconProps) {
  return (
    <Svg size={size} className={className}>
      <path d="M3.4 12.6c1.4 0 1.4-2.5 2.8-2.5s1.4 5 2.8 5 1.4-6 2.8-6 1.4 3.4 2.8 3.4" opacity="0.55" />
      <path d="M10.4 12.4 13 15l5.4-6.4" strokeWidth="1.9" />
    </Svg>
  );
}

/** Artist: a figure inside concentric rings. */
export function CloudArtist({ size, className, active }: CloudIconProps) {
  return (
    <Svg size={size} className={cn(active && glow, className)}>
      <circle cx="12" cy="12" r="9" opacity="0.5" />
      <circle cx="12" cy="9.4" r="2.4" />
      <path d="M7.4 17.6c.7-2.3 2.4-3.4 4.6-3.4s3.9 1.1 4.6 3.4" />
      <circle cx="12" cy="12" r="5" opacity="0.25" />
    </Svg>
  );
}

/** Playing state: three bars that bounce while audio runs. */
export function CloudEqualizer({ size = 18, className }: CloudIconProps) {
  return (
    <Svg size={size} className={className} strokeWidth={2}>
      <path d="M7 14V10" className="origin-center animate-eq [animation-delay:-120ms]" />
      <path d="M12 16.6V7.4" className="origin-center animate-eq" />
      <path d="M17 13.4v-2.8" className="origin-center animate-eq [animation-delay:-240ms]" />
    </Svg>
  );
}

/** Import: plus with a soft double ring. */
export function CloudPlus({ size, className }: CloudIconProps) {
  return (
    <Svg size={size} className={className}>
      <path d="M12 6.4v11.2M6.4 12h11.2" />
    </Svg>
  );
}
