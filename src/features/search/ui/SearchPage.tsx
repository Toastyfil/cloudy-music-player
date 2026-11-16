import { Loader2, Search as SearchIcon, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import type { AlbumSummary, ArtistSummary, PlaylistSummary, SearchAll, Track } from '@/shared/api/contracts';
import { searchApi } from '@/shared/api/client';
import { AlbumArt } from '@/shared/ui/AlbumArt';
import { TrackRow } from '@/shared/ui/TrackRow';
import { RowMenu } from '@/shared/ui/ContextMenu';
import { EmptyState, SectionHeader, Tabs, TrackListSkeleton } from '@/shared/ui/Misc';
import { usePlayerStore } from '@/features/player/store/playerStore';
import { useTrackMenu } from '@/features/library/hooks/useTrackMenu';
import { useUiStore } from '@/features/navigation/store/uiStore';
import { warmTracks } from '@/features/cache/lib/prefetch';
import { useT } from '@/shared/lib/i18n';
import { cn } from '@/shared/lib/cn';

type Tab = 'all' | 'songs' | 'artists' | 'albums' | 'playlists';

const TABS: { id: Tab; key: 'tabAll' | 'tabSongs' | 'tabArtists' | 'tabAlbums' | 'tabPlaylists' }[] = [
  { id: 'all', key: 'tabAll' },
  { id: 'songs', key: 'tabSongs' },
  { id: 'artists', key: 'tabArtists' },
  { id: 'albums', key: 'tabAlbums' },
  { id: 'playlists', key: 'tabPlaylists' },
];

function useDebounced<T>(value: T, delay = 280) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

function ArtistRow({ artist, onOpen }: { artist: ArtistSummary; onOpen: () => void }) {
  return (
    <button
      onClick={onOpen}
      className="flex h-14 w-full items-center gap-3 rounded-lg px-3 text-left transition-colors hover:bg-surface/70"
    >
      <AlbumArt src={artist.thumbnail} alt={artist.name} size={40} rounded="full" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14px] font-medium">{artist.name}</span>
        <span className="block truncate text-[12.5px] text-muted">Artist</span>
      </span>
    </button>
  );
}

function AlbumRow({ album, onOpen }: { album: AlbumSummary; onOpen: () => void }) {
  return (
    <button
      onClick={onOpen}
      className="flex h-14 w-full items-center gap-3 rounded-lg px-3 text-left transition-colors hover:bg-surface/70"
    >
      <AlbumArt src={album.thumbnail} alt={album.title} size={40} rounded="md" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14px] font-medium">{album.title}</span>
        <span className="block truncate text-[12.5px] text-muted">
          {album.artist}
          {album.year ? ` · ${album.year}` : ''}
        </span>
      </span>
    </button>
  );
}

function PlaylistRow({ playlist, onOpen }: { playlist: PlaylistSummary; onOpen: () => void }) {
  return (
    <button
      onClick={onOpen}
      className="flex h-14 w-full items-center gap-3 rounded-lg px-3 text-left transition-colors hover:bg-surface/70"
    >
      <AlbumArt src={playlist.thumbnail} alt={playlist.title} size={40} rounded="md" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14px] font-medium">{playlist.title}</span>
        <span className="block truncate text-[12.5px] text-muted">{playlist.author || 'Playlist'}</span>
      </span>
    </button>
  );
}

