import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePlayerStore } from '@/features/player/store/playerStore';
import { useUiStore } from '@/features/navigation/store/uiStore';
import { useSettingsStore, type ShortcutAction } from '@/features/settings/store/settingsStore';
import { eventToCombo, isTypingTarget } from '../lib/keys';

const VOLUME_STEP = 0.05;

/** Map keys to actions. Everything here is rebindable in Settings. */
export function useGlobalShortcuts() {
  const navigate = useNavigate();

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const settings = useSettingsStore.getState();
      const combo = eventToCombo(event);
      if (!combo) return;

      const action = (Object.entries(settings.shortcuts) as [ShortcutAction, string][]).find(
        ([, value]) => value === combo,
      )?.[0];

      const typing = isTypingTarget(event.target);

      // Escape and search-focus always work, even from a field.
      if (action === 'search' || combo === settings.shortcuts.search) {
        event.preventDefault();
        navigate('/search');
        useUiStore.getState().focusSearch();
        return;
      }

      if (typing) {
        if (combo === 'Escape') (event.target as HTMLElement).blur();
        return;
      }

      if (!action) return;
      const player = usePlayerStore.getState();
      const ui = useUiStore.getState();

      switch (action) {
        case 'playPause':
          event.preventDefault();
          void player.toggle();
          break;
        case 'next':
          event.preventDefault();
          void player.next();
          break;
        case 'previous':
          event.preventDefault();
          void player.previous();
          break;
        case 'seekForward':
          event.preventDefault();
          player.seekBy(5);
          break;
        case 'seekBackward':
          event.preventDefault();
          player.seekBy(-5);
          break;
        case 'volumeUp':
          event.preventDefault();
          player.adjustVolume(VOLUME_STEP);
          break;
        case 'volumeDown':
          event.preventDefault();
          player.adjustVolume(-VOLUME_STEP);
          break;
        case 'lyrics':
          event.preventDefault();
          ui.toggleLyrics();
          break;
        case 'queue':
          event.preventDefault();
          ui.toggleQueue();
          break;
        case 'fullscreen':
          event.preventDefault();
          ui.toggleFullscreenLyrics();
          break;
        case 'back':
          if (ui.closeTopLayer()) {
            event.preventDefault();
            break;
          }
          navigate(-1);
          break;
        default:
          break;
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [navigate]);
}
