import { create } from 'zustand';

interface UiState {
  lyricsOpen: boolean;
  queueOpen: boolean;
  fullscreenLyrics: boolean;
  settingsOpen: boolean;
  importOpen: boolean;
  searchFocusToken: number;
  toggleLyrics: (value?: boolean) => void;
  toggleQueue: (value?: boolean) => void;
  toggleFullscreenLyrics: (value?: boolean) => void;
  setSettingsOpen: (value: boolean) => void;
  setImportOpen: (value: boolean) => void;
  focusSearch: () => void;
  closeTopLayer: () => boolean;
}

export const useUiStore = create<UiState>((set, get) => ({
  lyricsOpen: false,
  queueOpen: false,
  fullscreenLyrics: false,
  settingsOpen: false,
  importOpen: false,
  searchFocusToken: 0,

  toggleLyrics(value) {
    const next = value ?? !get().lyricsOpen;
    set({ lyricsOpen: next, queueOpen: next ? false : get().queueOpen });
  },

  toggleQueue(value) {
    const next = value ?? !get().queueOpen;
    set({ queueOpen: next, lyricsOpen: next ? false : get().lyricsOpen });
  },

  toggleFullscreenLyrics(value) {
    const next = value ?? !get().fullscreenLyrics;
    set({ fullscreenLyrics: next, lyricsOpen: next ? true : get().lyricsOpen });
  },

  setSettingsOpen(value) {
    set({ settingsOpen: value });
  },

  setImportOpen(value) {
    set({ importOpen: value });
  },

  focusSearch() {
    set({ searchFocusToken: get().searchFocusToken + 1 });
  },

  /** Escape closes the topmost layer; returns whether something was closed. */
  closeTopLayer() {
    const state = get();
    if (state.settingsOpen) return set({ settingsOpen: false }), true;
    if (state.importOpen) return set({ importOpen: false }), true;
    if (state.fullscreenLyrics) return set({ fullscreenLyrics: false }), true;
    if (state.lyricsOpen) return set({ lyricsOpen: false }), true;
    if (state.queueOpen) return set({ queueOpen: false }), true;
    return false;
  },
}));
