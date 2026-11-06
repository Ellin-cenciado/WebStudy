import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useColorScheme } from 'react-native';
import { preferences } from '../lib/api';

export type Theme = 'light' | 'dark';
export type ThemePreference = 'system' | Theme;

export interface Palette {
  background: string;
  card: string;
  cardAlt: string;
  border: string;
  text: string;
  textMuted: string;
  textFaint: string;
  accent: string;
  accentText: string;
  accentSoft: string;
  accentBorder: string;
  good: string;
  goodSoft: string;
  goodBorder: string;
  warn: string;
  warnSoft: string;
  warnBorder: string;
  danger: string;
  dangerSoft: string;
  dangerBorder: string;
  input: string;
  tab: string;
  shadow: string;
}

const LIGHT: Palette = {
  background: '#f8fafc',
  card: '#ffffff',
  cardAlt: '#f1f5f9',
  border: '#e2e8f0',
  text: '#0f172a',
  textMuted: '#64748b',
  textFaint: '#94a3b8',
  accent: '#4f46e5',
  accentText: '#ffffff',
  accentSoft: '#eef2ff',
  accentBorder: '#c7d2fe',
  good: '#047857',
  goodSoft: '#ecfdf5',
  goodBorder: '#a7f3d0',
  warn: '#b45309',
  warnSoft: '#fffbeb',
  warnBorder: '#fde68a',
  danger: '#b91c1c',
  dangerSoft: '#fef2f2',
  dangerBorder: '#fecaca',
  input: '#ffffff',
  tab: '#ffffff',
  shadow: '#0f172a',
};

const DARK: Palette = {
  background: '#020617',
  card: '#0f172a',
  cardAlt: '#1e293b',
  border: '#1e293b',
  text: '#f8fafc',
  textMuted: '#94a3b8',
  textFaint: '#dddddd',
  accent: '#818cf8',
  accentText: '#1e1b4b',
  accentSoft: '#1e1b4b',
  accentBorder: '#3730a3',
  good: '#34d399',
  goodSoft: '#022c22',
  goodBorder: '#065f46',
  warn: '#fbbf24',
  warnSoft: '#451a03',
  warnBorder: '#92400e',
  danger: '#f87171',
  dangerSoft: '#450a0a',
  dangerBorder: '#991b1b',
  input: '#020617',
  tab: '#0f172a',
  shadow: '#000000',
};

interface ThemeContextValue {
  theme: Theme;
  colors: Palette;
  preference: ThemePreference;
  setPreference: (preference: ThemePreference) => void;
  toggle: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const system = useColorScheme();
  const [preference, setPreferenceState] = useState<ThemePreference>('system');
  const theme: Theme =
    preference === 'system' ? (system === 'dark' ? 'dark' : 'light') : preference;
  const colors = theme === 'dark' ? DARK : LIGHT;

  useEffect(() => {
    let mounted = true;
    void preferences
      .get('theme')
      .then(stored => {
        if (
          mounted &&
          (stored === 'system' || stored === 'light' || stored === 'dark')
        ) {
          setPreferenceState(stored);
        }
      })
      .catch(() => {
        // The system theme remains a safe fallback.
      });
    return () => {
      mounted = false;
    };
  }, []);

  const setPreference = useCallback((next: ThemePreference) => {
    setPreferenceState(next);
    void preferences.set('theme', next).catch(() => {
      // The chosen theme still applies for this session.
    });
  }, []);

  const toggle = useCallback(() => {
    const effective =
      preference === 'system' ? (system === 'dark' ? 'dark' : 'light') : preference;
    setPreference(effective === 'dark' ? 'light' : 'dark');
  }, [preference, setPreference, system]);

  const value = useMemo(
    () => ({ theme, colors, preference, setPreference, toggle }),
    [theme, colors, preference, setPreference, toggle],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext);
  if (value === null) {
    throw new Error('useTheme must be used inside ThemeProvider');
  }
  return value;
}
