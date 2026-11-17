import {
  apiBaseUrl,
  isSupportedSource,
  normalizeServerUrl,
} from '../src/lib/studyPrep';
import { formatBytes } from '../src/lib/format';

describe('normalizeServerUrl', () => {
  it('adds a scheme and removes trailing slashes', () => {
    expect(normalizeServerUrl('192.168.0.5:8000/')).toBe(
      'http://192.168.0.5:8000',
    );
    expect(normalizeServerUrl(' https://study.example.com/api/ ')).toBe(
      'https://study.example.com/api',
    );
  });

  it('keeps an empty value empty', () => {
    expect(normalizeServerUrl('   ')).toBe('');
  });
});

describe('apiBaseUrl', () => {
  it('appends the API prefix once', () => {
    expect(apiBaseUrl('http://192.168.0.5:8000')).toBe(
      'http://192.168.0.5:8000/api',
    );
    expect(apiBaseUrl('http://192.168.0.5:8000/api/')).toBe(
      'http://192.168.0.5:8000/api',
    );
  });
});

describe('isSupportedSource', () => {
  it('accepts PDF, PPTX, and Markdown names', () => {
    expect(isSupportedSource('notes.pdf')).toBe(true);
    expect(isSupportedSource('SLIDES.PPTX')).toBe(true);
    expect(isSupportedSource('chapter.md')).toBe(true);
    expect(isSupportedSource('chapter.markdown')).toBe(true);
  });

  it('rejects other formats', () => {
    expect(isSupportedSource('notes.docx')).toBe(false);
    expect(isSupportedSource('scan.png')).toBe(false);
  });
});

describe('formatBytes', () => {
  it('formats source sizes', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(50 * 1024 * 1024)).toBe('50 MB');
  });
});
