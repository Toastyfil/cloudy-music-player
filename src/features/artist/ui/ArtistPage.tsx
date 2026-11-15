import { Play, Shuffle } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import type { AlbumSummary, ArtistSummary, Track } from '@/shared/api/contracts';
import { catalogApi } from '@/shared/api/client';
import { useAsync } from '@/shared/hooks/useAsync';
import { AlbumArt } from '@/shared/ui/AlbumArt';
import { Button } from '@/shared/ui/Button';
import { EmptyState, HorizontalScroller, SectionHeader, Skeleton, TrackListSkeleton } from '@/shared/ui/Misc';
import { TrackRow } from '@/shared/ui/TrackRow';
import { RowMenu } from '@/shared/ui/ContextMenu';
import { usePlayerStore } from '@/features/player/store/playerStore';
import { useTrackMenu } from '@/features/library/hooks/useTrackMenu';
import { useFavoritesStore } from '@/features/favorites/store/favoritesStore';
import { FavoriteButton } from '@/features/favorites/ui/FavoriteButton';
import { prefetchTracks } from '@/features/cache/lib/prefetch';
import { useEffect } from 'react';

function shuffleCopy<T>(items: T[]) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export function AlbumCard({ album, onOpen }: { album: AlbumSummary; onOpen: () => void }) {
  return (
    <button onClick={onOpen} className="group w-[150px] shrink-0 snap-start text-left">
      <div className="relative overflow-hidden rounded-xl">
        <AlbumArt src={album.thumbnail} alt={album.title} size={150} rounded="lg" className="transition-transform duration-300 group-hover:scale-[1.03]" />
      </div>
      <p className="mt-2 truncate text-[13px] font-medium">{album.title}</p>
      <p className="truncate text-[11.5px] text-muted">{album.year ?? 'Album'}</p>
    </button>
  );
}

export function ArtistPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { data, loading, error } = useAsync(() => catalogApi.artist(id), [id]);
  const playTracks = usePlayerStore((s) => s.playTracks);
  const playNow = usePlayerStore((s) => s.playNow);
  const current = usePlayerStore((s) => s.queue[s.index] ?? null);
  const playing = usePlayerStore((s) => s.playing);
  const menuFor = useTrackMenu();
  const following = useFavoritesStore((s) => s.artistIds.includes(id));
  const toggleArtist = useFavoritesStore((s) => s.toggleArtist);

  useEffect(() => {
    if (data?.popular?.length) prefetchTracks(data.popular.slice(0, 3).map((track) => track.id));
  }, [data]);

  if (loading) {
    return (
      <div className="px-8 pt-6">
        <div className="flex items-end gap-6">
          <Skeleton className="h-[150px] w-[150px] rounded-full" />
          <div className="flex-1 space-y-3">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-9 w-64" />
          </div>
        </div>
        <div className="mt-10">
          <TrackListSkeleton rows={6} />
        </div>
      </div>
    );
  }

  if (error || !data) {
    return <EmptyState title="Artist unavailable" description={error ?? 'This artist could not be loaded.'} />;
  }

  const playAll = (tracks: Track[], shuffled = false) => {
    if (!tracks.length) return;
    void playTracks(shuffled ? shuffleCopy(tracks) : tracks, 0);
  };

  const related: ArtistSummary[] = data.related;

  return (
    <div className="px-8 pb-12 pt-2">
      <header className="flex items-end gap-6">
        <AlbumArt src={data.thumbnail} alt={data.name} size={150} rounded="full" className="shadow-[var(--shadow)]" />
        <div className="min-w-0 pb-2">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted">Artist</p>
          <h1 className="mt-1 truncate text-[40px] font-bold leading-[1.05] tracking-[-0.03em]">{data.name}</h1>
          <div className="mt-5 flex items-center gap-2">
            <Button size="lg" onClick={() => playAll(data.popular)} disabled={!data.popular.length}>
              <Play size={15} className="fill-black" /> Play All
            </Button>
            <Button size="lg" variant="subtle" onClick={() => playAll(data.popular, true)} disabled={!data.popular.length}>
              <Shuffle size={15} /> Shuffle
            </Button>
            <FavoriteButton
              active={following}
              label="Follow"
              activeLabel="Following"
              onToggle={() => void toggleArtist({ id: data.id, name: data.name, thumbnail: data.thumbnail })}
            />
          </div>
        </div>
      </header>

      {data.popular.length ? (
        <section className="mt-10">
          <SectionHeader title="Popular" />
          <div className="space-y-0.5">
            {data.popular.map((track, index) => (
              <TrackRow
                key={track.id}
                track={track}
                index={index}
                active={current?.id === track.id}
                playing={playing}
                onPlay={() => void playNow(track)}
                subtitleOverride={undefined}
                right={<RowMenu items={menuFor(track)} />}
              />
            ))}
          </div>
        </section>
      ) : null}

      {data.albums.length ? (
        <section className="mt-10">
          <SectionHeader title="Albums" />
          <HorizontalScroller>
            {data.albums.map((album) => (
              <AlbumCard key={album.id} album={album} onOpen={() => navigate(`/album/${album.id}`)} />
            ))}
          </HorizontalScroller>
        </section>
      ) : null}

      {data.singles.length ? (
        <section className="mt-8">
          <SectionHeader title="Singles" />
          <HorizontalScroller>
            {data.singles.map((album) => (
              <AlbumCard key={album.id} album={album} onOpen={() => navigate(`/album/${album.id}`)} />
            ))}
          </HorizontalScroller>
        </section>
      ) : null}

      {related.length ? (
        <section className="mt-8">
          <SectionHeader title="Related Artists" />
          <HorizontalScroller>
            {related.map((artist) => (
              <button
                key={artist.id}
                onClick={() => navigate(`/artist/${artist.id}`)}
                className="group w-[124px] shrink-0 snap-start text-center"
              >
                <AlbumArt src={artist.thumbnail} alt={artist.name} size={124} rounded="full" className="transition-transform duration-300 group-hover:scale-[1.03]" />
                <p className="mt-2 truncate text-[12.5px] font-medium">{artist.name}</p>
                <p className="text-[11px] text-muted">Artist</p>
              </button>
            ))}
          </HorizontalScroller>
        </section>
      ) : null}
    </div>
  );
}
