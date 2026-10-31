import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { loadSetting, saveSetting } from '../settings';
import { en } from './en';
import { vi, type Strings } from './vi';

export type { Strings };
export type Locale = 'vi' | 'en';

export const LOCALES: Record<Locale, Strings> = { vi, en };

const STORAGE_KEY = 'vg:locale';

// Vietnamese is the default audience; English only when the player picks it.
function initialLocale(): Locale {
  const saved = loadSetting(STORAGE_KEY);
  return saved === 'en' || saved === 'vi' ? saved : 'vi';
}

interface I18n {
  t: Strings;
  locale: Locale;
  setLocale: (locale: Locale) => void;
}

const I18nContext = createContext<I18n | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(initialLocale);
  const t = LOCALES[locale];

  useEffect(() => {
    document.documentElement.lang = locale;
    document.title = t.appName;
  }, [locale, t]);

  const value = useMemo<I18n>(
    () => ({
      t,
      locale,
      setLocale: (next) => {
        saveSetting(STORAGE_KEY, next);
        setLocaleState(next);
      },
    }),
    [t, locale],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18n {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used inside <I18nProvider>');
  return ctx;
}
