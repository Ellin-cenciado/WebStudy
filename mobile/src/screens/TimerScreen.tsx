import React from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import {
  Badge,
  Button,
  Card,
  PageHeader,
  ProgressBar,
  Screen,
  Spinner,
} from '../components/ui';
import { useLive } from '../context/LiveContext';
import { useLanguage } from '../context/LanguageContext';
import { useTheme } from '../context/ThemeContext';
import { useAction } from '../hooks/useAction';
import { api, backgroundTimer } from '../lib/api';
import { formatClock, formatHours, formatTimestamp } from '../lib/format';
import {
  dayKindLabel,
  phaseLabel,
  weekdayLabel,
} from '../i18n/labels';
import type { Translate } from '../i18n';

function phaseBadge(
  t: Translate,
  phase: string,
  freeDay: boolean,
  complete: boolean,
  vacation = false,
): string {
  if (complete) {
    return t('timer.dayComplete');
  }
  if (vacation) {
    return t('timer.vacation');
  }
  if (freeDay) {
    return t('timer.freeDay');
  }
  if (phase === 'idle') {
    return t('timer.ready');
  }
  return phaseLabel(t, phase);
}

function phaseTone(
  complete: boolean,
  freeDay: boolean,
  phase: string,
): 'good' | 'muted' | 'warn' | 'accent' {
  if (complete) {
    return 'good';
  }
  if (freeDay) {
    return 'muted';
  }
  if (phase === 'break') {
    return 'warn';
  }
  return 'accent';
}

