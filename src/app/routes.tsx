import { Route, Routes } from 'react-router-dom';
import { HomePage } from '@/features/home/ui/HomePage';
import { SearchPage } from '@/features/search/ui/SearchPage';
import { LibraryPage } from '@/features/library/ui/LibraryPage';
import { FavoritesPage } from '@/features/favorites/ui/FavoritesPage';
import { PlaylistsPage } from '@/features/library/ui/PlaylistsPage';
import { PlaylistPage } from '@/features/library/ui/PlaylistPage';
import { ArtistPage } from '@/features/artist/ui/ArtistPage';
import { AlbumPage } from '@/features/album/ui/AlbumPage';
import { EmptyState } from '@/shared/ui/Misc';

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/search" element={<SearchPage />} />
      <Route path="/favorites" element={<FavoritesPage />} />
      <Route path="/library" element={<LibraryPage />} />
      <Route path="/playlists" element={<PlaylistsPage />} />
      <Route path="/playlist/:id" element={<PlaylistPage />} />
      <Route path="/artist/:id" element={<ArtistPage />} />
      <Route path="/album/:id" element={<AlbumPage />} />
      <Route path="*" element={<EmptyState title="Nothing here" description="That page does not exist in Cloudy." />} />
    </Routes>
  );
}
