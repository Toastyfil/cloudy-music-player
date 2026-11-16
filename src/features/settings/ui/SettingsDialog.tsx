import { AnimatePresence, motion } from 'framer-motion';
import { Check, Info, Keyboard, MonitorCog, Palette, RefreshCw, RotateCcw, RotateCw, Search, SlidersHorizontal, Trash2, Volume2, Wifi } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { bridge, isElectron } from '@/shared/api/bridge';
import { Button } from '@/shared/ui/Button';
import { useUiStore } from '@/features/navigation/store/uiStore';
import {
  DEFAULT_SHORTCUTS,
  DSP_PRESETS,
  EQ_PRESETS,
  SHORTCUT_LABELS,
  bandLabel,
  useSettingsStore,
  type ShortcutAction,
} from '@/features/settings/store/settingsStore';
import { EQ_FREQUENCIES, EQ_RANGE_DB } from '@/features/player/engine/audioEngine';
import { comboToLabel, eventToCombo } from '@/features/shortcuts/lib/keys';
import { THEMES } from '@/shared/config/themes';
import { LOGO_VARIANTS, LogoGlyph } from '@/shared/ui/Logo';
import { LOCALES } from '@/shared/config/locales';
import { useT } from '@/shared/lib/i18n';
import { useUpdatesStore } from '@/features/updates/store/updatesStore';
import { cn } from '@/shared/lib/cn';

/** English names, so typing "japanese" or "german" finds the native label. */
const ENGLISH_NAMES = (() => {
  const names = new Map<string, string>();
  try {
    const display = new Intl.DisplayNames(['en'], { type: 'language' });
    for (const entry of LOCALES) names.set(entry.id, display.of(entry.id) ?? '');
  } catch {
    // Older runtimes without Intl.DisplayNames still filter on the native name.
  }
  return names;
})();

function EffectSlider({
  label,
  value,
  onChange,
  format,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  format?: (value: number) => string;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-[86px] shrink-0 text-[12px] text-muted">{label}</span>
      <input
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        aria-label={label}
        className="cloudy-range min-w-0 flex-1 cursor-pointer"
      />
      <span className="w-14 text-right text-[11px] tabular-nums text-muted">
        {format ? format(value) : `${Math.round(value * 100)}%`}
      </span>
    </div>
  );
}

type Tab = 'interface' | 'appearance' | 'playback' | 'audio' | 'shortcuts' | 'cache' | 'about';

