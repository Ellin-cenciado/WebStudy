import type {
  StudyPrepConfig,
  StudyPrepDepth,
  StudyPrepLanguage,
  StudyPrepResult,
  StudyPrepRun,
} from './types';

export const SUPPORTED_SOURCE = /\.(pdf|pptx|md|markdown)$/i;
export const MAX_SOURCE_FILES = 10;

export interface PickedSource {
  uri: string;
  name: string;
  type: string;
  size: number | null;
}

export interface StudyPrepCreateInput {
  notes: string;
  language: StudyPrepLanguage;
  depth: StudyPrepDepth;
  targetMinutes: number | null;
  files: PickedSource[];
}

export class StudyPrepApiError extends Error {
  status: number;
  code: string | null;
  hint: string | null;

  constructor(
    message: string,
    status: number,
    details: { code?: string | null; hint?: string | null } = {},
  ) {
    super(message);
    this.name = 'StudyPrepApiError';
    this.status = status;
    this.code = details.code ?? null;
    this.hint = details.hint ?? null;
  }
}

export function normalizeServerUrl(raw: string): string {
  let value = raw.trim();
  if (!value) {
    return '';
  }
  if (!/^https?:\/\//i.test(value)) {
    value = `http://${value}`;
  }
  return value.replace(/\/+$/, '');
}

export function apiBaseUrl(server: string): string {
  const root = normalizeServerUrl(server);
  if (!root) {
    return '';
  }
  return /\/api$/i.test(root) ? root : `${root}/api`;
}

export function isSupportedSource(name: string): boolean {
  return SUPPORTED_SOURCE.test(name);
}

export function sourceMime(name: string): string {
  const lower = name.toLowerCase();
  if (lower.endsWith('.pdf')) {
    return 'application/pdf';
  }
  if (lower.endsWith('.pptx')) {
    return 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
  }
  return 'text/markdown';
}

function messageFromBody(body: unknown): {
  message: string | null;
  code: string | null;
  hint: string | null;
} {
  if (typeof body === 'string') {
    return { message: body, code: null, hint: null };
  }
  if (!body || typeof body !== 'object') {
    return { message: null, code: null, hint: null };
  }
  const record = body as Record<string, unknown>;
  let message: string | null = null;
  if (typeof record.detail === 'string') {
    message = record.detail;
  } else if (Array.isArray(record.detail)) {
    message =
      record.detail
        .map(entry => {
          if (entry && typeof entry === 'object') {
            const item = entry as Record<string, unknown>;
            const location = Array.isArray(item.loc) ? item.loc.join('.') : '';
            const text = typeof item.msg === 'string' ? item.msg : '';
            return location ? `${location}: ${text}` : text;
          }
          return String(entry);
        })
        .filter(Boolean)
        .join('; ') || null;
  }
  return {
    message,
    code: typeof record.code === 'string' ? record.code : null,
    hint: typeof record.hint === 'string' ? record.hint : null,
  };
}

async function request<T>(
  server: string,
  path: string,
  init: RequestInit = {},
  timeoutMs = 20_000,
): Promise<T> {
  const base = apiBaseUrl(server);
  if (!base) {
    throw new StudyPrepApiError('Enter the WebStudy server address.', 0);
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${base}${path}`, {
      ...init,
      signal: controller.signal,
    });
    if (!response.ok) {
      let body: unknown = null;
      try {
        body = await response.json();
      } catch {
        // The server may return an empty or non-JSON error body.
      }
      const details = messageFromBody(body);
      throw new StudyPrepApiError(
        details.message ??
          `The server returned ${response.status} ${response.statusText}.`,
        response.status,
        { code: details.code, hint: details.hint },
      );
    }
    if (response.status === 204) {
      return undefined as T;
    }
    return (await response.json()) as T;
  } catch (error) {
    if (error instanceof StudyPrepApiError) {
      throw error;
    }
    if (error instanceof Error && error.name === 'AbortError') {
      throw new StudyPrepApiError(
        'The WebStudy server did not answer in time.',
        0,
        { hint: 'Check that the server is running and on the same network.' },
      );
    }
    throw new StudyPrepApiError(
      'Could not reach the WebStudy server.',
      0,
      {
        hint: 'Check the address, Wi-Fi connection, and that the backend is running with --host 0.0.0.0.',
      },
    );
  } finally {
    clearTimeout(timer);
  }
}

export const studyPrepClient = {
  config: (server: string) =>
    request<StudyPrepConfig>(server, '/study-prep/config'),

  listRuns: (server: string) =>
    request<StudyPrepRun[]>(server, '/study-prep/runs'),

  getRun: (server: string, runId: string) =>
    request<StudyPrepRun>(
      server,
      `/study-prep/runs/${encodeURIComponent(runId)}`,
    ),

  result: (server: string, runId: string) =>
    request<StudyPrepResult>(
      server,
      `/study-prep/runs/${encodeURIComponent(runId)}/result`,
    ),

  createRun: (server: string, input: StudyPrepCreateInput) => {
    const form = new FormData();
    form.append('notes', input.notes);
    form.append('language', input.language);
    form.append('depth', input.depth);
    form.append(
      'target_minutes',
      input.targetMinutes === null ? '' : String(input.targetMinutes),
    );
    for (const file of input.files) {
      form.append('files', {
        uri: file.uri,
        name: file.name,
        type: file.type || sourceMime(file.name),
      } as unknown as Blob);
    }
    return request<StudyPrepRun>(
      server,
      '/study-prep/runs',
      { method: 'POST', body: form },
      180_000,
    );
  },

  cancel: (server: string, runId: string) =>
    request<StudyPrepRun>(
      server,
      `/study-prep/runs/${encodeURIComponent(runId)}/cancel`,
      { method: 'POST' },
    ),

  retry: (server: string, runId: string) =>
    request<StudyPrepRun>(
      server,
      `/study-prep/runs/${encodeURIComponent(runId)}/retry`,
      { method: 'POST' },
    ),

  remove: (server: string, runId: string) =>
    request<void>(
      server,
      `/study-prep/runs/${encodeURIComponent(runId)}`,
      { method: 'DELETE' },
    ),
};
