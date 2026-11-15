import { Disc3, Heart, ListEnd, ListPlus, User, Trash2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useCallback } from 'react';
import type { Track } from '@/shared/api/contracts';
import type { MenuItem } from '@/shared/ui/ContextMenu';
import { isExternalTrack } from '@/shared/config/sources';
import { usePlayerStore } from '@/features/player/store/playerStore';
import { useFavoritesStore } from '@/features/favorites/store/favoritesStore';
import { bridge } from '@/shared/api/bridge';

/** The shared ⋮ menu every track row uses. */
export function useTrackMenu() {
  const navigate = useNavigate();
  const enqueue = usePlayerStore((s) => s.enqueue);
  const playNow = usePlayerStore((s) => s.playNow);
  const favorites = useFavoritesStore((s) => s.ids);
  const toggleFavorite = useFavoritesStore((s) => s.toggle);

  return useCallback(
    (track: Track, options?: { inLibrary?: boolean; onRemoved?: () => void }): MenuItem[] => {
      const favorite = favorites.includes(track.id);
      const external = isExternalTrack(track);
      const items: MenuItem[] = [
        {
          label: favorite ? 'Remove from Favorites' : 'Add to Favorites',
          icon: Heart,
          onSelect: () => void toggleFavorite(track),
        },
        { label: 'Play now', icon: ListPlus, onSelect: () => void playNow(track) },
        { label: 'Play next', icon: ListEnd, onSelect: () => enqueue(track, 'next') },
        { label: 'Add to Queue', icon: ListPlus, onSelect: () => enqueue(track, 'end') },
        {
          label: options?.inLibrary ? 'Remove from Library' : 'Add to Library',
          icon: options?.inLibrary ? Trash2 : Heart,
          onSelect: async () => {
            if (options?.inLibrary) {
              await bridge().library.remove(track.id);
              // Deleting the library row cascades to favorites in the database.
              useFavoritesStore.getState().forgetTrack(track.id);
              options.onRemoved?.();
            } else {
              await bridge().library.add(track);
            }
          },
        },
      ];
      // External catalogs keep their own artist and album ids, which Cloudy's
      // catalog pages cannot open.
      if (!external && track.album?.id) {
        items.push({ label: 'Go to Album', icon: Disc3, onSelect: () => navigate(`/album/${track.album!.id}`) });
      }
      const artistId = track.artists?.[0]?.id;
      if (!external && artistId) {
        items.push({ label: 'Go to Artist', icon: User, onSelect: () => navigate(`/artist/${artistId}`) });
      }
      return items;
    },
    [enqueue, favorites, navigate, playNow, toggleFavorite],
  );
}
