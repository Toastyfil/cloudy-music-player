import { Play, Shuffle, Trash2, Upload } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { LibraryPlaylist, PlaylistPage as RemotePlaylist, Track } from '@/shared/api/contracts';
import { bridge } from '@/shared/api/bridge';
import { catalogApi } from '@/shared/api/client';
import { AlbumArt } from '@/shared/ui/AlbumArt';
import { Button } from '@/shared/ui/Button';
import { EmptyState, TrackListSkeleton } from '@/shared/ui/Misc';
import { RowMenu } from '@/shared/ui/ContextMenu';
import { TrackRow } from '@/shared/ui/TrackRow';
import { usePlayerStore } from '@/features/player/store/playerStore';
import { useTrackMenu } from '@/features/library/hooks/useTrackMenu';
import { useUiStore } from '@/features/navigation/store/uiStore';
import { formatTotal } from '@/shared/lib/format';

export function PlaylistPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const isLocal = id.startsWith('pl_');
  const [name, setName] = useState('Playlist');
  const [description, setDescription] = useState('');
  const [tracks, setTracks] = useState<Track[]>([]);
  const [cover, setCover] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const playTracks = usePlayerStore((s) => s.playTracks);
  const current = usePlayerStore((s) => s.queue[s.index] ?? null);
  const playing = usePlayerStore((s) => s.playing);
  const shuffle = usePlayerStore((s) => s.shuffle);
  const menuFor = useTrackMenu();
  const setImportOpen = useUiStore((s) => s.setImportOpen);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (isLocal) {
        const [list, playlists, coverUrl] = await Promise.all([
          bridge().playlists.tracks(id),
          bridge().playlists.all(),
          bridge().playlists.cover(id),
        ]);
        const meta = (playlists as LibraryPlaylist[]).find((p) => p.id === id);
        setName(meta?.name ?? 'Playlist');
        setDescription(meta?.description ?? '');
        setTracks(list as Track[]);
        setCover(coverUrl);
        if (!meta) setError('That playlist no longer exists.');
      } else {
        const remote: RemotePlaylist = await catalogApi.playlist(id);
        setName(remote.title);
        setDescription(remote.author ?? 'YouTube Music');
        setTracks(remote.tracks);
        setCover(remote.thumbnail);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load this playlist');
    } finally {
      setLoading(false);
    }
  }, [id, isLocal]);

  useEffect(() => {
    void load();
  }, [load]);

  const total = tracks.reduce((sum, track) => sum + (track.duration || 0), 0);

  const shufflePlay = () => {
    const copy = [...tracks];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    void playTracks(copy, 0);
  };

  const saveToLibrary = async () => {
    const playlist = await bridge().playlists.create(name || 'Imported playlist', description, 'youtube');
    for (const track of tracks) {
      await bridge().playlists.addTrack(playlist.id, track);
    }
    navigate(`/playlist/${playlist.id}`);
  };

  const rename = async () => {
    if (!editing) {
      setEditing(true);
      return;
    }
    if (isLocal) await bridge().playlists.rename(id, name.trim() || 'Playlist');
    setEditing(false);
  };

  const remove = async () => {
    await bridge().playlists.remove(id);
    navigate('/playlists');
  };

  if (loading) {
    return (
      <div className="px-8 pt-6">
        <div className="mb-8 flex items-end gap-6">
          <div className="h-[180px] w-[180px] animate-pulse rounded-xl bg-surface" />
          <div className="space-y-3">
            <div className="h-3 w-20 animate-pulse rounded bg-surface" />
            <div className="h-8 w-64 animate-pulse rounded bg-surface" />
          </div>
        </div>
        <TrackListSkeleton rows={8} />
      </div>
    );
  }

  if (error) {
    return <EmptyState title="Playlist unavailable" description={error} />;
  }

  return (
    <div className="px-8 pb-12 pt-2">
      <header className="flex items-end gap-6">
        {cover ? (
          <AlbumArt src={cover} alt={name} size={180} rounded="lg" className="shadow-[var(--shadow)]" />
        ) : (
          <div className="flex h-[180px] w-[180px] items-center justify-center rounded-xl bg-surface text-faint">
            <Play size={40} strokeWidth={1.2} />
          </div>
        )}
        <div className="min-w-0 pb-1">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted">Playlist</p>
          {editing ? (
            <input
              autoFocus
              value={name}
              onChange={(event) => setName(event.target.value)}
              onBlur={() => void rename()}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void rename();
              }}
              className="mt-1 w-full rounded-md bg-surface px-2 py-1 text-[32px] font-bold tracking-[-0.03em] outline-none ring-1 ring-accent/40"
            />
          ) : (
            <h1
              onDoubleClick={() => void rename()}
              className="mt-1 max-w-[560px] truncate text-[32px] font-bold leading-[1.1] tracking-[-0.03em]"
              title={isLocal ? 'Double-click to rename' : undefined}
            >
              {name}
            </h1>
          )}
          <p className="mt-2 text-[12.5px] text-muted">
            {description ? <span>{description} · </span> : null}
            {tracks.length} tracks · {formatTotal(total)}
            {!isLocal ? <span className="text-faint"> · YouTube Music</span> : null}
          </p>
          <div className="mt-5 flex flex-wrap items-center gap-2">
            <Button size="lg" onClick={() => void playTracks(tracks, 0)} disabled={!tracks.length}>
              <Play size={15} className="fill-black" /> Play All
            </Button>
            <Button size="lg" variant="subtle" onClick={shufflePlay} disabled={!tracks.length}>
              <Shuffle size={15} /> Shuffle
            </Button>
            {!isLocal ? (
              <Button size="lg" variant="outline" onClick={() => void saveToLibrary()} disabled={!tracks.length}>
                Save to Library
              </Button>
            ) : (
              <Button size="lg" variant="outline" onClick={() => void remove()}>
                <Trash2 size={14} /> Delete
              </Button>
            )}
            <Button size="lg" variant="ghost" onClick={() => setImportOpen(true)}>
              <Upload size={14} /> Import
            </Button>
          </div>
        </div>
      </header>

      <section className="mt-8">
        {tracks.length === 0 ? (
          <EmptyState
            title="This playlist is empty"
            description="Search for music and use the ⋮ menu to add tracks here."
            action={<Button onClick={() => navigate('/search')}>Find music</Button>}
          />
        ) : (
          <div className="space-y-0.5">
            {tracks.map((track) => (
              <TrackRow
                key={track.id}
                track={track}
                active={current?.id === track.id}
                playing={playing || shuffle}
                onPlay={() => {
                  const index = tracks.findIndex((t) => t.id === track.id);
                  void playTracks(tracks, Math.max(0, index));
                }}
                right={<RowMenu items={menuFor(track, isLocal ? { inLibrary: true } : undefined)} />}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
