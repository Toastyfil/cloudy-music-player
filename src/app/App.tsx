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
import { AppRoutes } from './routes';
import { useUiStore } from '@/features/navigation/store/uiStore';
import { usePlayerStore, selectCurrentTrack } from '@/features/player/store/playerStore';
import { useLyricsStore } from '@/features/lyrics/store/lyricsStore';
import { prefetchLyrics } from '@/features/lyrics/api/lrclib';
import { applyPendingAlignment, scheduleAutoAlign } from '@/features/lyrics/lib/autoAlign';
import { useSettingsStore } from '@/features/settings/store/settingsStore';
import { useFavoritesStore } from '@/features/favorites/store/favoritesStore';
import { useGlobalShortcuts } from '@/features/shortcuts/hooks/useGlobalShortcuts';
import { useAudioBindings } from '@/features/player/hooks/useAudioBindings';
import { bridge } from '@/shared/api/bridge';

export function App() {
  const navigate = useNavigate();
  const lyricsOpen = useUiStore((s) => s.lyricsOpen);
  const toggleLyrics = useUiStore((s) => s.toggleLyrics);
  const toggleFullscreen = useUiStore((s) => s.toggleFullscreenLyrics);
  const track = usePlayerStore(selectCurrentTrack);
  const hydrate = usePlayerStore((s) => s.hydrate);
  const loadLyrics = useLyricsStore((s) => s.load);
  const loadSettings = useSettingsStore((s) => s.load);

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

      <AdaptiveAccent />
      <PlayerBar />
      <FullscreenLyrics />
      <SettingsDialog />
      <ImportDialog />
    </div>
  );
}
