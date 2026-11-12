import type { MessageKey } from './en';
import type { Translate } from './index';

const WEEKDAYS: Record<string, MessageKey> = {
  monday: 'weekday.monday',
  tuesday: 'weekday.tuesday',
  wednesday: 'weekday.wednesday',
  thursday: 'weekday.thursday',
  friday: 'weekday.friday',
  saturday: 'weekday.saturday',
  sunday: 'weekday.sunday',
};

const DAY_KINDS: Record<string, MessageKey> = {
  carried: 'dayKind.carried',
  optional: 'dayKind.optional',
  free: 'dayKind.free',
  vacation: 'dayKind.vacation',
};

const MODES: Record<string, MessageKey> = {
  carried: 'mode.carried',
  optional: 'mode.optional',
  free: 'mode.free',
};

const PHASES: Record<string, MessageKey> = {
  study: 'phase.study',
  break: 'phase.break',
  idle: 'phase.idle',
  complete: 'phase.complete',
};

const STAGES: Record<string, MessageKey> = {
  queued: 'stage.queued',
  mapping: 'stage.mapping',
  drafting: 'stage.drafting',
  planning: 'stage.planning',
  extracting: 'stage.extracting',
};

export function weekdayLabel(t: Translate, value: string): string {
  const key = WEEKDAYS[value.trim().toLowerCase()];
  return key ? t(key) : value;
}

export function dayKindLabel(t: Translate, value: string): string {
  const key = DAY_KINDS[value.trim().toLowerCase()];
  return key ? t(key) : value;
}

export function modeLabel(t: Translate, value: string): string {
  const key = MODES[value.trim().toLowerCase()];
  return key ? t(key) : value;
}

export function phaseLabel(t: Translate, value: string): string {
  const key = PHASES[value.trim().toLowerCase()];
  return key ? t(key) : value;
}

export function stageLabel(t: Translate, value: string): string {
  const key = STAGES[value.trim().toLowerCase()];
  return key ? t(key) : value;
}

export function pluralWord(
  t: Translate,
  count: number,
  one: MessageKey,
  other: MessageKey,
): string {
  return t(count === 1 ? one : other);
}
