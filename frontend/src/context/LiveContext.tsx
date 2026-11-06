import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { api, streamUrl } from "../lib/api";
import { errorMessage } from "../lib/format";
import type {
  ChecklistData,
  ServiceEvent,
  StateEnvelope,
} from "../lib/types";
import { useConfig } from "./ConfigContext";
import { useToast } from "./ToastContext";

interface LiveContextValue {
  state: StateEnvelope | null;
  checklist: ChecklistData | null;
  connected: boolean;
  error: string | null;
  refreshChecklist: () => Promise<void>;
}

const LiveContext = createContext<LiveContextValue | null>(null);

function parseMessage<T>(event: MessageEvent<string>): T | null {
  try {
    return JSON.parse(event.data) as T;
  } catch {
    return null;
  }
}

export function LiveProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<StateEnvelope | null>(null);
  const [checklist, setChecklist] = useState<ChecklistData | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { config } = useConfig();
  const { push } = useToast();
  const notificationsEnabled = useRef(config?.notifications ?? true);

  useEffect(() => {
    notificationsEnabled.current = config?.notifications ?? true;
  }, [config?.notifications]);

  const applyChecklist = useCallback((next: ChecklistData) => {
    // SSE preserves order on a connection. Do not ignore lower revisions:
    // the backend revision counter restarts at zero when it restarts.
    setChecklist(next);
  }, []);

  const refreshChecklist = useCallback(async () => {
    try {
      applyChecklist(await api.checklist());
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }, [applyChecklist]);

  useEffect(() => {
    let mounted = true;
    void api
      .state()
      .then((next) => {
        if (mounted) setState(next);
      })
      .catch(() => {
        // The SSE connection will show the real error state.
      });
    void api
      .checklist()
      .then((next) => {
        if (mounted) applyChecklist(next);
      })
      .catch(() => {
        // The SSE connection will show the real error state.
      });
    return () => {
      mounted = false;
    };
  }, [applyChecklist]);

  useEffect(() => {
    const source = new EventSource(streamUrl());

    source.onopen = () => {
      setConnected(true);
      setError(null);
    };

    source.onerror = () => {
      setConnected(false);
      setError("The WebStudy backend is offline. Reconnecting…");
    };

    const onState = (event: MessageEvent<string>) => {
      const next = parseMessage<StateEnvelope>(event);
      if (next !== null) {
        setState(next);
        setConnected(true);
        setError(null);
      }
    };

    const onChecklist = (event: MessageEvent<string>) => {
      const next = parseMessage<ChecklistData>(event);
      if (next !== null) {
        applyChecklist(next);
      }
    };

    const onEvent = (event: MessageEvent<string>) => {
      const next = parseMessage<ServiceEvent>(event);
      if (next === null) return;
      if (notificationsEnabled.current) {
        push({
          title: next.summary,
          body: next.body,
          kind: next.urgent ? "warning" : "info",
        });
        if (
          "Notification" in window &&
          Notification.permission === "granted"
        ) {
          new Notification(next.summary, { body: next.body });
        }
      }
    };

    source.addEventListener("state", onState as EventListener);
    source.addEventListener("checklist", onChecklist as EventListener);
    source.addEventListener("event", onEvent as EventListener);

    return () => {
      source.removeEventListener("state", onState as EventListener);
      source.removeEventListener("checklist", onChecklist as EventListener);
      source.removeEventListener("event", onEvent as EventListener);
      source.close();
    };
  }, [applyChecklist, push]);

  const value = useMemo(
    () => ({ state, checklist, connected, error, refreshChecklist }),
    [state, checklist, connected, error, refreshChecklist],
  );

  return <LiveContext.Provider value={value}>{children}</LiveContext.Provider>;
}

export function useLive(): LiveContextValue {
  const value = useContext(LiveContext);
  if (value === null) {
    throw new Error("useLive must be used inside LiveProvider");
  }
  return value;
}
