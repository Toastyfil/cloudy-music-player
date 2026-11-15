/** Normalise a KeyboardEvent into the "Ctrl+Shift+KeyX" form settings store. */
export function eventToCombo(event: KeyboardEvent): string | null {
  const parts: string[] = [];
  if (event.ctrlKey || event.metaKey) parts.push('Ctrl');
  if (event.altKey) parts.push('Alt');
  if (event.shiftKey) parts.push('Shift');

  const code = event.code;
  if (!code) return null;
  if (['ControlLeft', 'ControlRight', 'ShiftLeft', 'ShiftRight', 'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight'].includes(code)) {
    return null;
  }
  if (code.startsWith('Key')) parts.push(code);
  else if (code.startsWith('Digit')) parts.push(code);
  else parts.push(code);

  return parts.join('+');
}

export function comboToLabel(combo: string): string {
  return combo
    .replace(/^Key/, '')
    .replace(/^Digit/, '')
    .replace('ArrowLeft', '←')
    .replace('ArrowRight', '→')
    .replace('ArrowUp', '↑')
    .replace('ArrowDown', '↓')
    .replace('Space', 'Space')
    .split('+')
    .join(' + ');
}

export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}
