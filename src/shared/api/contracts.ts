export interface ArtistRef {
  id: string | null;
  name: string;
}

export interface Track {
  id: string;
  /** Playable audio id once known; external catalog results resolve it on play. */
  videoId?: string | null;
  title: string;
  displayTitle?: string;
  artist: string;
  artists: ArtistRef[];
  album: { id: string | null; name: string } | null;
  duration: number;
  durationText: string;
  thumbnail: string | null;
  year?: number | null;
  explicit?: boolean;
  /** `youtube-music` (default), `soundcloud`, `deezer` or `apple`. */
  source?: string;
  trackNumber?: number;
}

export interface ArtistSummary {
  id: string;
  name: string;
  thumbnail: string | null;
  subscribers?: string | null;
  kind?: 'artist';
}

export interface AlbumSummary {
  id: string;
  title: string;
  artist: string;
  artists: ArtistRef[];
  year: number | null;
  thumbnail: string | null;
  trackCount?: number | null;
  kind?: 'album';
}

export interface PlaylistSummary {
  id: string;
  title: string;
  author?: string;
  thumbnail: string | null;
  trackCount?: number | null;
  kind?: 'playlist';
}

export interface ArtistPage {
  id: string;
  name: string;
  thumbnail: string | null;
  popular: Track[];
  albums: AlbumSummary[];
  singles: AlbumSummary[];
  related: ArtistSummary[];
}

export interface AlbumPage {
  id: string;
  title: string;
  artist: string;
  artists: ArtistRef[];
  year: number | null;
  thumbnail: string | null;
  trackCount: number;
  duration: number;
  subtitle?: string;
  tracks: Track[];
}

export interface PlaylistPage {
  id: string;
  title: string;
  author?: string;
  thumbnail: string | null;
  trackCount: number;
  tracks: Track[];
}

export interface SearchAll {
  query: string;
  songs: Track[];
  artists: ArtistSummary[];
  albums: AlbumSummary[];
  playlists: PlaylistSummary[];
}

export interface TrackDetail extends Track {
  streamUrl: string | null;
  stream: { mimeType: string; bitrate: number | null; quality: string | null; proxy: string } | null;
}

export type ImportEntry = {
  title: string;
  artist: string;
  artists?: string[];
  duration?: number | null;
  matched: Track | null;
  confidence: number;
};

export type ImportResult = {
  source: string;
  kind: string;
  name: string;
  total: number;
  matchedCount: number;
  tracks?: ImportEntry[];
  resolved?: ImportEntry[];
  playlists?: { id: string; name: string; trackCount: number }[];
};

/** Library record — a track the user has saved, with local cache state. */
export interface LibraryTrack extends Track {
  addedAt: number;
  playCount: number;
  lastPlayedAt: number | null;
  cachedPath: string | null;
}

export interface FavoriteArtist extends ArtistSummary {
  addedAt: number;
}

export interface FavoriteAlbum extends AlbumSummary {
  addedAt: number;
}

export interface LibraryPlaylist {
  id: string;
  name: string;
  description: string;
  cover: string | null;
  trackCount: number;
  createdAt: number;
  updatedAt: number;
  source: string | null;
}

export interface PlayEvent {
  trackId: string;
  playedAt: number;
  seconds: number;
}

export interface LyricsMatch {
  id: number | null;
  trackName: string;
  artistName: string;
  albumName: string;
  duration: number | null;
  instrumental: boolean;
  plainLyrics: string | null;
  syncedLyrics: string | null;
  hasWordSync?: boolean;
}
