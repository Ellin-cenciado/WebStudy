import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import {
  Badge,
  Button,
  Card,
  Divider,
  PageHeader,
  Screen,
  Spinner,
  StatCard,
} from '../components/ui';
import { useLive } from '../context/LiveContext';
import { useTheme } from '../context/ThemeContext';
import { api } from '../lib/api';
import {
  errorMessage,
  formatDate,
  formatHours,
  titleCase,
} from '../lib/format';
import type { DayRow, StatsResponse } from '../lib/types';

const CHART_HEIGHT = 132;

function dayTone(day: DayRow): 'good' | 'warn' | 'muted' {
  if (day.day_kind === 'free' || day.day_kind === 'vacation') {
    return 'muted';
  }
  return day.completed ? 'good' : 'warn';
}

function DayRowItem({ day, last }: { day: DayRow; last: boolean }) {
  const { colors } = useTheme();
  const offDay = day.day_kind === 'free' || day.day_kind === 'vacation';
  const percent =
    day.required_seconds > 0
      ? Math.min(100, Math.round((day.elapsed_seconds / day.required_seconds) * 100))
      : 0;
  const tone = dayTone(day);
  const toneBg =
    tone === 'good'
      ? colors.goodSoft
      : tone === 'warn'
        ? colors.warnSoft
        : colors.cardAlt;
  const toneFg =
    tone === 'good' ? colors.good : tone === 'warn' ? colors.warn : colors.textMuted;
  return (
    <>
      <View style={styles.dayRow}>
        <View style={[styles.percent, { backgroundColor: toneBg }]}>
          <Text style={[styles.percentText, { color: toneFg }]}>
            {day.day_kind === 'vacation'
              ? 'Vac'
              : day.day_kind === 'free'
                ? 'Free'
                : `${percent}%`}
          </Text>
        </View>
        <View style={styles.dayInfo}>
          <Text style={[styles.dayDate, { color: colors.text }]}>
            {formatDate(day.logical_date)}
          </Text>
          <Text style={[styles.dayMeta, { color: colors.textMuted }]}>
            {formatHours(day.elapsed_seconds)} studied
            {day.required_seconds > 0
              ? ` of ${formatHours(day.required_seconds)}`
              : ''}
            {day.optional_goal_seconds > 0
              ? ` · optional ${formatHours(day.optional_done_seconds)}`
              : ''}
          </Text>
        </View>
        <View style={styles.dayRight}>
          <Text
            style={[
              styles.dayStatus,
              {
                color: day.completed
                  ? colors.good
                  : offDay
                    ? colors.textFaint
                    : colors.warn,
              },
            ]}>
            {offDay ? 'No goal' : day.completed ? 'Complete' : 'Incomplete'}
          </Text>
          <Text style={[styles.dayDebt, { color: colors.textFaint }]}>
            debt {formatHours(day.debt_out_seconds)}
          </Text>
        </View>
      </View>
      {!last ? <Divider /> : null}
    </>
  );
}

