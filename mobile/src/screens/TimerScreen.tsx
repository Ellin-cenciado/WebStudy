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
import { useTheme } from '../context/ThemeContext';
import { useAction } from '../hooks/useAction';
import { api, backgroundTimer } from '../lib/api';
import {
  formatClock,
  formatHours,
  formatTimestamp,
  titleCase,
} from '../lib/format';

function phaseLabel(phase: string, freeDay: boolean, complete: boolean): string {
  if (complete) {
    return 'Day complete';
  }
  if (freeDay) {
    return 'Free day';
  }
  if (phase === 'idle') {
    return 'Ready';
  }
  return titleCase(phase);
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
  const { pending, run } = useAction();
  const snapshot = state?.snapshot;

  if (state === null || snapshot === undefined) {
    return (
      <Screen>
        <Card style={styles.loadingCard}>
          <Spinner />
          <Text style={[styles.loadingText, { color: colors.textMuted }]}>
            Starting the on-device study engine…
          </Text>
        </Card>
      </Screen>
    );
  }

  const complete = snapshot.day_complete;
  const freeDay = snapshot.is_free_day;
  const running = snapshot.running;
  const canControl = connected && !complete && !freeDay;
  const phaseLength = snapshot.phase_length_seconds;
  const countdown =
    complete || freeDay || snapshot.phase === 'idle'
      ? null
      : formatClock(snapshot.phase_remaining_seconds);

  const primaryLabel = complete
    ? 'Done'
    : freeDay
      ? 'Free day'
      : running
        ? 'Pause'
        : snapshot.phase === 'complete'
          ? 'Done'
          : 'Start';

  const heading = complete
    ? 'You did it.'
    : freeDay
      ? 'Take the day off.'
      : running
        ? 'Stay with it.'
        : 'Ready when you are.';

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
        subtitle={`${titleCase(snapshot.weekday)} · ${snapshot.logical_day}`}
        actions={<Badge label={running ? 'Running' : 'Paused'} tone={running ? 'good' : 'muted'} />}
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
              Timer kept running
            </Text>
            <Text style={[styles.awayText, { color: colors.good }]}>
              +{formatClock(awaySeconds)} credited while you were away.
            </Text>
          </View>
          <Pressable
            accessibilityLabel="Dismiss timer update"
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
              Notifications are off
            </Text>
            <Text style={[styles.awayText, { color: colors.warn }]}>
              Background alerts and lock-screen controls need notification
              permission.
            </Text>
          </View>
          <View style={styles.permissionActions}>
            <Button
              label="Allow"
              onPress={() => void requestNotificationPermission()}
              size="sm"
              variant="secondary"
            />
            <Button
              label="Settings"
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
            label={phaseLabel(snapshot.phase, freeDay, complete)}
            tone={phaseTone(complete, freeDay, snapshot.phase)}
          />
          <Text style={[styles.updated, { color: colors.textFaint }]}>
            {running ? '● live' : 'updated'} {formatTimestamp(state.server_time)}
          </Text>
        </View>

        <View style={styles.timerCenter}>
          {countdown !== null ? (
            <Text style={[styles.timer, { color: colors.text }]}>{countdown}</Text>
          ) : (
            <Text style={[styles.ready, { color: colors.text }]}>
              {complete ? 'Done' : freeDay ? 'Rest' : 'Ready'}
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
              ? 'No study required today.'
              : complete
                ? `Required ${formatHours(snapshot.required_seconds)} — all done.`
                : `${formatHours(snapshot.remaining_seconds)} remaining of ${formatHours(snapshot.required_seconds)}`}
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
                {formatHours(snapshot.elapsed_seconds)} studied
              </Text>
              <Text style={[styles.totalLabel, { color: colors.textMuted }]}>
                {formatHours(snapshot.required_seconds)} goal
              </Text>
            </View>
          </View>

          {snapshot.debt_seconds > 0 && !complete ? (
            <Badge
              label={`↺ Carried in ${formatHours(snapshot.debt_seconds)} debt`}
              tone="warn"
            />
          ) : null}

          {snapshot.optional_goal_seconds > 0 ? (
            <View
              style={[styles.optional, { backgroundColor: colors.cardAlt }]}>
              <View style={styles.optionalLabels}>
                <Text style={[styles.optionalLabel, { color: colors.text }]}>
                  Optional goal
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
            label="Skip phase"
            left="▶▶"
            onPress={() => void run(() => api.skipPhase())}
            variant="secondary"
          />
        </View>
      </Card>

      <View style={styles.infoCards}>
        <Card style={styles.infoCard}>
          <Text style={[styles.infoLabel, { color: colors.textFaint }]}>
            Day type
          </Text>
          <Text style={[styles.infoValue, { color: colors.text }]}>
            {titleCase(snapshot.day_kind)}
          </Text>
          <Text style={[styles.infoHint, { color: colors.textMuted }]}>
            {snapshot.is_free_day
              ? 'No requirement. Debt is preserved.'
              : snapshot.day_kind === 'optional'
                ? 'Goal only. Unmet time is discarded.'
                : "Unmet time becomes tomorrow's debt."}
          </Text>
        </Card>

        <Card style={styles.infoCard}>
          <Text style={[styles.infoLabel, { color: colors.textFaint }]}>
            Session time
          </Text>
          <Text style={[styles.infoValue, { color: colors.text }]}>
            {formatHours(snapshot.elapsed_seconds)}
          </Text>
          <Text style={[styles.infoHint, { color: colors.textMuted }]}>
            Breaks count toward the daily goal.
          </Text>
        </Card>

        <Card style={styles.infoCard}>
          <Text style={[styles.infoLabel, { color: colors.textFaint }]}>
            Active item
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
              ? `Rest: ${formatClock(state.checklist.rest_remaining_seconds)}`
              : 'Only study time advances the item.'}
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
