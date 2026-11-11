import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type ScrollViewInstance,
} from 'react-native';
import {
  errorCodes,
  isErrorWithCode,
  pick,
  types,
} from '@react-native-documents/picker';
import {
  Badge,
  Button,
  Card,
  Divider,
  EmptyState,
  Field,
  PageHeader,
  ProgressBar,
  Screen,
  SectionTitle,
  Spinner,
  ThemedInput,
  type Tone,
} from '../components/ui';
import { useDialog } from '../context/DialogContext';
import { useTheme } from '../context/ThemeContext';
import { useToast } from '../context/ToastContext';
import { api, preferences } from '../lib/api';
import {
  errorMessage,
  formatBytes,
  formatDateTime,
  formatHours,
} from '../lib/format';
import {
  apiBaseUrl,
  isSupportedSource,
  MAX_SOURCE_FILES,
  normalizeServerUrl,
  sourceMime,
  studyPrepClient,
  StudyPrepApiError,
  type PickedSource,
} from '../lib/studyPrep';
import type {
  StudyPrepConfig,
  StudyPrepDepth,
  StudyPrepLanguage,
  StudyPrepResult,
  StudyPrepRun,
  StudyPrepStatus,
} from '../lib/types';

const SERVER_PREFERENCE = 'studyPrepServer';
const IMPORTED_PREFERENCE = 'studyPrepImportedRuns';
const MAX_NOTES_CHARS = 400_000;

const LANGUAGES: Array<{ value: StudyPrepLanguage; label: string }> = [
  { value: 'auto', label: 'Auto' },
  { value: 'es', label: 'Español' },
  { value: 'en', label: 'English' },
];

const DEPTHS: Array<{
  value: StudyPrepDepth;
  label: string;
  hint: string;
}> = [
  { value: 'quick', label: 'Quick', hint: 'A compact pass over the material.' },
  {
    value: 'balanced',
    label: 'Balanced',
    hint: 'Normal detail for an upcoming exam.',
  },
  { value: 'deep', label: 'Deep', hint: 'More detail and more study time.' },
];

const STATUS_TONES: Record<StudyPrepStatus, Tone> = {
  queued: 'muted',
  running: 'accent',
  ready: 'good',
  failed: 'danger',
  cancelled: 'warn',
  interrupted: 'warn',
};

const STATUS_LABELS: Record<StudyPrepStatus, string> = {
  queued: 'Queued',
  running: 'Running',
  ready: 'Ready',
  failed: 'Failed',
  cancelled: 'Cancelled',
  interrupted: 'Interrupted',
};

function describeError(caught: unknown): string {
  if (caught instanceof StudyPrepApiError) {
    return caught.hint ? `${caught.message} ${caught.hint}` : caught.message;
  }
  return errorMessage(caught);
}

function mergeRun(list: StudyPrepRun[], run: StudyPrepRun): StudyPrepRun[] {
  const next = list.some(entry => entry.id === run.id)
    ? list.map(entry => (entry.id === run.id ? run : entry))
    : [run, ...list];
  return [...next].sort((left, right) =>
    right.created_at.localeCompare(left.created_at),
  );
}

function ChoiceChip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        {
          backgroundColor: selected ? colors.accentSoft : colors.cardAlt,
          borderColor: selected ? colors.accentBorder : 'transparent',
          opacity: pressed ? 0.7 : 1,
        },
      ]}>
      <Text
        style={[
          styles.chipText,
          { color: selected ? colors.accent : colors.textMuted },
        ]}>
        {label}
      </Text>
    </Pressable>
  );
}

function ErrorCard({
  title,
  message,
  onRetry,
}: {
  title: string;
  message: string;
  onRetry?: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Card
      style={{
        backgroundColor: colors.dangerSoft,
        borderColor: colors.dangerBorder,
      }}>
      <Text style={[styles.errorTitle, { color: colors.danger }]}>{title}</Text>
      <Text style={[styles.errorText, { color: colors.danger }]}>{message}</Text>
      {onRetry ? (
        <Button label="Try again" onPress={onRetry} size="sm" variant="secondary" />
      ) : null}
    </Card>
  );
}

function FileRow({
  file,
  onRemove,
}: {
  file: PickedSource;
  onRemove: () => void;
}) {
  const { colors } = useTheme();
  return (
    <View style={[styles.fileRow, { borderColor: colors.border }]}>
      <View style={styles.fileMark}>
        <Text style={[styles.fileMarkText, { color: colors.accent }]}>
          {file.name.toLowerCase().endsWith('.pdf')
            ? 'PDF'
            : file.name.toLowerCase().endsWith('.pptx')
              ? 'PPT'
              : 'MD'}
        </Text>
      </View>
      <View style={styles.fileBody}>
        <Text
          numberOfLines={1}
          style={[styles.fileName, { color: colors.text }]}>
          {file.name}
        </Text>
        <Text style={[styles.fileMeta, { color: colors.textMuted }]}>
          {file.size === null ? 'Size unavailable' : formatBytes(file.size)}
        </Text>
      </View>
      <Pressable
        accessibilityLabel={`Remove ${file.name}`}
        hitSlop={8}
        onPress={onRemove}
        style={({ pressed }) => [styles.removeButton, pressed && styles.pressed]}>
        <Text style={[styles.removeText, { color: colors.textFaint }]}>×</Text>
      </Pressable>
    </View>
  );
}

