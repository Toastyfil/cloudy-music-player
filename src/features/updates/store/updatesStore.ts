import { create } from 'zustand';
import { bridge, type UpdateStatus } from '@/shared/api/bridge';

interface UpdatesState extends UpdateStatus {
  /** The user asked to be left alone until the next launch. */
  dismissed: boolean;
  installError: string | null;
  apply: (status: UpdateStatus) => void;
  dismiss: () => void;
  install: () => Promise<void>;
}

export const useUpdatesStore = create<UpdatesState>((set, get) => ({
  phase: 'idle',
  dismissed: false,
  installError: null,

  apply(status) {
    const previous = get();
    // A freshly finished download re-opens the prompt even if an earlier one
    // was dismissed, but progress ticks of that same download must not.
    const dismissed = status.phase === 'ready' && previous.phase !== 'ready' ? false : previous.dismissed;
    set({ ...status, dismissed, installError: null });
  },

  dismiss() {
    set({ dismissed: true });
  },

  async install() {
    const result = await bridge().updates.install();
    if (!result.ok) set({ installError: result.error ?? 'Could not start the installer' });
  },
}));
