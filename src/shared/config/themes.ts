// Cloudy's palette collection: twenty complete themes, each with its own accent,
// surfaces and text ramp. Ids are persisted, so they must stay stable.

export type ThemeMode = 'dark' | 'light';

export interface Theme {
  id: string;
  name: string;
  mode: ThemeMode;
  bg: string;
  elevated: string;
  surface: string;
  surfaceHover: string;
  surfaceActive: string;
  text: string;
  muted: string;
  faint: string;
  accent: string;
  accentStrong: string;
  accentSoft: string;
  border: string;
}

const dark = (
  id: string,
  name: string,
  accent: string,
  strong: string,
  soft: string,
  bg = '#0a0a0a',
  surface = '#171717',
): Theme => ({
  id,
  name,
  mode: 'dark',
  bg,
  elevated: '#121212',
  surface,
  surfaceHover: '#1f1f1f',
  surfaceActive: '#262626',
  text: '#f0f0f0',
  muted: '#8a8a8a',
  faint: '#5c5c5c',
  accent,
  accentStrong: strong,
  accentSoft: soft,
  border: 'rgba(255,255,255,0.06)',
});

const light = (
  id: string,
  name: string,
  accent: string,
  strong: string,
  soft: string,
  bg = '#fafafa',
  surface = '#f1f1f1',
): Theme => ({
  id,
  name,
  mode: 'light',
  bg,
  elevated: '#ffffff',
  surface,
  surfaceHover: '#e9e9e9',
  surfaceActive: '#e0e0e0',
  text: '#1a1a1a',
  muted: '#6b6b6b',
  faint: '#9a9a9a',
  accent,
  accentStrong: strong,
  accentSoft: soft,
  border: 'rgba(0,0,0,0.07)',
});

export const THEMES: Theme[] = [
  // 1–12: dark
  dark('cloudy-amber', 'Amber', '#f59e0b', '#fbbf24', 'rgba(245,158,11,0.14)'),
  dark('midnight', 'Midnight', '#6366f1', '#818cf8', 'rgba(99,102,241,0.16)', '#0a0a12', '#16161f'),
  dark('ocean', 'Ocean', '#22d3ee', '#67e8f9', 'rgba(34,211,238,0.14)', '#071016', '#101c24'),
  dark('forest', 'Forest', '#34d399', '#6ee7b7', 'rgba(52,211,153,0.14)', '#08120e', '#101d18'),
  dark('ember', 'Ember', '#ef4444', '#f87171', 'rgba(239,68,68,0.15)', '#120a0a', '#1e1414'),
  dark('violet', 'Violet', '#a855f7', '#c084fc', 'rgba(168,85,247,0.16)', '#0d0712', '#191021'),
  dark('sunset', 'Sunset', '#fb7185', '#fda4af', 'rgba(251,113,133,0.15)', '#120a0d', '#1e1318'),
  dark('cobalt', 'Cobalt', '#3b82f6', '#60a5fa', 'rgba(59,130,246,0.15)', '#070c14', '#101827'),
  dark('lime', 'Lime', '#a3e635', '#bef264', 'rgba(163,230,53,0.14)', '#0b1006', '#171f0f'),
  dark('rose', 'Rose', '#ec4899', '#f472b6', 'rgba(236,72,153,0.15)', '#11080d', '#1d1018'),
  dark('graphite', 'Graphite', '#94a3b8', '#cbd5e1', 'rgba(148,163,184,0.16)', '#0b0c0e', '#16181c'),
  dark('mango', 'Mango', '#fb923c', '#fdba74', 'rgba(251,146,60,0.15)', '#100b07', '#1c1510'),
  dark('mono', 'Mono', '#ffffff', '#e5e5e5', 'rgba(255,255,255,0.16)', '#000000', '#131313'),

  // 13–16: light
  light('daylight', 'Daylight', '#d97706', '#b45309', 'rgba(217,119,6,0.12)'),
  light('paper', 'Paper', '#2563eb', '#1d4ed8', 'rgba(37,99,235,0.10)', '#fafaf7', '#f0f0ea'),
  light('mint', 'Mint', '#059669', '#047857', 'rgba(5,150,105,0.10)', '#f7fbf9', '#eaf4ef'),
  light('bubblegum', 'Bubblegum', '#db2777', '#be185d', 'rgba(219,39,119,0.10)', '#fdf7fa', '#f7ecf2'),

  // 17–20: tinted dark
  dark('plum', 'Plum', '#c084fc', '#d8b4fe', 'rgba(192,132,252,0.16)', '#0e0812', '#1b1222'),
  dark('moss', 'Moss', '#84cc16', '#a3e635', 'rgba(132,204,22,0.14)', '#0c1008', '#171d10'),
  dark('slate-blue', 'Slate Blue', '#60a5fa', '#93c5fd', 'rgba(96,165,250,0.14)', '#080b12', '#121826'),
  dark('copper', 'Copper', '#f97316', '#fb923c', 'rgba(249,115,22,0.15)', '#0f0a06', '#1b140d'),
];

