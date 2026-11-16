import { AnimatePresence } from 'framer-motion';
import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { TitleBar } from '@/widgets/title-bar/TitleBar';
import { PlayerBar } from '@/widgets/player-bar/PlayerBar';
import { AdaptiveAccent } from '@/features/player/ui/AdaptiveAccent';
import { FullscreenLyrics } from '@/widgets/fullscreen-player/FullscreenLyrics';
import { Sidebar } from '@/features/navigation/ui/Sidebar';
import { QueuePanel } from '@/features/queue/ui/QueuePanel';
import { LyricsPanel } from '@/features/lyrics/ui/LyricsPanel';
import { SettingsDialog } from '@/features/settings/ui/SettingsDialog';
import { ImportDialog } from '@/features/importer/ui/ImportDialog';
import { OnboardingDialog } from '@/features/onboarding/ui/OnboardingDialog';
import { AppRoutes } from './routes';
import { useUiStore } from '@/features/navigation/store/uiStore';
import { usePlayerStore, selectCurrentTrack } from '@/features/player/store/playerStore';
import { useLyricsStore } from '@/features/lyrics/store/lyricsStore';
import { prefetchLyrics } from '@/features/lyrics/api/lrclib';
import { applyPendingAlignment, scheduleAutoAlign } from '@/features/lyrics/lib/autoAlign';
import { useSettingsStore } from '@/features/settings/store/settingsStore';
import { applyInterfaceSettings } from '@/features/settings/lib/interfaceSettings';
import { setAccentOverride } from '@/shared/config/themes';
import { useFavoritesStore } from '@/features/favorites/store/favoritesStore';
import { useGlobalShortcuts } from '@/features/shortcuts/hooks/useGlobalShortcuts';
import { UpdateDialog } from '@/features/updates/ui/UpdateDialog';
import { useUpdatesStore } from '@/features/updates/store/updatesStore';
import { useAudioBindings } from '@/features/player/hooks/useAudioBindings';
import { bridge } from '@/shared/api/bridge';
import { audioEngine } from '@/features/player/engine/audioEngine';

