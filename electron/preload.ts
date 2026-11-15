import { contextBridge, ipcRenderer } from 'electron';

// The renderer only ever sees this narrow surface: no node, no ipc handles.
const api = {
  window: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    toggleMaximize: () => ipcRenderer.invoke('window:toggleMaximize'),
    close: () => ipcRenderer.invoke('window:close'),
    quit: () => ipcRenderer.invoke('window:quit'),
    isMaximized: () => ipcRenderer.invoke('window:isMaximized'),
    onState: (cb: (state: { maximized: boolean }) => void) => {
      const handler = (_e: unknown, state: { maximized: boolean }) => cb(state);
      ipcRenderer.on('window:state', handler);
      return () => {
        ipcRenderer.removeListener('window:state', handler);
      };
    },
  },
  library: {
    all: (sort?: string) => ipcRenderer.invoke('library:all', sort),
    search: (q: string) => ipcRenderer.invoke('library:search', q),
    add: (track: unknown) => ipcRenderer.invoke('library:add', track),
    remove: (id: string) => ipcRenderer.invoke('library:remove', id),
    has: (id: string) => ipcRenderer.invoke('library:has', id),
    markPlayed: (id: string, seconds: number) => ipcRenderer.invoke('library:markPlayed', id, seconds),
    recent: (limit?: number) => ipcRenderer.invoke('library:recent', limit),
    mostPlayed: (limit?: number) => ipcRenderer.invoke('library:mostPlayed', limit),
  },
  favorites: {
    ids: () => ipcRenderer.invoke('favorites:ids'),
    all: () => ipcRenderer.invoke('favorites:all'),
    has: (id: string) => ipcRenderer.invoke('favorites:has', id),
    add: (track: unknown) => ipcRenderer.invoke('favorites:add', track),
    remove: (id: string) => ipcRenderer.invoke('favorites:remove', id),
    artists: () => ipcRenderer.invoke('favorites:artists'),
    artistIds: () => ipcRenderer.invoke('favorites:artistIds'),
    addArtist: (artist: unknown) => ipcRenderer.invoke('favorites:addArtist', artist),
    removeArtist: (id: string) => ipcRenderer.invoke('favorites:removeArtist', id),
    albums: () => ipcRenderer.invoke('favorites:albums'),
    albumIds: () => ipcRenderer.invoke('favorites:albumIds'),
    addAlbum: (album: unknown) => ipcRenderer.invoke('favorites:addAlbum', album),
    removeAlbum: (id: string) => ipcRenderer.invoke('favorites:removeAlbum', id),
  },
  playlists: {
    all: () => ipcRenderer.invoke('playlists:all'),
    create: (name: string, description?: string, source?: string | null) =>
      ipcRenderer.invoke('playlists:create', name, description, source),
    rename: (id: string, name: string) => ipcRenderer.invoke('playlists:rename', id, name),
    remove: (id: string) => ipcRenderer.invoke('playlists:remove', id),
    addTrack: (id: string, track: unknown) => ipcRenderer.invoke('playlists:addTrack', id, track),
    removeTrack: (id: string, trackId: string) => ipcRenderer.invoke('playlists:removeTrack', id, trackId),
    tracks: (id: string) => ipcRenderer.invoke('playlists:tracks', id),
    cover: (id: string) => ipcRenderer.invoke('playlists:cover', id),
  },
  settings: {
    all: () => ipcRenderer.invoke('settings:all'),
    set: (key: string, value: unknown) => ipcRenderer.invoke('settings:set', key, value),
  },
  queue: {
    save: (payload: unknown) => ipcRenderer.invoke('queue:save', payload),
    load: () => ipcRenderer.invoke('queue:load'),
  },
  cache: {
    track: (videoId: string, streamUrl: string) => ipcRenderer.invoke('cache:track', videoId, streamUrl),
    path: (videoId: string) => ipcRenderer.invoke('cache:path', videoId),
    stats: () => ipcRenderer.invoke('cache:stats'),
    clear: () => ipcRenderer.invoke('cache:clear'),
    remove: (videoId: string) => ipcRenderer.invoke('cache:remove', videoId),
  },
  presence: {
    update: (payload: unknown) => ipcRenderer.invoke('presence:update', payload),
    clear: () => ipcRenderer.invoke('presence:clear'),
    setEnabled: (value: boolean) => ipcRenderer.invoke('presence:enabled', value),
  },
  shell: {
    openExternal: (url: string) => ipcRenderer.invoke('shell:openExternal', url),
  },
  updates: {
    state: () => ipcRenderer.invoke('update:state'),
    check: (quiet?: boolean) => ipcRenderer.invoke('update:check', quiet),
    install: () => ipcRenderer.invoke('update:install'),
    onState: (cb: (state: unknown) => void) => {
      const handler = (_e: unknown, state: unknown) => cb(state);
      ipcRenderer.on('update:state', handler);
      return () => {
        ipcRenderer.removeListener('update:state', handler);
      };
    },
  },
  app: {
    info: () => ipcRenderer.invoke('app:info'),
    dbStats: () => ipcRenderer.invoke('db:stats'),
    thumbar: (playing: boolean) => ipcRenderer.invoke('media:thumbar', playing),
  },
  events: {
    onMediaAction: (cb: (action: string) => void) => {
      const handler = (_e: unknown, action: string) => cb(action);
      ipcRenderer.on('media:action', handler);
      return () => {
        ipcRenderer.removeListener('media:action', handler);
      };
    },
    onDeeplink: (cb: (route: string) => void) => {
      const handler = (_e: unknown, route: string) => cb(route);
      ipcRenderer.on('deeplink', handler);
      return () => {
        ipcRenderer.removeListener('deeplink', handler);
      };
    },
  },
  isElectron: true,
};

contextBridge.exposeInMainWorld('cloudy', api);

export type CloudyBridge = typeof api;
