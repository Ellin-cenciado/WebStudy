import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import {
  Badge,
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
import { useLanguage } from '../context/LanguageContext';
import { useLive } from '../context/LiveContext';
import { useTheme, type ThemePreference } from '../context/ThemeContext';
import { useToast } from '../context/ToastContext';
import { api } from '../lib/api';
import { errorMessage, formatDate, formatHours } from '../lib/format';
import { modeLabel, weekdayLabel } from '../i18n/labels';
import type { LanguagePreference, MessageKey } from '../i18n';
import {
  DAY_MODES,
  WEEKDAYS,
  type Config,
  type DayMode,
  type Recovery,
  type WeekdayName,
} from '../lib/types';

const THEME_OPTIONS: Array<{ value: ThemePreference; labelKey: MessageKey }> = [
  { value: 'system', labelKey: 'settings.appearance.system' },
  { value: 'light', labelKey: 'settings.appearance.light' },
  { value: 'dark', labelKey: 'settings.appearance.dark' },
];

const LANGUAGE_OPTIONS: Array<{
  value: LanguagePreference;
  labelKey: MessageKey;
}> = [
  { value: 'system', labelKey: 'settings.language.system' },
  { value: 'en', labelKey: 'settings.language.english' },
  { value: 'es', labelKey: 'settings.language.spanish' },
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
  const { colors, preference: themePreference, setPreference: setThemePreference } =
    useTheme();
  const {
    preference: languagePreference,
    setPreference: setLanguagePreference,
    t,
    language,
  } = useLanguage();
  const { push } = useToast();
  const {
    state,
    applyPayload,
    notificationPermission,
    requestNotificationPermission,
  } = useLive();
  const [draft, setDraft] = useState<Config | null>(null);
  const [pending, setPending] = useState(false);
  const [recovery, setRecovery] = useState<Recovery | null>(null);
  const [resetPending, setResetPending] = useState(false);

  useEffect(() => {
    if (config !== null) {
      setDraft(cloneConfig(config));
    }
  }, [config]);

  const refreshRecovery = useCallback(async () => {
    try {
      setRecovery(await api.recovery());
    } catch {
      // Recovery details are optional; settings still work without them.
    }
  }, []);

  useEffect(() => {
    void refreshRecovery();
  }, [refreshRecovery]);

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

  const updateVacation = (update: Partial<Config['vacation']>) => {
    setDraft(current =>
      current === null
        ? current
        : { ...current, vacation: { ...current.vacation, ...update } },
    );
  };

  const debtSeconds =
    state?.snapshot.debt_seconds ?? recovery?.debt_seconds ?? 0;

  const submit = async () => {
    if (draft === null || !dirty) {
      return;
    }
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(draft.boundary.trim())) {
      push({
        kind: 'error',
        title: t('settings.invalidBoundaryTitle'),
        body: t('settings.invalidBoundaryBody'),
      });
      return;
    }
    if (draft.study_minutes < 1 || draft.break_minutes < 1) {
      push({
        kind: 'error',
        title: t('settings.invalidPhaseTitle'),
        body: t('settings.invalidPhaseBody'),
      });
      return;
    }
    if (
      draft.vacation.enabled &&
      draft.vacation.start !== null &&
      draft.vacation.end !== null &&
      draft.vacation.start > draft.vacation.end
    ) {
      push({
        kind: 'error',
        title: t('settings.invalidVacationTitle'),
        body: t('settings.invalidVacationBody'),
      });
      return;
    }
    if (draft.reset_cooldown_days < 1) {
      push({
        kind: 'error',
        title: t('settings.invalidCooldownTitle'),
        body: t('settings.invalidCooldownBody'),
      });
      return;
    }
    setPending(true);
    try {
      await save({ ...draft, boundary: draft.boundary.trim() });
      await refreshRecovery();
      push({ kind: 'success', title: t('settings.saved') });
    } catch (caught) {
      push({
        kind: 'error',
        title: t('settings.saveError'),
        body: errorMessage(caught),
      });
    } finally {
      setPending(false);
    }
  };

  const resetDebt = async () => {
    if (debtSeconds <= 0 || recovery === null || !recovery.can_reset) {
      return;
    }
    setResetPending(true);
    try {
      const result = await api.resetDebt();
      applyPayload(result);
      setRecovery(result.recovery);
    } catch (caught) {
      push({
        kind: 'error',
        title: t('settings.resetDebtError'),
        body: errorMessage(caught),
      });
    } finally {
      setResetPending(false);
    }
  };

  const confirmReset = () => {
    if (debtSeconds <= 0 || recovery === null || !recovery.can_reset) {
      return;
    }
    Alert.alert(
      t('settings.resetTitle'),
      t('settings.resetMessage', {
        hours: formatHours(debtSeconds),
        days: recovery.cooldown_days,
      }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('settings.forgive'),
          style: 'destructive',
          onPress: () => void resetDebt(),
        },
      ],
    );
  };

  if (loading && config === null) {
    return (
      <Screen>
        <Card style={styles.loadingCard}>
          <Spinner />
          <Text style={[styles.loadingText, { color: colors.textMuted }]}>
            {t('settings.loading')}
          </Text>
        </Card>
      </Screen>
    );
  }

  if (error !== null && config === null) {
    return (
      <Screen>
        <PageHeader title={t('settings.errorTitle')} />
        <Card
          style={[
            styles.errorCard,
            { backgroundColor: colors.dangerSoft, borderColor: colors.dangerBorder },
          ]}>
          <Text style={[styles.errorTitle, { color: colors.danger }]}>
            {t('settings.errorTitle')}
          </Text>
          <Text style={[styles.errorText, { color: colors.danger }]}>{error}</Text>
          <Button
            label={t('common.tryAgain')}
            onPress={() => void refresh()}
            size="sm"
          />
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
        title={t('tab.settings')}
        subtitle={t('settings.headerSubtitle')}
        actions={
          <>
            <Button
              disabled={!dirty || pending}
              label={t('common.reset')}
              onPress={() => setDraft(config ? cloneConfig(config) : draft)}
              size="sm"
              variant="secondary"
            />
            <Button
              disabled={!dirty}
              label={t('common.save')}
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
        subtitle={t('settings.general.subtitle')}
        title={t('settings.general.title')}>
        <Field
          hint={t('settings.boundary.hint')}
          label={t('settings.boundary.label')}>
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
          description={t('settings.autoStart.description')}
          label={t('settings.autoStart.label')}
          onValueChange={value => patch({ auto_start: value })}
          value={draft.auto_start}
        />
        <ToggleRow
          description={t('settings.alerts.description')}
          label={t('settings.alerts.label')}
          onValueChange={value => patch({ notifications: value })}
          value={draft.notifications}
        />
        <View style={styles.notificationRow}>
          <View style={styles.notificationBody}>
            <Text style={[styles.notificationTitle, { color: colors.text }]}>
              {t('settings.notifications.title')}
            </Text>
            <Text style={[styles.notificationHint, { color: colors.textMuted }]}>
              {notificationPermission === 'granted'
                ? t('settings.notifications.granted')
                : notificationPermission === 'denied'
                  ? t('settings.notifications.denied')
                  : t('settings.notifications.unknown')}
            </Text>
          </View>
          {notificationPermission === 'granted' ? (
            <Badge label={t('settings.notifications.allowed')} tone="good" />
          ) : (
            <View style={styles.notificationActions}>
              <Button
                label={t('common.allow')}
                onPress={() => void requestNotificationPermission()}
                size="sm"
              />
              {notificationPermission === 'denied' ? (
                <Button
                  label={t('common.settingsButton')}
                  onPress={() => void Linking.openSettings()}
                  size="sm"
                  variant="ghost"
                />
              ) : null}
            </View>
          )}
        </View>
      </SettingsSection>

      <SettingsSection
        subtitle={t('settings.vacation.subtitle')}
        title={t('settings.vacation.title')}>
        <ToggleRow
          description={t('settings.vacation.enableDescription')}
          label={t('settings.vacation.enable')}
          onValueChange={value => updateVacation({ enabled: value })}
          value={draft.vacation.enabled}
        />
        {draft.vacation.enabled ? (
          <View style={styles.inlineFields}>
            <Field
              hint={t('settings.vacation.startsHint')}
              label={t('settings.vacation.starts')}>
              <ThemedInput
                autoCapitalize="none"
                onChangeText={value =>
                  updateVacation({ start: value.trim() || null })
                }
                placeholder="YYYY-MM-DD"
                style={styles.dateInput}
                value={draft.vacation.start ?? ''}
              />
            </Field>
            <Field
              hint={t('settings.vacation.endsHint')}
              label={t('settings.vacation.ends')}>
              <ThemedInput
                autoCapitalize="none"
                onChangeText={value =>
                  updateVacation({ end: value.trim() || null })
                }
                placeholder="YYYY-MM-DD"
                style={styles.dateInput}
                value={draft.vacation.end ?? ''}
              />
            </Field>
          </View>
        ) : null}
        <Text style={[styles.paragraph, { color: colors.textMuted }]}>
          {t('settings.vacation.paragraph')}
        </Text>
      </SettingsSection>

      <SettingsSection
        subtitle={t('settings.pomodoro.subtitle')}
        title={t('settings.pomodoro.title')}>
        <View style={styles.inlineFields}>
          <Field label={t('settings.pomodoro.study')}>
            <View style={styles.numberRow}>
              <NumberField
                max={240}
                min={1}
                onCommit={value => patch({ study_minutes: value })}
                style={styles.numberInput}
                value={draft.study_minutes}
              />
              <Text style={[styles.unit, { color: colors.textMuted }]}>
                {t('common.minutesShort')}
              </Text>
            </View>
          </Field>
          <Field label={t('settings.pomodoro.break')}>
            <View style={styles.numberRow}>
              <NumberField
                max={120}
                min={1}
                onCommit={value => patch({ break_minutes: value })}
                style={styles.numberInput}
                value={draft.break_minutes}
              />
              <Text style={[styles.unit, { color: colors.textMuted }]}>
                {t('common.minutesShort')}
              </Text>
            </View>
          </Field>
        </View>
      </SettingsSection>

      <SettingsSection
        subtitle={t('settings.recovery.subtitle')}
        title={t('settings.recovery.title')}>
        <View style={styles.recoveryDebtRow}>
          <Text style={[styles.recoveryDebtLabel, { color: colors.textMuted }]}>
            {t('settings.recovery.carriedDebt')}
          </Text>
          <Text style={[styles.recoveryDebtValue, { color: colors.text }]}>
            {formatHours(debtSeconds)}
          </Text>
        </View>
        <View style={styles.inlineFields}>
          <Field
            hint={t('settings.recovery.maxDebtHint')}
            label={t('settings.recovery.maxDebt')}>
            <View style={styles.numberRow}>
              <NumberField
                max={168}
                min={0}
                onCommit={value => patch({ max_debt_hours: value })}
                style={styles.numberInput}
                value={draft.max_debt_hours}
              />
              <Text style={[styles.unit, { color: colors.textMuted }]}>
                {t('common.hours')}
              </Text>
            </View>
          </Field>
          <Field
            hint={t('settings.recovery.cooldownHint')}
            label={t('settings.recovery.cooldown')}>
            <View style={styles.numberRow}>
              <NumberField
                max={365}
                min={1}
                onCommit={value => patch({ reset_cooldown_days: value })}
                style={styles.numberInput}
                value={draft.reset_cooldown_days}
              />
              <Text style={[styles.unit, { color: colors.textMuted }]}>
                {t('common.days')}
              </Text>
            </View>
          </Field>
        </View>
        <View style={styles.recoveryActions}>
          <Button
            disabled={
              debtSeconds <= 0 ||
              recovery === null ||
              !recovery.can_reset ||
              resetPending
            }
            label={t('settings.recovery.forgive')}
            onPress={confirmReset}
            pending={resetPending}
            size="sm"
            variant="secondary"
          />
          <Text style={[styles.help, styles.helpGrow, { color: colors.textMuted }]}>
            {debtSeconds <= 0
              ? recovery?.next_reset_on != null
                ? t('settings.recovery.noDebtNext', {
                    date: formatDate(recovery.next_reset_on, language),
                  })
                : t('settings.recovery.noDebt')
              : recovery === null
                ? t('settings.recovery.checking')
                : recovery.can_reset
                  ? t('settings.recovery.available')
                  : recovery.next_reset_on !== null
                    ? t('settings.recovery.nextAvailable', {
                        date: formatDate(recovery.next_reset_on, language),
                      })
                    : t('settings.recovery.cooldownActive')}
          </Text>
        </View>
        <Text style={[styles.paragraph, { color: colors.textMuted }]}>
          {t('settings.recovery.paragraph')}
        </Text>
      </SettingsSection>

      <SettingsSection
        subtitle={t('settings.schedule.subtitle')}
        title={t('settings.schedule.title')}>
        <View>
          {WEEKDAYS.map((day, index) => {
            const setting = draft.schedule[day];
            return (
              <View key={day}>
                <View style={styles.weekdayRow}>
                  <View style={styles.weekdayTop}>
                    <Text style={[styles.weekdayName, { color: colors.text }]}>
                      {weekdayLabel(t, day)}
                    </Text>
                    <View style={styles.chips}>
                      {DAY_MODES.map(mode => (
                        <ChoiceChip
                          key={mode}
                          label={modeLabel(t, mode)}
                          onPress={() => changeMode(day, mode)}
                          selected={setting.mode === mode}
                        />
                      ))}
                    </View>
                  </View>
                  <View style={styles.weekdayBottom}>
                    {setting.mode === 'free' ? (
                      <Text style={[styles.help, { color: colors.textMuted }]}>
                        {t('settings.schedule.noQuota')}
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
                          {t('common.minutesShort')}
                        </Text>
                      </View>
                    )}
                    <Text style={[styles.help, styles.helpGrow, { color: colors.textFaint }]}>
                      {t(
                        setting.mode === 'carried'
                          ? 'timer.dayHint.carried'
                          : setting.mode === 'optional'
                            ? 'timer.dayHint.optional'
                            : 'timer.dayHint.free',
                      )}
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
        subtitle={t('settings.language.subtitle')}
        title={t('settings.language.title')}>
        <View style={styles.chips}>
          {LANGUAGE_OPTIONS.map(option => (
            <ChoiceChip
              key={option.value}
              label={t(option.labelKey)}
              onPress={() => setLanguagePreference(option.value)}
              selected={languagePreference === option.value}
            />
          ))}
        </View>
        <Text style={[styles.paragraph, { color: colors.textMuted }]}>
          {t('settings.language.paragraph')}
        </Text>
      </SettingsSection>

      <SettingsSection
        subtitle={t('settings.appearance.subtitle')}
        title={t('settings.appearance.title')}>
        <View style={styles.chips}>
          {THEME_OPTIONS.map(option => (
            <ChoiceChip
              key={option.value}
              label={t(option.labelKey)}
              onPress={() => setThemePreference(option.value)}
              selected={themePreference === option.value}
            />
          ))}
        </View>
        <Text style={[styles.paragraph, { color: colors.textMuted }]}>
          {t('settings.appearance.paragraph')}
        </Text>
      </SettingsSection>

      <SettingsSection
        subtitle={t('settings.data.subtitle')}
        title={t('settings.data.title')}>
        <Text style={[styles.paragraph, { color: colors.textMuted }]}>
          {t('settings.data.paragraph')}
        </Text>
        <Text style={[styles.paragraph, { color: colors.textFaint }]}>
          {t('settings.data.paragraph2')}
        </Text>
      </SettingsSection>

      <Text style={[styles.footer, { color: colors.textFaint }]}>
        {t('settings.footer')}
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
  dateInput: { width: 145, fontVariant: ['tabular-nums'] },
  inlineFields: { flexDirection: 'row', gap: 16, flexWrap: 'wrap' },
  numberRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  numberInput: { width: 82, fontVariant: ['tabular-nums'] },
  quotaInput: { width: 72, fontVariant: ['tabular-nums'] },
  unit: { fontSize: 12 },
  recoveryDebtRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 10,
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
  },
  recoveryDebtLabel: { fontSize: 12, fontWeight: '600' },
  recoveryDebtValue: { fontSize: 24, fontWeight: '700', fontVariant: ['tabular-nums'] },
  recoveryActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flexWrap: 'wrap',
  },
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
  weekdayName: { fontSize: 14, fontWeight: '700', width: 96 },
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
  notificationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
  },
  notificationBody: { flex: 1, gap: 2 },
  notificationTitle: { fontSize: 13, fontWeight: '700' },
  notificationHint: { fontSize: 11, lineHeight: 16 },
  notificationActions: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  footer: { fontSize: 10, textAlign: 'center', paddingBottom: 4 },
});
