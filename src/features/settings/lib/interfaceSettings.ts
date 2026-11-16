/**
 * Riff-style interface switches, expressed as attributes and variables on
 * <html> so a change costs one style recalculation instead of a re-render of
 * the whole tree. Everything here is read back by `globals.css`.
 */
export type InterfaceSettings = {
  reduceMotion: boolean;
  noHandCursor: boolean;
  uiScale: number;
  cornerRadius: number;
  rowSize: number;
  trackNumbers: boolean;
  iconStyle: 'line' | 'solid';
  iconRoundness: 'round' | 'soft';
};

export function applyInterfaceSettings(settings: InterfaceSettings) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.dataset.reduceMotion = settings.reduceMotion ? 'on' : 'off';
  root.dataset.noHand = settings.noHandCursor ? 'on' : 'off';
  root.dataset.trackNumbers = settings.trackNumbers ? 'on' : 'off';
  root.dataset.iconStyle = settings.iconStyle;
  root.style.setProperty('--icon-radius', settings.iconRoundness === 'round' ? '9999px' : '10px');
  root.style.setProperty('--ui-scale', String(settings.uiScale));
  root.style.setProperty('--radius-card', `${settings.cornerRadius}px`);
  root.style.setProperty('--radius-xl2', `${settings.cornerRadius + 6}px`);
  root.style.setProperty('--row-h', `${settings.rowSize}px`);
}