function RunStatus({ run }: { run: StudyPrepRun }) {
  return (
    <Badge label={STATUS_LABELS[run.status]} tone={STATUS_TONES[run.status]} />
  );
}

export function StudyPrepScreen({
  onOpenChecklist,
}: {
  onOpenChecklist: () => void;
}) {
  const { colors } = useTheme();
  const { push } = useToast();
  const { confirm } = useDialog();

  const [server, setServer] = useState('');
  const [serverSaved, setServerSaved] = useState('');
  const [serverLoaded, setServerLoaded] = useState(false);
  const serverRef = useRef('');
  const serverRequest = useRef(0);

  const [config, setConfig] = useState<StudyPrepConfig | null>(null);
  const [configLoading, setConfigLoading] = useState(false);
  const [configError, setConfigError] = useState<string | null>(null);

  const [runs, setRuns] = useState<StudyPrepRun[]>([]);
  const [runsLoading, setRunsLoading] = useState(false);
  const [runsError, setRunsError] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selectedIdRef = useRef<string | null>(null);
  const resultRequest = useRef(0);
  const [detail, setDetail] = useState<StudyPrepRun | null>(null);
  const [result, setResult] = useState<StudyPrepResult | null>(null);
  const [resultLoading, setResultLoading] = useState(false);
  const [resultError, setResultError] = useState<string | null>(null);
  const [pollError, setPollError] = useState<string | null>(null);
  const [tab, setTab] = useState<'notes' | 'plan'>('notes');
  const screenRef = useRef<ScrollViewInstance | null>(null);
  const selectedCardY = useRef(0);

  const [notes, setNotes] = useState('');
  const [language, setLanguage] = useState<StudyPrepLanguage>('auto');
  const [depth, setDepth] = useState<StudyPrepDepth>('balanced');
  const [target, setTarget] = useState('');
  const [files, setFiles] = useState<PickedSource[]>([]);
  const [creating, setCreating] = useState(false);
  const [pendingAction, setPendingAction] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importedRuns, setImportedRuns] = useState<Set<string>>(
    () => new Set(),
  );

  useEffect(() => {
    let active = true;
    void Promise.all([
      preferences.get(SERVER_PREFERENCE),
      preferences.get(IMPORTED_PREFERENCE),
    ])
      .then(([value, importedValue]) => {
        if (!active) {
          return;
        }
        const stored = normalizeServerUrl(value ?? '');
        let importedIds: string[] = [];
        try {
          const parsed = JSON.parse(importedValue ?? '[]') as unknown;
          if (Array.isArray(parsed)) {
            importedIds = parsed.filter(
              (entry): entry is string => typeof entry === 'string',
            );
          }
        } catch {
          importedIds = [];
        }
        setImportedRuns(new Set(importedIds));
        setServer(stored);
        setServerSaved(stored);
        setServerLoaded(true);
      })
      .catch(() => {
        if (active) {
          setServerLoaded(true);
        }
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    serverRef.current = serverSaved;
    setConfig(null);
    setConfigError(null);
    setRuns([]);
    setRunsError(null);
    setSelectedId(null);
    setDetail(null);
    setResult(null);
  }, [serverSaved]);

  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  const refreshServer = useCallback(
    async (base: string, selectActive = false) => {
      if (!base) {
        return;
      }
      const token = ++serverRequest.current;
      setConfigLoading(true);
      setConfigError(null);
      setRunsLoading(true);
      setRunsError(null);
      try {
        const [nextConfig, nextRuns] = await Promise.all([
          studyPrepClient.config(base),
          studyPrepClient.listRuns(base),
        ]);
        if (serverRequest.current !== token || serverRef.current !== base) {
          return;
        }
        setConfig(nextConfig);
        setRuns(nextRuns);
        if (selectActive && selectedIdRef.current === null) {
          const active = nextRuns.find(
            entry => entry.status === 'queued' || entry.status === 'running',
          );
          if (active) {
            setSelectedId(active.id);
          }
        }
      } catch (caught) {
        if (serverRequest.current !== token || serverRef.current !== base) {
          return;
        }
        const message = describeError(caught);
        setConfigError(message);
        setRunsError(message);
        setConfig(null);
        setRuns([]);
      } finally {
        if (serverRequest.current === token) {
          setConfigLoading(false);
          setRunsLoading(false);
        }
      }
    },
    [],
  );

  useEffect(() => {
    if (serverSaved) {
      void refreshServer(serverSaved, true);
    }
  }, [serverSaved, refreshServer]);

  const refreshRuns = useCallback(async (base: string) => {
    try {
      const nextRuns = await studyPrepClient.listRuns(base);
      if (serverRef.current === base) {
        setRuns(nextRuns);
        setRunsError(null);
      }
    } catch (caught) {
      if (serverRef.current === base) {
        setRunsError(describeError(caught));
      }
    }
  }, []);

  const loadResult = useCallback(async (base: string, runId: string) => {
    const token = ++resultRequest.current;
    setResult(null);
    setResultError(null);
    setResultLoading(true);
    try {
      const nextResult = await studyPrepClient.result(base, runId);
      if (
        resultRequest.current === token &&
        selectedIdRef.current === runId
      ) {
        setResult(nextResult);
      }
    } catch (caught) {
      if (
        resultRequest.current === token &&
        selectedIdRef.current === runId
      ) {
        setResultError(describeError(caught));
      }
    } finally {
      if (resultRequest.current === token) {
        setResultLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    if (!serverSaved || selectedId === null) {
      return;
    }
    let active = true;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const poll = async () => {
      try {
        const run = await studyPrepClient.getRun(serverSaved, selectedId);
        if (!active) {
          return;
        }
        setDetail(run);
        setRuns(current => mergeRun(current, run));
        setPollError(null);
        if (run.status === 'ready') {
          if (run.has_result) {
            void loadResult(serverSaved, selectedId);
          }
          void refreshRuns(serverSaved);
          return;
        }
        if (run.status === 'queued' || run.status === 'running') {
          timer = setTimeout(() => void poll(), 1500);
          return;
        }
        void refreshRuns(serverSaved);
      } catch (caught) {
        if (!active) {
          return;
        }
        if (caught instanceof StudyPrepApiError && caught.status === 404) {
          setSelectedId(null);
          setDetail(null);
          setResult(null);
          setRunsError('That preparation was deleted.');
          void refreshRuns(serverSaved);
          return;
        }
        setPollError(describeError(caught));
        timer = setTimeout(() => void poll(), 3000);
      }
    };

    setDetail(current => (current?.id === selectedId ? current : null));
    setResult(null);
    setResultError(null);
    setResultLoading(false);
    setPollError(null);
    setTab('notes');
    void poll();

    return () => {
      active = false;
      if (timer !== null) {
        clearTimeout(timer);
      }
    };
  }, [serverSaved, selectedId, loadResult, refreshRuns]);

  const connect = async () => {
    const normalized = normalizeServerUrl(server);
    if (!normalized) {
      push({
        kind: 'error',
        title: 'Server address required',
        body: 'Enter the address of the computer running the WebStudy backend.',
      });
      return;
    }
    setServer(normalized);
    try {
      await preferences.set(SERVER_PREFERENCE, normalized);
    } catch {
      // The address still works for this session.
    }
    if (normalized === serverSaved) {
      void refreshServer(normalized, selectedId === null);
    } else {
      setServerSaved(normalized);
    }
  };

  const forgetServer = async () => {
    try {
      await preferences.set(SERVER_PREFERENCE, '');
    } catch {
      // Ignore storage failures; the in-memory state still clears.
    }
    setServer('');
    setServerSaved('');
  };

  const addFiles = async () => {
    try {
      const picked = await pick({
        allowMultiSelection: true,
        type: [types.allFiles],
      });
      const accepted: PickedSource[] = [];
      let skipped = 0;
      for (const asset of picked) {
        const name = asset.name ?? '';
        if (!isSupportedSource(name)) {
          skipped += 1;
          continue;
        }
        accepted.push({
          uri: asset.uri,
          name,
          type: asset.type ?? sourceMime(name),
          size: asset.size,
        });
      }
      if (skipped > 0) {
        push({
          kind: 'warning',
          title: 'Some files were skipped',
          body: 'Only PDF, PPTX, and Markdown files can be used.',
        });
      }
      if (accepted.length > 0) {
        setFiles(current => {
          const room = Math.max(0, (config?.max_files ?? MAX_SOURCE_FILES) - current.length);
          return [...current, ...accepted.slice(0, room)];
        });
      }
    } catch (caught) {
      if (
        isErrorWithCode(caught) &&
        caught.code === errorCodes.OPERATION_CANCELED
      ) {
        return;
      }
      push({
        kind: 'error',
        title: 'Could not open the file picker',
        body: errorMessage(caught),
      });
    }
  };

  const createRun = async () => {
    if (!config?.configured) {
      push({
        kind: 'warning',
        title: 'The server has no model configured',
        body: 'Set WEBSTUDY_LLM_MODEL on the server and restart the backend.',
      });
      return;
    }
    if (!notes.trim() && files.length === 0) {
      push({
        kind: 'warning',
        title: 'Add material first',
        body: 'Write rough notes, attach a source file, or both.',
      });
      return;
    }
    const trimmedTarget = target.trim();
    let targetMinutes: number | null = null;
    if (trimmedTarget) {
      const parsed = Number(trimmedTarget);
      if (!Number.isInteger(parsed) || parsed < 10 || parsed > 10_000) {
        push({
          kind: 'error',
          title: 'Invalid target',
          body: 'The target must be a whole number between 10 and 10,000 minutes.',
        });
        return;
      }
      targetMinutes = parsed;
    }
    const maxFileBytes = config.max_file_bytes;
    const maxTotalBytes = config.max_total_bytes;
    const knownTotal = files.reduce(
      (total, file) => total + (file.size ?? 0),
      0,
    );
    if (files.some(file => file.size !== null && file.size > maxFileBytes)) {
      push({
        kind: 'error',
        title: 'Source too large',
        body: `Each file must be at most ${formatBytes(maxFileBytes)}.`,
      });
      return;
    }
    if (knownTotal > maxTotalBytes) {
      push({
        kind: 'error',
        title: 'Sources too large',
        body: `All sources together must be at most ${formatBytes(maxTotalBytes)}.`,
      });
      return;
    }

    setCreating(true);
    try {
      const run = await studyPrepClient.createRun(serverSaved, {
        notes: notes.trim(),
        language,
        depth,
        targetMinutes,
        files,
      });
      setRuns(current => mergeRun(current, run));
      setSelectedId(run.id);
      setDetail(run);
      setResult(null);
      setResultError(null);
      setNotes('');
      setFiles([]);
      push({
        kind: 'success',
        title: 'Preparation queued',
        body: 'Notes and a study plan are being generated on the server.',
      });
    } catch (caught) {
      push({
        kind: 'error',
        title: 'Could not start the preparation',
        body: describeError(caught),
      });
    } finally {
      setCreating(false);
    }
  };

  const cancelRun = async (run: StudyPrepRun) => {
    const ok = await confirm({
      title: 'Cancel preparation?',
      message: 'The server will stop generating notes for this run.',
      confirmLabel: 'Cancel run',
      cancelLabel: 'Keep running',
      destructive: true,
    });
    if (!ok) {
      return;
    }
    setPendingAction(true);
    try {
      const next = await studyPrepClient.cancel(serverSaved, run.id);
      setRuns(current => mergeRun(current, next));
      if (selectedIdRef.current === next.id) {
        setDetail(next);
        setResult(null);
      }
    } catch (caught) {
      push({
        kind: 'error',
        title: 'Could not cancel the run',
        body: describeError(caught),
      });
    } finally {
      setPendingAction(false);
    }
  };

  const retryRun = async (run: StudyPrepRun) => {
    setPendingAction(true);
    try {
      const next = await studyPrepClient.retry(serverSaved, run.id);
      setRuns(current => mergeRun(current, next));
      if (selectedIdRef.current === next.id) {
        setDetail(next);
        setResult(null);
        setResultError(null);
        setImportedRuns(current => {
          if (!current.has(next.id)) {
            return current;
          }
          const copy = new Set(current);
          copy.delete(next.id);
          void preferences
            .set(IMPORTED_PREFERENCE, JSON.stringify([...copy]))
            .catch(() => {
              // The in-memory state still allows an import this session.
            });
          return copy;
        });
      }
    } catch (caught) {
      push({
        kind: 'error',
        title: 'Could not retry the run',
        body: describeError(caught),
      });
    } finally {
      setPendingAction(false);
    }
  };

  const removeRun = async (run: StudyPrepRun) => {
    const ok = await confirm({
      title: 'Delete preparation?',
      message: `Delete "${run.title}" and its stored sources on the server? The checklist is not affected.`,
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!ok) {
      return;
    }
    try {
      await studyPrepClient.remove(serverSaved, run.id);
      setRuns(current => current.filter(entry => entry.id !== run.id));
      if (selectedIdRef.current === run.id) {
        setSelectedId(null);
        setDetail(null);
        setResult(null);
      }
    } catch (caught) {
      push({
        kind: 'error',
        title: 'Could not delete the run',
        body: describeError(caught),
      });
    }
  };

  const importPlan = async () => {
    if (!result || !detail) {
      return;
    }
    const totalItems = result.plan.totals.items;
    const subjectCount = result.plan.totals.subjects;
    const ok = await confirm({
      title: 'Import plan?',
      message: `Add ${totalItems} ${
        totalItems === 1 ? 'item' : 'items'
      } in ${subjectCount} ${
        subjectCount === 1 ? 'subject' : 'subjects'
      } to this device's checklist. Existing subjects are kept.`,
      confirmLabel: 'Import',
    });
    if (!ok) {
      return;
    }
    setImporting(true);
    try {
      const subjects = result.plan.subjects.map(subject => ({
        name: subject.name,
        items: subject.items.map(item => ({
          text: item.text,
          duration_seconds: item.duration_seconds,
        })),
      }));
      await api.importPlan(subjects);
      setImportedRuns(current => {
        const next = new Set(current).add(detail.id);
        void preferences
          .set(IMPORTED_PREFERENCE, JSON.stringify([...next]))
          .catch(() => {
            // The in-memory state still prevents a second import this session.
          });
        return next;
      });
      push({
        kind: 'success',
        title: 'Checklist updated',
        body: `Added ${totalItems} ${
          totalItems === 1 ? 'item' : 'items'
        } in ${subjectCount} ${
          subjectCount === 1 ? 'subject' : 'subjects'
        }.`,
      });
    } catch (caught) {
      push({
        kind: 'error',
        title: 'Could not import the plan',
        body: errorMessage(caught),
      });
    } finally {
      setImporting(false);
    }
  };

  const jumpToPlan = useCallback(() => {
    setTab('plan');
    setTimeout(() => {
      screenRef.current?.scrollTo({
        y: Math.max(0, selectedCardY.current - 12),
        animated: true,
      });
    }, 60);
  }, []);

  if (!serverLoaded) {
    return (
      <Screen>
        <Card style={styles.loadingCard}>
          <Spinner />
          <Text style={[styles.loadingText, { color: colors.textMuted }]}>
            Loading study prep…
          </Text>
        </Card>
      </Screen>
    );
  }

  const configured = config?.configured ?? false;
  const providerLabel = config?.agent
    ? `${config.provider} · ${config.agent}${
        config.model ? ` · ${config.model}` : ''
      }`
    : `${config?.provider ?? ''} · ${config?.model ?? ''}`;
  const selectedRun =
    detail ?? runs.find(entry => entry.id === selectedId) ?? null;
  const imported =
    selectedRun !== null && importedRuns.has(selectedRun.id);
  const active =
    selectedRun?.status === 'queued' || selectedRun?.status === 'running';
  const jumpButton =
    result !== null &&
    selectedRun?.status === 'ready' &&
    tab === 'notes' ? (
      <Pressable
        accessibilityLabel="Jump to the study plan"
        accessibilityRole="button"
        onPress={jumpToPlan}
        style={({ pressed }) => [
          styles.jumpToPlan,
          {
            backgroundColor: colors.accent,
            shadowColor: colors.shadow,
            opacity: pressed ? 0.82 : 1,
          },
        ]}>
        <Text style={[styles.jumpToPlanText, { color: colors.accentText }]}>
          Jump to plan
        </Text>
        <Text style={[styles.jumpToPlanGlyph, { color: colors.accentText }]}>
          ↓
        </Text>
      </Pressable>
    ) : null;

  return (
    <Screen
      ref={screenRef}
      contentContainerStyle={jumpButton ? styles.withJumpButton : undefined}
      floating={jumpButton}>
      <PageHeader
        subtitle="Generate polished notes and a deterministic study plan from your material."
        title="Study Prep"
      />

      <Card style={styles.section}>
        <SectionTitle
          right={
            config !== null ? (
              <Badge
                label={configured ? 'Provider ready' : 'Setup needed'}
                tone={configured ? 'good' : 'warn'}
              />
            ) : undefined
          }
          subtitle="Notes are generated by the WebStudy backend on your computer, then imported into this device's checklist."
          title="Server"
        />
        <View style={styles.sectionBody}>
          <Field
            hint="Use the computer's LAN address, not 127.0.0.1. Example: http://192.168.0.20:8000"
            label="Backend address">
            <ThemedInput
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              onChangeText={setServer}
              placeholder="http://192.168.0.20:8000"
              value={server}
            />
          </Field>
          <View style={styles.actionRow}>
            <Button
              label={serverSaved ? 'Reconnect' : 'Connect'}
              onPress={() => void connect()}
              pending={configLoading}
              size="sm"
            />
            {serverSaved ? (
              <Button
                label="Forget"
                onPress={() => void forgetServer()}
                size="sm"
                variant="ghost"
              />
            ) : null}
            {apiBaseUrl(serverSaved) ? (
              <Text style={[styles.serverHint, { color: colors.textFaint }]}>
                {apiBaseUrl(serverSaved)}
              </Text>
            ) : null}
          </View>

          {!serverSaved ? (
            <View
              style={[
                styles.infoBox,
                {
                  backgroundColor: colors.cardAlt,
                  borderColor: colors.border,
                },
              ]}>
              <Text style={[styles.infoText, { color: colors.textMuted }]}>
                Start the backend on your computer with{' '}
                <Text style={styles.code}>--host 0.0.0.0</Text>, then enter its
                Wi-Fi address here. The phone and computer must be on the same
                network.
              </Text>
            </View>
          ) : configError !== null ? (
            <ErrorCard
              message={configError}
              onRetry={() => void refreshServer(serverSaved, true)}
              title="Could not reach the server"
            />
          ) : configLoading && config === null ? (
            <View style={styles.inlineLoading}>
              <Spinner />
              <Text style={[styles.loadingText, { color: colors.textMuted }]}>
                Connecting…
              </Text>
            </View>
          ) : config !== null ? (
            <View
              style={[
                styles.providerBox,
                {
                  backgroundColor: configured
                    ? colors.goodSoft
                    : colors.warnSoft,
                  borderColor: configured
                    ? colors.goodBorder
                    : colors.warnBorder,
                },
              ]}>
              <Text
                style={[
                  styles.providerTitle,
                  { color: configured ? colors.good : colors.warn },
                ]}>
                {configured ? providerLabel : 'No language model configured on the server'}
              </Text>
              <Text
                style={[
                  styles.providerText,
                  { color: configured ? colors.good : colors.warn },
                ]}>
                {configured
                  ? `Endpoint ${config.base_url} · ${config.context_tokens.toLocaleString()} token context`
                  : config.message ||
                    'Set WEBSTUDY_LLM_MODEL on the server, then restart the backend.'}
              </Text>
            </View>
          ) : null}
        </View>
      </Card>

      {config !== null && configured ? (
        <Card style={styles.section}>
          <SectionTitle
            subtitle="Rough notes, slides, PDFs, or Markdown. Sources are stored on the server under study-prep."
            title="New preparation"
          />
          <View style={styles.sectionBody}>
            <Field
              hint={`${notes.length.toLocaleString()} / ${MAX_NOTES_CHARS.toLocaleString()} characters`}
              label="Rough notes">
              <ThemedInput
                maxLength={MAX_NOTES_CHARS}
                multiline
                onChangeText={setNotes}
                placeholder="What did the class cover? What is in scope for the exam?"
                style={styles.notesInput}
                textAlignVertical="top"
                value={notes}
              />
            </Field>

            <Field label="Language">
              <View style={styles.chipRow}>
                {LANGUAGES.map(option => (
                  <ChoiceChip
                    key={option.value}
                    label={option.label}
                    onPress={() => setLanguage(option.value)}
                    selected={language === option.value}
                  />
                ))}
              </View>
            </Field>

            <Field label="Depth">
              <View style={styles.chipRow}>
                {DEPTHS.map(option => (
                  <ChoiceChip
                    key={option.value}
                    label={option.label}
                    onPress={() => setDepth(option.value)}
                    selected={depth === option.value}
                  />
                ))}
              </View>
              <Text style={[styles.fieldHint, { color: colors.textFaint }]}>
                {DEPTHS.find(option => option.value === depth)?.hint}
              </Text>
            </Field>

            <Field
              hint="Optional. The generated plan is scaled to this total."
              label="Target minutes">
              <ThemedInput
                keyboardType="number-pad"
                onChangeText={value => setTarget(value.replace(/[^0-9]/g, ''))}
                placeholder="Leave empty for source-based time"
                value={target}
              />
            </Field>

            <Field
              hint={`PDF, PPTX, or Markdown · up to ${config.max_files} files · ${formatBytes(config.max_file_bytes)} each`}
              label="Sources">
              {files.length > 0 ? (
                <View style={styles.fileList}>
                  {files.map((file, index) => (
                    <FileRow
                      file={file}
                      key={`${file.uri}-${index}`}
                      onRemove={() =>
                        setFiles(current =>
                          current.filter((_, itemIndex) => itemIndex !== index),
                        )
                      }
                    />
                  ))}
                </View>
              ) : null}
              <Button
                disabled={files.length >= config.max_files}
                label="Add source files"
                left="+"
                onPress={() => void addFiles()}
                size="sm"
                variant="secondary"
              />
            </Field>

            <Button
              disabled={
                (!notes.trim() && files.length === 0) ||
                files.length > config.max_files
              }
              label="Generate notes and plan"
              onPress={() => void createRun()}
              pending={creating}
            />
          </View>
        </Card>
      ) : null}

      {selectedRun !== null ? (
        <Card
          onLayout={event => {
            selectedCardY.current = event.nativeEvent.layout.y;
          }}
          style={styles.section}>
          <SectionTitle
            right={<RunStatus run={selectedRun} />}
            subtitle={`${formatDateTime(selectedRun.created_at)} · ${
              selectedRun.options.depth
            } · ${selectedRun.options.language}`}
            title={selectedRun.title}
          />
          <View style={styles.sectionBody}>
            {active ? (
              <>
                <ProgressBar value={selectedRun.progress} max={100} />
                <View style={styles.progressMeta}>
                  <Text style={[styles.progressText, { color: colors.text }]}>
                    {selectedRun.stage_detail || 'Working…'}
                  </Text>
                  <Text style={[styles.progressValue, { color: colors.textMuted }]}>
                    {selectedRun.progress}%
                  </Text>
                </View>
                <Button
                  label="Cancel run"
                  onPress={() => void cancelRun(selectedRun)}
                  pending={pendingAction}
                  size="sm"
                  variant="secondary"
                />
              </>
            ) : null}

            {selectedRun.status === 'failed' ||
            selectedRun.status === 'cancelled' ||
            selectedRun.status === 'interrupted' ? (
              <>
                <View
                  style={[
                    styles.errorBox,
                    {
                      backgroundColor: colors.dangerSoft,
                      borderColor: colors.dangerBorder,
                    },
                  ]}>
                  <Text style={[styles.errorTitle, { color: colors.danger }]}>
                    {selectedRun.error?.message ??
                      STATUS_LABELS[selectedRun.status]}
                  </Text>
                  {selectedRun.error?.hint ? (
                    <Text style={[styles.errorText, { color: colors.danger }]}>
                      {selectedRun.error.hint}
                    </Text>
                  ) : null}
                </View>
                <View style={styles.actionRow}>
                  <Button
                    label="Retry"
                    onPress={() => void retryRun(selectedRun)}
                    pending={pendingAction}
                    size="sm"
                  />
                  <Button
                    label="Delete"
                    onPress={() => void removeRun(selectedRun)}
                    size="sm"
                    variant="ghost"
                  />
                </View>
              </>
            ) : null}

            {pollError !== null ? (
              <Text style={[styles.pollError, { color: colors.warn }]}>
                {pollError}
              </Text>
            ) : null}

            {selectedRun.warnings.length > 0 ? (
              <View
                style={[
                  styles.warningBox,
                  {
                    backgroundColor: colors.warnSoft,
                    borderColor: colors.warnBorder,
                  },
                ]}>
                {selectedRun.warnings.map(warning => (
                  <Text
                    key={warning}
                    style={[styles.warningText, { color: colors.warn }]}>
                    {warning}
                  </Text>
                ))}
              </View>
            ) : null}

            {selectedRun.status === 'ready' ? (
              <>
                <View style={styles.tabRow}>
                  <ChoiceChip
                    label="Notes"
                    onPress={() => setTab('notes')}
                    selected={tab === 'notes'}
                  />
                  <ChoiceChip
                    label="Plan"
                    onPress={() => setTab('plan')}
                    selected={tab === 'plan'}
                  />
                </View>

                {resultLoading ? (
                  <View style={styles.inlineLoading}>
                    <Spinner />
                    <Text
                      style={[styles.loadingText, { color: colors.textMuted }]}>
                      Loading the result…
                    </Text>
                  </View>
                ) : resultError !== null ? (
                  <ErrorCard
                    message={resultError}
                    onRetry={() => void loadResult(serverSaved, selectedRun.id)}
                    title="Could not load the result"
                  />
                ) : result !== null && tab === 'notes' ? (
                  <View
                    style={[
                      styles.notesCard,
                      {
                        backgroundColor: colors.cardAlt,
                        borderColor: colors.border,
                      },
                    ]}>
                    <Text
                      selectable
                      style={[styles.notesText, { color: colors.text }]}>
                      {result.notes.markdown}
                    </Text>
                  </View>
                ) : result !== null && tab === 'plan' ? (
                  <View style={styles.plan}>
                    <Text style={[styles.planMeta, { color: colors.textMuted }]}>
                      {result.plan.totals.subjects} subjects ·{' '}
                      {result.plan.totals.items} items ·{' '}
                      {formatHours(result.plan.totals.duration_seconds)}
                    </Text>
                    {result.plan.warnings.map(warning => (
                      <Text
                        key={warning}
                        style={[styles.warningText, { color: colors.warn }]}>
                        {warning}
                      </Text>
                    ))}
                    {result.plan.subjects.map((subject, subjectIndex) => (
                      <View key={subject.temp_id} style={styles.planSubject}>
                        {subjectIndex > 0 ? <Divider /> : null}
                        <Text
                          style={[styles.planSubjectName, { color: colors.text }]}>
                          {subject.name}
                        </Text>
                        {subject.chapter_title &&
                        subject.chapter_title !== subject.name ? (
                          <Text
                            style={[
                              styles.planChapter,
                              { color: colors.textFaint },
                            ]}>
                            {subject.chapter_title}
                          </Text>
                        ) : null}
                        {subject.items.map(item => (
                          <View key={item.temp_id} style={styles.planItem}>
                            <Text
                              style={[
                                styles.planItemText,
                                { color: colors.textMuted },
                              ]}>
                              • {item.text}
                            </Text>
                            <Text
                              style={[
                                styles.planItemMinutes,
                                { color: colors.textFaint },
                              ]}>
                              {Math.round(item.duration_seconds / 60)}m
                            </Text>
                          </View>
                        ))}
                      </View>
                    ))}

                    {imported ? (
                      <View
                        style={[
                          styles.importedBox,
                          {
                            backgroundColor: colors.goodSoft,
                            borderColor: colors.goodBorder,
                          },
                        ]}>
                        <Text
                          style={[styles.importedText, { color: colors.good }]}>
                          This plan is already in your checklist.
                        </Text>
                        <Button
                          label="Open checklist"
                          onPress={onOpenChecklist}
                          size="sm"
                          variant="secondary"
                        />
                      </View>
                    ) : (
                      <Button
                        label="Import plan to checklist"
                        onPress={() => void importPlan()}
                        pending={importing}
                      />
                    )}
                  </View>
                ) : null}
              </>
            ) : null}

            {!active &&
            selectedRun.status !== 'ready' &&
            selectedRun.status !== 'failed' &&
            selectedRun.status !== 'cancelled' &&
            selectedRun.status !== 'interrupted' ? (
              <Text style={[styles.loadingText, { color: colors.textMuted }]}>
                Waiting for the server…
              </Text>
            ) : null}
          </View>
        </Card>
      ) : null}

      <Card style={styles.section}>
        <SectionTitle
          right={
            serverSaved ? (
              <Button
                label="Refresh"
                onPress={() => void refreshServer(serverSaved)}
                size="sm"
                variant="ghost"
              />
            ) : undefined
          }
          subtitle="Runs stored by the server under state_dir()/study-prep."
          title="History"
        />
        <View style={styles.sectionBody}>
          {!serverSaved ? (
            <EmptyState
              mark="◇"
              message="Connect to the WebStudy backend to see previous preparations."
              title="No server connected"
            />
          ) : runsLoading && runs.length === 0 ? (
            <View style={styles.inlineLoading}>
              <Spinner />
              <Text style={[styles.loadingText, { color: colors.textMuted }]}>
                Loading history…
              </Text>
            </View>
          ) : runsError !== null && runs.length === 0 ? (
            <ErrorCard
              message={runsError}
              onRetry={() => void refreshServer(serverSaved, true)}
              title="Could not load history"
            />
          ) : runs.length === 0 ? (
            <EmptyState
              mark="✦"
              message="Start a preparation above and it will appear here."
              title="Nothing prepared yet"
            />
          ) : (
            <View style={styles.runList}>
              {runs.map((run, index) => (
                <View key={run.id}>
                  {index > 0 ? <Divider /> : null}
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ selected: run.id === selectedId }}
                    onPress={() => setSelectedId(run.id)}
                    style={({ pressed }) => [
                      styles.runRow,
                      run.id === selectedId && {
                        backgroundColor: colors.accentSoft,
                      },
                      pressed && styles.pressed,
                    ]}>
                    <View style={styles.runBody}>
                      <Text
                        numberOfLines={1}
                        style={[styles.runTitle, { color: colors.text }]}>
                        {run.title}
                      </Text>
                      <Text
                        numberOfLines={1}
                        style={[styles.runMeta, { color: colors.textMuted }]}>
                        {formatDateTime(run.created_at)} ·{' '}
                        {run.stage_detail || STATUS_LABELS[run.status]}
                      </Text>
                    </View>
                    <RunStatus run={run} />
                    <Pressable
                      accessibilityLabel={`Delete ${run.title}`}
                      hitSlop={8}
                      onPress={() => void removeRun(run)}
                      style={({ pressed }) => [
                        styles.removeButton,
                        pressed && styles.pressed,
                      ]}>
                      <Text
                        style={[styles.removeText, { color: colors.textFaint }]}>
                        ×
                      </Text>
                    </Pressable>
                  </Pressable>
                </View>
              ))}
            </View>
          )}
        </View>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  withJumpButton: { paddingBottom: 96 },
  jumpToPlan: {
    position: 'absolute',
    right: 16,
    bottom: 18,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 17,
    paddingVertical: 12,
    borderRadius: 999,
    elevation: 6,
    shadowOpacity: 0.28,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
  },
  jumpToPlanText: { fontSize: 13, fontWeight: '800' },
  jumpToPlanGlyph: { fontSize: 16, fontWeight: '800', lineHeight: 18 },
  section: { padding: 16, gap: 12 },
  sectionBody: { gap: 12 },
  loadingCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 16,
  },
  loadingText: { fontSize: 13, lineHeight: 18 },
  inlineLoading: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  serverHint: { fontSize: 10, flexShrink: 1 },
  infoBox: { borderWidth: 1, borderRadius: 12, padding: 10 },
  infoText: { fontSize: 11, lineHeight: 16 },
  code: { fontFamily: 'monospace' },
  providerBox: { borderWidth: 1, borderRadius: 12, padding: 10, gap: 3 },
  providerTitle: { fontSize: 12, fontWeight: '700' },
  providerText: { fontSize: 11, lineHeight: 16 },
  notesInput: { minHeight: 108, paddingTop: 10 },
  fieldHint: { fontSize: 11, lineHeight: 16 },
  chipRow: { flexDirection: 'row', gap: 7, flexWrap: 'wrap' },
  chip: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  chipText: { fontSize: 12, fontWeight: '700' },
  fileList: { gap: 6 },
  fileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    borderWidth: 1,
    borderRadius: 12,
    padding: 8,
  },
  fileMark: {
    width: 34,
    height: 34,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fileMarkText: { fontSize: 9, fontWeight: '800' },
  fileBody: { flex: 1, gap: 1 },
  fileName: { fontSize: 12, fontWeight: '600' },
  fileMeta: { fontSize: 10 },
  removeButton: { paddingHorizontal: 6, paddingVertical: 2 },
  removeText: { fontSize: 20, lineHeight: 22 },
  pressed: { opacity: 0.6 },
  errorTitle: { fontSize: 13, fontWeight: '700' },
  errorText: { fontSize: 11, lineHeight: 16, marginTop: 2 },
  errorBox: { borderWidth: 1, borderRadius: 12, padding: 10 },
  warningBox: { borderWidth: 1, borderRadius: 12, padding: 10, gap: 4 },
  warningText: { fontSize: 11, lineHeight: 16 },
  pollError: { fontSize: 11, lineHeight: 16 },
  progressMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  progressText: { fontSize: 12, flexShrink: 1 },
  progressValue: {
    fontSize: 12,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  tabRow: { flexDirection: 'row', gap: 8 },
  notesCard: { borderWidth: 1, borderRadius: 12, padding: 12 },
  notesText: { fontSize: 13, lineHeight: 20 },
  plan: { gap: 12 },
  planMeta: { fontSize: 12 },
  planSubject: { gap: 6, paddingTop: 8 },
  planSubjectName: { fontSize: 14, fontWeight: '700' },
  planChapter: { fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.4 },
  planItem: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  planItemText: { flex: 1, fontSize: 12, lineHeight: 17 },
  planItemMinutes: {
    fontSize: 11,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
    minWidth: 34,
    textAlign: 'right',
  },
  importedBox: { borderWidth: 1, borderRadius: 12, padding: 10, gap: 8 },
  importedText: { fontSize: 12, lineHeight: 17 },
  runList: { gap: 0 },
  runRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    borderRadius: 10,
    paddingHorizontal: 6,
    paddingVertical: 9,
  },
  runBody: { flex: 1, gap: 2 },
  runTitle: { fontSize: 13, fontWeight: '600' },
  runMeta: { fontSize: 10 },
});