export function SearchPage() {
  // The title-bar field lands here as ?q=…, so the query survives the jump.
  const [params] = useSearchParams();
  const [query, setQuery] = useState(() => params.get('q') ?? '');
  const initialQuery = params.get('q');
  useEffect(() => {
    if (initialQuery) setQuery(initialQuery);
  }, [initialQuery]);
  const [tab, setTab] = useState<Tab>('all');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [songs, setSongs] = useState<Track[]>([]);
  const [artists, setArtists] = useState<ArtistSummary[]>([]);
  const [albums, setAlbums] = useState<AlbumSummary[]>([]);
  const [playlists, setPlaylists] = useState<PlaylistSummary[]>([]);
  const t = useT();
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const menuFor = useTrackMenu();
  const playNow = usePlayerStore((s) => s.playNow);
  const currentTrack = usePlayerStore((s) => s.queue[s.index] ?? null);
  const playing = usePlayerStore((s) => s.playing);
  const focusToken = useUiStore((s) => s.searchFocusToken);

  const debounced = useDebounced(query.trim());

  useEffect(() => {
    if (focusToken > 0) inputRef.current?.focus();
  }, [focusToken]);

  // Every catalog is searched at once, so the only thing a tab changes is which
  // slice of the answer is shown.
  useEffect(() => {
    if (!debounced) {
      setSongs([]);
      setArtists([]);
      setAlbums([]);
      setPlaylists([]);
      setError(null);
      return;
    }
    let cancelled = false;
    const controller = new AbortController();
    setLoading(true);
    setError(null);

    (async () => {
      try {
        if (tab === 'all') {
          const data: SearchAll = await searchApi.all(debounced);
          if (cancelled) return;
          setSongs(data.songs ?? []);
          setArtists(data.artists ?? []);
          setAlbums(data.albums ?? []);
          setPlaylists(data.playlists ?? []);
        } else if (tab === 'songs') {
          const data = await searchApi.songs(debounced);
          if (!cancelled) setSongs(data.results ?? []);
        } else if (tab === 'artists') {
          const data = await searchApi.artists(debounced);
          if (!cancelled) setArtists(data.results ?? []);
        } else if (tab === 'albums') {
          const data = await searchApi.albums(debounced);
          if (!cancelled) setAlbums(data.results ?? []);
        } else {
          const data = await searchApi.playlists(debounced);
          if (!cancelled) setPlaylists(data.results ?? []);
        }
      } catch (err) {
        if (!cancelled && !controller.signal.aborted) {
          setError(err instanceof Error ? err.message : 'Search failed');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [debounced, tab]);

  const showSongs = tab === 'all' || tab === 'songs';
  const showArtists = tab === 'all' || tab === 'artists';
  const showAlbums = tab === 'all' || tab === 'albums';
  const showPlaylists = tab === 'all' || tab === 'playlists';

  const songResults = useMemo(() => (tab === 'all' ? songs.slice(0, 8) : songs), [songs, tab]);

  // Have the top results resolved and downloaded before they are clicked.
  useEffect(() => {
    if (songResults.length) void warmTracks(songResults.slice(0, 4));
  }, [songResults]);

  const hasResults = songs.length || artists.length || albums.length || playlists.length;

  return (
    <div className="mx-auto w-full max-w-[1080px] px-8 pb-10 pt-2">
      <div className="relative">
        <SearchIcon size={17} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-faint" />
        <input
          ref={inputRef}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t('searchPlaceholder')}
          spellCheck={false}
          className={cn(
            'h-11 w-full rounded-xl bg-surface/80 pl-11 pr-10 text-[14px] text-text outline-none transition-all duration-200',
            'placeholder:text-faint focus:bg-surface focus:ring-1 focus:ring-accent/40',
          )}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              setQuery('');
              inputRef.current?.blur();
            }
          }}
        />
        {query ? (
          <button
            onClick={() => setQuery('')}
            className="absolute right-3 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full text-faint hover:bg-surface-hover hover:text-text"
            aria-label="Clear search"
          >
            <X size={14} />
          </button>
        ) : null}
      </div>

      <div className="mt-4 border-b border-line">
        <Tabs tabs={TABS.map((entry) => ({ id: entry.id, label: t(entry.key) }))} value={tab} onChange={setTab} />
      </div>

      {error ? (
        <div className="mt-8 rounded-xl border border-red-500/20 bg-red-500/5 p-4 text-[13px] text-red-300">
          {error}. Make sure the Cloudy backend is running on port 3456.
        </div>
      ) : null}

      {!debounced ? (
        <EmptyState
          title="Search to get started"
          description="One search across YouTube Music, SoundCloud, Deezer and Apple Music — Cloudy matches every hit to the track it plays, without ads."
        />
      ) : loading && !hasResults ? (
        <div className="mt-8">
          <TrackListSkeleton rows={6} />
        </div>
      ) : !hasResults && !loading ? (
        <EmptyState
          title="No results"
          description={`Nothing matched “${debounced}” in any catalog. Try a different spelling.`}
        />
      ) : (
        <div className="mt-6 space-y-10">
          {showSongs && songResults.length > 0 ? (
            <section>
              {tab === 'all' ? <SectionHeader title="Songs" /> : null}
              <div className="space-y-0.5">
                {songResults.map((track) => (
                  <TrackRow
                    key={track.id}
                    track={track}
                    active={currentTrack?.id === track.id}
                    playing={playing}
                    onPlay={() => void playNow(track)}
                    right={<RowMenu items={menuFor(track)} />}
                  />
                ))}
              </div>
            </section>
          ) : null}

          {showArtists && artists.length > 0 ? (
            <section>
              <SectionHeader title="Artists" />
              <div className="grid grid-cols-2 gap-x-6 gap-y-1">
                {(tab === 'all' ? artists.slice(0, 6) : artists).map((artist) => (
                  <ArtistRow key={artist.id} artist={artist} onOpen={() => navigate(`/artist/${artist.id}`)} />
                ))}
              </div>
            </section>
          ) : null}

          {showAlbums && albums.length > 0 ? (
            <section>
              <SectionHeader title="Albums" />
              <div className="grid grid-cols-2 gap-x-6 gap-y-1">
                {(tab === 'all' ? albums.slice(0, 6) : albums).map((album) => (
                  <AlbumRow key={album.id} album={album} onOpen={() => navigate(`/album/${album.id}`)} />
                ))}
              </div>
            </section>
          ) : null}

          {showPlaylists && playlists.length > 0 ? (
            <section>
              <SectionHeader title="Playlists" />
              <div className="grid grid-cols-2 gap-x-6 gap-y-1">
                {(tab === 'all' ? playlists.slice(0, 6) : playlists).map((playlist) => (
                  <PlaylistRow key={playlist.id} playlist={playlist} onOpen={() => navigate(`/playlist/${playlist.id}`)} />
                ))}
              </div>
            </section>
          ) : null}

          {loading ? (
            <div className="flex items-center gap-2 text-[12px] text-faint">
              <Loader2 size={13} className="animate-spin" /> Searching every catalog…
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
