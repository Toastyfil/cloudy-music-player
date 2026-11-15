import { Heart, Play, Search, Shuffle } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { FavoriteAlbum, FavoriteArtist, LibraryTrack } from '@/shared/api/contracts';
import { bridge } from '@/shared/api/bridge';
import { AlbumArt } from '@/shared/ui/AlbumArt';
import { Button } from '@/shared/ui/Button';
import { RowMenu } from '@/shared/ui/ContextMenu';
import { EmptyState, Tabs, TrackListSkeleton } from '@/shared/ui/Misc';
import { TrackRow } from '@/shared/ui/TrackRow';
import { usePlayerStore } from '@/features/player/store/playerStore';
import { useTrackMenu } from '@/features/library/hooks/useTrackMenu';
import { useFavoritesStore } from '../store/favoritesStore';

type Tab = 'songs' | 'artists' | 'albums';

function HeartPill({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      className="flex h-7 w-7 items-center justify-center rounded-full bg-black/60 text-white backdrop-blur transition-colors hover:text-accent focus-ring"
    >
      <Heart size={13} className="fill-accent text-accent" />
    </button>
  );
}

export function FavoritesPage() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>('songs');
  const [tracks, setTracks] = useState<LibraryTrack[]>([]);
  const [artists, setArtists] = useState<FavoriteArtist[]>([]);
  const [albums, setAlbums] = useState<FavoriteAlbum[]>([]);
  const [loading, setLoading] = useState(true);

  const songIds = useFavoritesStore((s) => s.ids);
  const artistIds = useFavoritesStore((s) => s.artistIds);
  const albumIds = useFavoritesStore((s) => s.albumIds);
  const toggleArtist = useFavoritesStore((s) => s.toggleArtist);
  const toggleAlbum = useFavoritesStore((s) => s.toggleAlbum);

  const playTracks = usePlayerStore((s) => s.playTracks);
  const playNow = usePlayerStore((s) => s.playNow);
  const current = usePlayerStore((s) => s.queue[s.index] ?? null);
  const playing = usePlayerStore((s) => s.playing);
  const menuFor = useTrackMenu();

  const load = useCallback(async () => {
    const [likedSongs, followedArtists, savedAlbums] = await Promise.all([
      bridge().favorites.all().catch(() => []),
      bridge().favorites.artists().catch(() => []),
      bridge().favorites.albums().catch(() => []),
    ]);
    setTracks(likedSongs as LibraryTrack[]);
    setArtists(followedArtists);
    setAlbums(savedAlbums);
    setLoading(false);
  }, []);

  // The shared id lists are the source of truth: a heart pressed anywhere in the
  // app refreshes this page.
  useEffect(() => {
    void load();
  }, [load, songIds, artistIds, albumIds]);

  const shuffle = () => {
    const copy = [...tracks];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    void playTracks(copy, 0);
  };

  const minutes = Math.round(tracks.reduce((sum, track) => sum + (track.duration || 0), 0) / 60);
  const total = tracks.length + artists.length + albums.length;

  if (loading) {
    return (
      <div className="px-8 pt-6">
        <TrackListSkeleton rows={8} />
      </div>
    );
  }

  if (!total) {
    return (
      <div className="px-8 pt-4">
        <EmptyState
          title="Nothing favorited yet"
          description="Press the heart on a song, follow an artist, or save an album — they all collect here."
          action={
            <Button onClick={() => navigate('/search')}>
              <Search size={14} /> Find something to love
            </Button>
          }
        />
      </div>
    );
  }

  const songsEmpty = (
    <EmptyState
      title="No liked songs yet"
      description="The heart on any track row adds it here."
      action={
        <Button variant="subtle" onClick={() => navigate('/search')}>
          <Search size={14} /> Search music
        </Button>
      }
    />
  );

  const artistsEmpty = (
    <EmptyState
      title="No followed artists yet"
      description="Open an artist and press Follow to keep them here."
      action={
        <Button variant="subtle" onClick={() => navigate('/search')}>
          <Search size={14} /> Find artists
        </Button>
      }
    />
  );

  const albumsEmpty = (
    <EmptyState
      title="No saved albums yet"
      description="Save an album from its page and it shows up here."
      action={
        <Button variant="subtle" onClick={() => navigate('/search')}>
          <Search size={14} /> Find albums
        </Button>
      }
    />
  );

  return (
    <div className="px-8 pb-12 pt-3">
      <header className="mb-6 flex flex-wrap items-end gap-5">
        <div
          className="relative flex h-[118px] w-[118px] shrink-0 items-center justify-center overflow-hidden rounded-xl shadow-[var(--shadow)]"
          style={{ background: 'linear-gradient(145deg, var(--accent) 0%, rgba(0,0,0,0.72) 100%)' }}
        >
          <Heart size={42} className="fill-white/90 text-white/90" />
        </div>
        <div className="min-w-0 flex-1 pb-1">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted">Collection</p>
          <h1 className="mt-1 text-[32px] font-bold leading-[1.08] tracking-[-0.03em]">Favorites</h1>
          <p className="mt-1.5 text-[12.5px] text-muted">
            {tracks.length} {tracks.length === 1 ? 'song' : 'songs'}
            {minutes ? ` · ${minutes} min` : ''} · {artists.length} {artists.length === 1 ? 'artist' : 'artists'} ·{' '}
            {albums.length} {albums.length === 1 ? 'album' : 'albums'}
          </p>
          {tracks.length ? (
            <div className="mt-4 flex items-center gap-2">
              <Button onClick={() => void playTracks(tracks, 0)}>
                <Play size={14} className="fill-black" /> Play liked songs
              </Button>
              <Button variant="subtle" onClick={shuffle}>
                <Shuffle size={14} /> Shuffle
              </Button>
            </div>
          ) : null}
        </div>
      </header>

      <div className="mb-6 border-b border-line">
        <Tabs
          tabs={[
            { id: 'songs' as Tab, label: `Songs${tracks.length ? ` · ${tracks.length}` : ''}` },
            { id: 'artists' as Tab, label: `Artists${artists.length ? ` · ${artists.length}` : ''}` },
            { id: 'albums' as Tab, label: `Albums${albums.length ? ` · ${albums.length}` : ''}` },
          ]}
          value={tab}
          onChange={setTab}
        />
      </div>

      {tab === 'songs' ? (
        tracks.length ? (
          <div className="space-y-0.5">
            {tracks.map((track) => (
              <TrackRow
                key={track.id}
                track={track}
                active={current?.id === track.id}
                playing={playing}
                onPlay={() => void playNow(track)}
                right={<RowMenu items={menuFor(track, { inLibrary: true, onRemoved: load })} />}
              />
            ))}
          </div>
        ) : (
          songsEmpty
        )
      ) : null}

      {tab === 'artists' ? (
        artists.length ? (
          <div className="flex flex-wrap gap-x-4 gap-y-7">
            {artists.map((artist) => (
              <div key={artist.id} className="group w-[150px]">
                <div className="relative">
                  <button
                    onClick={() => navigate(`/artist/${artist.id}`)}
                    className="block overflow-hidden rounded-full focus-ring"
                    aria-label={`Open ${artist.name}`}
                  >
                    <AlbumArt
                      src={artist.thumbnail}
                      alt={artist.name}
                      size={150}
                      rounded="full"
                      className="transition-transform duration-300 group-hover:scale-[1.03]"
                    />
                  </button>
                  <span className="absolute right-2 top-2 opacity-0 transition-opacity group-hover:opacity-100">
                    <HeartPill label={`Unfollow ${artist.name}`} onClick={() => void toggleArtist(artist)} />
                  </span>
                </div>
                <button onClick={() => navigate(`/artist/${artist.id}`)} className="mt-2 block w-full truncate text-left text-[13px] font-medium">
                  {artist.name}
                </button>
                <p className="text-[11.5px] text-muted">Artist</p>
              </div>
            ))}
          </div>
        ) : (
          artistsEmpty
        )
      ) : null}

      {tab === 'albums' ? (
        albums.length ? (
          <div className="flex flex-wrap gap-x-4 gap-y-7">
            {albums.map((album) => (
              <div key={album.id} className="group w-[150px]">
                <div className="relative">
                  <button
                    onClick={() => navigate(`/album/${album.id}`)}
                    className="block overflow-hidden rounded-xl focus-ring"
                    aria-label={`Open ${album.title}`}
                  >
                    <AlbumArt
                      src={album.thumbnail}
                      alt={album.title}
                      size={150}
                      rounded="lg"
                      className="transition-transform duration-300 group-hover:scale-[1.03]"
                    />
                  </button>
                  <span className="absolute right-2 top-2 opacity-0 transition-opacity group-hover:opacity-100">
                    <HeartPill label={`Remove ${album.title} from favorites`} onClick={() => void toggleAlbum(album)} />
                  </span>
                </div>
                <button onClick={() => navigate(`/album/${album.id}`)} className="mt-2 block w-full truncate text-left text-[13px] font-medium">
                  {album.title}
                </button>
                <p className="truncate text-[11.5px] text-muted">
                  {album.artist}
                  {album.year ? ` · ${album.year}` : ''}
                </p>
              </div>
            ))}
          </div>
        ) : (
          albumsEmpty
        )
      ) : null}
    </div>
  );
}
