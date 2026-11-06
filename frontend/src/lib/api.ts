import type {
  ChecklistData,
  Config,
  StateEnvelope,
  StatsResponse,
} from "./types";

const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined)?.replace(
  /\/$/,
  "",
) ?? "/api";

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
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
  if (init?.body && !headers.has("Content-Type")) {
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
    throw new ApiError(
      detailMessage(payload, response.statusText || "Request failed"),
      response.status,
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
};

export function streamUrl(): string {
  return `${API_BASE}/stream`;
}
