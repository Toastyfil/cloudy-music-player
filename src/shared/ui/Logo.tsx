import type { ReactNode } from 'react';
import { cn } from '@/shared/lib/cn';
import { useSettingsStore } from '@/features/settings/store/settingsStore';

/**
 * Home mark: the 12 sound-shaped variants offered in Appearance, plus Cloudy's
 * original cloud. Every mark is drawn on the same 24px grid with 1.5px strokes
 * so switching one for another never changes the weight of the title bar.
 */
export const LOGO_VARIANTS = [
  { id: 'bloom', name: 'Bloom' },
  { id: 'cloud', name: 'Cloud' },
  { id: 'wave-circle', name: 'Wave circle' },
  { id: 'twin-triangles', name: 'Twin triangles' },
  { id: 'tall-bar', name: 'Tall bar' },
  { id: 'infinity-sine', name: 'Infinity sine' },
  { id: 'crescent-wave', name: 'Crescent wave' },
  { id: 'eye-play', name: 'Eye play' },
  { id: 'bolt-eq', name: 'EQ bolt' },
  { id: 'spiral-wave', name: 'Spiral galaxy' },
  { id: 'knight-bars', name: 'Knight bars' },
  { id: 'dna-rungs', name: 'DNA helix' },
  { id: 'rocket-wave', name: 'Rocket wave' },
  { id: 'cat-whiskers', name: 'Cat whiskers' },
] as const;

export type LogoVariant = (typeof LOGO_VARIANTS)[number]['id'];

