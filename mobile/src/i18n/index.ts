import { en, type MessageKey, type Messages } from './en';
import { es } from './es';

export type Language = 'en' | 'es';
export type LanguagePreference = 'system' | Language;

export const MESSAGES: Record<Language, Messages> = { en, es };

export type Translate = (
  key: MessageKey,
  params?: Record<string, string | number>,
) => string;

export function interpolate(
  template: string,
  params?: Record<string, string | number>,
): string {
  if (!params) {
    return template;
  }
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = params[name];
    return value === undefined ? match : String(value);
  });
}

export function translate(
  language: Language,
  key: MessageKey,
  params?: Record<string, string | number>,
): string {
  return interpolate(MESSAGES[language][key] ?? en[key], params);
}

export function languageFromLocale(locale: string | null | undefined): Language {
  return locale?.toLowerCase().startsWith('es') ? 'es' : 'en';
}

export function systemLanguage(): Language {
  try {
    return languageFromLocale(Intl.DateTimeFormat().resolvedOptions().locale);
  } catch {
    return 'en';
  }
}

export type { MessageKey, Messages };
