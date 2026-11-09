import type {
  ChecklistData,
  ChecklistImportResult,
  ChecklistImportSubject,
  Config,
  StateEnvelope,
  StatsResponse,
  StudyPrepConfig,
  StudyPrepDepth,
  StudyPrepLanguage,
  StudyPrepResult,
  StudyPrepRun,
} from "./types";

const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined)?.replace(
  /\/$/,
  "",
) ?? "/api";

export interface StudyPrepCreateInput {
  notes: string;
  language: StudyPrepLanguage;
  depth: StudyPrepDepth;
  targetMinutes: number | null;
  files: File[];
}

export class ApiError extends Error {
  status: number;
  code: string | null;
  hint: string | null;

  constructor(
    message: string,
    status: number,
    details: { code?: string | null; hint?: string | null } = {},
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = details.code ?? null;
    this.hint = details.hint ?? null;
  }
}

function detailMessage(payload: unknown, fallback: string): string {
  if (typeof payload === "string") return payload;
  if (payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    const detail = record.detail;
    if (typeof detail === "string") return detail;
    if (Array.isArray(detail)) {
      return detail
        .map((entry) => {
          if (entry && typeof entry === "object") {
            const item = entry as Record<string, unknown>;
            const location = Array.isArray(item.loc) ? item.loc.join(".") : "";
            const message = typeof item.msg === "string" ? item.msg : "";
            return location ? `${location}: ${message}` : message;
          }
          return String(entry);
        })
        .filter(Boolean)
        .join("; ");
    }
  }
  return fallback;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (
    init?.body &&
    !(init.body instanceof FormData) &&
    !headers.has("Content-Type")
  ) {
    headers.set("Content-Type", "application/json");
  }
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers,
  });
  if (!response.ok) {
    let payload: unknown = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
    const record =
      payload && typeof payload === "object"
        ? (payload as Record<string, unknown>)
        : null;
    throw new ApiError(
      detailMessage(payload, response.statusText || "Request failed"),
      response.status,
      {
        code: typeof record?.code === "string" ? record.code : null,
        hint: typeof record?.hint === "string" ? record.hint : null,
      },
    );
  }
  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

export const api = {
  state: () => request<StateEnvelope>("/state"),
  checklist: () => request<ChecklistData>("/checklist"),
  config: () => request<Config>("/config"),
  saveConfig: (config: Config) =>
    request<Config>("/config", {
      method: "PUT",
      body: JSON.stringify(config),
    }),
  stats: (days = 30) => request<StatsResponse>(`/stats?days=${days}`),

  start: () => request<void>("/session/start", { method: "POST" }),
  pause: () => request<void>("/session/pause", { method: "POST" }),
  skipPhase: () => request<void>("/session/skip-phase", { method: "POST" }),

  addSubject: (name: string) =>
    request<{ id: string }>("/subjects", {
      method: "POST",
      body: JSON.stringify({ name }),
    }),
  renameSubject: (subjectId: string, name: string) =>
    request<void>(`/subjects/${subjectId}`, {
      method: "PATCH",
      body: JSON.stringify({ name }),
    }),
  removeSubject: (subjectId: string) =>
    request<void>(`/subjects/${subjectId}`, { method: "DELETE" }),
  selectSubject: (subjectId: string) =>
    request<void>(`/subjects/${subjectId}/select`, { method: "POST" }),
  resetSubject: (subjectId: string) =>
    request<void>(`/subjects/${subjectId}/reset`, { method: "POST" }),
  uncheckLast: (subjectId: string) =>
    request<void>(`/subjects/${subjectId}/uncheck-last`, { method: "POST" }),

  addItem: (subjectId: string, text: string, durationSeconds = 0) =>
    request<{ id: string }>(`/subjects/${subjectId}/items`, {
      method: "POST",
      body: JSON.stringify({ text, duration_seconds: durationSeconds }),
    }),
  updateItem: (
    itemId: string,
    update: { text?: string; duration_seconds?: number },
  ) =>
    request<void>(`/items/${itemId}`, {
      method: "PATCH",
      body: JSON.stringify(update),
    }),
  removeItem: (itemId: string) =>
    request<void>(`/items/${itemId}`, { method: "DELETE" }),
  checkItem: (itemId: string) =>
    request<void>(`/items/${itemId}/check`, { method: "POST" }),

  importChecklist: (subjects: ChecklistImportSubject[]) =>
    request<ChecklistImportResult>("/checklist/import", {
      method: "POST",
      body: JSON.stringify({ subjects }),
    }),

  studyPrepConfig: () => request<StudyPrepConfig>("/study-prep/config"),
  studyPrepRuns: () => request<StudyPrepRun[]>("/study-prep/runs"),
  studyPrepRun: (runId: string) =>
    request<StudyPrepRun>(`/study-prep/runs/${runId}`),
  studyPrepResult: (runId: string) =>
    request<StudyPrepResult>(`/study-prep/runs/${runId}/result`),
  createStudyPrepRun: (input: StudyPrepCreateInput) => {
    const body = new FormData();
    body.set("notes", input.notes);
    body.set("language", input.language);
    body.set("depth", input.depth);
    body.set(
      "target_minutes",
      input.targetMinutes === null ? "" : String(input.targetMinutes),
    );
    for (const file of input.files) {
      body.append("files", file);
    }
    return request<StudyPrepRun>("/study-prep/runs", {
      method: "POST",
      body,
    });
  },
  cancelStudyPrepRun: (runId: string) =>
    request<StudyPrepRun>(`/study-prep/runs/${runId}/cancel`, {
      method: "POST",
    }),
  retryStudyPrepRun: (runId: string) =>
    request<StudyPrepRun>(`/study-prep/runs/${runId}/retry`, {
      method: "POST",
    }),
  deleteStudyPrepRun: (runId: string) =>
    request<void>(`/study-prep/runs/${runId}`, { method: "DELETE" }),
  importStudyPrepRun: (
    runId: string,
    subjects?: ChecklistImportSubject[],
  ) =>
    request<ChecklistImportResult>(`/study-prep/runs/${runId}/import`, {
      method: "POST",
      body: subjects === undefined ? undefined : JSON.stringify({ subjects }),
    }),
};

export function streamUrl(): string {
  return `${API_BASE}/stream`;
}
