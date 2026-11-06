import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { api } from '../lib/api';
import { errorMessage } from '../lib/format';
import type {
  ChecklistData,
  PollPayload,
  StateEnvelope,
} from '../lib/types';
import { useConfig } from './ConfigContext';
import { useToast } from './ToastContext';

interface LiveContextValue {
  state: StateEnvelope | null;
  checklist: ChecklistData | null;
  connected: boolean;
  error: string | null;
  applyPayload: (payload: PollPayload) => void;
  refresh: () => Promise<void>;
}

const LiveContext = createContext<LiveContextValue | null>(null);

const POLL_INTERVAL_MS = 1000;

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

  const applyPayload = useCallback(
    (payload: PollPayload) => {
      setState(payload.state);
      setChecklist(payload.checklist);
      setConnected(true);
      setError(null);
      if (!notificationsEnabled.current) {
        return;
      }
      for (const event of payload.events) {
        push({
          title: event.summary,
          body: event.body,
          kind: event.urgent ? 'warning' : 'info',
        });
      }
    },
    [push],
  );

  const refresh = useCallback(async () => {
    try {
      applyPayload(await api.poll());
    } catch (caught) {
      setConnected(false);
      setError(errorMessage(caught));
    }
  }, [applyPayload]);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const loop = async () => {
      if (stopped) {
        return;
      }
      if (AppState.currentState === 'active') {
        await refresh();
      }
      if (!stopped) {
        timer = setTimeout(loop, POLL_INTERVAL_MS);
      }
    };

    void loop();

    const subscription = AppState.addEventListener(
      'change',
      (next: AppStateStatus) => {
        if (next === 'active') {
          void refresh();
        } else if (next === 'background') {
          void api.persist().catch(() => {
            // Persistence also happens periodically while polling.
          });
        }
      },
    );

    return () => {
      stopped = true;
      if (timer !== null) {
        clearTimeout(timer);
      }
      subscription.remove();
    };
  }, [refresh]);

  const value = useMemo(
    () => ({ state, checklist, connected, error, applyPayload, refresh }),
    [state, checklist, connected, error, applyPayload, refresh],
  );

  return <LiveContext.Provider value={value}>{children}</LiveContext.Provider>;
}

export function useLive(): LiveContextValue {
  const value = useContext(LiveContext);
  if (value === null) {
    throw new Error('useLive must be used inside LiveProvider');
  }
  return value;
}