export function App() {
  const navigate = useNavigate();
  const lyricsOpen = useUiStore((s) => s.lyricsOpen);
  const toggleLyrics = useUiStore((s) => s.toggleLyrics);
  const toggleFullscreen = useUiStore((s) => s.toggleFullscreenLyrics);
  const track = usePlayerStore(selectCurrentTrack);
  const hydrate = usePlayerStore((s) => s.hydrate);
  const loadLyrics = useLyricsStore((s) => s.load);
  const loadSettings = useSettingsStore((s) => s.load);
  const settingsLoaded = useSettingsStore((s) => s.loaded);
  const onboardingComplete = useSettingsStore((s) => s.onboardingComplete);
  const reduceMotion = useSettingsStore((s) => s.reduceMotion);
  const noHandCursor = useSettingsStore((s) => s.noHandCursor);
  const uiScale = useSettingsStore((s) => s.uiScale);
  const cornerRadius = useSettingsStore((s) => s.cornerRadius);
  const customBackground = useSettingsStore((s) => s.customBackground);
  const backgroundBlur = useSettingsStore((s) => s.backgroundBlur);
  const backgroundOpacity = useSettingsStore((s) => s.backgroundOpacity);
  const meshGradient = useSettingsStore((s) => s.meshGradient);

  useEffect(() => {
    applyInterfaceSettings({ reduceMotion, noHandCursor, uiScale, cornerRadius });
  }, [reduceMotion, noHandCursor, uiScale, cornerRadius]);

  // Custom accent, Riff-style: hue, saturation and lightness drive the accent
  // and the softer variants the UI derives from it.
  // Output device: applied once settings are loaded and whenever it changes.
  const outputDeviceId = useSettingsStore((s) => s.outputDeviceId);
  useEffect(() => {
    if (settingsLoaded) void audioEngine.setOutputDevice(outputDeviceId);
  }, [outputDeviceId, settingsLoaded]);

  // Interface typeface, Riff-style: a system sans by default, or a serif/mono.
  const interfaceFont = useSettingsStore((s) => s.interfaceFont);
  useEffect(() => {
    const stack =
      interfaceFont === 'serif'
        ? 'Georgia, "Times New Roman", serif'
        : interfaceFont === 'mono'
          ? 'ui-monospace, "Cascadia Mono", Consolas, monospace'
          : 'Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif';
    document.documentElement.style.setProperty('--font-ui', stack);
    if (document.body) document.body.style.fontFamily = stack;
  }, [interfaceFont]);

  // Your own CSS, applied after the app's styles so it always wins.
  const customCss = useSettingsStore((s) => s.customCss);
  useEffect(() => {
    let element = document.getElementById('cloudy-custom-css') as HTMLStyleElement | null;
    if (!customCss.trim()) {
      element?.remove();
      return;
    }
    if (!element) {
      element = document.createElement('style');
      element.id = 'cloudy-custom-css';
      document.head.appendChild(element);
    }
    element.textContent = customCss;
  }, [customCss]);

  const customAccentEnabled = useSettingsStore((s) => s.customAccentEnabled);
  const accentHue = useSettingsStore((s) => s.accentHue);
  const accentSaturation = useSettingsStore((s) => s.accentSaturation);
  const accentLightness = useSettingsStore((s) => s.accentLightness);
  const themeId = useSettingsStore((s) => s.themeId);
  useEffect(() => {
    if (!customAccentEnabled) {
      setAccentOverride(null);
      return;
    }
    setAccentOverride({
      accent: `hsl(${accentHue} ${accentSaturation}% ${accentLightness}%)`,
      accentStrong: `hsl(${accentHue} ${accentSaturation}% ${Math.max(32, accentLightness - 18)}%)`,
      accentSoft: `hsl(${accentHue} ${accentSaturation}% ${accentLightness}% / 0.16)`,
    });
  }, [customAccentEnabled, accentHue, accentSaturation, accentLightness, themeId]);

  useGlobalShortcuts();
  useAudioBindings();

  useEffect(() => {
    void loadSettings();
    void hydrate();
    void useFavoritesStore.getState().load();
  }, [loadSettings, hydrate]);

  // Lyrics follow the current track automatically, and the next few tracks in
  // the queue are warmed in the background so skips never wait on the network.
  useEffect(() => {
    if (track) void loadLyrics(track);
    else useLyricsStore.getState().reset();
    // A correction measured after the intro is applied here, at the start of the
    // track, instead of yanking the lyrics mid-song.
    if (track) applyPendingAlignment(track.id);
    // A new track gets one background alignment attempt, cached afterwards.
    scheduleAutoAlign(track);
    const { queue, index } = usePlayerStore.getState();
    const upcoming = index >= 0 ? queue.slice(index + 1, index + 4) : queue.slice(0, 3);
    if (upcoming.length) void prefetchLyrics(upcoming);
  }, [track?.id, loadLyrics]);

  // Update events arrive from the main process: progress while the installer
  // downloads, then a ready state that opens the prompt.
  useEffect(() => {
    const off = bridge().updates.onState((status) => useUpdatesStore.getState().apply(status));
    void bridge().updates.state().then((status) => useUpdatesStore.getState().apply(status));
    void bridge().updates.check(true);
    return off;
  }, []);

  // The pending correction usually cannot be applied at track switch, because
  // that track's lyrics may still be loading. Apply it the moment they arrive.
  const lyricsStatus = useLyricsStore((s) => s.status);
  useEffect(() => {
    if (track && lyricsStatus === 'synced') applyPendingAlignment(track.id);
  }, [track?.id, lyricsStatus]);

  // Starting playback is the other moment a track becomes a candidate: a track
  // restored paused should still get its one alignment attempt when the user
  // finally presses play.
  useEffect(() => {
    const off = usePlayerStore.subscribe((state, previous) => {
      if (state.playing && !previous.playing) scheduleAutoAlign(usePlayerStore.getState().queue[state.index] ?? null);
    });
    return off;
  }, []);

  // Deep links and tray/OS actions.
  useEffect(() => {
    const offLink = bridge().events.onDeeplink((route) => navigate(route));
    const offMedia = bridge().events.onMediaAction((action) => {
      const player = usePlayerStore.getState();
      if (action === 'playpause') void player.toggle();
      if (action === 'next') void player.next();
      if (action === 'previous') void player.previous();
      if (action === 'stop') player.seek(0);
    });
    return () => {
      offLink();
      offMedia();
    };
  }, [navigate]);

  return (
    <div className="relative flex h-full flex-col overflow-hidden">
      {/* Riff-style backdrop: an accent mesh, your own image, or both. It sits
          under every panel so translucent surfaces pick up its colour. */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        {meshGradient ? <div className="cloudy-mesh absolute -inset-32" /> : null}
        {customBackground ? (
          <div
            className="absolute inset-0 bg-cover bg-center"
            style={{
              backgroundImage: `url(${customBackground})`,
              filter: backgroundBlur ? `blur(${backgroundBlur}px)` : undefined,
              opacity: backgroundOpacity / 100,
              transform: backgroundBlur ? 'scale(1.08)' : undefined,
            }}
          />
        ) : null}
      </div>
      <TitleBar />

      <div className="relative z-10 flex min-h-0 flex-1">
        <Sidebar />
        <main className="min-w-0 flex-1 overflow-y-auto">
          <AppRoutes />
        </main>
        <AnimatePresence initial={false}>
          {lyricsOpen ? (
            <LyricsPanel
              key="lyrics"
              onClose={() => toggleLyrics(false)}
              onFullscreen={() => toggleFullscreen(true)}
            />
          ) : null}
        </AnimatePresence>
        <QueuePanel />
      </div>

      <UpdateDialog />
      {settingsLoaded && !onboardingComplete ? <OnboardingDialog /> : null}

      <AdaptiveAccent />
      <PlayerBar />
      <FullscreenLyrics />
      <SettingsDialog />
      <ImportDialog />
    </div>
  );
}