function relativeTime(timestamp: number) {
  const minutes = Math.round((Date.now() - timestamp) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return new Date(timestamp).toLocaleDateString();
}

const TABS: {
  id: Tab;
  key?: 'appearance' | 'playback' | 'shortcuts' | 'cache';
  label?: string;
  icon: typeof Palette;
}[] = [
  { id: 'interface', label: 'Interface', icon: MonitorCog },
  { id: 'appearance', key: 'appearance', icon: Palette },
  { id: 'playback', key: 'playback', icon: Volume2 },
  { id: 'audio', label: 'Audio', icon: SlidersHorizontal },
  { id: 'shortcuts', key: 'shortcuts', icon: Keyboard },
  { id: 'cache', key: 'cache', icon: Wifi },
  { id: 'about', label: 'About', icon: Info },
];

function Row({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-6 border-b border-line py-3.5 last:border-0">
      <div className="min-w-0">
        <p className="text-[13.5px] font-medium">{title}</p>
        {description ? <p className="mt-0.5 text-[11.5px] leading-relaxed text-muted">{description}</p> : null}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function Toggle({ value, onChange, label }: { value: boolean; onChange: (value: boolean) => void; label: string }) {
  return (
    <button
      role="switch"
      aria-checked={value}
      aria-label={label}
      onClick={() => onChange(!value)}
      className={cn(
        'relative h-6 w-11 rounded-full transition-colors duration-200',
        value ? 'bg-accent' : 'bg-[color:var(--track)]',
      )}
    >
      {/* The knob takes the page colour when on, so a white or pale accent
          (Mono, Graphite) never swallows it. */}
      <span
        className={cn(
          'absolute left-0 top-0.5 h-5 w-5 rounded-full shadow-sm transition-transform duration-200',
          value
            ? 'translate-x-[22px] bg-[color:var(--bg)] shadow-black/25'
            : 'translate-x-0.5 bg-[color:var(--text)]',
        )}
      />
    </button>
  );
}

/** Shrink a picked picture to a 1600px JPEG so it fits comfortably in settings. */
function fileToBackground(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      const scale = Math.min(1, 1600 / Math.max(image.width, image.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(image.width * scale));
      canvas.height = Math.max(1, Math.round(image.height * scale));
      canvas.getContext('2d')?.drawImage(image, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/jpeg', 0.82));
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not read that image'));
    };
    image.src = url;
  });
}

export function SettingsDialog() {
  const open = useUiStore((s) => s.settingsOpen);
  const setOpen = useUiStore((s) => s.setSettingsOpen);
  const [tab, setTab] = useState<Tab>('appearance');
  const [cache, setCache] = useState<{ files: number; bytes: number; directory: string } | null>(null);
  const [stats, setStats] = useState<{ tracks: number; playlists: number } | null>(null);
  const [capturing, setCapturing] = useState<ShortcutAction | null>(null);
  const [langFilter, setLangFilter] = useState('');
  const [presetName, setPresetName] = useState('');
  const [version, setVersion] = useState('1.1.1');

  const updatePhase = useUpdatesStore((s) => s.phase);
  const updateVersion = useUpdatesStore((s) => s.version);
  const updateProgress = useUpdatesStore((s) => s.progress ?? 0);
  const updateCheckedAt = useUpdatesStore((s) => s.checkedAt);
  const updateError = useUpdatesStore((s) => s.error);
  const installUpdate = useUpdatesStore((s) => s.install);

  const checkedLabel = updateCheckedAt ? relativeTime(updateCheckedAt) : null;
  const updateStatus =
    updatePhase === 'checking'
      ? 'Checking GitHub for a newer release…'
      : updatePhase === 'downloading'
        ? `Downloading Cloudy ${updateVersion ?? ''} · ${Math.round(updateProgress * 100)}%`
        : updatePhase === 'installing'
          ? 'Installing — Cloudy reopens on the new version.'
          : updatePhase === 'ready'
            ? `Cloudy ${updateVersion ?? ''} is downloaded and ready to install.`
            : updatePhase === 'error'
              ? `Last check failed${updateError ? ` (${updateError})` : ''}${checkedLabel ? ` · ${checkedLabel}` : ''}`
              : updatePhase === 'current'
                ? `Up to date${checkedLabel ? ` · checked ${checkedLabel}` : ''}`
                : 'Not checked yet — Cloudy looks for updates on every launch.';

  const settings = useSettingsStore();
  const t = useT();

  const visibleLocales = useMemo(() => {
    const query = langFilter.trim().toLowerCase();
    if (!query) return LOCALES;
    return LOCALES.filter((entry) =>
      `${entry.name} ${entry.region} ${entry.id} ${ENGLISH_NAMES.get(entry.id) ?? ''}`
        .toLowerCase()
        .includes(query),
    );
  }, [langFilter]);

  useEffect(() => {
    if (!open) setLangFilter('');
  }, [open]);

  useEffect(() => {
    if (!open) return;
    void bridge().cache.stats().then(setCache).catch(() => undefined);
    void bridge().app.dbStats().then(setStats).catch(() => undefined);
    void bridge().app.info().then((info) => setVersion(info.version)).catch(() => undefined);
  }, [open]);

  useEffect(() => {
    if (!capturing) return;
    const handler = (event: KeyboardEvent) => {
      event.preventDefault();
      if (event.key === 'Escape') {
        setCapturing(null);
        return;
      }
      const combo = eventToCombo(event);
      if (!combo) return;
      settings.setShortcut(capturing, combo);
      setCapturing(null);
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [capturing, settings]);

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/55 backdrop-blur-sm"
          onClick={() => setOpen(false)}
        >
          <motion.div
            initial={{ opacity: 0, y: 10, scale: 0.99 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.99 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            onClick={(event) => event.stopPropagation()}
            className="flex h-[560px] w-[760px] overflow-hidden rounded-2xl border border-line bg-[color:var(--bg-elevated)] shadow-[var(--shadow)]"
          >
            <aside className="w-[190px] shrink-0 border-r border-line p-3">
              <p className="px-2 pb-3 pt-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-faint">{t('settings')}</p>
              {TABS.map(({ id, key, label, icon: Icon }) => (
                <button
                  key={id}
                  onClick={() => setTab(id)}
                  className={cn(
                    'mb-0.5 flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] transition-colors',
                    tab === id ? 'bg-surface text-text' : 'text-muted hover:bg-surface/60 hover:text-text/90',
                  )}
                >
                  <Icon size={15} className={tab === id ? 'text-accent' : ''} />
                  {key ? t(key) : label}
                </button>
              ))}
              <p className="absolute bottom-4 px-2 text-[10.5px] text-faint">Cloudy {version}</p>
            </aside>

            <div className="min-w-0 flex-1 overflow-y-auto p-6">
              {tab === 'interface' ? (
                <section>
                  <h3 className="mb-3 text-[15px] font-semibold">You</h3>
                  <Row title="Profile" description="A local name and initial for your player. Nothing leaves this computer.">
                    <div className="flex items-center gap-2.5">
                      <span className="flex h-9 w-9 items-center justify-center rounded-full bg-accent/15 text-[13px] font-semibold uppercase text-accent">
                        {(settings.displayName.trim()[0] ?? 'C').toUpperCase()}
                      </span>
                      <input
                        value={settings.displayName}
                        onChange={(event) => settings.setDisplayName(event.target.value)}
                        placeholder="Your name"
                        aria-label="Profile name"
                        maxLength={40}
                        className="h-8 w-40 rounded-lg bg-surface/70 px-2.5 text-[12.5px] text-text outline-none placeholder:text-faint focus:ring-1 focus:ring-accent/40"
                      />
                    </div>
                  </Row>

                  <h3 className="mb-3 mt-7 text-[15px] font-semibold">Interface</h3>
                  <Row
                    title="Reduce motion"
                    description="Replace spring and slide animations with short fades, like Riff's motion switch."
                  >
                    <Toggle value={settings.reduceMotion} onChange={settings.setReduceMotion} label="Reduce motion" />
                  </Row>
                  <Row title="UI scale" description="Zoom the whole interface from 90% to 115%.">
                    <div className="flex gap-1 rounded-full border border-line bg-surface p-0.5">
                      {[0.9, 1, 1.05, 1.1, 1.15].map((scale) => (
                        <button
                          key={scale}
                          onClick={() => settings.setUiScale(scale)}
                          className={cn(
                            'rounded-full px-2.5 py-1 text-[12px] tabular-nums transition-colors',
                            Math.abs(settings.uiScale - scale) < 0.001
                              ? 'bg-accent text-black'
                              : 'text-muted hover:text-text',
                          )}
                        >
                          {Math.round(scale * 100)}%
                        </button>
                      ))}
                    </div>
                  </Row>
                  <Row title="Corner radius" description="How round cards, panels and artwork thumbnails are.">
                    <div className="flex items-center gap-3">
                      <input
                        type="range"
                        min={0}
                        max={20}
                        step={1}
                        value={settings.cornerRadius}
                        onChange={(event) => settings.setCornerRadius(Number(event.target.value))}
                        aria-label="Corner radius"
                        className="cloudy-range w-40 cursor-pointer"
                      />
                      <span className="w-9 text-right text-[11px] tabular-nums text-muted">
                        {settings.cornerRadius}px
                      </span>
                    </div>
                  </Row>
                  <Row title="No-hand cursor" description="Use the normal arrow over buttons and links instead of a pointing hand.">
                    <Toggle value={settings.noHandCursor} onChange={settings.setNoHandCursor} label="No-hand cursor" />
                  </Row>
                  <Row title="Auto-hide timestamps" description="Fade the player-bar times out until the pointer is over them.">
                    <Toggle
                      value={settings.autohideTimestamps}
                      onChange={settings.setAutohideTimestamps}
                      label="Auto-hide timestamps"
                    />
                  </Row>
                  <Row title="Hide title bar" description="Fade the title bar out until the pointer reaches the top of the window.">
                    <Toggle
                      value={settings.titleBarAutoHide}
                      onChange={settings.setTitleBarAutoHide}
                      label="Hide title bar"
                    />
                  </Row>
                  <div className="border-b border-line py-3.5 last:border-0">
                    <div className="mb-2 flex items-center justify-between gap-4">
                      <div className="min-w-0">
                        <p className="text-[13.5px] font-medium">Custom CSS</p>
                        <p className="mt-0.5 text-[11.5px] leading-relaxed text-muted">
                          Your own rules, appended after Cloudy's styles. Cleared here and nowhere else.
                        </p>
                      </div>
                      <div className="flex shrink-0 gap-1.5">
                        <button
                          onClick={() => settings.setCustomCss('')}
                          className="rounded-full border border-line px-2.5 py-1 text-[12px] text-muted transition-colors hover:text-text"
                        >
                          Clear
                        </button>
                      </div>
                    </div>
                    <textarea
                      value={settings.customCss}
                      onChange={(event) => settings.setCustomCss(event.target.value)}
                      spellCheck={false}
                      placeholder=".album-art { border-radius: 4px; }"
                      aria-label="Custom CSS"
                      rows={4}
                      className="w-full resize-y rounded-lg bg-surface/70 p-2.5 font-mono text-[11.5px] leading-relaxed text-text outline-none placeholder:text-faint focus:ring-1 focus:ring-accent/40"
                    />
                  </div>

                  <h3 className="mb-3 mt-7 text-[15px] font-semibold">Window</h3>
                  <Row
                    title="Minimize to tray on close"
                    description="Keep playing in the background when the window is closed. Turn off to quit instead."
                  >
                    <Toggle
                      value={!settings.quitOnClose}
                      onChange={(on) => settings.setQuitOnClose(!on)}
                      label="Minimize to tray on close"
                    />
                  </Row>
                </section>
              ) : null}

              {tab === 'appearance' ? (
                <section>
                  <h3 className="mb-3 text-[15px] font-semibold">{t('language')}</h3>
                  <div className="relative mb-2.5">
                    <Search size={13} className="pointer-events-none absolute start-2.5 top-1/2 -translate-y-1/2 text-faint" />
                    <input
                      value={langFilter}
                      onChange={(event) => setLangFilter(event.target.value)}
                      aria-label="Search languages"
                      spellCheck={false}
                      className="h-8 w-full rounded-lg bg-surface/70 ps-8 pe-2 text-[12px] text-text outline-none placeholder:text-faint focus:ring-1 focus:ring-accent/40"
                    />
                  </div>
                  <div className="mb-7 grid max-h-[168px] grid-cols-2 gap-2 overflow-y-auto pr-1">
                    {visibleLocales.map((entry) => (
                      <button
                        key={entry.id}
                        onClick={() => settings.setLocale(entry.id)}
                        aria-pressed={settings.locale === entry.id}
                        className={cn(
                          'flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left text-[12.5px] transition-colors',
                          settings.locale === entry.id
                            ? 'border-accent/70 bg-surface text-text'
                            : 'border-line text-muted hover:border-white/20 hover:text-text',
                        )}
                      >
                        <span className="truncate">{entry.name}</span>
                        {entry.region !== entry.name ? (
                          <span className="shrink-0 text-[10.5px] text-faint">{entry.region}</span>
                        ) : null}
                      </button>
                    ))}
                  </div>

                  <div className="mb-3 flex items-baseline justify-between">
                    <h3 className="text-[15px] font-semibold">{t('theme')}</h3>
                    <span className="text-[11.5px] text-muted">
                      {THEMES.length} {t('palettes')}
                    </span>
                  </div>
                  <div className="grid grid-cols-4 gap-2">
                    {THEMES.map((theme) => {
                      const active = settings.themeId === theme.id;
                      return (
                        <button
                          key={theme.id}
                          onClick={() => settings.setTheme(theme.id)}
                          aria-pressed={active}
                          title={theme.name}
                          className={cn(
                            'group relative overflow-hidden rounded-xl border p-2 text-left transition-all duration-200',
                            active ? 'border-accent/70' : 'border-line hover:border-white/20',
                          )}
                          style={{ background: theme.bg }}
                        >
                          <span className="flex items-center gap-1.5">
                            <span
                              className="h-4 w-4 rounded-full"
                              style={{ background: theme.accent, boxShadow: `0 0 10px ${theme.accent}66` }}
                            />
                            <span className="flex-1 truncate text-[11.5px] font-medium" style={{ color: theme.text }}>
                              {theme.name}
                            </span>
                            {active ? <Check size={12} style={{ color: theme.accent }} /> : null}
                          </span>
                          <span className="mt-2 flex h-6 items-end gap-1">
                            {[0.35, 0.6, 0.85, 1].map((opacity) => (
                              <span
                                key={opacity}
                                className="h-full flex-1 rounded-sm"
                                style={{ background: theme.surface, opacity }}
                              />
                            ))}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                  <p className="mt-4 text-[11.5px] leading-relaxed text-muted">
                    Themes change the surfaces, text ramp and accent together. The current accent is{' '}
                    <span className="font-medium text-text">{settings.currentTheme().name}</span>.
                  </p>

                  <div className="mb-3 mt-7 flex items-baseline justify-between">
                    <h3 className="text-[15px] font-semibold">App logo</h3>
                    <span className="text-[11.5px] text-muted">{LOGO_VARIANTS.length} marks</span>
                  </div>
                  <div className="grid grid-cols-7 gap-1.5">
                    {LOGO_VARIANTS.map((variant) => {
                      const active = settings.logoVariant === variant.id;
                      return (
                        <button
                          key={variant.id}
                          onClick={() => settings.setLogoVariant(variant.id)}
                          aria-pressed={active}
                          aria-label={variant.name}
                          title={variant.name}
                          className={cn(
                            'relative flex aspect-square items-center justify-center rounded-lg border transition-all duration-200',
                            active
                              ? 'border-accent/70 bg-accent/10 text-accent shadow-[0_0_16px_-6px_var(--accent)]'
                              : 'border-line text-muted hover:border-white/20 hover:text-text',
                          )}
                        >
                          <LogoGlyph variant={variant.id} size={20} />
                        </button>
                      );
                    })}
                  </div>
                  <p className="mt-2 text-[11.5px] leading-relaxed text-muted">
                    Shown in the title bar and on empty screens.
                  </p>

                  <h3 className="mb-3 mt-7 text-[15px] font-semibold">Accent</h3>
                  <Row
                    title="Custom accent"
                    description="Take the accent colour over from the theme and pick your own. Cover-driven colour is turned off while this is on."
                  >
                    <Toggle
                      value={settings.customAccentEnabled}
                      onChange={settings.setCustomAccentEnabled}
                      label="Custom accent"
                    />
                  </Row>
                  <Row title="Hue" description="Where the accent sits on the colour wheel.">
                    <div className="flex items-center gap-3">
                      <input
                        type="range"
                        min={0}
                        max={360}
                        step={1}
                        value={settings.accentHue}
                        onChange={(event) => settings.setAccentHue(Number(event.target.value))}
                        aria-label="Accent hue"
                        className="cloudy-range w-40 cursor-pointer"
                      />
                      <span className="w-9 text-right text-[11px] tabular-nums text-muted">{settings.accentHue}°</span>
                    </div>
                  </Row>
                  <Row title="Saturation" description="How vivid the accent is.">
                    <div className="flex items-center gap-3">
                      <input
                        type="range"
                        min={20}
                        max={100}
                        step={1}
                        value={settings.accentSaturation}
                        onChange={(event) => settings.setAccentSaturation(Number(event.target.value))}
                        aria-label="Accent saturation"
                        className="cloudy-range w-40 cursor-pointer"
                      />
                      <span className="w-9 text-right text-[11px] tabular-nums text-muted">
                        {settings.accentSaturation}%
                      </span>
                    </div>
                  </Row>
                  <Row title="Lightness" description="Bright or deep; keep it light on dark themes for contrast.">
                    <div className="flex items-center gap-3">
                      <input
                        type="range"
                        min={40}
                        max={85}
                        step={1}
                        value={settings.accentLightness}
                        onChange={(event) => settings.setAccentLightness(Number(event.target.value))}
                        aria-label="Accent lightness"
                        className="cloudy-range w-40 cursor-pointer"
                      />
                      <span className="w-9 text-right text-[11px] tabular-nums text-muted">
                        {settings.accentLightness}%
                      </span>
                    </div>
                  </Row>

                  <h3 className="mb-3 mt-7 text-[15px] font-semibold">Background</h3>
                  <Row
                    title="Custom app background"
                    description="Your own picture behind the whole player. It is resized and kept on this computer."
                  >
                    <div className="flex items-center gap-2">
                      <label className="cursor-pointer rounded-full border border-line bg-surface px-3 py-1 text-[12px] text-text transition-colors hover:border-white/20">
                        Choose file
                        <input
                          type="file"
                          accept="image/*"
                          className="hidden"
                          aria-label="Choose app background"
                          onChange={(event) => {
                            const file = event.target.files?.[0];
                            if (file) void fileToBackground(file).then(settings.setCustomBackground).catch(() => undefined);
                            event.target.value = '';
                          }}
                        />
                      </label>
                      {settings.customBackground ? (
                        <button
                          onClick={() => settings.setCustomBackground('')}
                          className="rounded-full px-2.5 py-1 text-[12px] text-muted transition-colors hover:text-text"
                        >
                          Remove
                        </button>
                      ) : null}
                    </div>
                  </Row>
                  <Row title="Background blur" description="Soften the picture so panels stay readable.">
                    <div className="flex items-center gap-3">
                      <input
                        type="range"
                        min={0}
                        max={40}
                        step={1}
                        value={settings.backgroundBlur}
                        onChange={(event) => settings.setBackgroundBlur(Number(event.target.value))}
                        aria-label="Background blur"
                        className="cloudy-range w-40 cursor-pointer"
                      />
                      <span className="w-9 text-right text-[11px] tabular-nums text-muted">
                        {settings.backgroundBlur}px
                      </span>
                    </div>
                  </Row>
                  <Row title="Background opacity" description="How strongly the picture shows through.">
                    <div className="flex items-center gap-3">
                      <input
                        type="range"
                        min={0}
                        max={100}
                        step={1}
                        value={settings.backgroundOpacity}
                        onChange={(event) => settings.setBackgroundOpacity(Number(event.target.value))}
                        aria-label="Background opacity"
                        className="cloudy-range w-40 cursor-pointer"
                      />
                      <span className="w-9 text-right text-[11px] tabular-nums text-muted">
                        {settings.backgroundOpacity}%
                      </span>
                    </div>
                  </Row>
                  <Row title="Mesh gradient" description="Slow accent-coloured light drifting behind the interface.">
                    <Toggle value={settings.meshGradient} onChange={settings.setMeshGradient} label="Mesh gradient" />
                  </Row>

                  <h3 className="mb-3 mt-7 text-[15px] font-semibold">Window</h3>
                  <Row title="Transparent window" description="See your desktop through Cloudy. The window reopens once to apply it.">
                    <Toggle
                      value={settings.windowTransparent}
                      onChange={settings.setWindowTransparent}
                      label="Transparent window"
                    />
                  </Row>
                  <Row title="Opacity" description="How much of the desktop shows through while transparency is on.">
                    <div className="flex items-center gap-2">
                      <input
                        type="range"
                        min={0.35}
                        max={1}
                        step={0.05}
                        value={settings.windowOpacity}
                        disabled={!settings.windowTransparent}
                        onChange={(event) => settings.setWindowOpacity(Number(event.target.value))}
                        className="cloudy-range w-[140px] cursor-pointer"
                      />
                      <span className="w-10 text-[11.5px] tabular-nums text-muted">
                        {Math.round(settings.windowOpacity * 100)}%
                      </span>
                    </div>
                  </Row>
                </section>
              ) : null}

              {tab === 'playback' ? (
                <section>
                  <h3 className="mb-3 text-[15px] font-semibold">Playback</h3>
                  <Row title="Audio quality" description="High prefers the best available audio stream (AAC ~130–160kbps).">
                    <div className="flex gap-1 rounded-full border border-line bg-surface p-0.5">
                      {(['high', 'medium'] as const).map((quality) => (
                        <button
                          key={quality}
                          onClick={() => settings.setAudioQuality(quality)}
                          className={cn(
                            'rounded-full px-3 py-1 text-[12px] capitalize transition-colors',
                            settings.audioQuality === quality ? 'bg-accent text-black' : 'text-muted hover:text-text',
                          )}
                        >
                          {quality}
                        </button>
                      ))}
                    </div>
                  </Row>
                  <Row title="Discord Rich Presence" description="Show what you're listening to on your Discord profile.">
                    <Toggle value={settings.discordEnabled} onChange={settings.setDiscord} label="Discord presence" />
                  </Row>
                  <Row title="Offline caching" description="Save audio locally after it plays, so it works without a connection.">
                    <Toggle value={settings.cacheEnabled} onChange={settings.setCacheEnabled} label="Offline caching" />
                  </Row>
                  <Row title="Dynamic colour" description="Borrow the dominant hue of the current cover for the accent, and hand it back when playback stops.">
                    <Toggle value={settings.dynamicColor} onChange={settings.setDynamicColor} label="Dynamic colour" />
                  </Row>
                  <Row
                    title="Wavy progress ring"
                    description="A breathing progress ring around the cover, distorted by the bass and pulsed on beats."
                  >
                    <Toggle value={settings.waveRing} onChange={settings.setWaveRing} label="Wavy progress ring" />
                  </Row>
                  <Row
                    title="Performance mode"
                    description="Caps lyrics at 30fps, stops the visualiser and freezes the wave and gradient motion."
                  >
                    <Toggle
                      value={settings.performanceMode}
                      onChange={settings.setPerformanceMode}
                      label="Performance mode"
                    />
                  </Row>
                  <Row title="Lyrics animation speed" description="How quickly lines glide to the next lyric and the karaoke follows the vocal.">
                    <div className="flex gap-1 rounded-full border border-line bg-surface p-0.5">
                      {[0.5, 1, 2.5].map((speed) => (
                        <button
                          key={speed}
                          onClick={() => settings.setLyricsSpeed(speed)}
                          className={cn(
                            'rounded-full px-2.5 py-1 text-[12px] tabular-nums transition-colors',
                            settings.lyricsSpeed === speed ? 'bg-accent text-black' : 'text-muted hover:text-text',
                          )}
                        >
                          {speed}×
                        </button>
                      ))}
                    </div>
                  </Row>
                  <Row title="Gradient tightness" description="The karaoke edge: 2% is a sharp wipe, 24% a wide soft feather.">
                    <div className="flex items-center gap-2">
                      <input
                        type="range"
                        min={2}
                        max={24}
                        step={1}
                        value={settings.gradientTightness}
                        onChange={(event) => settings.setGradientTightness(Number(event.target.value))}
                        className="cloudy-range w-[140px] cursor-pointer"
                      />
                      <span className="w-10 text-right text-[11.5px] tabular-nums text-muted">
                        {settings.gradientTightness}%
                      </span>
                    </div>
                  </Row>
                  <Row title="Visualiser sensitivity" description="How far the spectrum bars react to the mix.">
                    <div className="flex items-center gap-2">
                      <input
                        type="range"
                        min={0.5}
                        max={2}
                        step={0.1}
                        value={settings.visualizerSensitivity}
                        onChange={(event) => settings.setVisualizerSensitivity(Number(event.target.value))}
                        className="cloudy-range w-[140px] cursor-pointer"
                      />
                      <span className="w-10 text-right text-[11.5px] tabular-nums text-muted">
                        {Math.round(settings.visualizerSensitivity * 100)}%
                      </span>
                    </div>
                  </Row>
                  <Row title="Visualiser smoothness" description="Short snappy bars or long, slowly falling tails.">
                    <div className="flex items-center gap-2">
                      <input
                        type="range"
                        min={0}
                        max={1}
                        step={0.05}
                        value={settings.visualizerSmoothness}
                        onChange={(event) => settings.setVisualizerSmoothness(Number(event.target.value))}
                        className="cloudy-range w-[140px] cursor-pointer"
                      />
                      <span className="w-10 text-right text-[11.5px] tabular-nums text-muted">
                        {Math.round(settings.visualizerSmoothness * 100)}%
                      </span>
                    </div>
                  </Row>
                  <Row title="System media controls" description="Windows SMTC / macOS Now Playing pick up track, art and transport.">
                    <span className="text-[12.5px] text-muted">{isElectron() ? 'Supported' : 'Only in the desktop app'}</span>
                  </Row>
                  <Row title="Karaoke word highlighting" description="Fill each word as it is sung. Off leaves the whole line highlighted.">
                    <Toggle value={settings.lyricsKaraoke} onChange={settings.setLyricsKaraoke} label="Karaoke word highlighting" />
                  </Row>
                  <Row title="Auto-scroll lyrics" description="Follow the active line during playback. Off leaves scrolling to you.">
                    <Toggle value={settings.lyricsAutoScroll} onChange={settings.setLyricsAutoScroll} label="Auto-scroll lyrics" />
                  </Row>
                  <Row title="Online lyrics lookup" description="Fetch synced lyrics from lrclib when a track has none saved.">
                    <Toggle value={settings.onlineLyrics} onChange={settings.setOnlineLyrics} label="Online lyrics lookup" />
                  </Row>
                  <Row title="Crossfade" description="Fade the ending track into the next one. 0 keeps the hard cut.">
                    <div className="flex gap-1 rounded-full border border-line bg-surface p-0.5">
                      {[0, 1000, 2000, 3000, 4000].map((ms) => (
                        <button
                          key={ms}
                          onClick={() => settings.setFadeMs(ms)}
                          className={cn(
                            'rounded-full px-2.5 py-1 text-[12px] tabular-nums transition-colors',
                            settings.fadeMs === ms ? 'bg-accent text-black' : 'text-muted hover:text-text',
                          )}
                        >
                          {ms === 0 ? 'Off' : `${ms / 1000}s`}
                        </button>
                      ))}
                    </div>
                  </Row>
                  <Row title="Lyrics offset" description="Nudge lyrics earlier or later if a track's timings drift.">
                    <div className="flex items-center gap-2">
                      <input
                        type="range"
                        min={-3}
                        max={3}
                        step={0.1}
                        value={settings.lyricsOffset}
                        onChange={(event) => settings.setLyricsOffset(Number(event.target.value))}
                        className="cloudy-range w-[140px] cursor-pointer"
                      />
                      <span className="w-10 text-[11.5px] tabular-nums text-muted">{settings.lyricsOffset.toFixed(1)}s</span>
                    </div>
                  </Row>
                </section>
              ) : null}

              {tab === 'audio' ? (
                <section>
                  <div className="mb-3 flex items-center justify-between">
                    <h3 className="text-[15px] font-semibold">Equalizer</h3>
                    <Button size="sm" variant="subtle" onClick={() => settings.resetAudio()}>
                      <RotateCcw size={13} /> Reset
                    </Button>
                  </div>

                  <div className="mb-3 flex flex-wrap gap-1.5">
                    {EQ_PRESETS.map((preset) => (
                      <button
                        key={preset.id}
                        onClick={() => settings.applyEqPreset(preset.id)}
                        aria-pressed={settings.eqPreset === preset.id}
                        className={cn(
                          'h-8 rounded-full px-3 text-[12px] font-medium transition-colors',
                          settings.eqPreset === preset.id
                            ? 'bg-accent text-black'
                            : 'bg-surface/70 text-muted hover:bg-surface hover:text-text',
                        )}
                      >
                        {preset.label}
                      </button>
                    ))}
                    {settings.eqPreset === 'custom' ? (
                      <span className="flex h-8 items-center rounded-full border border-dashed border-line px-3 text-[12px] text-muted">
                        Custom
                      </span>
                    ) : null}
                  </div>

                  <div className="space-y-1.5 rounded-xl border border-line bg-surface/40 p-4">
                    {EQ_FREQUENCIES.map((frequency, index) => {
                      const gain = settings.eqGains[index] ?? 0;
                      return (
                        <div key={frequency} className="flex items-center gap-3">
                          <span className="w-9 text-right text-[11px] tabular-nums text-muted">
                            {bandLabel(frequency)}
                          </span>
                          <input
                            type="range"
                            min={-EQ_RANGE_DB}
                            max={EQ_RANGE_DB}
                            step={0.5}
                            value={gain}
                            onChange={(event) => settings.setEqBand(index, Number(event.target.value))}
                            aria-label={`${bandLabel(frequency)} hertz`}
                            className="cloudy-range min-w-0 flex-1 cursor-pointer"
                          />
                          <span className="w-14 text-right text-[11px] tabular-nums text-muted">
                            {gain > 0 ? '+' : ''}
                            {gain.toFixed(1)} dB
                          </span>
                        </div>
                      );
                    })}
                  </div>

                  <div className="mt-4">
                    <Row title="Preamp" description="Trim the EQ's output so a big boost never clips.">
                      <div className="flex items-center gap-2">
                        <input
                          type="range"
                          min={-12}
                          max={12}
                          step={0.5}
                          value={settings.preampDb}
                          onChange={(event) => settings.setPreamp(Number(event.target.value))}
                          aria-label="Preamp"
                          className="cloudy-range w-[140px] cursor-pointer"
                        />
                        <span className="w-14 text-right text-[11.5px] tabular-nums text-muted">
                          {settings.preampDb > 0 ? '+' : ''}
                          {settings.preampDb.toFixed(1)} dB
                        </span>
                      </div>
                    </Row>
                    <Row title="Tempo" description="Play slower or faster without changing the pitch.">
                      <div className="flex items-center gap-2">
                        <input
                          type="range"
                          min={0.5}
                          max={2}
                          step={0.05}
                          value={settings.tempo}
                          onChange={(event) => settings.setTempo(Number(event.target.value))}
                          aria-label="Tempo"
                          className="cloudy-range w-[140px] cursor-pointer"
                        />
                        <span className="w-14 text-right text-[11.5px] tabular-nums text-muted">
                          {settings.tempo.toFixed(2)}×
                        </span>
                        <Button size="sm" variant="ghost" onClick={() => settings.setTempo(1)}>
                          1×
                        </Button>
                      </div>
                    </Row>
                  </div>

                  <p className="mt-3 text-[11.5px] leading-relaxed text-muted">
                    Ten peaking bands from 32 Hz to 16 kHz, applied live to the audio graph. Presets are starting points —
                    moving any band switches the set to Custom, and everything is remembered between launches.
                  </p>

                  <div className="mb-3 mt-7 flex items-baseline justify-between">
                    <h3 className="text-[15px] font-semibold">Effects</h3>
                    <span className="text-[11.5px] text-muted">
                      {settings.dspPreset === 'custom' ? 'Custom chain' : settings.dspPreset}
                    </span>
                  </div>

                  <div className="mb-3 flex flex-wrap gap-1.5">
                    {DSP_PRESETS.map((preset) => (
                      <button
                        key={preset.id}
                        onClick={() => settings.applyDspPreset(preset.id)}
                        aria-pressed={settings.dspPreset === preset.id}
                        className={cn(
                          'h-8 rounded-full px-3 text-[12px] font-medium transition-colors',
                          settings.dspPreset === preset.id
                            ? 'bg-accent text-black'
                            : 'bg-surface/70 text-muted hover:bg-surface hover:text-text',
                        )}
                      >
                        {preset.label}
                      </button>
                    ))}
                    {Object.keys(settings.dspPresets).map((name) => (
                      <span
                        key={name}
                        className={cn(
                          'flex h-8 items-center gap-1 rounded-full border px-2.5 text-[12px]',
                          settings.dspPreset === name ? 'border-accent/70 text-text' : 'border-line text-muted',
                        )}
                      >
                        <button onClick={() => settings.applyDspPreset(name)} className="max-w-[120px] truncate">
                          {name}
                        </button>
                        <button
                          onClick={() => settings.deleteDspPreset(name)}
                          aria-label={`Delete preset ${name}`}
                          className="text-faint transition-colors hover:text-red-400"
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </div>

                  <div className="space-y-1.5 rounded-xl border border-line bg-surface/40 p-4">
                    <EffectSlider
                      label="Drive"
                      value={settings.dsp.drive}
                      onChange={(drive) => settings.setDsp({ drive })}
                    />
                    <EffectSlider
                      label="Delay"
                      value={settings.dsp.delayMix}
                      onChange={(delayMix) => settings.setDsp({ delayMix })}
                    />
                    <EffectSlider
                      label="Echo time"
                      value={settings.dsp.delayTime}
                      onChange={(delayTime) => settings.setDsp({ delayTime })}
                      format={(value) => `${Math.round(80 + value * 520)} ms`}
                    />
                    <EffectSlider
                      label="Feedback"
                      value={settings.dsp.delayFeedback}
                      onChange={(delayFeedback) => settings.setDsp({ delayFeedback })}
                    />
                    <EffectSlider
                      label="Reverb"
                      value={settings.dsp.reverbMix}
                      onChange={(reverbMix) => settings.setDsp({ reverbMix })}
                    />
                    <EffectSlider
                      label="Room size"
                      value={settings.dsp.reverbSize}
                      onChange={(reverbSize) => settings.setDsp({ reverbSize })}
                      format={(value) => `${(0.4 + value * 3.2).toFixed(1)}s`}
                    />
                    <EffectSlider
                      label="Compressor"
                      value={settings.dsp.compressor}
                      onChange={(compressor) => settings.setDsp({ compressor })}
                    />
                  </div>

                  <div className="mt-4">
                    <Row
                      title="Normalize loudness"
                      description="Ride the gain toward roughly −16 LUFS so quiet and loud tracks sit at the same level."
                    >
                      <Toggle
                        value={settings.dsp.normalize}
                        onChange={(normalize) => settings.setDsp({ normalize })}
                        label="Normalize loudness"
                      />
                    </Row>
                    <Row title="Fade in / out" description="Ramp the volume on start and stop instead of a hard cut.">
                      <div className="flex items-center gap-2">
                        <input
                          type="range"
                          min={0}
                          max={2000}
                          step={50}
                          value={settings.fadeMs}
                          onChange={(event) => settings.setFadeMs(Number(event.target.value))}
                          aria-label="Fade in and out"
                          className="cloudy-range w-[140px] cursor-pointer"
                        />
                        <span className="w-12 text-right text-[11.5px] tabular-nums text-muted">
                          {settings.fadeMs === 0 ? 'Off' : `${(settings.fadeMs / 1000).toFixed(1)}s`}
                        </span>
                      </div>
                    </Row>
                  </div>

                  <div className="mt-4">
                    <Row title="Stereo pan" description="Shift the whole output towards one ear.">
                      <div className="flex items-center gap-2">
                        <input
                          type="range"
                          min={-100}
                          max={100}
                          step={5}
                          value={Math.round(settings.pan * 100)}
                          onChange={(event) => settings.setPan(Number(event.target.value) / 100)}
                          aria-label="Stereo pan"
                          className="cloudy-range w-[140px] cursor-pointer"
                        />
                        <span className="w-12 text-right text-[11.5px] tabular-nums text-muted">
                          {settings.pan === 0
                            ? 'Centre'
                            : `${settings.pan < 0 ? 'L' : 'R'}${Math.abs(Math.round(settings.pan * 100))}`}
                        </span>
                      </div>
                    </Row>
                    <Row title="Mono audio" description="Collapse both channels into one for single-speaker setups.">
                      <Toggle value={settings.mono} onChange={settings.setMono} label="Mono audio" />
                    </Row>
                  </div>

                  <div className="mt-3 flex items-center gap-2">
                    <input
                      value={presetName}
                      onChange={(event) => setPresetName(event.target.value)}
                      placeholder="Name this chain"
                      aria-label="Preset name"
                      spellCheck={false}
                      className="h-8 min-w-0 flex-1 rounded-lg bg-surface/70 px-2.5 text-[12px] text-text outline-none placeholder:text-faint focus:ring-1 focus:ring-accent/40"
                    />
                    <Button
                      size="sm"
                      variant="subtle"
                      disabled={!presetName.trim()}
                      onClick={() => {
                        settings.saveDspPreset(presetName);
                        setPresetName('');
                      }}
                    >
                      Save preset
                    </Button>
                  </div>
                </section>
              ) : null}

              {tab === 'shortcuts' ? (
                <section>
                  <div className="mb-3 flex items-center justify-between">
                    <h3 className="text-[15px] font-semibold">Keyboard shortcuts</h3>
                    <Button size="sm" variant="subtle" onClick={() => settings.resetShortcuts()}>
                      <RotateCcw size={13} /> Reset
                    </Button>
                  </div>
                  {(Object.keys(SHORTCUT_LABELS) as ShortcutAction[]).map((action) => (
                    <Row key={action} title={SHORTCUT_LABELS[action]}>
                      <button
                        onClick={() => setCapturing(action)}
                        className={cn(
                          'min-w-[110px] rounded-lg px-3 py-1.5 text-[12px] transition-colors',
                          capturing === action
                            ? 'bg-accent text-black'
                            : 'bg-surface text-text/85 hover:bg-surface-hover',
                        )}
                      >
                        {capturing === action ? 'Press keys…' : comboToLabel(settings.shortcuts[action] ?? DEFAULT_SHORTCUTS[action])}
                      </button>
                    </Row>
                  ))}
                </section>
              ) : null}

              {tab === 'cache' ? (
                <section>
                  <h3 className="mb-3 text-[15px] font-semibold">Cache & data</h3>
                  <Row title="Cached audio" description={cache?.directory}>
                    <span className="text-[12.5px] text-muted">
                      {cache ? `${cache.files} tracks · ${(cache.bytes / 1024 / 1024).toFixed(1)} MB` : '—'}
                    </span>
                  </Row>
                  <Row title="Library" description="Saved tracks and playlists live in a local SQLite database.">
                    <span className="text-[12.5px] text-muted">
                      {stats ? `${stats.tracks} tracks · ${stats.playlists} playlists` : '—'}
                    </span>
                  </Row>
                  <Row title="Lyrics cache" description="Lyrics are cached per session and re-fetched on restart.">
                    <span className="text-[12.5px] text-muted">Session only</span>
                  </Row>
                  <div className="mt-4 flex gap-2">
                    <Button
                      size="sm"
                      variant="subtle"
                      onClick={async () => {
                        const next = await bridge().cache.clear();
                        setCache(next);
                      }}
                    >
                      <Trash2 size={13} /> Clear audio cache
                    </Button>
                  </div>
                  <p className="mt-4 flex items-start gap-2 rounded-lg bg-surface/60 p-3 text-[11.5px] leading-relaxed text-muted">
                    <Check size={13} className="mt-0.5 shrink-0 text-accent" />
                    Cloudy has no account, no analytics and no ads. Nothing leaves your machine except catalog requests, LRCLIB
                    lyrics lookups and (optionally) Discord presence.
                  </p>
                </section>
              ) : null}

              {tab === 'about' ? (
                <section>
                  <h3 className="mb-3 text-[15px] font-semibold">About Cloudy</h3>
                  <Row title="Version" description="The build installed on this machine.">
                    <span className="text-[12.5px] text-muted">Cloudy {version}</span>
                  </Row>
                  <Row title="Updates" description={updateStatus}>
                    <div className="flex items-center gap-2">
                      {updatePhase === 'ready' ? (
                        <Button size="sm" onClick={() => void installUpdate()}>
                          <RotateCw size={13} /> Restart now
                        </Button>
                      ) : null}
                      <Button
                        size="sm"
                        variant="subtle"
                        disabled={updatePhase === 'checking' || updatePhase === 'downloading' || updatePhase === 'installing'}
                        onClick={() => void bridge().updates.check()}
                      >
                        <RefreshCw size={13} className={updatePhase === 'checking' ? 'animate-spin' : ''} /> Check for updates
                      </Button>
                    </div>
                  </Row>
                  <p className="mt-4 flex items-start gap-2 rounded-lg bg-surface/60 p-3 text-[11.5px] leading-relaxed text-muted">
                    <Check size={13} className="mt-0.5 shrink-0 text-accent" />
                    Your library, playlists, settings and cached audio live outside the install folder, so an update never touches
                    them.
                  </p>
                </section>
              ) : null}
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
