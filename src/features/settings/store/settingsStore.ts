import { create } from 'zustand';
import { bridge } from '@/shared/api/bridge';
import {
  DEFAULT_THEME_ID,
  findTheme,
  applyTheme,
  setWindowAlpha,
  themeForMode,
  type Theme,
} from '@/shared/config/themes';
import { DEFAULT_LOCALE, type Locale } from '@/shared/config/locales';
import { normalizeLocale, setLocale } from '@/shared/lib/i18n';
import {
  audioEngine,
  DEFAULT_DSP,
  EQ_FREQUENCIES,
  EQ_RANGE_DB,
  type DspSettings,
} from '@/features/player/engine/audioEngine';

const DSP_DEFAULTS: DspSettings = { ...DEFAULT_DSP };

/** The rail's default order: the five pages, in the order Riff keeps them. */
export const SIDEBAR_ORDER_DEFAULT = ['home', 'search', 'favorites', 'library', 'playlists'] as const;

export const DSP_PRESETS: { id: string; label: string; dsp: DspSettings }[] = [
  { id: 'clean', label: 'Clean', dsp: { ...DSP_DEFAULTS } },
  {
    id: 'warm',
    label: 'Warm Tape',
    dsp: { ...DSP_DEFAULTS, drive: 0.22, compressor: 0.35, reverbMix: 0.12, reverbSize: 0.35 },
  },
  {
    id: 'night',
    label: 'Night Drive',
    dsp: {
      ...DSP_DEFAULTS,
      drive: 0.1,
      delayMix: 0.26,
      delayTime: 0.42,
      delayFeedback: 0.36,
      reverbMix: 0.22,
      reverbSize: 0.6,
      compressor: 0.4,
    },
  },
  { id: 'room', label: 'Big Room', dsp: { ...DSP_DEFAULTS, reverbMix: 0.38, reverbSize: 0.85 } },
  { id: 'squash', label: 'Loud & Tight', dsp: { ...DSP_DEFAULTS, compressor: 0.75, drive: 0.08 } },
];

function sanitizeDsp(value: unknown): DspSettings {
  const raw = (value ?? {}) as Partial<Record<keyof DspSettings, unknown>>;
  const unit = (input: unknown, fallback: number) => {
    const number = Number(input);
    return Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : fallback;
  };
  return {
    drive: unit(raw.drive, DSP_DEFAULTS.drive),
    delayMix: unit(raw.delayMix, DSP_DEFAULTS.delayMix),
    delayTime: unit(raw.delayTime, DSP_DEFAULTS.delayTime),
    delayFeedback: unit(raw.delayFeedback, DSP_DEFAULTS.delayFeedback),
    reverbMix: unit(raw.reverbMix, DSP_DEFAULTS.reverbMix),
    reverbSize: unit(raw.reverbSize, DSP_DEFAULTS.reverbSize),
    compressor: unit(raw.compressor, DSP_DEFAULTS.compressor),
    normalize: typeof raw.normalize === 'boolean' ? raw.normalize : DSP_DEFAULTS.normalize,
  };
}

/** Gain in dB for each of the ten bands, low to high. */
export interface EqPreset {
  id: string;
  label: string;
  gains: number[];
}