export const DEFAULT_THEME_ID = 'graphite';

export function findTheme(id: string | null | undefined): Theme {
  return THEMES.find((theme) => theme.id === id) ?? THEMES.find((theme) => theme.id === DEFAULT_THEME_ID) ?? THEMES[0];
}

// Window transparency: when it is on, the base surface carries an alpha so the
// transparent Electron window lets the desktop through everywhere it is used.
let activeTheme: Theme | null = null;
let windowAlpha = 1;
let accentOverride: AccentPalette | null = null;

export interface AccentPalette {
  accent: string;
  accentStrong: string;
  accentSoft: string;
}

/**
 * Borrow the accent from album artwork without touching the rest of the theme.
 * Pass null to fall back to the palette's own accent.
 */
export function setAccentOverride(next: AccentPalette | null) {
  accentOverride = next;
  if (activeTheme) applyTheme(activeTheme);
}

export function currentAccentOverride() {
  return accentOverride;
}

function toRgba(hex: string, alpha: number) {
  const raw = hex.replace('#', '');
  const full = raw.length === 3 ? raw.split('').map((c) => c + c).join('') : raw;
  const value = Number.parseInt(full, 16);
  return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, ${alpha})`;
}

/** 1 = fully opaque; anything lower makes the app shell see-through. */
export function setWindowAlpha(alpha: number) {
  windowAlpha = Math.min(1, Math.max(0.35, alpha));
  if (activeTheme) applyTheme(activeTheme);
}

/** Push a theme onto the document as CSS variables. */
export function applyTheme(theme: Theme) {
  activeTheme = theme;
  const root = document.documentElement;
  const vars: Record<string, string> = {
    '--bg': windowAlpha >= 0.999 ? theme.bg : toRgba(theme.bg, Number(windowAlpha.toFixed(2))),
    '--bg-elevated': theme.elevated,
    '--surface': theme.surface,
    '--surface-hover': theme.surfaceHover,
    '--surface-active': theme.surfaceActive,
    '--text': theme.text,
    '--text-muted': theme.muted,
    '--text-faint': theme.faint,
    '--accent': accentOverride?.accent ?? theme.accent,
    '--accent-strong': accentOverride?.accentStrong ?? theme.accentStrong,
    '--accent-soft': accentOverride?.accentSoft ?? theme.accentSoft,
    '--border': theme.border,
    '--shadow': theme.mode === 'dark' ? '0 18px 50px rgba(0,0,0,0.55)' : '0 18px 50px rgba(0,0,0,0.12)',
  };
  for (const [key, value] of Object.entries(vars)) root.style.setProperty(key, value);
  root.dataset.theme = theme.mode;
  root.dataset.palette = theme.id;
  root.classList.toggle('dark', theme.mode === 'dark');
  root.style.colorScheme = theme.mode;
}
