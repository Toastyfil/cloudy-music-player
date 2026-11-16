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
  iconWeight: number;
  panelBlur: number;
  highlightButtons: boolean;
  accentIntensity: number;
  tintBackground: boolean;
  meshBrightness: number;
  bannerAnimationSpeed: number;
  bannerFade: number;
};

export function applyInterfaceSettings(settings: InterfaceSettings) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.dataset.reduceMotion = settings.reduceMotion ? 'on' : 'off';
  root.dataset.noHand = settings.noHandCursor ? 'on' : 'off';
  root.dataset.trackNumbers = settings.trackNumbers ? 'on' : 'off';
  root.dataset.iconStyle = settings.iconStyle;
  root.dataset.tint = settings.tintBackground && settings.accentIntensity > 0 ? 'on' : 'off';
  root.style.setProperty('--icon-radius', settings.iconRoundness === 'round' ? '9999px' : '10px');
  root.style.setProperty('--icon-weight', String(settings.iconWeight));
  root.style.setProperty('--panel-blur', `${settings.panelBlur}px`);
  root.style.setProperty('--accent-tint', `${settings.accentIntensity}%`);
  root.style.setProperty('--mesh-brightness', String(settings.meshBrightness / 100));
  root.style.setProperty('--bg-drift-duration', `${settings.bannerAnimationSpeed}s`);
  root.style.setProperty('--banner-fade', `${settings.bannerFade}%`);
  // Primary buttons either take the accent fill or stay neutral; both are CSS
  // variables so the Button component needs no store access of its own.
  root.style.setProperty('--btn-primary-bg', settings.highlightButtons ? 'var(--accent)' : 'var(--surface)');
  root.style.setProperty('--btn-primary-text', settings.highlightButtons ? '#000' : 'var(--text)');
  root.style.setProperty('--ui-scale', String(settings.uiScale));
  root.style.setProperty('--radius-card', `${settings.cornerRadius}px`);
  root.style.setProperty('--radius-xl2', `${settings.cornerRadius + 6}px`);
  root.style.setProperty('--row-h', `${settings.rowSize}px`);
}