export const EQ_PRESETS: EqPreset[] = [
  { id: 'flat', label: 'Flat', gains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
  { id: 'bass', label: 'Bass Boost', gains: [8, 7, 5, 3, 1, 0, -1, -1, 0, 0] },
  { id: 'vocal', label: 'Vocal Clarity', gains: [-2, -1, 0, 2, 4, 5, 4, 2, 1, 0] },
  { id: 'electronic', label: 'Electronic', gains: [6, 5, 3, 0, -1, 0, 2, 4, 5, 4] },
  { id: 'rock', label: 'Rock', gains: [5, 4, 2, 0, -1, -1, 2, 3, 4, 3] },
];

const FLAT_GAINS = EQ_FREQUENCIES.map(() => 0);

/** 32 → “32”, 1000 → “1k”, 16000 → “16k”. */
export function bandLabel(frequency: number) {
  return frequency >= 1000 ? `${frequency / 1000}k` : String(frequency);
}

function sanitizeGains(value: unknown): number[] {
  const list = Array.isArray(value) ? value : [];
  return EQ_FREQUENCIES.map((_, index) => {
    const gain = Number(list[index]);
    if (!Number.isFinite(gain)) return 0;
    return Math.max(-EQ_RANGE_DB, Math.min(EQ_RANGE_DB, gain));
  });
}

export type ShortcutAction =
  | 'playPause'
  | 'seekForward'
  | 'seekBackward'
  | 'next'
  | 'previous'
  | 'lyrics'
  | 'queue'
  | 'fullscreen'
  | 'volumeUp'
  | 'volumeDown'
  | 'search'
  | 'back';

export const SHORTCUT_LABELS: Record<ShortcutAction, string> = {
  playPause: 'Play / Pause',
  seekForward: 'Seek forward 5s',
  seekBackward: 'Seek back 5s',
  next: 'Next track',
  previous: 'Previous track',
  lyrics: 'Toggle lyrics',
  queue: 'Toggle queue',
  fullscreen: 'Fullscreen lyrics',
  volumeUp: 'Volume up',
  volumeDown: 'Volume down',
  search: 'Focus search',
  back: 'Back / close',
};

export const DEFAULT_SHORTCUTS: Record<ShortcutAction, string> = {
  playPause: 'Space',
  seekForward: 'ArrowRight',
  seekBackward: 'ArrowLeft',
  next: 'KeyN',
  previous: 'KeyP',
  lyrics: 'KeyL',
  queue: 'KeyQ',
  fullscreen: 'KeyF',
  volumeUp: 'ArrowUp',
  volumeDown: 'ArrowDown',
  search: 'Ctrl+KeyF',
  back: 'Escape',
};

interface SettingsState {
  themeId: string;
  discordEnabled: boolean;
  cacheEnabled: boolean;
  audioQuality: 'high' | 'medium';
  lyricsOffset: number;
  windowTransparent: boolean;
  windowOpacity: number;
  locale: Locale;
  shortcuts: Record<ShortcutAction, string>;
  /** Ten bands, dB each. */
  eqGains: number[];
  eqPreset: string;
  preampDb: number;
  tempo: number;
  /** Tint the whole UI from the current cover's dominant hue. */
  dynamicColor: boolean;
  /** −1 left … 1 right. */
  pan: number;
  mono: boolean;
  /** Which home mark is drawn in the title bar and empty screens. */
  logoVariant: string;
  /** Bass-reactive wavy progress ring around the cover. */
  waveRing: boolean;
  /** Cheap mode: no wave motion, reduced visualiser work. */
  performanceMode: boolean;
  /** 0.5 = half speed, 1 = normal, 2.5 = fast. Scales lyric scroll and karaoke. */
  lyricsSpeed: number;
  /** Feather width of the karaoke sweep, in percent of the word (2 sharp – 24 soft). */
  gradientTightness: number;
  /** Multiplier for spectrum bar heights, 0.5 – 2. */
  visualizerSensitivity: number;
  /** 0 = snappy bars, 1 = long smooth tails. */
  visualizerSmoothness: number;
  dsp: DspSettings;
  dspPreset: string;
  dspPresets: Record<string, DspSettings>;
  /** Fade length for play/pause, 0 disables it. */
  fadeMs: number;
  /** The first-run tour is finished; survives updates because settings do. */
  onboardingComplete: boolean;
  /** Riff's "reduce motion": springs become short fades. */
  reduceMotion: boolean;
  /** Riff's "no-hand cursor": the arrow everywhere instead of a pointing hand. */
  noHandCursor: boolean;
  /** Interface zoom, 0.9 – 1.15. */
  uiScale: number;
  /** Card and panel corner radius in px. */
  cornerRadius: number;
  /** Closing the window quits instead of hiding to the tray. */
  quitOnClose: boolean;
  /** Local profile name shown in Settings, next to the avatar initial. */
  displayName: string;
  /** Local profile picture as a small data URL, or ''. */
  avatar: string;
  /** Custom app background as a compressed data URL, or ''. */
  customBackground: string;
  /** Blur applied to the custom background, in px. */
  backgroundBlur: number;
  /** Custom background opacity, 0 – 100. */
  backgroundOpacity: number;
  /** Animated accent mesh behind the interface, like Riff's. */
  meshGradient: boolean;
  /** Word-by-word karaoke sweep; off leaves a flat two-tone line. */
  lyricsKaraoke: boolean;
  /** Follow the active line automatically; off leaves scrolling to you. */
  lyricsAutoScroll: boolean;
  /** Fetch lyrics from lrclib at all. */
  onlineLyrics: boolean;
  /** Audio output device id; '' follows the system default. */
  outputDeviceId: string;
  /** `[E]` badge next to explicit tracks. */
  showExplicitTag: boolean;
  /** Interface typeface: system sans, a serif, or the mono face. */
  interfaceFont: 'sans' | 'serif' | 'mono';
  /** Rounder, classic track rows. */
  classicCards: boolean;
  /** Track row height in px: 48 dense, 56 default, 68 roomy. */
  rowSize: number;
  /** Use the current cover as the app background, blurred like Riff's. */
  coverBackground: boolean;
  /** Brightness of whichever background is showing, 30 – 130. */
  backgroundBrightness: number;
  /** Slow Ken-Burns drift on the background picture. */
  animateBackground: boolean;
  /** cover = zoom and crop, contain = show the whole picture, stretch = fill exactly. */
  backgroundFit: 'cover' | 'contain' | 'stretch';
  /** Always show the position number in track lists. */
  showTrackNumbers: boolean;
  /** Catalog badge (SOUNDCLOUD, DEEZER, …) next to the artist. */
  showSourceBadge: boolean;
  /** "No lyrics / no sync" notices inside the lyrics panel. */
  showLyricsWarnings: boolean;
  /** Filled circle behind the play/pause glyph. */
  playButtonBackground: boolean;
  /** Compact search field in the title bar, or the field only on the Search page. */
  searchPosition: 'title' | 'page';
  /** Player bar docked at the bottom, or right under the title bar. */
  nowPlayingPosition: 'bottom' | 'top';
  /** Show the small floating player while the window is minimized. */
  miniPlayerOnMinimize: boolean;
  /** Stroke glyphs, or softly filled ones. */
  iconStyle: 'line' | 'solid';
  /** Icon buttons: pill-round or softly rounded. */
  iconRoundness: 'round' | 'soft';
  /** Duration column in track tables. */
  showDurationColumn: boolean;
  /** Album column under the artist in track tables. */
  showAlbumColumn: boolean;
  /** Favourite heart column in track tables. */
  showFavoriteColumn: boolean;
  /** Wave-shaped seek bar instead of a flat rule. */
  wavySeekBar: boolean;
  /** Stroke weight for every Lucide glyph, 1 – 2.6. */
  iconWeight: number;
  /** Where the title-bar search sits: left, middle or right. */
  searchAlign: 'left' | 'middle' | 'right';
  /** A Home button beside the title-bar search. */
  showHomeButton: boolean;
  /** Spectrum bars in the player bar. */
  showPlaybarVisualizer: boolean;
  /** 5 – 100. */
  playbarVisualizerOpacity: number;
  /** Blur behind floating panels (lyrics, queue), 0 – 48. */
  panelBlur: number;
  /** Dragged order of the sidebar rail: nav keys and `pl:<id>` shortcuts. */
  sidebarOrder: string[];
  /** Fill the main button of each screen with the accent. */
  highlightButtons: boolean;
  /** 0 – 100, how far the accent bleeds into neutral surfaces. */
  accentIntensity: number;
  /** Apply the accent intensity to panels and the background. */
  tintBackground: boolean;
  /** 0 – 100, opacity of the accent mesh. */
  meshBrightness: number;
  /** Banner animation period in seconds, 12 – 48. */
  bannerAnimationSpeed: number;
  /** 20 – 100, how far the banner fades towards the bottom. */
  bannerFade: number;
  /** Glyph on the Home "listening right now" badge. */
  topMomentIcon: 'heart' | 'honey' | 'star' | 'fire' | 'cloud';
  /** Draw the Cloudy mark beside the Home greeting. */
  showHomeLogo: boolean;
  /** Now Playing title alignment. */
  nowPlayingTitleAlign: 'left' | 'center';
  /** Where the transport sits on the Now Playing screen. */
  nowPlayingToolbarPosition:
    | 'top-center'
    | 'top-left'
    | 'top-right'
    | 'bottom-center'
    | 'bottom-left'
    | 'bottom-right'
    | 'left-center'
    | 'right-center';
  /** Default keeps the artist line; Compact drops it for a tighter row. */
  trackCardStyle: 'default' | 'compact';
  /** Spectrum inside the Now Playing panel. */
  showNowPlayingVisualizer: boolean;
  /** Visualizer beside the controls, or stretched behind the whole bar. */
  playbarVisualizerPosition: 'compact' | 'behind';
  /** 20 – 100, opacity of surface panels. */
  interfaceOpacity: number;
  /** Bars or a single waving line. */
  visualizerStyle: 'bars' | 'wave';
  /** Morphing cover shape in the player bar. */
  shapedCover: boolean;
  /** Morphing cover shape on the Now Playing and karaoke screens. */
  shapedCoversNowPlaying: boolean;
  /** Artwork backdrop inside the Now Playing panel. */
  nowPlayingBanner: boolean;
  /** Artwork backdrop on playlist pages. */
  playlistBanners: boolean;
  /** Blur of the cover banner, 0 – 12. */
  bannerBlur: number;
  /** Opacity of the cover banner, 20 – 100. */
  bannerOpacity: number;
  /** Theme mode override; auto keeps the palette's own darkness. */
  themeMode: 'auto' | 'dark' | 'light';
  /** Fade the player-bar timestamps out until the pointer is over them. */
  autohideTimestamps: boolean;
  /** Hide the title bar until the pointer reaches the top edge. */
  titleBarAutoHide: boolean;
  /** Your own CSS, appended after the app's styles. */
  customCss: string;
  /** Riff's accent controls: take the accent over from the theme. */
  customAccentEnabled: boolean;
  accentHue: number;
  accentSaturation: number;
  accentLightness: number;
  loaded: boolean;
  load: () => Promise<void>;
  setTheme: (id: string) => void;
  currentTheme: () => Theme;
  setDiscord: (enabled: boolean) => void;
  setCacheEnabled: (enabled: boolean) => void;
  setAudioQuality: (quality: 'high' | 'medium') => void;
  setLyricsOffset: (offset: number) => void;
  setWindowTransparent: (enabled: boolean) => void;
  setWindowOpacity: (opacity: number) => void;
  setLocale: (locale: Locale) => void;
  setShortcut: (action: ShortcutAction, keys: string) => void;
  resetShortcuts: () => void;
  setEqBand: (index: number, gain: number) => void;
  applyEqPreset: (id: string) => void;
  setPreamp: (db: number) => void;
  setTempo: (rate: number) => void;
  setDynamicColor: (on: boolean) => void;
  setPan: (value: number) => void;
  setMono: (on: boolean) => void;
  setLogoVariant: (variant: string) => void;
  setWaveRing: (on: boolean) => void;
  setPerformanceMode: (on: boolean) => void;
  setReduceMotion: (on: boolean) => void;
  setNoHandCursor: (on: boolean) => void;
  setUiScale: (value: number) => void;
  setCornerRadius: (value: number) => void;
  setQuitOnClose: (on: boolean) => void;
  setDisplayName: (name: string) => void;
  setAvatar: (dataUrl: string) => void;
  setCustomBackground: (dataUrl: string) => void;
  setBackgroundBlur: (value: number) => void;
  setBackgroundOpacity: (value: number) => void;
  setMeshGradient: (on: boolean) => void;
  setCustomAccentEnabled: (on: boolean) => void;
  setAccentHue: (value: number) => void;
  setAccentSaturation: (value: number) => void;
  setAccentLightness: (value: number) => void;
  setLyricsKaraoke: (on: boolean) => void;
  setLyricsAutoScroll: (on: boolean) => void;
  setOnlineLyrics: (on: boolean) => void;
  setTitleBarAutoHide: (on: boolean) => void;
  setAutohideTimestamps: (on: boolean) => void;
  setShowExplicitTag: (on: boolean) => void;
  setRowSize: (value: number) => void;
  setCoverBackground: (on: boolean) => void;
  setBackgroundBrightness: (value: number) => void;
  setAnimateBackground: (on: boolean) => void;
  setBackgroundFit: (fit: 'cover' | 'contain' | 'stretch') => void;
  setShowTrackNumbers: (on: boolean) => void;
  setShowSourceBadge: (on: boolean) => void;
  setShowLyricsWarnings: (on: boolean) => void;
  setPlayButtonBackground: (on: boolean) => void;
  setSearchPosition: (position: 'title' | 'page') => void;
  setNowPlayingPosition: (position: 'bottom' | 'top') => void;
  setMiniPlayerOnMinimize: (on: boolean) => void;
  setIconStyle: (style: 'line' | 'solid') => void;
  setIconRoundness: (roundness: 'round' | 'soft') => void;
  setShowDurationColumn: (on: boolean) => void;
  setShowAlbumColumn: (on: boolean) => void;
  setShowFavoriteColumn: (on: boolean) => void;
  setWavySeekBar: (on: boolean) => void;
  setIconWeight: (value: number) => void;
  setSearchAlign: (align: 'left' | 'middle' | 'right') => void;
  setShowHomeButton: (on: boolean) => void;
  setShowPlaybarVisualizer: (on: boolean) => void;
  setPlaybarVisualizerOpacity: (value: number) => void;
  setPanelBlur: (value: number) => void;
  setSidebarOrder: (order: string[]) => void;
  setHighlightButtons: (on: boolean) => void;
  setAccentIntensity: (value: number) => void;
  setTintBackground: (on: boolean) => void;
  setMeshBrightness: (value: number) => void;
  setBannerAnimationSpeed: (value: number) => void;
  setBannerFade: (value: number) => void;
  setTopMomentIcon: (icon: 'heart' | 'honey' | 'star' | 'fire' | 'cloud') => void;
  setShowHomeLogo: (on: boolean) => void;
  setNowPlayingTitleAlign: (align: 'left' | 'center') => void;
  setNowPlayingToolbarPosition: (position: SettingsState['nowPlayingToolbarPosition']) => void;
  setTrackCardStyle: (style: 'default' | 'compact') => void;
  setShowNowPlayingVisualizer: (on: boolean) => void;
  setPlaybarVisualizerPosition: (position: 'compact' | 'behind') => void;
  setInterfaceOpacity: (value: number) => void;
  setVisualizerStyle: (style: 'bars' | 'wave') => void;
  setShapedCover: (on: boolean) => void;
  setShapedCoversNowPlaying: (on: boolean) => void;
  setNowPlayingBanner: (on: boolean) => void;
  setPlaylistBanners: (on: boolean) => void;
  setBannerBlur: (value: number) => void;
  setBannerOpacity: (value: number) => void;
  setThemeMode: (mode: 'auto' | 'dark' | 'light') => void;
  resetInterface: () => void;
  setOutputDeviceId: (id: string) => void;
  setInterfaceFont: (font: 'sans' | 'serif' | 'mono') => void;
  setClassicCards: (on: boolean) => void;
  setCustomCss: (css: string) => void;
  setLyricsSpeed: (speed: number) => void;
  setGradientTightness: (percent: number) => void;
  setVisualizerSensitivity: (value: number) => void;
  setVisualizerSmoothness: (value: number) => void;
  setDsp: (next: Partial<DspSettings>) => void;
  applyDspPreset: (id: string) => void;
  saveDspPreset: (name: string) => void;
  deleteDspPreset: (name: string) => void;
  setFadeMs: (ms: number) => void;
  resetAudio: () => void;
  completeOnboarding: () => void;
}

const persistKey = (key: string, value: unknown) => {
  void bridge().settings.set(key, value).catch(() => undefined);
};

export const useSettingsStore = create<SettingsState>((set, get) => ({
  themeId: DEFAULT_THEME_ID,
  discordEnabled: true,
  cacheEnabled: true,
  audioQuality: 'high',
  lyricsOffset: 0,
  windowTransparent: false,
  windowOpacity: 0.9,
  locale: DEFAULT_LOCALE,
  shortcuts: { ...DEFAULT_SHORTCUTS },
  eqGains: [...FLAT_GAINS],
  eqPreset: 'flat',
  preampDb: 0,
  tempo: 1,
  dynamicColor: true,
  pan: 0,
  mono: false,
  logoVariant: 'bloom',
  waveRing: true,
  performanceMode: false,
  lyricsSpeed: 1,
  gradientTightness: 12,
  visualizerSensitivity: 1,
  visualizerSmoothness: 0.5,
  dsp: { ...DSP_DEFAULTS },
  dspPreset: 'clean',
  dspPresets: {},
  fadeMs: 0,
  onboardingComplete: false,
  reduceMotion: false,
  noHandCursor: false,
  uiScale: 1,
  cornerRadius: 12,
  quitOnClose: false,
  displayName: '',
  avatar: '',
  customBackground: '',
  backgroundBlur: 12,
  backgroundOpacity: 100,
  meshGradient: true,
  lyricsKaraoke: true,
  lyricsAutoScroll: true,
  onlineLyrics: true,
  rowSize: 56,
  coverBackground: false,
  backgroundBrightness: 100,
  animateBackground: false,
  backgroundFit: 'cover',
  showTrackNumbers: false,
  showSourceBadge: true,
  showLyricsWarnings: true,
  playButtonBackground: true,
  searchPosition: 'title',
  nowPlayingPosition: 'bottom',
  miniPlayerOnMinimize: true,
  iconStyle: 'line',
  iconRoundness: 'round',
  showDurationColumn: true,
  showAlbumColumn: true,
  showFavoriteColumn: true,
  wavySeekBar: true,
  iconWeight: 1.75,
  searchAlign: 'middle',
  showHomeButton: false,
  showPlaybarVisualizer: true,
  playbarVisualizerOpacity: 100,
  panelBlur: 10,
  sidebarOrder: [...SIDEBAR_ORDER_DEFAULT],
  highlightButtons: true,
  accentIntensity: 0,
  tintBackground: false,
  meshBrightness: 50,
  bannerAnimationSpeed: 44,
  bannerFade: 100,
  topMomentIcon: 'heart',
  showHomeLogo: false,
  nowPlayingTitleAlign: 'left',
  nowPlayingToolbarPosition: 'top-center',
  trackCardStyle: 'default',
  showNowPlayingVisualizer: false,
  playbarVisualizerPosition: 'compact',
  interfaceOpacity: 100,
  visualizerStyle: 'bars',
  shapedCover: false,
  shapedCoversNowPlaying: false,
  nowPlayingBanner: false,
  playlistBanners: false,
  bannerBlur: 0,
  bannerOpacity: 100,
  themeMode: 'auto',
  outputDeviceId: '',
  showExplicitTag: true,
  interfaceFont: 'sans',
  classicCards: false,
  autohideTimestamps: false,
  titleBarAutoHide: false,
  customCss: '',
  customAccentEnabled: false,
  accentHue: 262,
  accentSaturation: 72,
  accentLightness: 64,
  loaded: false,

  async load() {
    try {
      const stored = (await bridge().settings.all()) as Record<string, unknown>;
      const next: Partial<SettingsState> = {};
      if (typeof stored.themeId === 'string') next.themeId = findTheme(stored.themeId).id;
      // Migrate the old dark/light preference.
      else if (stored.theme === 'light') next.themeId = 'daylight';
      if (typeof stored.discordEnabled === 'boolean') next.discordEnabled = stored.discordEnabled;
      if (typeof stored.cacheEnabled === 'boolean') next.cacheEnabled = stored.cacheEnabled;
      if (stored.audioQuality === 'high' || stored.audioQuality === 'medium') next.audioQuality = stored.audioQuality;
      if (typeof stored.lyricsOffset === 'number') next.lyricsOffset = stored.lyricsOffset;
      if (typeof stored.windowTransparent === 'boolean') next.windowTransparent = stored.windowTransparent;
      if (stored.onboardingComplete === true) next.onboardingComplete = true;
      if (typeof stored.windowOpacity === 'number') next.windowOpacity = stored.windowOpacity;
      if (typeof stored.locale === 'string') next.locale = normalizeLocale(stored.locale);
      if (stored.shortcuts && typeof stored.shortcuts === 'object') {
        next.shortcuts = { ...DEFAULT_SHORTCUTS, ...(stored.shortcuts as Record<ShortcutAction, string>) };
      }
      if (stored.eqGains) {
        next.eqGains = sanitizeGains(stored.eqGains);
        next.eqPreset = typeof stored.eqPreset === 'string' ? stored.eqPreset : 'custom';
      }
      if (typeof stored.preampDb === 'number') next.preampDb = stored.preampDb;
      if (typeof stored.tempo === 'number') next.tempo = Math.min(2, Math.max(0.5, stored.tempo));
      if (typeof stored.dynamicColor === 'boolean') next.dynamicColor = stored.dynamicColor;
      if (typeof stored.logoVariant === 'string') next.logoVariant = stored.logoVariant;
      if (typeof stored.pan === 'number') next.pan = Math.max(-1, Math.min(1, stored.pan));
      if (typeof stored.mono === 'boolean') next.mono = stored.mono;
      if (typeof stored.waveRing === 'boolean') next.waveRing = stored.waveRing;
      if (typeof stored.performanceMode === 'boolean') next.performanceMode = stored.performanceMode;
      if (typeof stored.reduceMotion === 'boolean') next.reduceMotion = stored.reduceMotion;
      if (typeof stored.noHandCursor === 'boolean') next.noHandCursor = stored.noHandCursor;
      if (typeof stored.uiScale === 'number') next.uiScale = Math.max(0.9, Math.min(1.15, stored.uiScale));
      if (typeof stored.cornerRadius === 'number')
        next.cornerRadius = Math.max(0, Math.min(20, Math.round(stored.cornerRadius)));
      if (typeof stored.quitOnClose === 'boolean') next.quitOnClose = stored.quitOnClose;
      if (typeof stored.displayName === 'string') next.displayName = stored.displayName.slice(0, 40);
      if (typeof stored.avatar === 'string') next.avatar = stored.avatar;
      if (typeof stored.customBackground === 'string') next.customBackground = stored.customBackground;
      if (typeof stored.backgroundBlur === 'number')
        next.backgroundBlur = Math.max(0, Math.min(40, Math.round(stored.backgroundBlur)));
      if (typeof stored.backgroundOpacity === 'number')
        next.backgroundOpacity = Math.max(0, Math.min(100, Math.round(stored.backgroundOpacity)));
      if (typeof stored.meshGradient === 'boolean') next.meshGradient = stored.meshGradient;
      if (typeof stored.lyricsKaraoke === 'boolean') next.lyricsKaraoke = stored.lyricsKaraoke;
      if (typeof stored.lyricsAutoScroll === 'boolean') next.lyricsAutoScroll = stored.lyricsAutoScroll;
      if (typeof stored.onlineLyrics === 'boolean') next.onlineLyrics = stored.onlineLyrics;
      if (typeof stored.rowSize === 'number') next.rowSize = Math.max(44, Math.min(84, Math.round(stored.rowSize)));
      if (typeof stored.coverBackground === 'boolean') next.coverBackground = stored.coverBackground;
      if (typeof stored.backgroundBrightness === 'number')
        next.backgroundBrightness = Math.max(30, Math.min(130, Math.round(stored.backgroundBrightness)));
      if (typeof stored.animateBackground === 'boolean') next.animateBackground = stored.animateBackground;
      if (stored.backgroundFit === 'cover' || stored.backgroundFit === 'contain' || stored.backgroundFit === 'stretch')
        next.backgroundFit = stored.backgroundFit;
      if (typeof stored.showTrackNumbers === 'boolean') next.showTrackNumbers = stored.showTrackNumbers;
      if (typeof stored.showSourceBadge === 'boolean') next.showSourceBadge = stored.showSourceBadge;
      if (typeof stored.showLyricsWarnings === 'boolean') next.showLyricsWarnings = stored.showLyricsWarnings;
      if (typeof stored.playButtonBackground === 'boolean')
        next.playButtonBackground = stored.playButtonBackground;
      if (stored.searchPosition === 'title' || stored.searchPosition === 'page')
        next.searchPosition = stored.searchPosition;
      if (stored.nowPlayingPosition === 'bottom' || stored.nowPlayingPosition === 'top')
        next.nowPlayingPosition = stored.nowPlayingPosition;
      if (typeof stored.miniPlayerOnMinimize === 'boolean')
        next.miniPlayerOnMinimize = stored.miniPlayerOnMinimize;
      if (stored.iconStyle === 'line' || stored.iconStyle === 'solid') next.iconStyle = stored.iconStyle;
      if (stored.iconRoundness === 'round' || stored.iconRoundness === 'soft')
        next.iconRoundness = stored.iconRoundness;
      if (typeof stored.showDurationColumn === 'boolean') next.showDurationColumn = stored.showDurationColumn;
      if (typeof stored.showAlbumColumn === 'boolean') next.showAlbumColumn = stored.showAlbumColumn;
      if (typeof stored.showFavoriteColumn === 'boolean') next.showFavoriteColumn = stored.showFavoriteColumn;
      if (typeof stored.wavySeekBar === 'boolean') next.wavySeekBar = stored.wavySeekBar;
      if (typeof stored.iconWeight === 'number')
        next.iconWeight = Math.max(1, Math.min(2.6, stored.iconWeight));
      if (stored.searchAlign === 'left' || stored.searchAlign === 'middle' || stored.searchAlign === 'right')
        next.searchAlign = stored.searchAlign;
      if (typeof stored.showHomeButton === 'boolean') next.showHomeButton = stored.showHomeButton;
      if (typeof stored.showPlaybarVisualizer === 'boolean')
        next.showPlaybarVisualizer = stored.showPlaybarVisualizer;
      if (typeof stored.playbarVisualizerOpacity === 'number')
        next.playbarVisualizerOpacity = Math.max(5, Math.min(100, Math.round(stored.playbarVisualizerOpacity)));
      if (typeof stored.panelBlur === 'number') next.panelBlur = Math.max(0, Math.min(48, Math.round(stored.panelBlur)));
      if (Array.isArray(stored.sidebarOrder))
        next.sidebarOrder = stored.sidebarOrder.filter((id): id is string => typeof id === 'string').slice(0, 400);
      if (typeof stored.highlightButtons === 'boolean') next.highlightButtons = stored.highlightButtons;
      if (typeof stored.accentIntensity === 'number')
        next.accentIntensity = Math.max(0, Math.min(100, Math.round(stored.accentIntensity)));
      if (typeof stored.tintBackground === 'boolean') next.tintBackground = stored.tintBackground;
      if (typeof stored.meshBrightness === 'number')
        next.meshBrightness = Math.max(0, Math.min(100, Math.round(stored.meshBrightness)));
      if (typeof stored.bannerAnimationSpeed === 'number')
        next.bannerAnimationSpeed = Math.max(12, Math.min(48, Math.round(stored.bannerAnimationSpeed)));
      if (typeof stored.bannerFade === 'number')
        next.bannerFade = Math.max(20, Math.min(100, Math.round(stored.bannerFade)));
      if (stored.topMomentIcon === 'heart' || stored.topMomentIcon === 'honey' || stored.topMomentIcon === 'star' || stored.topMomentIcon === 'fire' || stored.topMomentIcon === 'cloud')
        next.topMomentIcon = stored.topMomentIcon;
      if (typeof stored.showHomeLogo === 'boolean') next.showHomeLogo = stored.showHomeLogo;
      if (stored.nowPlayingTitleAlign === 'left' || stored.nowPlayingTitleAlign === 'center')
        next.nowPlayingTitleAlign = stored.nowPlayingTitleAlign;
      if (typeof stored.nowPlayingToolbarPosition === 'string' && stored.nowPlayingToolbarPosition.includes('-'))
        next.nowPlayingToolbarPosition = stored.nowPlayingToolbarPosition as SettingsState['nowPlayingToolbarPosition'];
      if (stored.trackCardStyle === 'default' || stored.trackCardStyle === 'compact')
        next.trackCardStyle = stored.trackCardStyle;
      if (typeof stored.showNowPlayingVisualizer === 'boolean')
        next.showNowPlayingVisualizer = stored.showNowPlayingVisualizer;
      if (stored.playbarVisualizerPosition === 'compact' || stored.playbarVisualizerPosition === 'behind')
        next.playbarVisualizerPosition = stored.playbarVisualizerPosition;
      if (typeof stored.interfaceOpacity === 'number')
        next.interfaceOpacity = Math.max(20, Math.min(100, Math.round(stored.interfaceOpacity)));
      if (stored.visualizerStyle === 'bars' || stored.visualizerStyle === 'wave')
        next.visualizerStyle = stored.visualizerStyle;
      if (typeof stored.shapedCover === 'boolean') next.shapedCover = stored.shapedCover;
      if (typeof stored.shapedCoversNowPlaying === 'boolean')
        next.shapedCoversNowPlaying = stored.shapedCoversNowPlaying;
      if (typeof stored.nowPlayingBanner === 'boolean') next.nowPlayingBanner = stored.nowPlayingBanner;
      if (typeof stored.playlistBanners === 'boolean') next.playlistBanners = stored.playlistBanners;
      if (typeof stored.bannerBlur === 'number') next.bannerBlur = Math.max(0, Math.min(12, stored.bannerBlur));
      if (typeof stored.bannerOpacity === 'number')
        next.bannerOpacity = Math.max(20, Math.min(100, Math.round(stored.bannerOpacity)));
      if (stored.themeMode === 'auto' || stored.themeMode === 'dark' || stored.themeMode === 'light')
        next.themeMode = stored.themeMode;
      if (typeof stored.outputDeviceId === 'string') next.outputDeviceId = stored.outputDeviceId;
      if (typeof stored.showExplicitTag === 'boolean') next.showExplicitTag = stored.showExplicitTag;
      if (stored.interfaceFont === 'sans' || stored.interfaceFont === 'serif' || stored.interfaceFont === 'mono')
        next.interfaceFont = stored.interfaceFont;
      if (typeof stored.classicCards === 'boolean') next.classicCards = stored.classicCards;
      if (typeof stored.autohideTimestamps === 'boolean') next.autohideTimestamps = stored.autohideTimestamps;
      if (typeof stored.titleBarAutoHide === 'boolean') next.titleBarAutoHide = stored.titleBarAutoHide;
      if (typeof stored.customCss === 'string') next.customCss = stored.customCss.slice(0, 20_000);
      if (typeof stored.customAccentEnabled === 'boolean') next.customAccentEnabled = stored.customAccentEnabled;
      if (typeof stored.accentHue === 'number')
        next.accentHue = Math.max(0, Math.min(360, Math.round(stored.accentHue)));
      if (typeof stored.accentSaturation === 'number')
        next.accentSaturation = Math.max(20, Math.min(100, Math.round(stored.accentSaturation)));
      if (typeof stored.accentLightness === 'number')
        next.accentLightness = Math.max(40, Math.min(85, Math.round(stored.accentLightness)));
      if (typeof stored.lyricsSpeed === 'number') next.lyricsSpeed = stored.lyricsSpeed;
      if (typeof stored.gradientTightness === 'number')
        next.gradientTightness = Math.max(2, Math.min(24, stored.gradientTightness));
      if (typeof stored.visualizerSensitivity === 'number')
        next.visualizerSensitivity = Math.max(0.5, Math.min(2, stored.visualizerSensitivity));
      if (typeof stored.visualizerSmoothness === 'number')
        next.visualizerSmoothness = Math.max(0, Math.min(1, stored.visualizerSmoothness));
      if (stored.dsp) {
        next.dsp = sanitizeDsp(stored.dsp);
        next.dspPreset = typeof stored.dspPreset === 'string' ? stored.dspPreset : 'custom';
      }
      if (stored.dspPresets && typeof stored.dspPresets === 'object') {
        const presets: Record<string, DspSettings> = {};
        for (const [name, value] of Object.entries(stored.dspPresets as Record<string, unknown>)) {
          presets[name] = sanitizeDsp(value);
        }
        next.dspPresets = presets;
      }
      if (typeof stored.fadeMs === 'number') next.fadeMs = Math.max(0, Math.min(2000, stored.fadeMs));
      set({ ...next, loaded: true });
      // The engine keeps its own copy, so these survive until the audio graph
      // is built on the first play.
      audioEngine.setEq(next.eqGains ?? get().eqGains);
      audioEngine.setPreampDb(next.preampDb ?? get().preampDb);
      audioEngine.setTempo(next.tempo ?? get().tempo);
      audioEngine.setDsp(next.dsp ?? get().dsp);
      audioEngine.setPan(next.pan ?? get().pan);
      audioEngine.setMono(next.mono ?? get().mono);
      setLocale(next.locale ?? get().locale);
      const transparent = next.windowTransparent ?? get().windowTransparent;
      setWindowAlpha(transparent ? (next.windowOpacity ?? get().windowOpacity) : 1);
      applyTheme(themeForMode(findTheme(next.themeId ?? get().themeId), next.themeMode ?? get().themeMode));
      void bridge().presence.setEnabled(next.discordEnabled ?? get().discordEnabled);
    } catch {
      set({ loaded: true });
      applyTheme(findTheme(get().themeId));
    }
  },

  setTheme(id) {
    const theme = findTheme(id);
    set({ themeId: theme.id });
    applyTheme(themeForMode(theme, get().themeMode));
    persistKey('themeId', theme.id);
  },

  setThemeMode(mode) {
    set({ themeMode: mode });
    applyTheme(themeForMode(findTheme(get().themeId), mode));
    persistKey('themeMode', mode);
  },

  currentTheme() {
    return findTheme(get().themeId);
  },

  setDiscord(enabled) {
    set({ discordEnabled: enabled });
    persistKey('discordEnabled', enabled);
    void bridge().presence.setEnabled(enabled);
  },

  setCacheEnabled(enabled) {
    set({ cacheEnabled: enabled });
    persistKey('cacheEnabled', enabled);
  },

  setAudioQuality(quality) {
    set({ audioQuality: quality });
    persistKey('audioQuality', quality);
  },

  setLyricsOffset(offset) {
    set({ lyricsOffset: offset });
    persistKey('lyricsOffset', offset);
  },

  /** The Electron main process rebuilds the window so the flag can take effect. */
  completeOnboarding() {
    set({ onboardingComplete: true });
    persistKey('onboardingComplete', true);
  },

  setWindowTransparent(enabled) {
    set({ windowTransparent: enabled });
    setWindowAlpha(enabled ? get().windowOpacity : 1);
    persistKey('windowTransparent', enabled);
  },

  setWindowOpacity(opacity) {
    const value = Math.min(1, Math.max(0.35, opacity));
    set({ windowOpacity: value });
    if (get().windowTransparent) setWindowAlpha(value);
    persistKey('windowOpacity', value);
  },

  setLocale(locale) {
    const value = normalizeLocale(locale);
    set({ locale: value });
    setLocale(value);
    persistKey('locale', value);
  },

  setShortcut(action, keys) {
    const shortcuts = { ...get().shortcuts, [action]: keys };
    set({ shortcuts });
    persistKey('shortcuts', shortcuts);
  },

  resetShortcuts() {
    const shortcuts = { ...DEFAULT_SHORTCUTS };
    set({ shortcuts });
    persistKey('shortcuts', shortcuts);
  },

  setEqBand(index, gain) {
    const value = Math.max(-EQ_RANGE_DB, Math.min(EQ_RANGE_DB, Math.round(gain * 10) / 10));
    const eqGains = get().eqGains.map((current, band) => (band === index ? value : current));
    audioEngine.setEq(eqGains);
    set({ eqGains, eqPreset: 'custom' });
    persistKey('eqGains', eqGains);
    persistKey('eqPreset', 'custom');
  },

  applyEqPreset(id) {
    const preset = EQ_PRESETS.find((entry) => entry.id === id) ?? EQ_PRESETS[0];
    const eqGains = [...preset.gains];
    audioEngine.setEq(eqGains);
    set({ eqGains, eqPreset: preset.id });
    persistKey('eqGains', eqGains);
    persistKey('eqPreset', preset.id);
  },

  setPreamp(db) {
    const value = Math.max(-12, Math.min(12, Math.round(db * 10) / 10));
    audioEngine.setPreampDb(value);
    set({ preampDb: value });
    persistKey('preampDb', value);
  },

  setDynamicColor(on) {
    set({ dynamicColor: on });
    persistKey('dynamicColor', on);
  },

  setPan(value) {
    const pan = Math.max(-1, Math.min(1, Math.round(value * 100) / 100));
    audioEngine.setPan(pan);
    set({ pan });
    persistKey('pan', pan);
  },

  setMono(on) {
    audioEngine.setMono(on);
    set({ mono: on });
    persistKey('mono', on);
  },

  setLogoVariant(variant) {
    set({ logoVariant: variant });
    persistKey('logoVariant', variant);
  },

  setReduceMotion(on) {
    set({ reduceMotion: on });
    persistKey('reduceMotion', on);
  },

  setNoHandCursor(on) {
    set({ noHandCursor: on });
    persistKey('noHandCursor', on);
  },

  setUiScale(value) {
    const uiScale = Math.max(0.9, Math.min(1.15, Math.round(value * 100) / 100));
    set({ uiScale });
    persistKey('uiScale', uiScale);
  },

  setCornerRadius(value) {
    const cornerRadius = Math.max(0, Math.min(20, Math.round(value)));
    set({ cornerRadius });
    persistKey('cornerRadius', cornerRadius);
  },

  setQuitOnClose(on) {
    set({ quitOnClose: on });
    persistKey('quitOnClose', on);
  },

  setDisplayName(name) {
    const displayName = name.slice(0, 40);
    set({ displayName });
    persistKey('displayName', displayName);
  },

  setAvatar(dataUrl) {
    set({ avatar: dataUrl });
    persistKey('avatar', dataUrl);
  },

  setCustomBackground(dataUrl) {
    set({ customBackground: dataUrl });
    persistKey('customBackground', dataUrl);
  },

  setBackgroundBlur(value) {
    const backgroundBlur = Math.max(0, Math.min(40, Math.round(value)));
    set({ backgroundBlur });
    persistKey('backgroundBlur', backgroundBlur);
  },

  setBackgroundOpacity(value) {
    const backgroundOpacity = Math.max(0, Math.min(100, Math.round(value)));
    set({ backgroundOpacity });
    persistKey('backgroundOpacity', backgroundOpacity);
  },

  setMeshGradient(on) {
    set({ meshGradient: on });
    persistKey('meshGradient', on);
  },

  // A custom accent owns --accent, so cover-driven colour is switched off with
  // it; otherwise every track change would repaint the accent behind your back.
  setCustomAccentEnabled(on) {
    set(on ? { customAccentEnabled: on, dynamicColor: false } : { customAccentEnabled: on });
    persistKey('customAccentEnabled', on);
    if (on) persistKey('dynamicColor', false);
  },

  setAccentHue(value) {
    const accentHue = Math.max(0, Math.min(360, Math.round(value)));
    set({ accentHue });
    persistKey('accentHue', accentHue);
  },

  setAccentSaturation(value) {
    const accentSaturation = Math.max(20, Math.min(100, Math.round(value)));
    set({ accentSaturation });
    persistKey('accentSaturation', accentSaturation);
  },

  setLyricsKaraoke(on) {
    set({ lyricsKaraoke: on });
    persistKey('lyricsKaraoke', on);
  },

  setLyricsAutoScroll(on) {
    set({ lyricsAutoScroll: on });
    persistKey('lyricsAutoScroll', on);
  },

  setOnlineLyrics(on) {
    set({ onlineLyrics: on });
    persistKey('onlineLyrics', on);
  },

  setOutputDeviceId(id) {
    set({ outputDeviceId: id });
    persistKey('outputDeviceId', id);
    void audioEngine.setOutputDevice(id);
  },

  setRowSize(value) {
    const rowSize = Math.max(44, Math.min(84, Math.round(value)));
    set({ rowSize });
    persistKey('rowSize', rowSize);
  },

  setCoverBackground(on) {
    set({ coverBackground: on });
    persistKey('coverBackground', on);
  },

  setBackgroundBrightness(value) {
    const backgroundBrightness = Math.max(30, Math.min(130, Math.round(value)));
    set({ backgroundBrightness });
    persistKey('backgroundBrightness', backgroundBrightness);
  },

  setAnimateBackground(on) {
    set({ animateBackground: on });
    persistKey('animateBackground', on);
  },

  setBackgroundFit(fit) {
    set({ backgroundFit: fit });
    persistKey('backgroundFit', fit);
  },

  setShowTrackNumbers(on) {
    set({ showTrackNumbers: on });
    persistKey('showTrackNumbers', on);
  },

  setShowSourceBadge(on) {
    set({ showSourceBadge: on });
    persistKey('showSourceBadge', on);
  },

  setShowLyricsWarnings(on) {
    set({ showLyricsWarnings: on });
    persistKey('showLyricsWarnings', on);
  },

  setPlayButtonBackground(on) {
    set({ playButtonBackground: on });
    persistKey('playButtonBackground', on);
  },

  /** Put the interface back to stock values; the library is untouched. */
  resetInterface() {
    const defaults = {
      rowSize: 56,
      coverBackground: false,
      backgroundBrightness: 100,
      animateBackground: false,
      backgroundFit: 'cover' as const,
      showTrackNumbers: false,
      showSourceBadge: true,
      showLyricsWarnings: true,
      playButtonBackground: true,
      searchPosition: 'title' as const,
      nowPlayingPosition: 'bottom' as const,
      miniPlayerOnMinimize: true,
      iconStyle: 'line' as const,
      iconRoundness: 'round' as const,
      showDurationColumn: true,
      showAlbumColumn: true,
      showFavoriteColumn: true,
      wavySeekBar: true,
      iconWeight: 1.75,
      searchAlign: 'middle' as const,
      showHomeButton: false,
      showPlaybarVisualizer: true,
      playbarVisualizerOpacity: 100,
      panelBlur: 10,
      sidebarOrder: [...SIDEBAR_ORDER_DEFAULT],
      highlightButtons: true,
      accentIntensity: 0,
      tintBackground: false,
      meshBrightness: 50,
      bannerAnimationSpeed: 44,
      bannerFade: 100,
      topMomentIcon: 'heart' as const,
      showHomeLogo: false,
      nowPlayingTitleAlign: 'left' as const,
      nowPlayingToolbarPosition: 'top-center' as const,
      trackCardStyle: 'default' as const,
      showNowPlayingVisualizer: false,
      playbarVisualizerPosition: 'compact' as const,
      interfaceOpacity: 100,
      visualizerStyle: 'bars' as const,
      shapedCover: false,
      shapedCoversNowPlaying: false,
      nowPlayingBanner: false,
      playlistBanners: false,
      bannerBlur: 0,
      bannerOpacity: 100,
      themeMode: 'auto' as const,
      reduceMotion: false,
      noHandCursor: false,
      uiScale: 1,
      cornerRadius: 12,
      autohideTimestamps: false,
      titleBarAutoHide: false,
      classicCards: false,
      customCss: '',
      customBackground: '',
      backgroundBlur: 12,
      backgroundOpacity: 100,
      meshGradient: true,
      customAccentEnabled: false,
      showExplicitTag: true,
      interfaceFont: 'sans' as const,
    };
    set(defaults);
    for (const [key, value] of Object.entries(defaults)) persistKey(key, value);
  },

  setShowExplicitTag(on) {
    set({ showExplicitTag: on });
    persistKey('showExplicitTag', on);
  },

  setInterfaceFont(font) {
    set({ interfaceFont: font });
    persistKey('interfaceFont', font);
  },

  setClassicCards(on) {
    set({ classicCards: on });
    persistKey('classicCards', on);
  },

  setSearchPosition(position) {
    set({ searchPosition: position });
    persistKey('searchPosition', position);
  },

  setNowPlayingPosition(position) {
    set({ nowPlayingPosition: position });
    persistKey('nowPlayingPosition', position);
  },

  setMiniPlayerOnMinimize(on) {
    set({ miniPlayerOnMinimize: on });
    persistKey('miniPlayerOnMinimize', on);
  },

  setIconStyle(style) {
    set({ iconStyle: style });
    persistKey('iconStyle', style);
  },

  setIconRoundness(roundness) {
    set({ iconRoundness: roundness });
    persistKey('iconRoundness', roundness);
  },

  setShowDurationColumn(on) {
    set({ showDurationColumn: on });
    persistKey('showDurationColumn', on);
  },

  setShowAlbumColumn(on) {
    set({ showAlbumColumn: on });
    persistKey('showAlbumColumn', on);
  },

  setShowFavoriteColumn(on) {
    set({ showFavoriteColumn: on });
    persistKey('showFavoriteColumn', on);
  },

  setWavySeekBar(on) {
    set({ wavySeekBar: on });
    persistKey('wavySeekBar', on);
  },

  setIconWeight(value) {
    const next = Math.max(1, Math.min(2.6, value));
    set({ iconWeight: next });
    persistKey('iconWeight', next);
  },

  setSearchAlign(align) {
    set({ searchAlign: align });
    persistKey('searchAlign', align);
  },

  setSidebarOrder(order) {
    const next = [...new Set(order.filter((id) => typeof id === 'string' && id.length > 0))];
    set({ sidebarOrder: next });
    persistKey('sidebarOrder', next);
  },

  setShowHomeButton(on) {
    set({ showHomeButton: on });
    persistKey('showHomeButton', on);
  },

  setShowPlaybarVisualizer(on) {
    set({ showPlaybarVisualizer: on });
    persistKey('showPlaybarVisualizer', on);
  },

  setPlaybarVisualizerOpacity(value) {
    const next = Math.max(5, Math.min(100, Math.round(value)));
    set({ playbarVisualizerOpacity: next });
    persistKey('playbarVisualizerOpacity', next);
  },

  setPanelBlur(value) {
    const next = Math.max(0, Math.min(48, Math.round(value)));
    set({ panelBlur: next });
    persistKey('panelBlur', next);
  },

  setHighlightButtons(on) {
    set({ highlightButtons: on });
    persistKey('highlightButtons', on);
  },

  setAccentIntensity(value) {
    const next = Math.max(0, Math.min(100, Math.round(value)));
    set({ accentIntensity: next });
    persistKey('accentIntensity', next);
  },

  setTintBackground(on) {
    set({ tintBackground: on });
    persistKey('tintBackground', on);
  },

  setMeshBrightness(value) {
    const next = Math.max(0, Math.min(100, Math.round(value)));
    set({ meshBrightness: next });
    persistKey('meshBrightness', next);
  },

  setBannerAnimationSpeed(value) {
    const next = Math.max(12, Math.min(48, Math.round(value)));
    set({ bannerAnimationSpeed: next });
    persistKey('bannerAnimationSpeed', next);
  },

  setBannerFade(value) {
    const next = Math.max(20, Math.min(100, Math.round(value)));
    set({ bannerFade: next });
    persistKey('bannerFade', next);
  },

  setTopMomentIcon(icon) {
    set({ topMomentIcon: icon });
    persistKey('topMomentIcon', icon);
  },

  setShowHomeLogo(on) {
    set({ showHomeLogo: on });
    persistKey('showHomeLogo', on);
  },

  setNowPlayingTitleAlign(align) {
    set({ nowPlayingTitleAlign: align });
    persistKey('nowPlayingTitleAlign', align);
  },

  setNowPlayingToolbarPosition(position) {
    set({ nowPlayingToolbarPosition: position });
    persistKey('nowPlayingToolbarPosition', position);
  },

  setTrackCardStyle(style) {
    set({ trackCardStyle: style });
    persistKey('trackCardStyle', style);
  },

  setShowNowPlayingVisualizer(on) {
    set({ showNowPlayingVisualizer: on });
    persistKey('showNowPlayingVisualizer', on);
  },

  setPlaybarVisualizerPosition(position) {
    set({ playbarVisualizerPosition: position });
    persistKey('playbarVisualizerPosition', position);
  },

  setInterfaceOpacity(value) {
    const next = Math.max(20, Math.min(100, Math.round(value)));
    set({ interfaceOpacity: next });
    persistKey('interfaceOpacity', next);
  },

  setVisualizerStyle(style) {
    set({ visualizerStyle: style });
    persistKey('visualizerStyle', style);
  },

  setShapedCover(on) {
    set({ shapedCover: on });
    persistKey('shapedCover', on);
  },

  setShapedCoversNowPlaying(on) {
    set({ shapedCoversNowPlaying: on });
    persistKey('shapedCoversNowPlaying', on);
  },

  setNowPlayingBanner(on) {
    set({ nowPlayingBanner: on });
    persistKey('nowPlayingBanner', on);
  },

  setPlaylistBanners(on) {
    set({ playlistBanners: on });
    persistKey('playlistBanners', on);
  },

  setBannerBlur(value) {
    const next = Math.max(0, Math.min(12, value));
    set({ bannerBlur: next });
    persistKey('bannerBlur', next);
  },

  setBannerOpacity(value) {
    const next = Math.max(20, Math.min(100, Math.round(value)));
    set({ bannerOpacity: next });
    persistKey('bannerOpacity', next);
  },

  setAutohideTimestamps(on) {
    set({ autohideTimestamps: on });
    persistKey('autohideTimestamps', on);
  },

  setTitleBarAutoHide(on) {
    set({ titleBarAutoHide: on });
    persistKey('titleBarAutoHide', on);
  },

  setCustomCss(css) {
    const customCss = css.slice(0, 20_000);
    set({ customCss });
    persistKey('customCss', customCss);
  },

  setAccentLightness(value) {
    const accentLightness = Math.max(40, Math.min(85, Math.round(value)));
    set({ accentLightness });
    persistKey('accentLightness', accentLightness);
  },

  setWaveRing(on) {
    set({ waveRing: on });
    persistKey('waveRing', on);
  },

  setPerformanceMode(on) {
    set({ performanceMode: on });
    persistKey('performanceMode', on);
  },

  setLyricsSpeed(speed) {
    const value = speed <= 0.75 ? 0.5 : speed >= 1.75 ? 2.5 : 1;
    set({ lyricsSpeed: value });
    persistKey('lyricsSpeed', value);
  },

  setGradientTightness(percent) {
    const value = Math.round(Math.max(2, Math.min(24, percent)));
    set({ gradientTightness: value });
    persistKey('gradientTightness', value);
  },

  setVisualizerSensitivity(value) {
    const next = Math.round(Math.max(0.5, Math.min(2, value)) * 10) / 10;
    set({ visualizerSensitivity: next });
    persistKey('visualizerSensitivity', next);
  },

  setVisualizerSmoothness(value) {
    const next = Math.round(Math.max(0, Math.min(1, value)) * 100) / 100;
    set({ visualizerSmoothness: next });
    persistKey('visualizerSmoothness', next);
  },

  setDsp(next) {
    const dsp = sanitizeDsp({ ...get().dsp, ...next });
    audioEngine.setDsp(dsp);
    set({ dsp, dspPreset: 'custom' });
    persistKey('dsp', dsp);
    persistKey('dspPreset', 'custom');
  },

  applyDspPreset(id) {
    const builtIn = DSP_PRESETS.find((preset) => preset.id === id);
    const saved = get().dspPresets[id];
    const dsp = sanitizeDsp(builtIn?.dsp ?? saved ?? DSP_DEFAULTS);
    audioEngine.setDsp(dsp);
    set({ dsp, dspPreset: id });
    persistKey('dsp', dsp);
    persistKey('dspPreset', id);
  },

  saveDspPreset(name) {
    const label = name.trim().slice(0, 40);
    if (!label) return;
    const dspPresets = { ...get().dspPresets, [label]: { ...get().dsp } };
    set({ dspPresets, dspPreset: label });
    persistKey('dspPresets', dspPresets);
    persistKey('dspPreset', label);
  },

  deleteDspPreset(name) {
    const rest = { ...get().dspPresets };
    delete rest[name];
    set({ dspPresets: rest });
    persistKey('dspPresets', rest);
  },

  setFadeMs(ms) {
    const value = Math.max(0, Math.min(2000, Math.round(ms / 50) * 50));
    set({ fadeMs: value });
    persistKey('fadeMs', value);
  },

  setTempo(rate) {
    const value = Math.max(0.5, Math.min(2, Math.round(rate * 100) / 100));
    audioEngine.setTempo(value);
    set({ tempo: value });
    persistKey('tempo', value);
  },

  resetAudio() {
    const eqGains = [...FLAT_GAINS];
    const dsp = { ...DSP_DEFAULTS };
    audioEngine.setEq(eqGains);
    audioEngine.setPreampDb(0);
    audioEngine.setTempo(1);
    audioEngine.setDsp(dsp);
    set({ eqGains, eqPreset: 'flat', preampDb: 0, tempo: 1, dsp, dspPreset: 'clean', fadeMs: 0 });
    persistKey('dsp', dsp);
    persistKey('dspPreset', 'clean');
    persistKey('fadeMs', 0);
    persistKey('eqGains', eqGains);
    persistKey('eqPreset', 'flat');
    persistKey('preampDb', 0);
    persistKey('tempo', 1);
  },
}));
