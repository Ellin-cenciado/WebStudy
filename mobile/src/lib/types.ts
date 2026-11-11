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

export type StudyPrepLanguage = 'auto' | 'es' | 'en';
export type StudyPrepDepth = 'quick' | 'balanced' | 'deep';
export type StudyPrepStatus =
  | 'queued'
  | 'running'
  | 'ready'
  | 'failed'
  | 'cancelled'
  | 'interrupted';

export interface StudyPrepSource {
  id: string;
  filename: string;
  kind: 'pdf' | 'pptx' | 'md' | 'notes';
  title: string;
  unit_label: string;
  unit_count: number;
  char_count: number;
  chapter_count: number;
  size_bytes: number;
  status: 'pending' | 'ready' | 'error';
  error: string | null;
  warnings: string[];
}

export interface StudyPrepRunError {
  code: string;
  message: string;
  hint: string | null;
}

export interface StudyPrepRun {
  id: string;
  title: string;
  status: StudyPrepStatus;
  stage: string;
  progress: number;
  stage_detail: string;
  created_at: string;
  updated_at: string;
  options: {
    language: StudyPrepLanguage;
    depth: StudyPrepDepth;
    target_minutes: number | null;
  };
  sources: StudyPrepSource[];
  warnings: string[];
  error: StudyPrepRunError | null;
  has_result: boolean;
  imported_at: string | null;
  total_duration_seconds: number | null;
  item_count: number | null;
  subject_count: number | null;
}

export interface StudyPrepConfig {
  configured: boolean;
  provider: string;
  base_url: string;
  model: string;
  agent: string;
  context_tokens: number;
  max_output_tokens: number;
  max_files: number;
  max_file_bytes: number;
  max_total_bytes: number;
  message: string;
}

export interface StudyPrepNoteSection {
  id: string;
  chapter_id: string;
  chapter_title: string;
  title: string;
  exam_scope: boolean;
  grounded: boolean;
  markdown: string;
  word_count: number;
}

export interface StudyPrepNotes {
  title: string;
  language: 'es' | 'en';
  summary: string;
  exam_scope: string[];
  key_terms: { term: string; definition: string }[];
  sections: StudyPrepNoteSection[];
  markdown: string;
  word_count: number;
}

export interface StudyPlanItem {
  temp_id: string;
  text: string;
  duration_seconds: number;
  kind: 'study' | 'review';
  exam_scope: boolean;
}

export interface StudyPlanSubject {
  temp_id: string;
  name: string;
  source_id: string;
  chapter_id: string;
  chapter_title: string;
  items: StudyPlanItem[];
}

export interface StudyPlan {
  version: number;
  title: string;
  subjects: StudyPlanSubject[];
  totals: {
    duration_seconds: number;
    items: number;
    subjects: number;
  };
  target_minutes: number | null;
  warnings: string[];
}

export interface StudyPrepResult {
  notes: StudyPrepNotes;
  plan: StudyPlan;
}

export interface ChecklistImportSubject {
  name: string;
  items: { text: string; duration_seconds: number }[];
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
