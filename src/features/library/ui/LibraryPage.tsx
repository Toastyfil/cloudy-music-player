import { ArrowDownWideNarrow, Heart, LayoutGrid, List, ListMusic, Music4, Play, Plus, Search, Shuffle } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { LibraryPlaylist, LibraryTrack } from '@/shared/api/contracts';
import { bridge } from '@/shared/api/bridge';
import { AlbumArt } from '@/shared/ui/AlbumArt';
import { Button } from '@/shared/ui/Button';
import { CardGrid, EmptyState, HorizontalScroller, SectionHeader, TrackListSkeleton } from '@/shared/ui/Misc';
import { RowMenu } from '@/shared/ui/ContextMenu';
import { TrackRow } from '@/shared/ui/TrackRow';
import { usePlayerStore } from '@/features/player/store/playerStore';
import { useTrackMenu } from '@/features/library/hooks/useTrackMenu';
import { useUiStore } from '@/features/navigation/store/uiStore';
import { useT } from '@/shared/lib/i18n';

type SortKey = 'recent' | 'title' | 'artist' | 'length';
type Tab = 'all' | 'songs' | 'albums' | 'artists' | 'playlists';
type View = 'grid' | 'list';

const SORTS: { key: SortKey; label: string }[] = [
  { key: 'recent', label: 'Recently added' },
  { key: 'title', label: 'Title' },
  { key: 'artist', label: 'Artist' },
  { key: 'length', label: 'Length' },
];

const TABS: { id: Tab; key: 'tabAll' | 'tabSongs' | 'tabAlbums' | 'tabArtists' | 'tabPlaylists' }[] = [
  { id: 'all', key: 'tabAll' },
  { id: 'songs', key: 'tabSongs' },
  { id: 'albums', key: 'tabAlbums' },
  { id: 'artists', key: 'tabArtists' },
  { id: 'playlists', key: 'tabPlaylists' },
];

interface AlbumGroup {
  key: string;
  id: string | null;
  name: string;
  artist: string;
  cover: string | null;
  tracks: LibraryTrack[];
}

interface ArtistGroup {
  key: string;
  id: string | null;
  name: string;
  cover: string | null;
  tracks: LibraryTrack[];
}

