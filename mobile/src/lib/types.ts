export type DayMode = 'carried' | 'optional' | 'free';

export type WeekdayName =
  | 'monday'
  | 'tuesday'
  | 'wednesday'
  | 'thursday'
  | 'friday'
  | 'saturday'
  | 'sunday';

export interface Snapshot {
  logical_day: string;
  weekday: string;
  day_kind: string;
  debt_seconds: number;
  elapsed_seconds: number;
  required_seconds: number;
  remaining_seconds: number;
  optional_goal_seconds: number;
  optional_done_seconds: number;
  phase: string;
  phase_elapsed_seconds: number;
  phase_length_seconds: number;
  phase_remaining_seconds: number;
  running: boolean;
  day_complete: boolean;
  is_free_day: boolean;
}

export interface ChecklistSummary {
  active_subject_id: string;
  active_item_id: string;
  remaining_seconds: number;
  overrun_seconds: number;
  rest_remaining_seconds: number;
  revision: number;
}

export interface StateEnvelope {
  server_time: string;
  snapshot: Snapshot;
  checklist: ChecklistSummary;
}

export interface ServiceEvent {
  kind: string;
  summary: string;
  body: string;
  urgent: boolean;
}

export interface ChecklistItem {
  id: string;
  text: string;
  base_seconds: number;
  elapsed_seconds: number;
  carry_in_seconds: number;
  checked: boolean;
  carry_out_seconds: number;
}

export interface ChecklistSubject {
  id: string;
  name: string;
  items: ChecklistItem[];
}

export interface ChecklistData {
  version: number;
  revision: number;
  active_subject_id: string | null;
  subjects: ChecklistSubject[];
}

export interface WeekdaySetting {
  mode: DayMode;
  quota_minutes: number;
}

export interface Config {
  boundary: string;
  auto_start: boolean;
  study_minutes: number;
  break_minutes: number;
  notifications: boolean;
  schedule: Record<WeekdayName, WeekdaySetting>;
}

export interface DayRow {
  logical_date: string;
  weekday: string;
  day_kind: string;
  quota_seconds: number;
  debt_in_seconds: number;
  required_seconds: number;
  elapsed_seconds: number;
  debt_out_seconds: number;
  optional_goal_seconds: number;
  optional_done_seconds: number;
  study_seconds: number;
  break_seconds: number;
  completed: boolean;
}

export interface StatsResponse {
  summary: {
    streak: number;
    completed: number;
    total: number;
    debt_seconds: number;
  };
  days: DayRow[];
}

export interface PollPayload {
  state: StateEnvelope;
  checklist: ChecklistData;
  events: ServiceEvent[];
}

export const WEEKDAYS: WeekdayName[] = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
];

export const DAY_MODES: DayMode[] = ['carried', 'optional', 'free'];