export function TimerScreen() {
  const {
    state,
    connected,
    awaySeconds,
    dismissAway,
    notificationPermission,
    requestNotificationPermission,
  } = useLive();
  const { colors } = useTheme();
  const { t, language } = useLanguage();
  const { pending, run } = useAction();
  const snapshot = state?.snapshot;

  if (state === null || snapshot === undefined) {
    return (
      <Screen>
        <Card style={styles.loadingCard}>
          <Spinner />
          <Text style={[styles.loadingText, { color: colors.textMuted }]}>
            {t('timer.loading')}
          </Text>
        </Card>
      </Screen>
    );
  }

  const complete = snapshot.day_complete;
  const freeDay = snapshot.is_free_day;
  const vacation = snapshot.is_vacation;
  const running = snapshot.running;
  const canControl = connected && !complete && !freeDay;
  const phaseLength = snapshot.phase_length_seconds;
  const countdown =
    complete || freeDay || snapshot.phase === 'idle'
      ? null
      : formatClock(snapshot.phase_remaining_seconds);

  const primaryLabel = complete
    ? t('timer.done')
    : vacation
      ? t('timer.vacation')
      : freeDay
        ? t('timer.freeDay')
        : running
          ? t('timer.pause')
          : snapshot.phase === 'complete'
            ? t('timer.done')
            : t('timer.start');

  const heading = complete
    ? t('timer.heading.done')
    : vacation
      ? t('timer.heading.vacation')
      : freeDay
        ? t('timer.heading.free')
        : running
          ? t('timer.heading.running')
          : t('timer.heading.ready');

  const onPrimary = async () => {
    if (!running) {
      await requestNotificationPermission();
    }
    const ok = await run(() => (running ? api.pause() : api.start()));
    if (ok && !running) {
      void backgroundTimer.start().catch(() => {
        // The state effect will retry while the app is still visible.
      });
    }
  };

  return (
    <Screen>
      <PageHeader
        title={heading}
        subtitle={`${weekdayLabel(t, snapshot.weekday)} · ${snapshot.logical_day}`}
        actions={
          <Badge
            label={running ? t('timer.running') : t('timer.paused')}
            tone={running ? 'good' : 'muted'}
          />
        }
      />

      {awaySeconds !== null ? (
        <View
          style={[
            styles.awayBanner,
            {
              backgroundColor: colors.goodSoft,
              borderColor: colors.goodBorder,
            },
          ]}>
          <View style={styles.awayBody}>
            <Text style={[styles.awayTitle, { color: colors.good }]}>
              {t('timer.awayTitle')}
            </Text>
            <Text style={[styles.awayText, { color: colors.good }]}>
              {t('timer.awayBody', { time: formatClock(awaySeconds) })}
            </Text>
          </View>
          <Pressable
            accessibilityLabel={t('timer.dismissAway')}
            hitSlop={10}
            onPress={dismissAway}
            style={styles.awayDismiss}>
            <Text style={[styles.awayDismissText, { color: colors.good }]}>
              ×
            </Text>
          </Pressable>
        </View>
      ) : null}

      {notificationPermission === 'denied' ? (
        <View
          style={[
            styles.permissionBanner,
            {
              backgroundColor: colors.warnSoft,
              borderColor: colors.warnBorder,
            },
          ]}>
          <View style={styles.awayBody}>
            <Text style={[styles.awayTitle, { color: colors.warn }]}>
              {t('timer.notificationsOff')}
            </Text>
            <Text style={[styles.awayText, { color: colors.warn }]}>
              {t('timer.notificationsBody')}
            </Text>
          </View>
          <View style={styles.permissionActions}>
            <Button
              label={t('common.allow')}
              onPress={() => void requestNotificationPermission()}
              size="sm"
              variant="secondary"
            />
            <Button
              label={t('common.settingsButton')}
              onPress={() => void Linking.openSettings()}
              size="sm"
              variant="ghost"
            />
          </View>
        </View>
      ) : null}

      <Card style={styles.timerCard}>
        <View style={styles.timerTop}>
          <Badge
            label={phaseBadge(t, snapshot.phase, freeDay, complete, vacation)}
            tone={phaseTone(complete, freeDay, snapshot.phase)}
          />
          <Text style={[styles.updated, { color: colors.textFaint }]}>
            {running
              ? t('timer.live', { time: formatTimestamp(state.server_time, language) })
              : t('timer.updated', {
                  time: formatTimestamp(state.server_time, language),
                })}
          </Text>
        </View>

        <View style={styles.timerCenter}>
          {countdown !== null ? (
            <Text style={[styles.timer, { color: colors.text }]}>{countdown}</Text>
          ) : (
            <Text style={[styles.ready, { color: colors.text }]}>
              {complete
                ? t('timer.done')
                : vacation
                  ? t('timer.off')
                  : freeDay
                    ? t('timer.rest')
                    : t('timer.ready')}
            </Text>
          )}

          {snapshot.phase !== 'idle' &&
          phaseLength > 0 &&
          !complete &&
          !freeDay ? (
            <View style={styles.phaseBar}>
              <ProgressBar
                height={6}
                max={phaseLength}
                tone={snapshot.phase === 'break' ? 'warn' : 'accent'}
                value={snapshot.phase_elapsed_seconds}
              />
            </View>
          ) : null}

          <Text style={[styles.remaining, { color: colors.textMuted }]}>
            {freeDay
              ? t('timer.noStudyToday')
              : complete
                ? t('timer.requiredDone', {
                    hours: formatHours(snapshot.required_seconds),
                  })
                : t('timer.remainingOf', {
                    remaining: formatHours(snapshot.remaining_seconds),
                    required: formatHours(snapshot.required_seconds),
                  })}
          </Text>

          <View style={styles.totalBar}>
            <ProgressBar
              height={10}
              max={snapshot.required_seconds}
              tone={complete ? 'good' : 'accent'}
              value={snapshot.elapsed_seconds}
            />
            <View style={styles.totalLabels}>
              <Text style={[styles.totalLabel, { color: colors.textMuted }]}>
                {t('timer.studied', {
                  hours: formatHours(snapshot.elapsed_seconds),
                })}
              </Text>
              <Text style={[styles.totalLabel, { color: colors.textMuted }]}>
                {t('timer.goal', {
                  hours: formatHours(snapshot.required_seconds),
                })}
              </Text>
            </View>
          </View>

          {snapshot.debt_seconds > 0 && !complete ? (
            <Badge
              label={t('timer.carriedIn', {
                hours: formatHours(snapshot.debt_seconds),
              })}
              tone="warn"
            />
          ) : null}

          {snapshot.optional_goal_seconds > 0 ? (
            <View
              style={[styles.optional, { backgroundColor: colors.cardAlt }]}>
              <View style={styles.optionalLabels}>
                <Text style={[styles.optionalLabel, { color: colors.text }]}>
                  {t('timer.optionalGoal')}
                </Text>
                <Text style={[styles.optionalValue, { color: colors.textMuted }]}>
                  {formatHours(snapshot.optional_done_seconds)} /{' '}
                  {formatHours(snapshot.optional_goal_seconds)}
                </Text>
              </View>
              <ProgressBar
                height={6}
                max={snapshot.optional_goal_seconds}
                tone="warn"
                value={snapshot.optional_done_seconds}
              />
            </View>
          ) : null}
        </View>

        <View style={styles.actions}>
          <Button
            disabled={!canControl}
            label={primaryLabel}
            left={running ? '❚❚' : '▶'}
            onPress={() => void onPrimary()}
            pending={pending}
            style={styles.grow}
          />
          <Button
            disabled={!canControl || snapshot.phase === 'idle'}
            label={t('timer.skipPhase')}
            left="▶▶"
            onPress={() => void run(() => api.skipPhase())}
            variant="secondary"
          />
        </View>
      </Card>

      <View style={styles.infoCards}>
        <Card style={styles.infoCard}>
          <Text style={[styles.infoLabel, { color: colors.textFaint }]}>
            {t('timer.dayType')}
          </Text>
          <Text style={[styles.infoValue, { color: colors.text }]}>
            {dayKindLabel(t, snapshot.day_kind)}
          </Text>
          <Text style={[styles.infoHint, { color: colors.textMuted }]}>
            {vacation
              ? t('timer.dayHint.vacation')
              : snapshot.is_free_day
                ? t('timer.dayHint.free')
                : snapshot.day_kind === 'optional'
                  ? t('timer.dayHint.optional')
                  : t('timer.dayHint.carried')}
          </Text>
        </Card>

        <Card style={styles.infoCard}>
          <Text style={[styles.infoLabel, { color: colors.textFaint }]}>
            {t('timer.sessionTime')}
          </Text>
          <Text style={[styles.infoValue, { color: colors.text }]}>
            {formatHours(snapshot.elapsed_seconds)}
          </Text>
          <Text style={[styles.infoHint, { color: colors.textMuted }]}>
            {t('timer.breaksCount')}
          </Text>
        </Card>

        <Card style={styles.infoCard}>
          <Text style={[styles.infoLabel, { color: colors.textFaint }]}>
            {t('timer.activeItem')}
          </Text>
          <Text style={[styles.infoValue, { color: colors.text }]}>
            {state.checklist.active_item_id
              ? state.checklist.overrun_seconds > 0
                ? `+${formatClock(state.checklist.overrun_seconds)}`
                : formatClock(state.checklist.remaining_seconds)
              : '—'}
          </Text>
          <Text style={[styles.infoHint, { color: colors.textMuted }]}>
            {state.checklist.rest_remaining_seconds > 0
              ? t('timer.restRemaining', {
                  time: formatClock(state.checklist.rest_remaining_seconds),
                })
              : t('timer.onlyStudy')}
          </Text>
        </Card>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  awayBanner: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  awayBody: { flex: 1, gap: 2 },
  awayTitle: { fontSize: 13, fontWeight: '700' },
  awayText: { fontSize: 12, lineHeight: 17 },
  awayDismiss: { paddingHorizontal: 4 },
  awayDismissText: { fontSize: 20, lineHeight: 20, opacity: 0.7 },
  permissionBanner: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  permissionActions: { alignItems: 'flex-end', gap: 6 },
  loadingCard: {
    minHeight: 220,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  loadingText: { fontSize: 13 },
  timerCard: { gap: 18 },
  timerTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  updated: { fontSize: 10, fontVariant: ['tabular-nums'] },
  timerCenter: { alignItems: 'center', gap: 12 },
  timer: {
    fontSize: 64,
    fontWeight: '300',
    letterSpacing: -2,
    fontVariant: ['tabular-nums'],
    lineHeight: 76,
  },
  ready: { fontSize: 52, fontWeight: '800', letterSpacing: -1.5, lineHeight: 66 },
  phaseBar: { width: '82%', maxWidth: 320 },
  remaining: { fontSize: 13, textAlign: 'center' },
  totalBar: { width: '100%', maxWidth: 380, gap: 5, marginTop: 2 },
  totalLabels: { flexDirection: 'row', justifyContent: 'space-between' },
  totalLabel: { fontSize: 10, fontVariant: ['tabular-nums'] },
  optional: {
    width: '100%',
    maxWidth: 380,
    borderRadius: 14,
    padding: 10,
    gap: 6,
  },
  optionalLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  optionalLabel: { fontSize: 11, fontWeight: '700' },
  optionalValue: { fontSize: 11, fontVariant: ['tabular-nums'] },
  actions: { flexDirection: 'row', gap: 10, flexWrap: 'wrap' },
  grow: { flexGrow: 1, flexBasis: 160 },
  infoCards: { gap: 10 },
  infoCard: { gap: 3 },
  infoLabel: {
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  infoValue: { fontSize: 18, fontWeight: '800' },
  infoHint: { fontSize: 11, lineHeight: 16 },
});
