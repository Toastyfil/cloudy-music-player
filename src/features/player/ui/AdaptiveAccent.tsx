import { useEffect } from 'react';
import { setAccentOverride } from '@/shared/config/themes';
import { accentFromImage } from '@/shared/lib/dominantColor';
import { useSettingsStore } from '@/features/settings/store/settingsStore';
import { selectCurrentTrack, usePlayerStore } from '@/features/player/store/playerStore';

/**
 * Tints the interface with the current cover's dominant hue. Kept as its own
 * component so a track change re-renders nothing but this effect.
 */
export function AdaptiveAccent() {
  const thumbnail = usePlayerStore((state) => selectCurrentTrack(state)?.thumbnail);
  const enabled = useSettingsStore((state) => state.dynamicColor);

  useEffect(() => {
    if (!enabled || !thumbnail) {
      setAccentOverride(null);
      return;
    }
    let cancelled = false;
    void accentFromImage(thumbnail).then((palette) => {
      if (!cancelled) setAccentOverride(palette);
    });
    return () => {
      cancelled = true;
    };
  }, [enabled, thumbnail]);

  return null;
}