const MARKS: Record<LogoVariant, ReactNode> = {
  // Riff-like bloom: five overlapping lobes around a soft centre, drawn as one
  // family of 24px circles so it reads as a mark rather than an illustration.
  bloom: (
    <>
      <circle cx="12" cy="7.6" r="4.5" />
      <circle cx="16.4" cy="11.2" r="4.5" opacity="0.85" />
      <circle cx="14.8" cy="16.4" r="4.5" opacity="0.7" />
      <circle cx="9.2" cy="16.4" r="4.5" opacity="0.7" />
      <circle cx="7.6" cy="11.2" r="4.5" opacity="0.85" />
      <circle cx="12" cy="11.8" r="2.1" opacity="0.45" strokeWidth="1.2" />
    </>
  ),
  cloud: <path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z" />,
  'wave-circle': (
    <>
      <circle cx="12" cy="12" r="9" opacity="0.5" />
      <path d="M7.8 12v2.2M10.6 8.6v6.8M13.4 6.8v10.4M16.2 10.4v3.2" strokeWidth="1.7" />
    </>
  ),
  'twin-triangles': (
    <>
      <path d="M4.2 17.6 10.4 6.2l5 9.6Z" />
      <path d="M12.4 17.6 16.6 9.4l3.2 8.2Z" opacity="0.65" />
    </>
  ),
  'tall-bar': (
    <>
      <path d="M5.4 15.4v-3.2M8.2 17.4V9.8M11 20V3.4M13.8 17.4V9.8M16.6 15.4v-3.2M19.4 13.6v-.8" strokeWidth="1.8" />
      <path d="M4 21h16" opacity="0.35" strokeWidth="1.2" />
    </>
  ),
  'infinity-sine': (
    <>
      <path d="M12 12c0-2.6-2-4.7-4.6-4.7S2.8 9.4 2.8 12s2 4.7 4.6 4.7S12 14.6 12 12c0-2.6 2-4.7 4.6-4.7s4.6 2.1 4.6 4.7-2 4.7-4.6 4.7S12 14.6 12 12Z" />
      <path d="M7.4 10.2v3.6M16.6 10.2v3.6" opacity="0.6" strokeWidth="1.3" />
    </>
  ),
  'crescent-wave': (
    <>
      <path d="M15.6 3.4a8.8 8.8 0 1 0 0 17.2 7.1 7.1 0 0 1 0-17.2Z" />
      <path d="M10.2 9.6v4.8M13 8.6v6.8M15.6 10.8v2.4" opacity="0.8" strokeWidth="1.5" />
    </>
  ),
  'eye-play': (
    <>
      <path d="M2.8 12S6.4 6.2 12 6.2 21.2 12 21.2 12 17.6 17.8 12 17.8 2.8 12 2.8 12Z" />
      <path d="M10.3 9.7c0-.4.4-.6.7-.4l3.2 2.3c.3.2.3.6 0 .8l-3.2 2.3c-.3.2-.7 0-.7-.4Z" fill="currentColor" fillOpacity="0.85" />
    </>
  ),
  'bolt-eq': (
    <>
      <path d="M13.4 2.8 6.6 13h4.6l-1.4 8.2 7.6-11.2h-4.8Z" />
      <path d="M17.6 4.6v2.2M20 7.8v1.2M17.6 17v2.2" opacity="0.5" strokeWidth="1.3" />
    </>
  ),
  'spiral-wave': (
    <>
      <path d="M3.4 16.2c1.2-6 6.2-9.8 11-7.8 3.6 1.5 3.4 6.2-.2 7.2-3 .8-5.4-1.6-4-3.9.9-1.5 2.8-1.9 4.2-1" opacity="0.9" />
      <path d="M3.4 16.2c1.4-.5 2.4-1.4 3.2-2.6" opacity="0.45" strokeWidth="1.3" />
      <path d="M17.4 19.4h.9M15.2 18.2v2.4M19.8 17.8v2.8" opacity="0.55" strokeWidth="1.3" />
    </>
  ),
  'knight-bars': (
    <>
      <path d="M6.2 20.4v-3.8c0-2.1 1-3.7 2.7-4.9L12.4 9 11 5.4l2.4-2.2 2.9 1.6 1 3.1-.9 2.2 3 2.4c1 .8 1.5 1.9 1.5 3.2v4.7" />
      <path d="M11.4 11.6 8.8 9.8" opacity="0.55" strokeWidth="1.3" />
      <path d="M14 13.6v3.6M16.4 14.6v2.6M18.6 16v1.8" opacity="0.6" strokeWidth="1.4" />
    </>
  ),
  'dna-rungs': (
    <>
      <path d="M8 3.2c0 5 8 7.6 8 12.6M16 3.2c0 5-8 7.6-8 12.6" opacity="0.85" />
      <path d="M8.4 6.4h7M8.4 10.2h7M8.4 14h7M8.4 17.8h7" opacity="0.55" strokeWidth="1.3" />
    </>
  ),
  'rocket-wave': (
    <>
      <path d="M12 3.2c2.2 1.9 3.4 4.4 3.4 7.3v3.7H8.6v-3.7c0-2.9 1.2-5.4 3.4-7.3Z" />
      <circle cx="12" cy="8.8" r="1.3" />
      <path d="M8.6 12.4 6 16l2.6.7M15.4 12.4 18 16l-2.6.7" opacity="0.7" />
      <path d="M9.8 17.2h4.4M10.6 19.8h2.8M12 17.2v2.6" opacity="0.8" strokeWidth="1.4" />
    </>
  ),
  'cat-whiskers': (
    <>
      <path d="M5.4 9.4 4 4.6l4.2 2M18.6 9.4 20 4.6l-4.2 2" />
      <path d="M5.2 11.4c0-3.4 3-5.6 6.8-5.6s6.8 2.2 6.8 5.6-2.8 7.4-6.8 7.4-6.8-4-6.8-7.4Z" />
      <path d="M9.2 10.8h.6M14.2 10.8h.6" strokeWidth="1.6" />
      <path d="M3.2 13.6h3.4M17.4 13.6h3.4M3.6 16.6l3.2-.8M20.4 16.6l-3.2-.8" opacity="0.6" strokeWidth="1.3" />
    </>
  ),
};

export function LogoGlyph({
  variant,
  size = 24,
  className,
  strokeWidth = 1.5,
}: {
  variant: LogoVariant | string;
  size?: number;
  className?: string;
  strokeWidth?: number;
}) {
  const key = (variant in MARKS ? variant : 'cloud') as LogoVariant;
  const filled = key === 'cloud';
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn('shrink-0', className)}
      aria-hidden="true"
      focusable="false"
    >
      {MARKS[key]}
    </svg>
  );
}

/**
 * Cloudy's mark. It draws with the current text colour, so it is white on dark
 * themes and black on light ones — no accent tint, no shadow.
 */
export function CloudyMark({
  size = 28,
  className,
  animated = false,
}: {
  size?: number;
  className?: string;
  animated?: boolean;
}) {
  const variant = useSettingsStore((s) => s.logoVariant);
  return (
    <span
      className={cn('inline-flex shrink-0 items-center justify-center text-current', className)}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <LogoGlyph variant={variant} size={size} className={animated ? 'animate-pulse' : undefined} />
    </span>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn('flex items-center gap-2 font-semibold tracking-tight', className)}>
      <CloudyMark size={18} />
      <span>Cloudy</span>
    </span>
  );
}
