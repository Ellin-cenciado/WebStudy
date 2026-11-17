import { en } from '../src/i18n/en';
import { es } from '../src/i18n/es';
import {
  interpolate,
  languageFromLocale,
  translate,
} from '../src/i18n';
import { dayKindLabel, weekdayLabel } from '../src/i18n/labels';

describe('translation catalog', () => {
  it('has the same keys in English and Spanish', () => {
    expect(Object.keys(es).sort()).toEqual(Object.keys(en).sort());
  });

  it('has no empty messages', () => {
    for (const value of Object.values(en)) {
      expect(value.trim()).not.toBe('');
    }
    for (const value of Object.values(es)) {
      expect(value.trim()).not.toBe('');
    }
  });
});

describe('interpolate', () => {
  it('replaces named placeholders', () => {
    expect(interpolate('{hours} of {total}', { hours: '2h', total: '4h' })).toBe(
      '2h of 4h',
    );
  });

  it('leaves unknown placeholders untouched', () => {
    expect(interpolate('{known} {unknown}', { known: 'ok' })).toBe(
      'ok {unknown}',
    );
  });
});

describe('translate', () => {
  it('returns the requested language', () => {
    expect(translate('en', 'tab.timer')).toBe('Timer');
    expect(translate('es', 'tab.timer')).toBe('Cronómetro');
  });

  it('interpolates localized messages', () => {
    expect(
      translate('es', 'timer.remainingOf', {
        remaining: '2 h 00 min',
        required: '4 h 00 min',
      }),
    ).toBe('Quedan 2 h 00 min de 4 h 00 min');
  });
});

describe('languageFromLocale', () => {
  it('detects Spanish locales', () => {
    expect(languageFromLocale('es-AR')).toBe('es');
    expect(languageFromLocale('ES')).toBe('es');
    expect(languageFromLocale('en-US')).toBe('en');
    expect(languageFromLocale(null)).toBe('en');
  });
});

describe('backend label mapping', () => {
  const t = (key: Parameters<typeof translate>[1]) => translate('es', key);

  it('translates weekdays and day kinds', () => {
    expect(weekdayLabel(t, 'Monday')).toBe('Lunes');
    expect(weekdayLabel(t, 'sunday')).toBe('Domingo');
    expect(dayKindLabel(t, 'carried')).toBe('Con arrastre');
    expect(dayKindLabel(t, 'vacation')).toBe('Vacaciones');
  });

  it('falls back to the raw value for unknown labels', () => {
    expect(weekdayLabel(t, 'funday')).toBe('funday');
    expect(dayKindLabel(t, 'custom')).toBe('custom');
  });
});
