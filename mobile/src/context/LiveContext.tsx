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
import {
  AppState,
  PermissionsAndroid,
  Platform,
  type AppStateStatus,
} from 'react-native';
import { api, backgroundTimer } from '../lib/api';
import { errorMessage } from '../lib/format';
import type {
  ChecklistData,
  PollPayload,
  StateEnvelope,
} from '../lib/types';
import { useConfig } from './ConfigContext';
import { useToast } from './ToastContext';

export type NotificationPermission = 'granted' | 'denied' | 'unknown';

interface LiveContextValue {
  state: StateEnvelope | null;
  checklist: ChecklistData | null;
  connected: boolean;
  error: string | null;
  awaySeconds: number | null;
  notificationPermission: NotificationPermission;
  applyPayload: (payload: PollPayload) => void;
  refresh: () => Promise<void>;
  dismissAway: () => void;
  requestNotificationPermission: () => Promise<boolean>;
}

const LiveContext = createContext<LiveContextValue | null>(null);

const POLL_INTERVAL_MS = 1000;
const AWAY_THRESHOLD_SECONDS = 60;

export function LiveProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<StateEnvelope | null>(null);
  const [checklist, setChecklist] = useState<ChecklistData | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [awaySeconds, setAwaySeconds] = useState<number | null>(null);
  const [notificationPermission, setNotificationPermission] =
    useState<NotificationPermission>('unknown');
  const { config } = useConfig();
  const { push } = useToast();
  const notificationsEnabled = useRef(config?.notifications ?? true);
  const stateRef = useRef<StateEnvelope | null>(null);
  const serviceWanted = useRef(false);
  const permissionRequested = useRef(false);
  const backgroundRef = useRef<{
    elapsed: number;
    running: boolean;
    logicalDay: string;
  } | null>(null);

  useEffect(() => {
    notificationsEnabled.current = config?.notifications ?? true;
  }, [config?.notifications]);

  useEffect(() => {
    if (Platform.OS !== 'android' || Number(Platform.Version) < 33) {
      setNotificationPermission('granted');
      return;
    }
    PermissionsAndroid.check(
      PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
    )
      .then(granted => {
        setNotificationPermission(granted ? 'granted' : 'unknown');
      })
      .catch(() => {
        setNotificationPermission('unknown');
      });
  }, []);

  const requestNotificationPermission = useCallback(async () => {
    permissionRequested.current = true;
    if (Platform.OS !== 'android' || Number(Platform.Version) < 33) {
      setNotificationPermission('granted');
      return true;
    }
    try {
      const result = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
      );
      const granted = result === PermissionsAndroid.RESULTS.GRANTED;
      setNotificationPermission(granted ? 'granted' : 'denied');
      return granted;
    } catch {
      setNotificationPermission('denied');
      return false;
    }
  }, []);

  const dismissAway = useCallback(() => {
    setAwaySeconds(null);
  }, []);

  const timerRunning = state?.snapshot.running ?? false;
  const timerBlocked =
    (state?.snapshot.day_complete ?? false) ||
    (state?.snapshot.is_free_day ?? false);

  useEffect(() => {
    if (Platform.OS === 'android') {
      void backgroundTimer.setForeground(true).catch(() => {});
    }
  }, []);

  useEffect(() => {
    if (Platform.OS !== 'android') {
      return;
    }
    const wanted = timerRunning && !timerBlocked;
    if (wanted === serviceWanted.current) {
      return;
    }
    serviceWanted.current = wanted;
    if (wanted) {
      void backgroundTimer.start().catch(() => {
        // The in-process timer still runs; the notification is unavailable.
      });
    } else {
      void backgroundTimer.stop().catch(() => {
        // Stopping an absent service is harmless.
      });
    }
  }, [timerRunning, timerBlocked]);

  useEffect(() => {
    if (
      Platform.OS !== 'android' ||
      Number(Platform.Version) < 33 ||
      !timerRunning ||
      notificationPermission !== 'unknown' ||
      permissionRequested.current
    ) {
      return;
    }
    void requestNotificationPermission();
  }, [timerRunning, notificationPermission, requestNotificationPermission]);

  const applyPayload = useCallback(
    (payload: PollPayload) => {
      stateRef.current = payload.state;
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
    let lastAppState: AppStateStatus = (AppState.currentState ??
      'active') as AppStateStatus;

    const leaveForeground = () => {
      void backgroundTimer.setForeground(false).catch(() => {});
      const snapshot = stateRef.current?.snapshot;
      backgroundRef.current = snapshot
        ? {
            elapsed: snapshot.elapsed_seconds,
            running: snapshot.running,
            logicalDay: snapshot.logical_day,
          }
        : null;
      void api.persist().catch(() => {
        // The timer service will persist on its next tick.
      });
    };

    const returnToForeground = async () => {
      void backgroundTimer.setForeground(true).catch(() => {});
      await refresh();
      const before = backgroundRef.current;
      backgroundRef.current = null;
      const after = stateRef.current?.snapshot;
      if (before === null || after === undefined) {
        return;
      }
      if (after.logical_day !== before.logicalDay) {
        push({
          kind: 'info',
          title: 'New study day',
          body: 'The day rolled over while you were away.',
        });
        return;
      }
      if (!before.running || !after.running) {
        return;
      }
      const delta = after.elapsed_seconds - before.elapsed;
      if (delta >= AWAY_THRESHOLD_SECONDS) {
        setAwaySeconds(delta);
      }
    };

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
        if (next === 'background' && lastAppState !== 'background') {
          leaveForeground();
        } else if (next === 'active' && lastAppState !== 'active') {
          void returnToForeground();
        }
        lastAppState = next;
      },
    );

    return () => {
      stopped = true;
      if (timer !== null) {
        clearTimeout(timer);
      }
      subscription.remove();
    };
  }, [refresh, push]);

  const value = useMemo(
    () => ({
      state,
      checklist,
      connected,
      error,
      awaySeconds,
      notificationPermission,
      applyPayload,
      refresh,
      dismissAway,
      requestNotificationPermission,
    }),
    [
      state,
      checklist,
      connected,
      error,
      awaySeconds,
      notificationPermission,
      applyPayload,
      refresh,
      dismissAway,
      requestNotificationPermission,
    ],
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