export function LibraryPage() {
  const t = useT();
  const navigate = useNavigate();
  const [tracks, setTracks] = useState<LibraryTrack[]>([]);
  const [playlists, setPlaylists] = useState<LibraryPlaylist[]>([]);
  const [covers, setCovers] = useState<Record<string, string | null>>({});
  const [loading, setLoading] = useState(true);
  const [sort, setSort] = useState<SortKey>('recent');
  const [tab, setTab] = useState<Tab>('all');
  const [view, setView] = useState<View>('grid');
  const [query, setQuery] = useState('');
  const playTracks = usePlayerStore((s) => s.playTracks);
  const playNow = usePlayerStore((s) => s.playNow);
  const current = usePlayerStore((s) => s.queue[s.index] ?? null);
  const playing = usePlayerStore((s) => s.playing);
  const menuFor = useTrackMenu();
  const setImportOpen = useUiStore((s) => s.setImportOpen);

  const load = useCallback(async () => {
    try {
      const [list, playlistList] = await Promise.all([bridge().library.all(sort), bridge().playlists.all()]);
      setTracks(list as LibraryTrack[]);
      setPlaylists(playlistList as LibraryPlaylist[]);
      const entries = await Promise.all(
        (playlistList as LibraryPlaylist[]).map(
          async (playlist) => [playlist.id, await bridge().playlists.cover(playlist.id)] as const,
        ),
      );
      setCovers(Object.fromEntries(entries));
    } catch {
      setTracks([]);
      setPlaylists([]);
    } finally {
      setLoading(false);
    }
  }, [sort]);

  useEffect(() => {
    void load();
    const interval = setInterval(load, 5000);
    return () => clearInterval(interval);
  }, [load]);

  const needle = query.trim().toLowerCase();
  const matches = useCallback(
    (...fields: (string | null | undefined)[]) =>
      !needle || fields.some((field) => (field ?? '').toLowerCase().includes(needle)),
    [needle],
  );

  const filtered = useMemo(
    () => tracks.filter((track) => matches(track.title, track.artist, track.album?.name)),
    [tracks, matches],
  );

  const albums = useMemo(() => {
    const groups = new Map<string, AlbumGroup>();
    for (const track of tracks) {
      const key = track.album?.id ?? track.album?.name ?? track.title;
      const group = groups.get(key);
      if (group) group.tracks.push(track);
      else
        groups.set(key, {
          key,
          id: track.album?.id ?? null,
          name: track.album?.name ?? track.title,
          artist: track.artist,
          cover: track.thumbnail,
          tracks: [track],
        });
    }
    return [...groups.values()];
  }, [tracks]);

  const artists = useMemo(() => {
    const groups = new Map<string, ArtistGroup>();
    for (const track of tracks) {
      const ref = track.artists?.[0];
      const key = ref?.id ?? ref?.name ?? track.artist;
      const group = groups.get(key);
      if (group) group.tracks.push(track);
      else
        groups.set(key, {
          key,
          id: ref?.id ?? null,
          name: ref?.name ?? track.artist,
          cover: track.thumbnail,
          tracks: [track],
        });
    }
    return [...groups.values()];
  }, [tracks]);

  const shownAlbums = albums.filter((album) => matches(album.name, album.artist));
  const shownArtists = artists.filter((artist) => matches(artist.name));
  const shownPlaylists = playlists.filter((playlist) => matches(playlist.name, playlist.description));
  const totalDuration = filtered.reduce((sum, track) => sum + (track.duration || 0), 0);

  const createPlaylist = async () => {
    const playlist = await bridge().playlists.create('New playlist');
    navigate(`/playlist/${playlist.id}`);
  };

  const shuffle = () => {
    const copy = [...filtered];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    void playTracks(copy, 0);
  };

  const songList = (
    <div className="space-y-0.5">
      {filtered.map((track) => (
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
  );

  const songGrid = (
    <CardGrid>
      {filtered.map((track) => (
        <button key={track.id} onClick={() => void playNow(track)} className="group text-left">
          <div className="relative overflow-hidden rounded-xl">
            <AlbumArt src={track.thumbnail} alt={track.title} size={160} rounded="lg" className="w-full" />
            {current?.id === track.id ? (
              <span className="absolute inset-0 flex items-end justify-start bg-black/35 p-2">
                <span className="rounded-full bg-accent px-2 py-0.5 text-[10px] font-semibold text-black">
                  {playing ? 'Playing' : 'Paused'}
                </span>
              </span>
            ) : null}
          </div>
          <p className="mt-2 truncate text-[13px] font-medium">{track.title}</p>
          <p className="truncate text-[11.5px] text-muted">{track.artist}</p>
        </button>
      ))}
    </CardGrid>
  );

  const albumCard = (album: AlbumGroup) => (
    <button
      key={album.key}
      onDoubleClick={() => void playTracks(album.tracks, 0)}
      onClick={() => (album.id ? navigate(`/album/${album.id}`) : void playTracks(album.tracks, 0))}
      className="group w-[150px] shrink-0 snap-start text-left"
    >
      <AlbumArt src={album.cover} alt={album.name} size={150} rounded="lg" className="w-full" />
      <p className="mt-2 truncate text-[13px] font-medium">{album.name}</p>
      <p className="truncate text-[11.5px] text-muted">
        {album.artist} · {album.tracks.length} {album.tracks.length === 1 ? 'song' : 'songs'}
      </p>
    </button>
  );

  const artistCard = (artist: ArtistGroup) => (
    <button
      key={artist.key}
      onClick={() => (artist.id ? navigate(`/artist/${artist.id}`) : void playTracks(artist.tracks, 0))}
      onDoubleClick={() => void playTracks(artist.tracks, 0)}
      className="group w-[150px] shrink-0 snap-start text-center"
    >
      <AlbumArt src={artist.cover} alt={artist.name} size={150} rounded="full" className="mx-auto" />
      <p className="mt-2 truncate text-[13px] font-medium">{artist.name}</p>
      <p className="truncate text-[11.5px] text-muted">
        {artist.tracks.length} {artist.tracks.length === 1 ? 'song' : 'songs'}
      </p>
    </button>
  );

  const playlistCard = (playlist: LibraryPlaylist) => (
    <button
      key={playlist.id}
      onClick={() => navigate(`/playlist/${playlist.id}`)}
      className="group w-[150px] shrink-0 snap-start text-left"
    >
      {covers[playlist.id] ? (
        <AlbumArt src={covers[playlist.id]} alt={playlist.name} size={150} rounded="lg" className="w-full" />
      ) : (
        <div className="flex h-[150px] w-[150px] items-center justify-center rounded-xl bg-surface text-faint transition-colors group-hover:text-accent">
          <ListMusic size={34} strokeWidth={1.5} />
        </div>
      )}
      <p className="mt-2 truncate text-[13px] font-medium">{playlist.name}</p>
      <p className="truncate text-[11.5px] text-muted">
        {playlist.trackCount} {playlist.trackCount === 1 ? 'track' : 'tracks'}
        {playlist.source ? ` · ${playlist.source}` : ''}
      </p>
    </button>
  );

  const likedHero = (
    <div className="mb-8 flex flex-wrap items-center gap-5 rounded-2xl bg-surface/45 p-4">
      <button
        onClick={() => filtered.length && void playTracks(tracks, 0)}
        disabled={!tracks.length}
        className="relative h-[104px] w-[104px] shrink-0 overflow-hidden rounded-xl disabled:opacity-60"
        style={{ background: 'linear-gradient(140deg, var(--accent) 0%, rgba(0,0,0,0.62) 100%)' }}
        aria-label="Play saved songs"
      >
        <Music4 size={40} className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-white/90" />
      </button>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] uppercase tracking-[0.16em] text-muted">Saved songs</p>
        <p className="mt-1 text-[22px] font-semibold tracking-[-0.02em]">
          {tracks.length} {tracks.length === 1 ? 'song' : 'songs'}
        </p>
        <p className="mt-0.5 text-[12px] text-muted">
          {Math.round(tracks.reduce((sum, track) => sum + (track.duration || 0), 0) / 60)} minutes ·{' '}
          {artists.length} {artists.length === 1 ? 'artist' : 'artists'}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <Button size="sm" onClick={() => void playTracks(tracks, 0)} disabled={!tracks.length}>
          <Play size={13} className="fill-black" /> Play
        </Button>
        <Button size="sm" variant="subtle" onClick={shuffle} disabled={!tracks.length}>
          <Shuffle size={13} /> Shuffle
        </Button>
      </div>
    </div>
  );

  const header = (
    <header className="mb-5 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-[28px] font-bold tracking-[-0.03em]">Library</h1>
        <p className="mt-1 text-[12.5px] text-muted">
          {tracks.length} {tracks.length === 1 ? 'track' : 'tracks'} · {albums.length} albums · {artists.length} artists
        </p>
      </div>
      <div className="flex items-center gap-2">
        <Button size="sm" variant="subtle" onClick={() => navigate('/favorites')}>
          <Heart size={13} /> {t('favorites')}
        </Button>
        <Button size="sm" onClick={() => void createPlaylist()}>
          <Plus size={14} className="text-black" /> {t('createPlaylist')}
        </Button>
      </div>
    </header>
  );

  const toolbar = (
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-5">
        {TABS.map((entry) => (
          <button
            key={entry.id}
            onClick={() => setTab(entry.id)}
            className={`relative -mb-px pb-2 pt-1 text-[13.5px] transition-colors duration-200 focus-ring ${
              tab === entry.id ? 'text-text' : 'text-muted hover:text-text/85'
            }`}
          >
            {t(entry.key)}
            <span
              className={`absolute inset-x-0 -bottom-px h-[2px] rounded-full transition-all duration-200 ${
                tab === entry.id ? 'bg-accent opacity-100' : 'opacity-0'
              }`}
            />
          </button>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <div className="relative w-[230px]">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('searchLibrary')}
            className="h-9 w-full rounded-lg bg-surface/70 pl-9 pr-3 text-[13px] outline-none transition-all placeholder:text-faint focus:ring-1 focus:ring-accent/40"
          />
        </div>
        {tab === 'songs' ? (
          <label className="flex h-9 items-center gap-2 rounded-lg bg-surface/70 px-3 text-[12px] text-muted">
            <ArrowDownWideNarrow size={13} />
            <select
              value={sort}
              onChange={(event) => setSort(event.target.value as SortKey)}
              className="bg-transparent text-[12.5px] text-text outline-none"
            >
              {SORTS.map((option) => (
                <option key={option.key} value={option.key} className="bg-[color:var(--bg-elevated)]">
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <div className="flex h-9 items-center rounded-lg bg-surface/70 p-0.5">
          <button
            onClick={() => setView('grid')}
            aria-label="Grid view"
            aria-pressed={view === 'grid'}
            className={`flex h-8 w-8 items-center justify-center rounded-md transition-colors ${
              view === 'grid' ? 'bg-surface-active text-text' : 'text-muted hover:text-text'
            }`}
          >
            <LayoutGrid size={14} />
          </button>
          <button
            onClick={() => setView('list')}
            aria-label="List view"
            aria-pressed={view === 'list'}
            className={`flex h-8 w-8 items-center justify-center rounded-md transition-colors ${
              view === 'list' ? 'bg-surface-active text-text' : 'text-muted hover:text-text'
            }`}
          >
            <List size={14} />
          </button>
        </div>
      </div>
    </div>
  );

  const empty = (
    <EmptyState
      title={tracks.length || playlists.length ? 'Nothing matches that filter' : 'Your library is empty'}
      description={
        tracks.length || playlists.length
          ? 'Try a different title, artist or album.'
          : 'Save tracks from search, or import a playlist to fill this up.'
      }
      action={
        !tracks.length && !playlists.length ? (
          <div className="flex items-center gap-2">
            <Button onClick={() => navigate('/search')}>
              <Search size={14} /> Search music
            </Button>
            <Button variant="subtle" onClick={() => setImportOpen(true)}>
              Import playlist
            </Button>
          </div>
        ) : undefined
      }
    />
  );

  const content = () => {
    if (loading) return <TrackListSkeleton rows={8} />;

    if (tab === 'songs') {
      if (!filtered.length) return empty;
      return (
        <>
          {view === 'list' ? songList : songGrid}
          <p className="mt-6 text-[11.5px] text-faint">
            {filtered.length} tracks · {Math.round(totalDuration / 60)} minutes
          </p>
        </>
      );
    }

    if (tab === 'albums') {
      if (!shownAlbums.length) return empty;
      return <div className="flex flex-wrap gap-x-5 gap-y-7">{shownAlbums.map(albumCard)}</div>;
    }

    if (tab === 'artists') {
      if (!shownArtists.length) return empty;
      return <div className="flex flex-wrap gap-x-5 gap-y-7">{shownArtists.map(artistCard)}</div>;
    }

    if (tab === 'playlists') {
      if (!shownPlaylists.length) {
        return (
          <EmptyState
            title="No playlists yet"
            description="Create one, or paste a link from Spotify, Apple Music, YouTube, SoundCloud or Deezer."
            action={
              <Button onClick={() => setImportOpen(true)}>
                <Plus size={14} /> Import a playlist
              </Button>
            }
          />
        );
      }
      return <div className="flex flex-wrap gap-x-5 gap-y-7">{shownPlaylists.map(playlistCard)}</div>;
    }

    // All
    if (!tracks.length && !playlists.length) return empty;
    return (
      <div className="space-y-10">
        {tracks.length ? likedHero : null}

        {shownAlbums.length ? (
          <section>
            <SectionHeader
              title="Albums"
              action={
                <button onClick={() => setTab('albums')} className="text-[12px] text-muted transition-colors hover:text-accent">
                  See all
                </button>
              }
            />
            <HorizontalScroller>{shownAlbums.slice(0, 10).map(albumCard)}</HorizontalScroller>
          </section>
        ) : null}

        {shownArtists.length ? (
          <section>
            <SectionHeader
              title="Artists"
              action={
                <button onClick={() => setTab('artists')} className="text-[12px] text-muted transition-colors hover:text-accent">
                  See all
                </button>
              }
            />
            <HorizontalScroller>{shownArtists.slice(0, 10).map(artistCard)}</HorizontalScroller>
          </section>
        ) : null}

        {shownPlaylists.length ? (
          <section>
            <SectionHeader
              title="Your playlists"
              action={
                <button onClick={() => setTab('playlists')} className="text-[12px] text-muted transition-colors hover:text-accent">
                  See all
                </button>
              }
            />
            <HorizontalScroller>{shownPlaylists.slice(0, 10).map(playlistCard)}</HorizontalScroller>
          </section>
        ) : null}

        {tracks.length ? (
          <section>
            <SectionHeader
              title="Recently added"
              action={
                <button onClick={() => setTab('songs')} className="text-[12px] text-muted transition-colors hover:text-accent">
                  All songs
                </button>
              }
            />
            <div className="space-y-0.5">
              {filtered.slice(0, 8).map((track) => (
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
          </section>
        ) : null}
      </div>
    );
  };

  return (
    <div className="px-8 pb-12 pt-3">
      {header}
      {toolbar}
      {content()}
    </div>
  );
}

export function PlaylistCoverStack({ covers }: { covers: (string | null)[] }) {
  return (
    <div className="flex gap-1">
      {covers.slice(0, 4).map((cover, i) => (
        <AlbumArt key={i} src={cover} size={64} rounded="md" />
      ))}
    </div>
  );
}
