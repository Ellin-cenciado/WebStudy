import { NativeModules } from 'react-native';
import type { Config, PollPayload, StatsResponse } from './types';

type Envelope<T> = { ok: true; data: T } | { ok: false; error: string };

type NativeBridge = {
  dispatch(method: string, payload: string): Promise<string>;
  getPreference(key: string): Promise<string | null>;
  setPreference(key: string, value: string): Promise<null>;
};

const native: NativeBridge | undefined = NativeModules.WebStudy;

async function dispatch<T>(
  method: string,
  payload: Record<string, unknown> = {},
): Promise<T> {
  if (native === undefined) {
    throw new Error('The embedded study engine is unavailable.');
  }
  const raw = await native.dispatch(method, JSON.stringify(payload));
  const envelope = JSON.parse(raw) as Envelope<T>;
  if (!envelope.ok) {
    throw new Error(envelope.error);
  }
  return envelope.data;
}

export const api = {
  poll: () => dispatch<PollPayload>('poll'),
  config: () => dispatch<Config>('config'),
  saveConfig: (config: Config) =>
    dispatch<Config>('saveConfig', {
      boundary: config.boundary,
      auto_start: config.auto_start,
      study_minutes: config.study_minutes,
      break_minutes: config.break_minutes,
      notifications: config.notifications,
      schedule: config.schedule,
    }),
  stats: (days = 30) => dispatch<StatsResponse>('stats', { days }),

  start: () => dispatch<PollPayload>('start'),
  pause: () => dispatch<PollPayload>('pause'),
  skipPhase: () => dispatch<PollPayload>('skipPhase'),

  addSubject: (name: string) => dispatch<PollPayload>('addSubject', { name }),
  renameSubject: (subjectId: string, name: string) =>
    dispatch<PollPayload>('renameSubject', { subjectId, name }),
  removeSubject: (subjectId: string) =>
    dispatch<PollPayload>('removeSubject', { subjectId }),
  selectSubject: (subjectId: string) =>
    dispatch<PollPayload>('selectSubject', { subjectId }),
  resetSubject: (subjectId: string) =>
    dispatch<PollPayload>('resetSubject', { subjectId }),
  uncheckLast: (subjectId: string) =>
    dispatch<PollPayload>('uncheckLast', { subjectId }),

  addItem: (subjectId: string, text: string, durationSeconds = 0) =>
    dispatch<PollPayload>('addItem', { subjectId, text, durationSeconds }),
  updateItem: (
    itemId: string,
    update: { text?: string; durationSeconds?: number },
  ) => dispatch<PollPayload>('updateItem', { itemId, ...update }),
  removeItem: (itemId: string) =>
    dispatch<PollPayload>('removeItem', { itemId }),
  checkItem: (itemId: string) =>
    dispatch<PollPayload>('checkItem', { itemId }),

  persist: () => dispatch<PollPayload>('persist'),
};

export const preferences = {
  get: (key: string) => native?.getPreference(key) ?? Promise.resolve(null),
  set: (key: string, value: string) =>
    native?.setPreference(key, value) ?? Promise.resolve(null),
};
