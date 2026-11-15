import { Play, Shuffle, Clock3 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { AlbumSummary, Track } from '@/shared/api/contracts';
import { catalogApi, searchApi } from '@/shared/api/client';
import { useAsync } from '@/shared/hooks/useAsync';
import { AlbumArt } from '@/shared/ui/AlbumArt';
import { Button } from '@/shared/ui/Button';
import { EmptyState, HorizontalScroller, SectionHeader, Skeleton, TrackListSkeleton } from '@/shared/ui/Misc';
import { RowMenu } from '@/shared/ui/ContextMenu';
import { usePlayerStore } from '@/features/player/store/playerStore';
import { useTrackMenu } from '@/features/library/hooks/useTrackMenu';
import { useFavoritesStore } from '@/features/favorites/store/favoritesStore';
import { FavoriteButton } from '@/features/favorites/ui/FavoriteButton';
import { formatTime, formatTotal } from '@/shared/lib/format';
import { AlbumCard } from '@/features/artist/ui/ArtistPage';
import { prefetchTracks } from '@/features/cache/lib/prefetch';

export function AlbumPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { data, loading, error } = useAsync(() => catalogApi.album(id), [id]);
  const playTracks = usePlayerStore((s) => s.playTracks);
  const current = usePlayerStore((s) => s.queue[s.index] ?? null);
  const playing = usePlayerStore((s) => s.playing);
  const menuFor = useTrackMenu();
  const saved = useFavoritesStore((s) => s.albumIds.includes(id));
  const toggleAlbum = useFavoritesStore((s) => s.toggleAlbum);
  const [more, setMore] = useState<AlbumSummary[]>([]);

  useEffect(() => {
    if (data?.tracks?.length) prefetchTracks(data.tracks.slice(0, 3).map((track) => track.id));
  }, [data]);

  useEffect(() => {
    let cancelled = false;
    if (!data?.artist) {
      setMore([]);
      return;
    }
    (async () => {
      try {
        const found = await searchApi.artists(data.artist);
        const artistId = (found.results ?? []).find((a) => a.name.toLowerCase() === data.artist.toLowerCase())?.id;
        if (!artistId) return;
        const page = await catalogApi.artist(artistId);
        if (!cancelled) setMore(page.albums.filter((album) => album.id !== data.id).slice(0, 10));
      } catch {
        /* "More by" is optional */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [data?.artist, data?.id]);

  if (loading) {
    return (
      <div className="px-8 pt-6">
        <div className="flex items-end gap-6">
          <Skeleton className="h-[200px] w-[200px] rounded-xl" />
          <div className="flex-1 space-y-3">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-9 w-72" />
            <Skeleton className="h-3 w-40" />
          </div>
        </div>
        <div className="mt-10">
          <TrackListSkeleton rows={8} />
        </div>
      </div>
    );
  }

  if (error || !data) {
    return <EmptyState title="Album unavailable" description={error ?? 'This album could not be loaded.'} />;
  }

  const shuffle = () => {
    const copy = [...data.tracks];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    void playTracks(copy, 0);
  };

  const playAt = (track: Track) => {
    const index = data.tracks.findIndex((t) => t.id === track.id);
    void playTracks(data.tracks, Math.max(0, index));
  };

  return (
    <div className="px-8 pb-12 pt-2">
      <header className="flex items-end gap-6">
        <AlbumArt src={data.thumbnail} alt={data.title} size={200} rounded="lg" className="shadow-[var(--shadow)]" />
        <div className="min-w-0 pb-2">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted">Album</p>
          <h1 className="mt-1 max-w-[620px] truncate text-[34px] font-bold leading-[1.08] tracking-[-0.03em]">{data.title}</h1>
          <p className="mt-2 text-[13px] text-muted">
            <button
              onClick={() => {
                const artistId = data.artists?.[0]?.id;
                if (artistId) navigate(`/artist/${artistId}`);
              }}
              className="font-medium text-text/85 transition-colors hover:text-accent"
            >
              {data.artist}
            </button>
            {data.year ? <span className="text-faint"> · {data.year}</span> : null}
            <span className="text-faint">
              {' '}
              · {data.trackCount} tracks · {formatTotal(data.duration || 0)}
            </span>
          </p>
          <div className="mt-5 flex items-center gap-2">
            <Button size="lg" onClick={() => void playTracks(data.tracks, 0)} disabled={!data.tracks.length}>
              <Play size={15} className="fill-black" /> Play All
            </Button>
            <Button size="lg" variant="subtle" onClick={shuffle} disabled={!data.tracks.length}>
              <Shuffle size={15} /> Shuffle
            </Button>
            <FavoriteButton
              active={saved}
              label="Save album"
              activeLabel="Saved"
              onToggle={() =>
                void toggleAlbum({
                  id: data.id,
                  title: data.title,
                  artist: data.artist,
                  artists: data.artists,
                  year: data.year,
                  thumbnail: data.thumbnail,
                  trackCount: data.trackCount,
                })
              }
            />
          </div>
        </div>
      </header>

      <section className="mt-9">
        <div className="mb-2 flex items-center gap-3 border-b border-line px-3 pb-2 text-[11px] uppercase tracking-[0.14em] text-faint">
          <span className="w-6 text-right">#</span>
          <span className="flex-1">Title</span>
          <Clock3 size={12} />
        </div>
        {data.tracks.map((track, index) => {
          const active = current?.id === track.id;
          return (
            <div
              key={`${track.id}-${index}`}
              role="button"
              tabIndex={0}
              onClick={() => playAt(track)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') playAt(track);
              }}
              className={`group flex h-12 items-center gap-3 rounded-md px-3 transition-colors ${
                active ? 'bg-accent-soft' : 'hover:bg-surface/70'
              }`}
            >
              <span className={`w-6 text-right text-[12.5px] tabular-nums ${active ? 'text-accent' : 'text-faint'}`}>
                {active && playing ? <span className="inline-block h-2 w-2 rounded-full bg-accent" /> : (track.trackNumber ?? index + 1)}
              </span>
              <span className="min-w-0 flex-1">
                <span className={`block truncate text-[13.5px] ${active ? 'font-semibold text-accent' : 'font-medium'}`}>
                  {track.title}
                </span>
                <span className="block truncate text-[11.5px] text-muted">{track.artist}</span>
              </span>
              <span className="text-[12px] tabular-nums text-muted">{formatTime(track.duration)}</span>
              <span className="flex w-7 justify-end opacity-0 transition-opacity group-hover:opacity-100">
                <RowMenu items={menuFor(track)} />
              </span>
            </div>
          );
        })}
      </section>

      {more.length ? (
        <section className="mt-10">
          <SectionHeader title={`More by ${data.artist}`} />
          <HorizontalScroller>
            {more.map((album) => (
              <AlbumCard key={album.id} album={album} onOpen={() => navigate(`/album/${album.id}`)} />
            ))}
          </HorizontalScroller>
        </section>
      ) : null}
    </div>
  );
}
