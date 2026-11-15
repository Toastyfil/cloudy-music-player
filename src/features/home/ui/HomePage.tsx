import { Play, Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { LibraryPlaylist, LibraryTrack } from '@/shared/api/contracts';
import { bridge } from '@/shared/api/bridge';
import { AlbumArt } from '@/shared/ui/AlbumArt';
import { Button } from '@/shared/ui/Button';
import { CardGrid, EmptyState, HorizontalScroller, SectionHeader } from '@/shared/ui/Misc';
import { usePlayerStore } from '@/features/player/store/playerStore';
import { useUiStore } from '@/features/navigation/store/uiStore';
import { formatTime } from '@/shared/lib/format';
import { RowMenu } from '@/shared/ui/ContextMenu';
import { useTrackMenu } from '@/features/library/hooks/useTrackMenu';

interface AlbumGroup {
  key: string;
  name: string;
  artist: string;
  thumbnail: string | null;
  tracks: LibraryTrack[];
}

export function HomePage() {
  const navigate = useNavigate();
  const [recent, setRecent] = useState<LibraryTrack[]>([]);
  const [playlists, setPlaylists] = useState<LibraryPlaylist[]>([]);
  const [loaded, setLoaded] = useState(false);
  const queue = usePlayerStore((s) => s.queue);
  const index = usePlayerStore((s) => s.index);
  const playTracks = usePlayerStore((s) => s.playTracks);
  const playNow = usePlayerStore((s) => s.playNow);
  const current = usePlayerStore((s) => s.queue[s.index] ?? null);
  const playing = usePlayerStore((s) => s.playing);
  const setImportOpen = useUiStore((s) => s.setImportOpen);
  const menuFor = useTrackMenu();

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [recentTracks, playlistList] = await Promise.all([bridge().library.recent(24), bridge().playlists.all()]);
        if (!alive) return;
        setRecent(recentTracks as LibraryTrack[]);
        setPlaylists(playlistList as LibraryPlaylist[]);
      } catch {
        /* start empty */
      } finally {
        if (alive) setLoaded(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const albums: AlbumGroup[] = [];
  const seen = new Map<string, AlbumGroup>();
  for (const track of recent) {
    const key = track.album?.id ?? track.album?.name ?? track.title;
    let group = seen.get(key);
    if (!group) {
      group = { key, name: track.album?.name ?? track.title, artist: track.artist, thumbnail: track.thumbnail, tracks: [] };
      seen.set(key, group);
      albums.push(group);
    }
    group.tracks.push(track);
  }

  const upNext = queue.slice(Math.max(0, index), index + 7);

  if (!loaded) {
    return <div className="px-8 pt-6" />;
  }

  const isEmpty = !recent.length && !queue.length && !playlists.length;

  return (
    <div className="px-8 pb-12 pt-3">
      <header className="mb-8">
        <h1 className="text-[30px] font-bold tracking-[-0.03em]">Head in the clouds.</h1>
        <p className="mt-1 text-[13px] text-muted">Your music, your library, your light.</p>
      </header>

      {isEmpty ? (
        <EmptyState
          title="Search to get started"
          description="Cloudy plays straight from the YouTube Music catalog — no account, no ads, nothing to sign up for."
          action={
            <div className="flex items-center gap-2">
              <Button onClick={() => navigate('/search')}>
                <Search size={15} /> Find music
              </Button>
              <Button variant="subtle" onClick={() => setImportOpen(true)}>
                Import a playlist
              </Button>
            </div>
          }
        />
      ) : (
        <div className="space-y-10">
          {upNext.length ? (
            <section>
              <SectionHeader
                title="Listening right now"
                action={
                  <button
                    onClick={() => void usePlayerStore.getState().toggle()}
                    className="flex items-center gap-1.5 text-[12px] text-muted transition-colors hover:text-accent"
                  >
                    <Play size={12} className="fill-current" /> {playing ? 'Playing' : 'Resume'}
                  </button>
                }
              />
              <div className="flex gap-4 overflow-x-auto pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {upNext.map((track, i) => (
                  <button
                    key={`${track.id}-${i}`}
                    onClick={() => void playNow(track)}
                    className="group w-[132px] shrink-0 text-left"
                  >
                    <div className="relative overflow-hidden rounded-xl">
                      <AlbumArt src={track.thumbnail} alt={track.title} size={132} rounded="lg" />
                      {current?.id === track.id ? (
                        <span className="absolute inset-0 bg-black/35" />
                      ) : null}
                      {current?.id === track.id ? (
                        <span className="absolute bottom-2 left-2 rounded-full bg-accent px-2 py-0.5 text-[10px] font-semibold text-black">
                          {playing ? 'Playing' : 'Paused'}
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-2 truncate text-[12.5px] font-medium">{track.title}</p>
                    <p className="truncate text-[11px] text-muted">{track.artist}</p>
                  </button>
                ))}
              </div>
            </section>
          ) : null}

          {albums.length ? (
            <section>
              <SectionHeader title="Top Albums" />
              <CardGrid>
                {albums.slice(0, 12).map((album) => (
                  <button
                    key={album.key}
                    onClick={() => void playTracks(album.tracks, 0)}
                    className="group text-left"
                  >
                    <div className="overflow-hidden rounded-xl">
                      <AlbumArt
                        src={album.thumbnail}
                        alt={album.name}
                        size={160}
                        rounded="lg"
                        className="w-full transition-transform duration-300 group-hover:scale-[1.03]"
                      />
                    </div>
                    <p className="mt-2 truncate text-[13px] font-medium">{album.name}</p>
                    <p className="truncate text-[11.5px] text-muted">{album.artist}</p>
                  </button>
                ))}
              </CardGrid>
            </section>
          ) : null}

          {recent.length ? (
            <section>
              <SectionHeader title="Jump back in" />
              <HorizontalScroller>
                {recent.slice(0, 10).map((track) => (
                  <div key={track.id} className="w-[190px] shrink-0 snap-start">
                    <button
                      onClick={() => void playNow(track)}
                      className="flex w-full items-center gap-3 rounded-xl bg-surface/50 p-2.5 text-left transition-colors hover:bg-surface"
                    >
                      <AlbumArt src={track.thumbnail} alt={track.title} size={52} rounded="md" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[12.5px] font-medium">{track.title}</span>
                        <span className="block truncate text-[11px] text-muted">{track.artist}</span>
                        <span className="block text-[10.5px] text-faint">{formatTime(track.duration)}</span>
                      </span>
                    </button>
                    <div className="mt-1 hidden justify-end group-hover:flex" />
                  </div>
                ))}
              </HorizontalScroller>
            </section>
          ) : null}

          <section>
            <SectionHeader
              title="Your Playlists"
              action={
                <button
                  onClick={() => navigate('/playlists')}
                  className="text-[12px] text-muted transition-colors hover:text-accent"
                >
                  See all
                </button>
              }
            />
            {playlists.length ? (
              <CardGrid>
                {playlists.slice(0, 8).map((playlist) => (
                  <button key={playlist.id} onClick={() => navigate(`/playlist/${playlist.id}`)} className="group text-left">
                    <AlbumArt src={playlist.cover} alt={playlist.name} size={160} rounded="lg" className="w-full" />
                    <p className="mt-2 truncate text-[13px] font-medium">{playlist.name}</p>
                    <p className="text-[11.5px] text-muted">{playlist.trackCount} tracks</p>
                  </button>
                ))}
              </CardGrid>
            ) : (
              <button
                onClick={() => setImportOpen(true)}
                className="flex h-[92px] w-full items-center justify-between rounded-xl border border-dashed border-line px-5 text-left transition-colors hover:border-accent/40 hover:bg-surface/40"
              >
                <span>
                  <span className="block text-[13px] font-medium">Import a playlist</span>
                  <span className="block text-[11.5px] text-muted">Paste a Spotify, Apple Music, YouTube, SoundCloud or Deezer link</span>
                </span>
                <span className="text-accent">→</span>
              </button>
            )}
          </section>

          {recent.length ? (
            <section>
              <SectionHeader title="Recently played" />
              <div className="space-y-0.5">
                {recent.slice(0, 6).map((track) => (
                  <div
                    key={track.id}
                    className="group flex h-14 items-center gap-3 rounded-lg px-3 transition-colors hover:bg-surface/70"
                  >
                    <button onClick={() => void playNow(track)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                      <AlbumArt src={track.thumbnail} alt={track.title} size={40} rounded="md" />
                      <span className="min-w-0">
                        <span className="block truncate text-[13.5px] font-medium">{track.title}</span>
                        <span className="block truncate text-[11.5px] text-muted">{track.artist}</span>
                      </span>
                    </button>
                    <span className="text-[11.5px] tabular-nums text-muted">{formatTime(track.duration)}</span>
                    <span className="opacity-0 transition-opacity group-hover:opacity-100">
                      <RowMenu items={menuFor(track, { inLibrary: true })} />
                    </span>
                  </div>
                ))}
              </div>
            </section>
          ) : null}
        </div>
      )}
    </div>
  );
}
