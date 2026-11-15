import { ListMusic, Plus, Upload } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { LibraryPlaylist } from '@/shared/api/contracts';
import { bridge } from '@/shared/api/bridge';
import { AlbumArt } from '@/shared/ui/AlbumArt';
import { Button } from '@/shared/ui/Button';
import { CardGrid, EmptyState } from '@/shared/ui/Misc';
import { useUiStore } from '@/features/navigation/store/uiStore';

export function PlaylistsPage() {
  const navigate = useNavigate();
  const [playlists, setPlaylists] = useState<LibraryPlaylist[]>([]);
  const [covers, setCovers] = useState<Record<string, string | null>>({});
  const [loading, setLoading] = useState(true);
  const setImportOpen = useUiStore((s) => s.setImportOpen);

  const load = useCallback(async () => {
    try {
      const list = (await bridge().playlists.all()) as LibraryPlaylist[];
      setPlaylists(list);
      const entries = await Promise.all(
        list.map(async (playlist) => [playlist.id, await bridge().playlists.cover(playlist.id)] as const),
      );
      setCovers(Object.fromEntries(entries));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const create = async () => {
    const playlist = await bridge().playlists.create('New playlist');
    navigate(`/playlist/${playlist.id}`);
  };

  return (
    <div className="px-8 pb-12 pt-3">
      <header className="mb-6 flex items-end justify-between">
        <div>
          <h1 className="text-[28px] font-bold tracking-[-0.03em]">Playlists</h1>
          <p className="mt-1 text-[12.5px] text-muted">{playlists.length} saved</p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="subtle" onClick={() => setImportOpen(true)}>
            <Upload size={13} /> Import
          </Button>
          <Button size="sm" onClick={() => void create()}>
            <Plus size={14} /> New playlist
          </Button>
        </div>
      </header>

      {loading ? null : playlists.length === 0 ? (
        <EmptyState
          title="No playlists yet"
          description="Create one, or paste a link from Spotify, Apple Music, YouTube, SoundCloud or Deezer and Cloudy will match every track."
          action={
            <Button onClick={() => setImportOpen(true)}>
              <Upload size={14} /> Import a playlist
            </Button>
          }
        />
      ) : (
        <CardGrid>
          {playlists.map((playlist) => (
            <button key={playlist.id} onClick={() => navigate(`/playlist/${playlist.id}`)} className="group text-left">
              {covers[playlist.id] ? (
                <AlbumArt src={covers[playlist.id]} alt={playlist.name} size={160} rounded="lg" className="w-full" />
              ) : (
                <div className="flex aspect-square w-full items-center justify-center rounded-xl bg-surface text-faint transition-colors group-hover:text-accent">
                  <ListMusic size={34} strokeWidth={1.5} />
                </div>
              )}
              <p className="mt-2 truncate text-[13px] font-medium">{playlist.name}</p>
              <p className="text-[11.5px] text-muted">
                {playlist.trackCount} {playlist.trackCount === 1 ? 'track' : 'tracks'}
                {playlist.source ? ` · ${playlist.source}` : ''}
              </p>
            </button>
          ))}
        </CardGrid>
      )}
    </div>
  );
}
