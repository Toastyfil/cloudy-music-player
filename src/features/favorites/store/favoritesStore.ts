import { create } from 'zustand';
import type { AlbumSummary, ArtistSummary, Track } from '@/shared/api/contracts';
import { bridge } from '@/shared/api/bridge';

/**
 * Favorites are what the user pressed a heart on: songs, artists and albums.
 * Tracks are kept separate from the library (which also holds everything saved
 * through playlists and imports); an artist or album favorite is just a
 * bookmark. The id lists load once so every row, card and page header can show
 * its filled heart without an IPC call of its own.
 */
interface FavoritesState {
  ids: string[];
  artistIds: string[];
  albumIds: string[];
  loaded: boolean;
  load: () => Promise<void>;
  has: (id?: string | null) => boolean;
  hasArtist: (id?: string | null) => boolean;
  hasAlbum: (id?: string | null) => boolean;
  toggle: (track: Track) => Promise<boolean>;
  toggleArtist: (artist: ArtistSummary) => Promise<boolean>;
  toggleAlbum: (album: AlbumSummary) => Promise<boolean>;
  /** Drop a track locally, e.g. after it was removed from the library. */
  forgetTrack: (id: string) => void;
}

export const useFavoritesStore = create<FavoritesState>((set, get) => ({
  ids: [],
  artistIds: [],
  albumIds: [],
  loaded: false,

  async load() {
    const [tracks, artists, albums] = await Promise.allSettled([
      bridge().favorites.ids(),
      bridge().favorites.artistIds(),
      bridge().favorites.albumIds(),
    ]);
    set({
      ids: tracks.status === 'fulfilled' && Array.isArray(tracks.value) ? tracks.value : [],
      artistIds: artists.status === 'fulfilled' && Array.isArray(artists.value) ? artists.value : [],
      albumIds: albums.status === 'fulfilled' && Array.isArray(albums.value) ? albums.value : [],
      loaded: true,
    });
  },

  has(id) {
    return Boolean(id) && get().ids.includes(id as string);
  },

  hasArtist(id) {
    return Boolean(id) && get().artistIds.includes(id as string);
  },

  hasAlbum(id) {
    return Boolean(id) && get().albumIds.includes(id as string);
  },

  async toggle(track) {
    const active = get().ids.includes(track.id);
    if (active) {
      await bridge().favorites.remove(track.id);
      set({ ids: get().ids.filter((id) => id !== track.id) });
      return false;
    }
    await bridge().favorites.add(track);
    set({ ids: [track.id, ...get().ids.filter((id) => id !== track.id)] });
    return true;
  },

  async toggleArtist(artist) {
    const active = get().artistIds.includes(artist.id);
    if (active) {
      await bridge().favorites.removeArtist(artist.id);
      set({ artistIds: get().artistIds.filter((id) => id !== artist.id) });
      return false;
    }
    await bridge().favorites.addArtist(artist);
    set({ artistIds: [artist.id, ...get().artistIds.filter((id) => id !== artist.id)] });
    return true;
  },

  async toggleAlbum(album) {
    const active = get().albumIds.includes(album.id);
    if (active) {
      await bridge().favorites.removeAlbum(album.id);
      set({ albumIds: get().albumIds.filter((id) => id !== album.id) });
      return false;
    }
    await bridge().favorites.addAlbum(album);
    set({ albumIds: [album.id, ...get().albumIds.filter((id) => id !== album.id)] });
    return true;
  },

  forgetTrack(id) {
    if (!get().ids.includes(id)) return;
    set({ ids: get().ids.filter((trackId) => trackId !== id) });
  },
}));
