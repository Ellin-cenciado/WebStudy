import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import {
  Button,
  Card,
  Divider,
  Field,
  NumberField,
  PageHeader,
  Screen,
  SectionTitle,
  Spinner,
  ThemedInput,
  ToggleRow,
} from '../components/ui';
import { useConfig } from '../context/ConfigContext';
import { useTheme, type ThemePreference } from '../context/ThemeContext';
import { useToast } from '../context/ToastContext';
import { errorMessage, titleCase } from '../lib/format';
import {
  DAY_MODES,
  WEEKDAYS,
  type Config,
  type DayMode,
  type WeekdayName,
} from '../lib/types';

const MODE_HELP: Record<DayMode, string> = {
  carried: 'Unmet required time carries into the next day.',
  optional: 'A goal only; unmet time is discarded.',
  free: 'No requirement. Existing debt is preserved.',
};

const THEME_OPTIONS: Array<{ value: ThemePreference; label: string }> = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

function cloneConfig(config: Config): Config {
  return JSON.parse(JSON.stringify(config)) as Config;
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

function SettingsSection({
  title,
  subtitle,
  children,
  right,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  right?: React.ReactNode;
}) {
  return (
    <Card style={styles.section}>
      <SectionTitle right={right} subtitle={subtitle} title={title} />
      <View style={styles.sectionBody}>{children}</View>
    </Card>
  );
}

export function SettingsScreen() {
  const { config, loading, error, refresh, save } = useConfig();
  const { colors, preference, setPreference } = useTheme();
  const { push } = useToast();
  const [draft, setDraft] = useState<Config | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (config !== null) {
      setDraft(cloneConfig(config));
    }
  }, [config]);

  const dirty = useMemo(
    () =>
      config !== null &&
      draft !== null &&
      JSON.stringify(config) !== JSON.stringify(draft),
    [config, draft],
  );

  const patch = (update: Partial<Config>) => {
    setDraft(current => (current === null ? current : { ...current, ...update }));
  };

  const updateDay = (day: WeekdayName, update: Partial<Config['schedule'][WeekdayName]>) => {
    setDraft(current => {
      if (current === null) {
        return current;
      }
      return {
        ...current,
        schedule: {
          ...current.schedule,
          [day]: { ...current.schedule[day], ...update },
        },
      };
    });
  };

  const changeMode = (day: WeekdayName, mode: DayMode) => {
    if (draft === null) {
      return;
    }
    const current = draft.schedule[day];
    let quota = current.quota_minutes;
    if (mode === 'free') {
      quota = 0;
    } else if (current.mode === 'free' && quota === 0) {
      quota = 240;
    }
    updateDay(day, { mode, quota_minutes: quota });
  };

  const submit = async () => {
    if (draft === null || !dirty) {
      return;
    }
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(draft.boundary.trim())) {
      push({
        kind: 'error',
        title: 'Invalid day boundary',
        body: 'Use 24-hour time in HH:MM format, for example 04:00.',
      });
      return;
    }
    if (draft.study_minutes < 1 || draft.break_minutes < 1) {
      push({
        kind: 'error',
        title: 'Invalid phase length',
        body: 'Study and break phases must be at least one minute.',
      });
      return;
    }
    setPending(true);
    try {
      await save({ ...draft, boundary: draft.boundary.trim() });
      push({ kind: 'success', title: 'Settings saved' });
    } catch (caught) {
      push({
        kind: 'error',
        title: 'Could not save settings',
        body: errorMessage(caught),
      });
    } finally {
      setPending(false);
    }
  };

  if (loading && config === null) {
    return (
      <Screen>
        <Card style={styles.loadingCard}>
          <Spinner />
          <Text style={[styles.loadingText, { color: colors.textMuted }]}>
            Loading settings…
          </Text>
        </Card>
      </Screen>
    );
  }

  if (error !== null && config === null) {
    return (
      <Screen>
        <PageHeader title="Settings" />
        <Card
          style={[
            styles.errorCard,
            { backgroundColor: colors.dangerSoft, borderColor: colors.dangerBorder },
          ]}>
          <Text style={[styles.errorTitle, { color: colors.danger }]}>
            Could not load settings
          </Text>
          <Text style={[styles.errorText, { color: colors.danger }]}>{error}</Text>
          <Button label="Try again" onPress={() => void refresh()} size="sm" />
        </Card>
      </Screen>
    );
  }

  if (draft === null) {
    return null;
  }

  return (
    <Screen>
      <PageHeader
        title="Settings"
        subtitle="Stored on this device and shared by every mobile screen."
        actions={
          <>
            <Button
              disabled={!dirty || pending}
              label="Reset"
              onPress={() => setDraft(config ? cloneConfig(config) : draft)}
              size="sm"
              variant="secondary"
            />
            <Button
              disabled={!dirty}
              label="Save"
              left="✓"
              onPress={() => void submit()}
              pending={pending}
              size="sm"
            />
          </>
        }
      />

      {error !== null ? (
        <Card
          style={[
            styles.notice,
            { backgroundColor: colors.warnSoft, borderColor: colors.warnBorder },
          ]}>
          <Text style={[styles.noticeText, { color: colors.warn }]}>{error}</Text>
        </Card>
      ) : null}

      <SettingsSection
        subtitle="The logical day rolls over at this local time."
        title="General">
        <Field
          hint="Use 04:00 for late-night study."
          label="Day boundary">
          <ThemedInput
            autoCapitalize="none"
            keyboardType="numbers-and-punctuation"
            maxLength={5}
            onChangeText={value => patch({ boundary: value })}
            placeholder="04:00"
            style={styles.boundaryInput}
            value={draft.boundary}
          />
        </Field>
        <ToggleRow
          description="Begin a study phase as soon as the engine starts."
          label="Start automatically"
          onValueChange={value => patch({ auto_start: value })}
          value={draft.auto_start}
        />
        <ToggleRow
          description="Show phase, rest, and day-complete alerts while the app is open."
          label="In-app alerts"
          onValueChange={value => patch({ notifications: value })}
          value={draft.notifications}
        />
      </SettingsSection>

      <SettingsSection
        subtitle="Breaks count toward the daily session, by design."
        title="Pomodoro">
        <View style={styles.inlineFields}>
          <Field label="Study phase">
            <View style={styles.numberRow}>
              <NumberField
                max={240}
                min={1}
                onCommit={value => patch({ study_minutes: value })}
                style={styles.numberInput}
                value={draft.study_minutes}
              />
              <Text style={[styles.unit, { color: colors.textMuted }]}>min</Text>
            </View>
          </Field>
          <Field label="Break phase">
            <View style={styles.numberRow}>
              <NumberField
                max={120}
                min={1}
                onCommit={value => patch({ break_minutes: value })}
                style={styles.numberInput}
                value={draft.break_minutes}
              />
              <Text style={[styles.unit, { color: colors.textMuted }]}>min</Text>
            </View>
          </Field>
        </View>
      </SettingsSection>

      <SettingsSection
        subtitle="Each weekday can require carried hours, set an optional goal, or be free."
        title="Weekly schedule">
        <View>
          {WEEKDAYS.map((day, index) => {
            const setting = draft.schedule[day];
            return (
              <View key={day}>
                <View style={styles.weekdayRow}>
                  <View style={styles.weekdayTop}>
                    <Text style={[styles.weekdayName, { color: colors.text }]}>
                      {titleCase(day)}
                    </Text>
                    <View style={styles.chips}>
                      {DAY_MODES.map(mode => (
                        <ChoiceChip
                          key={mode}
                          label={titleCase(mode)}
                          onPress={() => changeMode(day, mode)}
                          selected={setting.mode === mode}
                        />
                      ))}
                    </View>
                  </View>
                  <View style={styles.weekdayBottom}>
                    {setting.mode === 'free' ? (
                      <Text style={[styles.help, { color: colors.textMuted }]}>
                        No quota
                      </Text>
                    ) : (
                      <View style={styles.numberRow}>
                        <NumberField
                          max={1440}
                          min={0}
                          onCommit={value =>
                            updateDay(day, { quota_minutes: value })
                          }
                          style={styles.quotaInput}
                          value={setting.quota_minutes}
                        />
                        <Text style={[styles.unit, { color: colors.textMuted }]}>
                          min
                        </Text>
                      </View>
                    )}
                    <Text style={[styles.help, styles.helpGrow, { color: colors.textFaint }]}>
                      {MODE_HELP[setting.mode]}
                    </Text>
                  </View>
                </View>
                {index < WEEKDAYS.length - 1 ? <Divider /> : null}
              </View>
            );
          })}
        </View>
      </SettingsSection>

      <SettingsSection
        subtitle="Follow the device or choose a fixed appearance."
        title="Appearance">
        <View style={styles.chips}>
          {THEME_OPTIONS.map(option => (
            <ChoiceChip
              key={option.value}
              label={option.label}
              onPress={() => setPreference(option.value)}
              selected={preference === option.value}
            />
          ))}
        </View>
        <Text style={[styles.paragraph, { color: colors.textMuted }]}>
          The choice is remembered on this device. System mode follows Android's
          dark-theme setting.
        </Text>
      </SettingsSection>

      <SettingsSection
        subtitle="Everything stays in app-private storage."
        title="Your data">
        <Text style={[styles.paragraph, { color: colors.textMuted }]}>
          The embedded Python engine stores config, state, checklist, and history
          on this device. Nothing is uploaded. Uninstalling the app removes the
          data.
        </Text>
        <Text style={[styles.paragraph, { color: colors.textFaint }]}>
          The desktop transparency settings are not used on Android.
        </Text>
      </SettingsSection>

      <Text style={[styles.footer, { color: colors.textFaint }]}>
        WebStudy mobile · Python engine bundled with Chaquopy
      </Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  loadingCard: { minHeight: 160, alignItems: 'center', justifyContent: 'center', gap: 10 },
  loadingText: { fontSize: 13 },
  errorCard: { gap: 8 },
  errorTitle: { fontSize: 14, fontWeight: '700' },
  errorText: { fontSize: 12, lineHeight: 17 },
  notice: { padding: 12 },
  noticeText: { fontSize: 12, lineHeight: 17 },
  section: { gap: 14 },
  sectionBody: { gap: 12 },
  boundaryInput: { width: 110, fontVariant: ['tabular-nums'] },
  inlineFields: { flexDirection: 'row', gap: 16, flexWrap: 'wrap' },
  numberRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  numberInput: { width: 82, fontVariant: ['tabular-nums'] },
  quotaInput: { width: 72, fontVariant: ['tabular-nums'] },
  unit: { fontSize: 12 },
  chips: { flexDirection: 'row', gap: 5, flexWrap: 'wrap' },
  chip: {
    borderRadius: 9,
    borderWidth: 1,
    paddingHorizontal: 9,
    paddingVertical: 6,
  },
  chipText: { fontSize: 11, fontWeight: '700' },
  weekdayRow: { gap: 8, paddingVertical: 10 },
  weekdayTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    flexWrap: 'wrap',
  },
  weekdayName: { fontSize: 14, fontWeight: '700', width: 78 },
  weekdayBottom: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flexWrap: 'wrap',
    paddingLeft: 0,
  },
  help: { fontSize: 10, lineHeight: 15 },
  helpGrow: { flex: 1, minWidth: 150 },
  paragraph: { fontSize: 12, lineHeight: 18 },
  footer: { fontSize: 10, textAlign: 'center', paddingBottom: 4 },
});
