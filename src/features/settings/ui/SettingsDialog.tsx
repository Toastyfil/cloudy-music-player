import { AnimatePresence, motion } from 'framer-motion';
import {
  Check,
  Download,
  Info,
  Keyboard,
  MonitorCog,
  Palette,
  RefreshCw,
  RotateCcw,
  RotateCw,
  Search,
  SlidersHorizontal,
  Trash2,
  Upload,
  UserRound,
  Image as ImageIcon,
  ListMusic,
  Wrench,
  Copy,
  FolderOpen,
  Volume2,
  Wifi,
} from 'lucide-react';
import type { LibraryPlaylist, Track } from '@/shared/api/contracts';
import { useEffect, useMemo, useState } from 'react';
import { bridge, isElectron } from '@/shared/api/bridge';
import { Button } from '@/shared/ui/Button';
import { useUiStore } from '@/features/navigation/store/uiStore';
import {
  DEFAULT_SHORTCUTS,
  DSP_PRESETS,
  EQ_PRESETS,
  SHORTCUT_LABELS,
  SIDEBAR_ORDER_DEFAULT,
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

type Tab =
  | 'you'
  | 'interface'
  | 'appearance'
  | 'banners'
  | 'tracks'
  | 'playback'
  | 'audio'
  | 'shortcuts'
  | 'advanced'
  | 'cache'
  | 'about';

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
  { id: 'you', label: 'You', icon: UserRound },
  { id: 'interface', label: 'Interface', icon: MonitorCog },
  { id: 'appearance', key: 'appearance', icon: Palette },
  { id: 'banners', label: 'Banners', icon: ImageIcon },
  { id: 'tracks', label: 'Tracks', icon: ListMusic },
  { id: 'playback', key: 'playback', icon: Volume2 },
  { id: 'audio', label: 'Audio', icon: SlidersHorizontal },
  { id: 'shortcuts', key: 'shortcuts', icon: Keyboard },
  { id: 'advanced', label: 'Advanced', icon: Wrench },
  { id: 'cache', label: 'Storage', icon: Wifi },
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

/** Shrink a picked picture to a JPEG data URL so it fits comfortably in settings. */
function fileToBackground(file: File, maxSize = 1600, quality = 0.82): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      const scale = Math.min(1, maxSize / Math.max(image.width, image.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(image.width * scale));
      canvas.height = Math.max(1, Math.round(image.height * scale));
      canvas.getContext('2d')?.drawImage(image, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not read that image'));
    };
    image.src = url;
  });
}

