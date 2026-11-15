import { useSyncExternalStore } from 'react';
import {
  DEFAULT_LOCALE,
  LOCALES,
  localeDirection,
  translate,
  type Locale,
  type TranslationKey,
} from '@/shared/config/locales';

let current: Locale = DEFAULT_LOCALE;
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function normalizeLocale(value: unknown): Locale {
  return typeof value === 'string' && LOCALES.some((entry) => entry.id === value) ? (value as Locale) : DEFAULT_LOCALE;
}

/** Apply a locale to the document and re-render every translated string. */
export function setLocale(locale: Locale) {
  current = normalizeLocale(locale);
  const root = document.documentElement;
  root.lang = current;
  root.dir = localeDirection(current);
  for (const listener of listeners) listener();
}

export function getLocale() {
  return current;
}

/** `const t = useT(); t('library')` — re-renders when the language changes. */
export function useT() {
  const locale = useSyncExternalStore(subscribe, getLocale, getLocale);
  return (key: TranslationKey) => translate(locale, key);
}
