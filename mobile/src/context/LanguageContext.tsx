import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  languageFromLocale,
  systemLanguage,
  translate,
  type Language,
  type LanguagePreference,
  type Translate,
} from '../i18n';
import { api, preferences, systemLocale } from '../lib/api';

const LANGUAGE_PREFERENCE = 'language';

interface LanguageContextValue {
  preference: LanguagePreference;
  language: Language;
  setPreference: (preference: LanguagePreference) => void;
  t: Translate;
}

const LanguageContext = createContext<LanguageContextValue | null>(null);

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] =
    useState<LanguagePreference>('system');
  const [system, setSystem] = useState<Language>(() => systemLanguage());

  useEffect(() => {
    let active = true;
    void Promise.all([
      preferences.get(LANGUAGE_PREFERENCE),
      systemLocale().catch(() => null),
    ])
      .then(([stored, locale]) => {
        if (!active) {
          return;
        }
        if (locale) {
          setSystem(languageFromLocale(locale));
        }
        if (stored === 'system' || stored === 'en' || stored === 'es') {
          setPreferenceState(stored);
        }
      })
      .catch(() => {
        // Keep the system locale detected at startup.
      });
    return () => {
      active = false;
    };
  }, []);

  const language = preference === 'system' ? system : preference;

  useEffect(() => {
    void api.setLanguage(language).catch(() => {
      // The embedded engine may not be ready yet; the next poll still works.
    });
  }, [language]);

  const setPreference = useCallback((next: LanguagePreference) => {
    setPreferenceState(next);
    void preferences.set(LANGUAGE_PREFERENCE, next).catch(() => {
      // The in-memory choice still applies for this session.
    });
  }, []);

  const t = useCallback<Translate>(
    (key, params) => translate(language, key, params),
    [language],
  );

  const value = useMemo(
    () => ({ preference, language, setPreference, t }),
    [preference, language, setPreference, t],
  );

  return (
    <LanguageContext.Provider value={value}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage(): LanguageContextValue {
  const value = useContext(LanguageContext);
  if (value === null) {
    throw new Error('useLanguage must be used inside LanguageProvider');
  }
  return value;
}