/** Hand a JSON file to the browser so the user picks where it lands. */
function downloadJson(name: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 5000);
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
  const [favoriteCount, setFavoriteCount] = useState<number | null>(null);
  const [devices, setDevices] = useState<{ id: string; label: string }[]>([]);
  const [libraryBusy, setLibraryBusy] = useState<'' | 'export' | 'import'>('');
  const [libraryMessage, setLibraryMessage] = useState('');
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
    void navigator.mediaDevices
      ?.enumerateDevices()
      .then((list) =>
        setDevices(
          list
            .filter((device) => device.kind === 'audiooutput')
            .map((device, index) => ({ id: device.deviceId, label: device.label || `Output ${index + 1}` })),
        ),
      )
      .catch(() => setDevices([]));
    void bridge()
      .favorites.ids()
      .then((ids) => setFavoriteCount(ids.length))
      .catch(() => setFavoriteCount(null));
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
              {tab === 'you' ? (
                <section>
                  <h3 className="mb-3 text-[15px] font-semibold">You</h3>
                  <div className="mb-4 flex items-center gap-4 rounded-xl border border-line bg-surface/50 p-4">
                    <label className="group relative flex h-16 w-16 cursor-pointer items-center justify-center overflow-hidden rounded-full bg-accent/15 text-[22px] font-semibold uppercase text-accent">
                      {settings.avatar ? (
                        <img src={settings.avatar} alt="Profile picture" className="h-full w-full object-cover" />
                      ) : (
                        (settings.displayName.trim()[0] ?? 'C').toUpperCase()
                      )}
                      <span className="absolute inset-0 hidden items-center justify-center bg-black/55 text-[10px] font-medium text-white group-hover:flex">
                        Change
                      </span>
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        aria-label="Choose profile picture"
                        onChange={(event) => {
                          const file = event.target.files?.[0];
                          if (file) void fileToBackground(file, 256, 0.86).then(settings.setAvatar).catch(() => undefined);
                          event.target.value = '';
                        }}
                      />
                    </label>
                    <div className="min-w-0 flex-1">
                      <input
                        value={settings.displayName}
                        onChange={(event) => settings.setDisplayName(event.target.value)}
                        placeholder="Your name"
                        aria-label="Profile name in You tab"
                        maxLength={40}
                        className="h-9 w-full rounded-lg bg-surface/70 px-2.5 text-[13px] text-text outline-none placeholder:text-faint focus:ring-1 focus:ring-accent/40"
                      />
                      <p className="mt-1 text-[11px] text-muted">Local profile — no account, nothing uploaded.</p>
                    </div>
                    {settings.avatar ? (
                      <button
                        onClick={() => settings.setAvatar('')}
                        className="shrink-0 rounded-full px-2.5 py-1 text-[12px] text-muted transition-colors hover:text-text"
                      >
                        Remove
                      </button>
                    ) : null}
                  </div>

                  <div className="mb-5 grid grid-cols-3 gap-2">
                    {[
                      { label: 'Tracks', value: stats?.tracks },
                      { label: 'Playlists', value: stats?.playlists },
                      { label: 'Favorites', value: favoriteCount ?? undefined },
                    ].map((entry) => (
                      <div key={entry.label} className="rounded-xl border border-line bg-surface/40 p-3">
                        <p className="text-[17px] font-semibold tabular-nums">
                          {entry.value == null ? '—' : entry.value}
                        </p>
                        <p className="text-[11px] text-muted">{entry.label}</p>
                      </div>
                    ))}
                  </div>

                  <h3 className="mb-3 text-[15px] font-semibold">Backup</h3>
                  <Row
                    title="Export library (.json)"
                    description="Playlists, their tracks and your favorites in one file you can keep anywhere."
                  >
                    <Button
                      variant="ghost"
                      onClick={async () => {
                        setLibraryBusy('export');
                        setLibraryMessage('');
                        try {
                          const lists = (await bridge().playlists.all()) as LibraryPlaylist[];
                          const playlists = [];
                          for (const list of lists) {
                            playlists.push({
                              name: list.name,
                              description: list.description ?? '',
                              tracks: await bridge().playlists.tracks(list.id),
                            });
                          }
                          const favorites = (await bridge().favorites.all()) as Track[];
                          downloadJson(`cloudy-library-${new Date().toISOString().slice(0, 10)}.json`, {
                            app: 'Cloudy',
                            version: 1,
                            exportedAt: new Date().toISOString(),
                            profile: { name: settings.displayName },
                            playlists,
                            favorites,
                          });
                          setLibraryMessage(`Exported ${playlists.length} playlists and ${favorites.length} favorites.`);
                        } catch (error) {
                          setLibraryMessage(`Export failed: ${(error as Error).message}`);
                        } finally {
                          setLibraryBusy('');
                        }
                      }}
                      disabled={libraryBusy !== ''}
                    >
                      <Download size={13} /> {libraryBusy === 'export' ? 'Working…' : 'Export'}
                    </Button>
                  </Row>
                  <Row
                    title="Import library (.json)"
                    description="Adds the playlists and favorites from a Cloudy backup. Nothing already here is removed."
                  >
                    <label className="flex cursor-pointer items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-1 text-[12px] text-text transition-colors hover:border-white/20">
                      <Upload size={13} /> {libraryBusy === 'import' ? 'Working…' : 'Import'}
                      <input
                        type="file"
                        accept="application/json,.json"
                        className="hidden"
                        aria-label="Import library"
                        disabled={libraryBusy !== ''}
                        onChange={async (event) => {
                          const file = event.target.files?.[0];
                          event.target.value = '';
                          if (!file) return;
                          setLibraryBusy('import');
                          setLibraryMessage('');
                          try {
                            const data = JSON.parse(await file.text()) as {
                              playlists?: { name?: string; description?: string; tracks?: Track[] }[];
                              favorites?: Track[];
                              profile?: { name?: string };
                            };
                            let addedLists = 0;
                            for (const list of data.playlists ?? []) {
                              if (!list?.name) continue;
                              const created = await bridge().playlists.create(list.name, list.description ?? '');
                              for (const track of list.tracks ?? []) {
                                if (track?.id) await bridge().playlists.addTrack(created.id, track);
                              }
                              addedLists += 1;
                            }
                            let addedFavorites = 0;
                            for (const track of data.favorites ?? []) {
                              if (!track?.id) continue;
                              await bridge().favorites.add(track);
                              addedFavorites += 1;
                            }
                            if (!settings.displayName && data.profile?.name) settings.setDisplayName(data.profile.name);
                            const fresh = await bridge().app.dbStats();
                            setStats(fresh);
                            setLibraryMessage(`Imported ${addedLists} playlists and ${addedFavorites} favorites.`);
                          } catch (error) {
                            setLibraryMessage(`Import failed: ${(error as Error).message}`);
                          } finally {
                            setLibraryBusy('');
                          }
                        }}
                      />
                    </label>
                  </Row>
                  {libraryMessage ? <p className="mt-2 text-[11.5px] text-muted">{libraryMessage}</p> : null}
                </section>
              ) : null}

              {tab === 'interface' ? (
                <section>
                  <h3 className="mb-3 text-[15px] font-semibold">Layout</h3>
                  <Row title="Search bar placement" description="Where the quick field sits in the title bar.">
                    <div className="flex gap-1 rounded-full border border-line bg-surface p-0.5">
                      {([
                        ['left', 'Left'],
                        ['middle', 'Middle'],
                        ['right', 'Right'],
                      ] as const).map(([value, label]) => (
                        <button
                          key={value}
                          onClick={() => settings.setSearchAlign(value)}
                          className={cn(
                            'rounded-full px-3 py-1 text-[12px] transition-colors',
                            settings.searchAlign === value ? 'bg-accent text-black' : 'text-muted hover:text-text',
                          )}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </Row>
                  <Row
                    title="Sidebar order"
                    description="Drag any rail icon, including a playlist shortcut, to move it. The order is stored with your settings."
                  >
                    <Button
                      variant="subtle"
                      onClick={() => settings.setSidebarOrder([...SIDEBAR_ORDER_DEFAULT])}
                      disabled={settings.sidebarOrder.join('|') === SIDEBAR_ORDER_DEFAULT.join('|')}
                    >
                      <RotateCcw size={13} /> Reset order
                    </Button>
                  </Row>
                  <Row title="Home button beside search" description="A small house that jumps to Home from any page.">
                    <Toggle
                      value={settings.showHomeButton}
                      onChange={settings.setShowHomeButton}
                      label="Home button beside search"
                    />
                  </Row>
                  <Row title="Search bar" description="A quick field in the title bar, or just the Search page.">
                    <div className="flex gap-1 rounded-full border border-line bg-surface p-0.5">
                      {([
                        ['title', 'Title bar'],
                        ['page', 'Page only'],
                      ] as const).map(([value, label]) => (
                        <button
                          key={value}
                          onClick={() => settings.setSearchPosition(value)}
                          className={cn(
                            'rounded-full px-3 py-1 text-[12px] transition-colors',
                            settings.searchPosition === value ? 'bg-accent text-black' : 'text-muted hover:text-text',
                          )}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </Row>
                  <Row title="Now Playing bar" description="Dock the transport at the bottom, or pin it under the title bar.">
                    <div className="flex gap-1 rounded-full border border-line bg-surface p-0.5">
                      {([
                        ['bottom', 'Bottom'],
                        ['top', 'Top'],
                      ] as const).map(([value, label]) => (
                        <button
                          key={value}
                          onClick={() => settings.setNowPlayingPosition(value)}
                          className={cn(
                            'rounded-full px-3 py-1 text-[12px] transition-colors',
                            settings.nowPlayingPosition === value ? 'bg-accent text-black' : 'text-muted hover:text-text',
                          )}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </Row>
                  <Row title="Icon style" description="Hairline outlines, or the same glyphs softly filled.">
                    <div className="flex gap-1 rounded-full border border-line bg-surface p-0.5">
                      {([
                        ['line', 'Line'],
                        ['solid', 'Solid'],
                      ] as const).map(([value, label]) => (
                        <button
                          key={value}
                          onClick={() => settings.setIconStyle(value)}
                          className={cn(
                            'rounded-full px-3 py-1 text-[12px] transition-colors',
                            settings.iconStyle === value ? 'bg-accent text-black' : 'text-muted hover:text-text',
                          )}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </Row>
                  <Row title="Icon roundness" description="Pill-round icon buttons, or softly rounded squares.">
                    <div className="flex gap-1 rounded-full border border-line bg-surface p-0.5">
                      {([
                        ['round', 'Round'],
                        ['soft', 'Soft'],
                      ] as const).map(([value, label]) => (
                        <button
                          key={value}
                          onClick={() => settings.setIconRoundness(value)}
                          className={cn(
                            'rounded-full px-3 py-1 text-[12px] transition-colors',
                            settings.iconRoundness === value ? 'bg-accent text-black' : 'text-muted hover:text-text',
                          )}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </Row>
                  <Row title="Icon weight" description="Stroke thickness of every glyph.">
                    <div className="flex items-center gap-3">
                      <input
                        type="range"
                        min={1}
                        max={2.6}
                        step={0.05}
                        value={settings.iconWeight}
                        onChange={(event) => settings.setIconWeight(Number(event.target.value))}
                        aria-label="Icon weight"
                        className="cloudy-range w-40 cursor-pointer"
                      />
                      <span className="w-10 text-right text-[11px] tabular-nums text-muted">
                        {settings.iconWeight.toFixed(2)}
                      </span>
                    </div>
                  </Row>
                  <Row title="Visualizer in the player bar" description="The spectrum bars beside the player controls.">
                    <Toggle
                      value={settings.showPlaybarVisualizer}
                      onChange={settings.setShowPlaybarVisualizer}
                      label="Visualizer in the player bar"
                    />
                  </Row>
                  <Row title="Visualizer opacity" description="How strongly the player-bar bars read against the bar.">
                    <div className="flex items-center gap-3">
                      <input
                        type="range"
                        min={5}
                        max={100}
                        step={1}
                        value={settings.playbarVisualizerOpacity}
                        onChange={(event) => settings.setPlaybarVisualizerOpacity(Number(event.target.value))}
                        aria-label="Visualizer opacity"
                        className="cloudy-range w-40 cursor-pointer"
                      />
                      <span className="w-10 text-right text-[11px] tabular-nums text-muted">
                        {settings.playbarVisualizerOpacity}%
                      </span>
                    </div>
                  </Row>
                  <Row title="Floating panel blur" description="Backdrop blur behind the lyrics, queue and title bar.">
                    <div className="flex items-center gap-3">
                      <input
                        type="range"
                        min={0}
                        max={48}
                        step={1}
                        value={settings.panelBlur}
                        onChange={(event) => settings.setPanelBlur(Number(event.target.value))}
                        aria-label="Floating panel blur"
                        className="cloudy-range w-40 cursor-pointer"
                      />
                      <span className="w-10 text-right text-[11px] tabular-nums text-muted">{settings.panelBlur}px</span>
                    </div>
                  </Row>
                  <Row title="Top moment icon" description="The glyph on the badge over the cover on Home.">
                    <div className="flex gap-1 rounded-full border border-line bg-surface p-0.5">
                      {([
                        ['heart', 'Heart'],
                        ['honey', 'Honey'],
                        ['star', 'Star'],
                        ['fire', 'Fire'],
                        ['cloud', 'Cloud'],
                      ] as const).map(([value, label]) => (
                        <button
                          key={value}
                          onClick={() => settings.setTopMomentIcon(value)}
                          className={cn(
                            'rounded-full px-2.5 py-1 text-[12px] transition-colors',
                            settings.topMomentIcon === value ? 'bg-accent text-black' : 'text-muted hover:text-text',
                          )}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </Row>
                  <Row title="Logo beside Home greeting" description="Draw your chosen mark next to “Head in the clouds.”">
                    <Toggle value={settings.showHomeLogo} onChange={settings.setShowHomeLogo} label="Logo beside Home greeting" />
                  </Row>
                  <Row title="Track card style" description="Default keeps the artist line under the title; Compact drops it for a tighter row.">
                    <div className="flex gap-1 rounded-full border border-line bg-surface p-0.5">
                      {([
                        ['default', 'Default'],
                        ['compact', 'Compact'],
                      ] as const).map(([value, label]) => (
                        <button
                          key={value}
                          onClick={() => settings.setTrackCardStyle(value)}
                          className={cn(
                            'rounded-full px-3 py-1 text-[12px] transition-colors',
                            settings.trackCardStyle === value ? 'bg-accent text-black' : 'text-muted hover:text-text',
                          )}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </Row>
                  <Row title="Now Playing title alignment" description="Left or centred title on the Now Playing and karaoke screens.">
                    <div className="flex gap-1 rounded-full border border-line bg-surface p-0.5">
                      {([
                        ['left', 'Left'],
                        ['center', 'Center'],
                      ] as const).map(([value, label]) => (
                        <button
                          key={value}
                          onClick={() => settings.setNowPlayingTitleAlign(value)}
                          className={cn(
                            'rounded-full px-3 py-1 text-[12px] transition-colors',
                            settings.nowPlayingTitleAlign === value ? 'bg-accent text-black' : 'text-muted hover:text-text',
                          )}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </Row>
                  <Row title="Now Playing toolbar position" description="Where the transport sits on the fullscreen Now Playing screen.">
                    <select
                      value={settings.nowPlayingToolbarPosition}
                      onChange={(event) =>
                        settings.setNowPlayingToolbarPosition(
                          event.target.value as typeof settings.nowPlayingToolbarPosition,
                        )
                      }
                      aria-label="Now Playing toolbar position"
                      className="h-7 rounded-full border border-line bg-surface px-2.5 text-[12px] text-text outline-none"
                    >
                      {[
                        ['top-center', 'Top center'],
                        ['top-left', 'Top left'],
                        ['top-right', 'Top right'],
                        ['bottom-center', 'Bottom center'],
                        ['bottom-left', 'Bottom left'],
                        ['bottom-right', 'Bottom right'],
                        ['left-center', 'Left side'],
                        ['right-center', 'Right side'],
                      ].map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </Row>
                  <Row title="Visualizer in Now Playing" description="A spectrum under the track title in the lyrics panel.">
                    <Toggle
                      value={settings.showNowPlayingVisualizer}
                      onChange={settings.setShowNowPlayingVisualizer}
                      label="Visualizer in Now Playing"
                    />
                  </Row>
                  <Row title="Visualizer style" description="Separate rounded bars, or one continuous wave.">
                    <div className="flex gap-1 rounded-full border border-line bg-surface p-0.5">
                      {([
                        ['bars', 'Bars'],
                        ['wave', 'Wave'],
                      ] as const).map(([value, label]) => (
                        <button
                          key={value}
                          onClick={() => settings.setVisualizerStyle(value)}
                          className={cn(
                            'rounded-full px-3 py-1 text-[12px] transition-colors',
                            settings.visualizerStyle === value ? 'bg-accent text-black' : 'text-muted hover:text-text',
                          )}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </Row>
                  <Row title="Playbar visualizer position" description="Compact block beside the controls, or stretched behind the whole bar.">
                    <div className="flex gap-1 rounded-full border border-line bg-surface p-0.5">
                      {([
                        ['compact', 'Compact'],
                        ['behind', 'Behind bar'],
                      ] as const).map(([value, label]) => (
                        <button
                          key={value}
                          onClick={() => settings.setPlaybarVisualizerPosition(value)}
                          className={cn(
                            'rounded-full px-3 py-1 text-[12px] transition-colors',
                            settings.playbarVisualizerPosition === value ? 'bg-accent text-black' : 'text-muted hover:text-text',
                          )}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </Row>
                  <Row title="Interface opacity" description="How solid panels are; lower lets the backdrop show through.">
                    <div className="flex items-center gap-3">
                      <input
                        type="range"
                        min={20}
                        max={100}
                        step={1}
                        value={settings.interfaceOpacity}
                        onChange={(event) => settings.setInterfaceOpacity(Number(event.target.value))}
                        aria-label="Interface opacity"
                        className="cloudy-range w-40 cursor-pointer"
                      />
                      <span className="w-10 text-right text-[11px] tabular-nums text-muted">{settings.interfaceOpacity}%</span>
                    </div>
                  </Row>
                  <Row title="Shaped cover in the player bar" description="Slow morphing squircle around the bar cover.">
                    <Toggle value={settings.shapedCover} onChange={settings.setShapedCover} label="Shaped cover in the player bar" />
                  </Row>
                  <Row title="Shaped covers on Now Playing" description="Apply the same shape to the Now Playing and karaoke covers.">
                    <Toggle
                      value={settings.shapedCoversNowPlaying}
                      onChange={settings.setShapedCoversNowPlaying}
                      label="Shaped covers on Now Playing"
                    />
                  </Row>
                  <Row title="Table columns" description="What a track row shows besides the cover, title and artist.">
                    <div className="flex flex-wrap justify-end gap-1.5">
                      {([
                        ['Duration', settings.showDurationColumn, settings.setShowDurationColumn],
                        ['Album', settings.showAlbumColumn, settings.setShowAlbumColumn],
                        ['Favourites', settings.showFavoriteColumn, settings.setShowFavoriteColumn],
                      ] as const).map(([label, on, toggle]) => (
                        <button
                          key={label}
                          aria-pressed={on}
                          onClick={() => toggle(!on)}
                          className={cn(
                            'rounded-full border px-2.5 py-1 text-[11.5px] transition-colors',
                            on
                              ? 'border-accent/40 bg-accent/15 text-accent'
                              : 'border-line text-muted hover:text-text',
                          )}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </Row>
                  <Row title="Wavy seek bar" description="The progress line ripples with the bass; off leaves a plain rule.">
                    <Toggle value={settings.wavySeekBar} onChange={settings.setWavySeekBar} label="Wavy seek bar" />
                  </Row>
                  <Row
                    title="Mini player when minimized"
                    description="A small floating bar with the cover, heart and transport sits above other windows while Cloudy is minimized."
                  >
                    <Toggle
                      value={settings.miniPlayerOnMinimize}
                      onChange={settings.setMiniPlayerOnMinimize}
                      label="Mini player when minimized"
                    />
                  </Row>

                  <h3 className="mb-3 mt-7 text-[15px] font-semibold">You</h3>
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
                  <Row title="Track card size" description="How tall each track row is.">
                    <div className="flex gap-1 rounded-full border border-line bg-surface p-0.5">
                      {[48, 56, 68].map((size) => (
                        <button
                          key={size}
                          onClick={() => settings.setRowSize(size)}
                          className={cn(
                            'rounded-full px-3 py-1 text-[12px] tabular-nums transition-colors',
                            settings.rowSize === size ? 'bg-accent text-black' : 'text-muted hover:text-text',
                          )}
                        >
                          {size}
                        </button>
                      ))}
                    </div>
                  </Row>
                  <Row title="Play button background" description="The filled circle behind the main play/pause glyph.">
                    <Toggle
                      value={settings.playButtonBackground}
                      onChange={settings.setPlayButtonBackground}
                      label="Play button background"
                    />
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
                  <h3 className="mb-3 text-[15px] font-semibold">Theme mode</h3>
                  <Row
                    title="Light or dark"
                    description="Keep your palette but follow light or dark, or leave Auto so the theme decides."
                  >
                    <div className="flex gap-1 rounded-full border border-line bg-surface p-0.5">
                      {([
                        ['auto', 'Auto'],
                        ['dark', 'Dark'],
                        ['light', 'Light'],
                      ] as const).map(([value, label]) => (
                        <button
                          key={value}
                          onClick={() => settings.setThemeMode(value)}
                          className={cn(
                            'rounded-full px-3 py-1 text-[12px] transition-colors',
                            settings.themeMode === value ? 'bg-accent text-black' : 'text-muted hover:text-text',
                          )}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </Row>

                  <h3 className="mb-3 mt-7 text-[15px] font-semibold">{t('language')}</h3>
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

                  <h3 className="mb-3 mt-7 text-[15px] font-semibold">Type &amp; rows</h3>
                  <Row title="Interface font" description="The typeface for the whole interface. Artwork titles keep their own styling.">
                    <div className="flex gap-1 rounded-full border border-line bg-surface p-0.5">
                      {(['sans', 'serif', 'mono'] as const).map((font) => (
                        <button
                          key={font}
                          onClick={() => settings.setInterfaceFont(font)}
                          className={cn(
                            'rounded-full px-3 py-1 text-[12px] capitalize transition-colors',
                            settings.interfaceFont === font ? 'bg-accent text-black' : 'text-muted hover:text-text',
                          )}
                        >
                          {font}
                        </button>
                      ))}
                    </div>
                  </Row>
                  <Row title="Classic rounded rows" description="Rounder 20px track rows with a press animation, like Riff's card style.">
                    <Toggle value={settings.classicCards} onChange={settings.setClassicCards} label="Classic rounded rows" />
                  </Row>

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
                  <Row
                    title="Accent intensity"
                    description="How far the accent bleeds into panels and buttons, from neutral to full tint."
                  >
                    <div className="flex items-center gap-3">
                      <input
                        type="range"
                        min={0}
                        max={100}
                        step={1}
                        value={settings.accentIntensity}
                        onChange={(event) => settings.setAccentIntensity(Number(event.target.value))}
                        aria-label="Accent intensity"
                        className="cloudy-range w-40 cursor-pointer"
                      />
                      <span className="w-10 text-right text-[11px] tabular-nums text-muted">
                        {settings.accentIntensity}%
                      </span>
                    </div>
                  </Row>
                  <Row title="Tint the background" description="Apply that intensity to panels and the app background, not just highlights.">
                    <Toggle
                      value={settings.tintBackground}
                      onChange={settings.setTintBackground}
                      label="Tint the background"
                    />
                  </Row>
                  <Row title="Highlight buttons" description="Fill the main button of each screen with the accent colour.">
                    <Toggle
                      value={settings.highlightButtons}
                      onChange={settings.setHighlightButtons}
                      label="Highlight buttons"
                    />
                  </Row>
                  <Row title="Mesh gradient brightness" description="Opacity of the coloured mesh behind the app.">
                    <div className="flex items-center gap-3">
                      <input
                        type="range"
                        min={0}
                        max={100}
                        step={1}
                        value={settings.meshBrightness}
                        onChange={(event) => settings.setMeshBrightness(Number(event.target.value))}
                        aria-label="Mesh gradient brightness"
                        className="cloudy-range w-40 cursor-pointer"
                      />
                      <span className="w-10 text-right text-[11px] tabular-nums text-muted">{settings.meshBrightness}%</span>
                    </div>
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

              {tab === 'banners' ? (
                <section>
                  <h3 className="mb-3 text-[15px] font-semibold">Background</h3>
                  <Row
                    title="Cover background"
                    description="Use the current track's artwork as the app background, like Riff's blurred cover."
                  >
                    <Toggle value={settings.coverBackground} onChange={settings.setCoverBackground} label="Cover background" />
                  </Row>
                  <Row title="Brightness" description="Lighten or deepen whichever background is showing.">
                    <div className="flex items-center gap-3">
                      <input
                        type="range"
                        min={30}
                        max={130}
                        step={1}
                        value={settings.backgroundBrightness}
                        onChange={(event) => settings.setBackgroundBrightness(Number(event.target.value))}
                        aria-label="Background brightness"
                        className="cloudy-range w-40 cursor-pointer"
                      />
                      <span className="w-10 text-right text-[11px] tabular-nums text-muted">
                        {settings.backgroundBrightness}%
                      </span>
                    </div>
                  </Row>
                  <Row title="Animate background" description="A slow drift across the picture so a still frame never looks frozen.">
                    <Toggle value={settings.animateBackground} onChange={settings.setAnimateBackground} label="Animate background" />
                  </Row>
                  <Row title="Banner fit" description="Fit shows the whole picture, Zoom fills and crops, Stretch fills exactly.">
                    <div className="flex gap-1 rounded-full border border-line bg-surface p-0.5">
                      {([
                        ['contain', 'Fit'],
                        ['cover', 'Zoom'],
                        ['stretch', 'Stretch'],
                      ] as const).map(([fit, label]) => (
                        <button
                          key={fit}
                          onClick={() => settings.setBackgroundFit(fit)}
                          className={cn(
                            'rounded-full px-3 py-1 text-[12px] transition-colors',
                            settings.backgroundFit === fit ? 'bg-accent text-black' : 'text-muted hover:text-text',
                          )}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </Row>
                  <Row title="Animation speed" description="Seconds for one pass of the background drift. Lower is livelier.">
                    <div className="flex items-center gap-3">
                      <input
                        type="range"
                        min={12}
                        max={48}
                        step={1}
                        value={settings.bannerAnimationSpeed}
                        onChange={(event) => settings.setBannerAnimationSpeed(Number(event.target.value))}
                        aria-label="Animation speed"
                        className="cloudy-range w-40 cursor-pointer"
                      />
                      <span className="w-10 text-right text-[11px] tabular-nums text-muted">
                        {settings.bannerAnimationSpeed}s
                      </span>
                    </div>
                  </Row>
                  <Row title="Banner fade" description="Where the picture starts to dissolve into the app background.">
                    <div className="flex items-center gap-3">
                      <input
                        type="range"
                        min={20}
                        max={100}
                        step={1}
                        value={settings.bannerFade}
                        onChange={(event) => settings.setBannerFade(Number(event.target.value))}
                        aria-label="Banner fade"
                        className="cloudy-range w-40 cursor-pointer"
                      />
                      <span className="w-10 text-right text-[11px] tabular-nums text-muted">{settings.bannerFade}%</span>
                    </div>
                  </Row>
                  <Row title="Now Playing cover banner" description="Artwork backdrop behind the lyrics panel for the current track.">
                    <Toggle
                      value={settings.nowPlayingBanner}
                      onChange={settings.setNowPlayingBanner}
                      label="Now Playing cover banner"
                    />
                  </Row>
                  <Row title="Playlist banners" description="Artwork backdrop at the top of each playlist page.">
                    <Toggle
                      value={settings.playlistBanners}
                      onChange={settings.setPlaylistBanners}
                      label="Playlist banners"
                    />
                  </Row>
                  <Row title="Banner blur" description="Blur applied to the cover banner, separate from your own background picture.">
                    <div className="flex items-center gap-3">
                      <input
                        type="range"
                        min={0}
                        max={12}
                        step={1}
                        value={settings.bannerBlur}
                        onChange={(event) => settings.setBannerBlur(Number(event.target.value))}
                        aria-label="Banner blur"
                        className="cloudy-range w-40 cursor-pointer"
                      />
                      <span className="w-10 text-right text-[11px] tabular-nums text-muted">{settings.bannerBlur}px</span>
                    </div>
                  </Row>
                  <Row title="Banner opacity" description="Opacity of the cover banner.">
                    <div className="flex items-center gap-3">
                      <input
                        type="range"
                        min={20}
                        max={100}
                        step={1}
                        value={settings.bannerOpacity}
                        onChange={(event) => settings.setBannerOpacity(Number(event.target.value))}
                        aria-label="Banner opacity"
                        className="cloudy-range w-40 cursor-pointer"
                      />
                      <span className="w-10 text-right text-[11px] tabular-nums text-muted">{settings.bannerOpacity}%</span>
                    </div>
                  </Row>
                  <p className="mt-3 text-[11.5px] leading-relaxed text-muted">
                    Your own picture, its blur and its opacity live in Appearance → Background.
                  </p>
                </section>
              ) : null}

              {tab === 'tracks' ? (
                <section>
                  <h3 className="mb-3 text-[15px] font-semibold">Lists</h3>
                  <Row title="Track numbers" description="Show the position number in front of every row, not just on hover.">
                    <Toggle value={settings.showTrackNumbers} onChange={settings.setShowTrackNumbers} label="Track numbers" />
                  </Row>
                  <Row title="Source badge" description="Show the catalog (SoundCloud, Deezer, Apple, Audius) next to the artist.">
                    <Toggle value={settings.showSourceBadge} onChange={settings.setShowSourceBadge} label="Source badge" />
                  </Row>
                  <Row title="Explicit tag" description="Show an E badge next to tracks marked explicit.">
                    <Toggle value={settings.showExplicitTag} onChange={settings.setShowExplicitTag} label="Explicit tag" />
                  </Row>

                  <h3 className="mb-3 mt-7 text-[15px] font-semibold">Lyrics</h3>
                  <Row
                    title="No-lyrics warnings"
                    description={'Show the "no lyrics / no sync found" explanation inside the lyrics panel.'}
                  >
                    <Toggle
                      value={settings.showLyricsWarnings}
                      onChange={settings.setShowLyricsWarnings}
                      label="No-lyrics warnings"
                    />
                  </Row>
                </section>
              ) : null}

              {tab === 'advanced' ? (
                <section>
                  <h3 className="mb-3 text-[15px] font-semibold">Diagnostics</h3>
                  <Row title="Copy diagnostics" description="Version, settings and cache numbers, ready to paste into a bug report.">
                    <Button
                      variant="ghost"
                      onClick={async () => {
                        const info = await bridge().app.info().catch(() => null);
                        const [cacheStats, dbStats] = await Promise.all([
                          bridge().cache.stats().catch(() => null),
                          bridge().app.dbStats().catch(() => null),
                        ]);
                        const payload = {
                          app: 'Cloudy',
                          version: info?.version ?? version,
                          platform: info?.platform ?? 'unknown',
                          tracks: dbStats?.tracks ?? null,
                          playlists: dbStats?.playlists ?? null,
                          cacheFiles: cacheStats?.files ?? null,
                          cacheBytes: cacheStats?.bytes ?? null,
                          settings: { ...settings, load: undefined, currentTheme: undefined },
                        };
                        await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
                      }}
                    >
                      <Copy size={13} /> Copy
                    </Button>
                  </Row>
                  <Row title="Open data folder" description="Where Cloudy keeps its database, cached audio and update logs.">
                    <Button variant="ghost" onClick={() => void bridge().app.openDataFolder()}>
                      <FolderOpen size={13} /> Open
                    </Button>
                  </Row>

                  <h3 className="mb-3 mt-7 text-[15px] font-semibold">Reset</h3>
                  <Row
                    title="Reset interface settings"
                    description="Puts appearance, interface and list options back to stock. Your library and playlists are untouched."
                  >
                    <Button
                      variant="ghost"
                      onClick={() => {
                        if (window.confirm('Reset appearance, interface and list settings to their defaults?')) {
                          settings.resetInterface();
                        }
                      }}
                    >
                      Reset
                    </Button>
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
                  <h3 className="mb-3 text-[15px] font-semibold">Output</h3>
                  <Row
                    title="Audio output device"
                    description="Send playback to a specific speaker, headset or interface. Default follows Windows."
                  >
                    <select
                      value={settings.outputDeviceId}
                      onChange={(event) => settings.setOutputDeviceId(event.target.value)}
                      aria-label="Audio output device"
                      className="h-8 max-w-[220px] rounded-lg bg-surface px-2 text-[12px] text-text outline-none focus:ring-1 focus:ring-accent/40"
                    >
                      <option value="">System default</option>
                      {devices.map((device) => (
                        <option key={device.id} value={device.id}>
                          {device.label}
                        </option>
                      ))}
                    </select>
                  </Row>

                  <div className="mt-7 mb-3 flex items-center justify-between">
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
                  <Row
                    title="Export account backup"
                    description="Settings, playlists, favourites and library in one JSON file you can keep or move."
                  >
                    <Button
                      variant="ghost"
                      onClick={async () => {
                        const [stored, allPlaylists, favoriteTracks, libraryTracks] = await Promise.all([
                          bridge().settings.all(),
                          bridge().playlists.all(),
                          bridge().favorites.all(),
                          bridge().library.all(),
                        ]);
                        const withTracks = await Promise.all(
                          allPlaylists.map(async (list) => ({
                            name: list.name,
                            description: list.description,
                            tracks: await bridge().playlists.tracks(list.id),
                          })),
                        );
                        downloadJson(`cloudy-account-${new Date().toISOString().slice(0, 10)}.json`, {
                          app: 'Cloudy',
                          exportedAt: new Date().toISOString(),
                          settings: stored,
                          playlists: withTracks,
                          favorites: favoriteTracks,
                          library: libraryTracks,
                        });
                      }}
                    >
                      <Copy size={13} /> Export
                    </Button>
                  </Row>
                  <Row
                    title="Import account backup"
                    description="Restore settings, playlists and favourites from a Cloudy export. Existing items are kept."
                  >
                    <label className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-full px-3 text-[12.5px] text-text/80 transition-colors hover:bg-surface">
                      <Upload size={13} /> Import
                      <input
                        type="file"
                        accept="application/json,.json"
                        className="hidden"
                        onChange={async (event) => {
                          const file = event.target.files?.[0];
                          if (!file) return;
                          try {
                            const data = JSON.parse(await file.text()) as {
                              settings?: Record<string, unknown>;
                              playlists?: { name: string; description?: string | null; tracks?: Track[] }[];
                              favorites?: Track[];
                            };
                            for (const [key, value] of Object.entries(data.settings ?? {})) {
                              await bridge().settings.set(key, value);
                            }
                            const existing = await bridge().playlists.all();
                            for (const list of data.playlists ?? []) {
                              let target = existing.find((item) => item.name === list.name);
                              if (!target) target = await bridge().playlists.create(list.name, list.description ?? undefined);
                              for (const track of list.tracks ?? []) {
                                await bridge().playlists.addTrack(target.id, track);
                              }
                            }
                            for (const track of data.favorites ?? []) {
                              await bridge().favorites.add(track);
                            }
                            window.location.reload();
                          } catch {
                            window.alert('That file is not a Cloudy account backup.');
                          }
                        }}
                      />
                    </label>
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