function Bars({ days }: { days: DayRow[] }) {
  const { colors } = useTheme();
  const recent = days.slice(-14);
  if (recent.length === 0) {
    return (
      <View style={[styles.chartEmpty, { borderColor: colors.border }]}>
        <Text style={[styles.chartEmptyText, { color: colors.textFaint }]}>
          No history yet.
        </Text>
      </View>
    );
  }
  return (
    <View style={styles.chart}>
      {recent.map(day => {
        const fraction =
          day.required_seconds > 0
            ? Math.max(
                day.elapsed_seconds > 0 ? 0.03 : 0,
                Math.min(1, day.elapsed_seconds / day.required_seconds),
              )
            : day.elapsed_seconds > 0
              ? 1
              : 0.03;
        const tone = dayTone(day);
        const barColor =
          tone === 'muted'
            ? colors.textFaint
            : tone === 'good'
              ? colors.good
              : colors.warn;
        return (
          <View key={day.logical_date} style={styles.chartColumn}>
            <View style={styles.chartBarArea}>
              <View
                style={{
                  height: Math.max(3, Math.round(fraction * CHART_HEIGHT)),
                  backgroundColor: barColor,
                  borderRadius: 4,
                  width: '100%',
                }}
              />
            </View>
            <Text style={[styles.chartLabel, { color: colors.textFaint }]}>
              {day.logical_date.slice(5)}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

export function StatsScreen() {
  const { state } = useLive();
  const { colors } = useTheme();
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setStats(await api.stats(30));
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, state?.snapshot.logical_day]);

  return (
    <Screen>
      <PageHeader
        title="Stats"
        subtitle="The last 30 days of study, debt, and compliance."
        actions={
          <Button
            label="Refresh"
            left="↻"
            onPress={() => void load()}
            pending={loading}
            size="sm"
            variant="secondary"
          />
        }
      />

      {error !== null ? (
        <Card
          style={[
            styles.errorCard,
            { backgroundColor: colors.dangerSoft, borderColor: colors.dangerBorder },
          ]}>
          <Text style={[styles.errorTitle, { color: colors.danger }]}>
            Could not load stats
          </Text>
          <Text style={[styles.errorMessage, { color: colors.danger }]}>
            {error}
          </Text>
          <Button label="Try again" onPress={() => void load()} size="sm" />
        </Card>
      ) : null}

      {stats === null ? (
        <Card style={styles.loadingCard}>
          <Spinner />
          <Text style={[styles.loadingText, { color: colors.textMuted }]}>
            Loading history…
          </Text>
        </Card>
      ) : (
        <>
          <View style={styles.summaryRow}>
            <StatCard
              label="Streak"
              value={`${stats.summary.streak}d`}
              tone={stats.summary.streak > 0 ? 'good' : 'muted'}
            />
            <StatCard
              label="Compliance"
              value={
                stats.summary.total === 0
                  ? '—'
                  : `${Math.round(
                      (stats.summary.completed / stats.summary.total) * 100,
                    )}%`
              }
              tone={
                stats.summary.total > 0 &&
                stats.summary.completed === stats.summary.total
                  ? 'good'
                  : 'accent'
              }
            />
            <StatCard
              label="Debt"
              value={formatHours(stats.summary.debt_seconds)}
              tone={stats.summary.debt_seconds > 0 ? 'warn' : 'good'}
            />
          </View>

          <Card style={styles.chartCard}>
            <View style={styles.chartHeader}>
              <View style={styles.chartHeaderText}>
                <Text style={[styles.chartTitle, { color: colors.text }]}>
                  Last 14 days
                </Text>
                <Text style={[styles.chartSubtitle, { color: colors.textMuted }]}>
                  Green means the goal was met. Amber means it was not.
                </Text>
              </View>
              <Badge
                label={`${stats.summary.completed}/${stats.summary.total} days`}
                tone="muted"
              />
            </View>
            <Bars days={stats.days} />
          </Card>

          <Card padded={false}>
            <View style={styles.logHeader}>
              <Text style={[styles.logTitle, { color: colors.text }]}>Day log</Text>
              <Text style={[styles.logCount, { color: colors.textFaint }]}>
                {stats.days.length} day{stats.days.length === 1 ? '' : 's'}
              </Text>
            </View>
            <Divider />
            {stats.days.length === 0 ? (
              <Text style={[styles.logEmpty, { color: colors.textMuted }]}>
                History appears after the first day settles.
              </Text>
            ) : (
              <View style={styles.logList}>
                {[...stats.days].reverse().map((day, index, all) => (
                  <DayRowItem
                    day={day}
                    key={day.logical_date}
                    last={index === all.length - 1}
                  />
                ))}
              </View>
            )}
          </Card>

          <Text style={[styles.footnote, { color: colors.textFaint }]}>
            {titleCase(state?.snapshot.day_kind ?? '')} today · updated every second
          </Text>
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  errorCard: { gap: 8 },
  errorTitle: { fontSize: 14, fontWeight: '700' },
  errorMessage: { fontSize: 12, lineHeight: 17 },
  loadingCard: {
    minHeight: 160,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  loadingText: { fontSize: 13 },
  summaryRow: { flexDirection: 'row', gap: 8 },
  chartCard: { gap: 14 },
  chartHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
  },
  chartHeaderText: { flex: 1, gap: 2 },
  chartTitle: { fontSize: 15, fontWeight: '700' },
  chartSubtitle: { fontSize: 11, lineHeight: 16 },
  chart: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 3,
    height: CHART_HEIGHT + 24,
  },
  chartColumn: { flex: 1, alignItems: 'center', gap: 4 },
  chartBarArea: {
    height: CHART_HEIGHT,
    width: '100%',
    justifyContent: 'flex-end',
  },
  chartLabel: { fontSize: 8, fontVariant: ['tabular-nums'] },
  chartEmpty: {
    height: CHART_HEIGHT,
    borderWidth: 1,
    borderRadius: 14,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
  },
  chartEmptyText: { fontSize: 13 },
  logHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  logTitle: { fontSize: 15, fontWeight: '700' },
  logCount: { fontSize: 11 },
  logList: { paddingHorizontal: 16 },
  logEmpty: {
    fontSize: 13,
    textAlign: 'center',
    paddingHorizontal: 16,
    paddingVertical: 38,
  },
  dayRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 11,
  },
  percent: {
    width: 46,
    height: 42,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  percentText: {
    fontSize: 10,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  dayInfo: { flex: 1, gap: 2 },
  dayDate: { fontSize: 13, fontWeight: '700' },
  dayMeta: { fontSize: 10, lineHeight: 14 },
  dayRight: { alignItems: 'flex-end', gap: 2 },
  dayStatus: { fontSize: 11, fontWeight: '700' },
  dayDebt: { fontSize: 9, fontVariant: ['tabular-nums'] },
  footnote: { fontSize: 10, textAlign: 'center', paddingBottom: 4 },
});
