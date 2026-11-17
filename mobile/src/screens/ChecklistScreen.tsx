import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import {
  Badge,
  Button,
  Card,
  Divider,
  EmptyState,
  PageHeader,
  Screen,
  Spinner,
  ThemedInput,
} from '../components/ui';
import { useDialog } from '../context/DialogContext';
import { useLanguage } from '../context/LanguageContext';
import { useLive } from '../context/LiveContext';
import { useTheme } from '../context/ThemeContext';
import { useToast } from '../context/ToastContext';
import { useAction } from '../hooks/useAction';
import { api } from '../lib/api';
import { formatClock, formatHours, formatOverrun } from '../lib/format';
import { weekdayLabel } from '../i18n/labels';
import type {
  ChecklistItem,
  ChecklistSubject,
  ChecklistSummary,
} from '../lib/types';

function CarryNote({ item }: { item: ChecklistItem }) {
  const { colors } = useTheme();
  const { t } = useLanguage();
  const carryIn = item.carry_in_seconds;
  if (item.checked) {
    if (item.carry_out_seconds > 0) {
      return (
        <Text style={{ color: colors.good, fontSize: 11 }}>
          {t('checklist.surplusPassed', {
            time: formatClock(item.carry_out_seconds),
          })}
        </Text>
      );
    }
    if (item.carry_out_seconds < 0) {
      return (
        <Text style={{ color: colors.danger, fontSize: 11 }}>
          {t('checklist.overrunDeducted', {
            time: formatClock(-item.carry_out_seconds),
          })}
        </Text>
      );
    }
    return (
      <Text style={{ color: colors.textMuted, fontSize: 11 }}>
        {t('checklist.completed')}
      </Text>
    );
  }
  if (carryIn > 0) {
    return (
      <Text style={{ color: colors.good, fontSize: 11 }}>
        {t('checklist.carried', { time: formatClock(carryIn) })}
      </Text>
    );
  }
  if (carryIn < 0) {
    return (
      <Text style={{ color: colors.danger, fontSize: 11 }}>
        {t('checklist.debt', { time: formatClock(-carryIn) })}
      </Text>
    );
  }
  return (
    <Text style={{ color: colors.textMuted, fontSize: 11 }}>
      {t('checklist.planned', { time: formatClock(item.base_seconds) })}
    </Text>
  );
}

function ItemRow({
  item,
  isCurrent,
  summary,
}: {
  item: ChecklistItem;
  isCurrent: boolean;
  summary: ChecklistSummary;
}) {
  const { colors } = useTheme();
  const { t } = useLanguage();
  const { pending, run } = useAction();
  const { confirm, prompt } = useDialog();
  const { push } = useToast();

  const futureRemaining =
    item.base_seconds + item.carry_in_seconds - item.elapsed_seconds;
  const remaining = isCurrent ? summary.remaining_seconds : futureRemaining;
  const overrun = isCurrent ? summary.overrun_seconds : 0;
  const isOverrun = overrun > 0 || remaining < 0;
  const shown = isOverrun
    ? formatOverrun(Math.max(overrun, -remaining))
    : formatClock(Math.max(remaining, 0));

  const editDuration = async () => {
    const result = await prompt({
      title: t('checklist.itemDurationTitle'),
      message: t('checklist.itemDurationMessage', { item: item.text }),
      label: t('checklist.minutesLabel'),
      initialValue: String(Math.max(1, Math.round(item.base_seconds / 60))),
      submitLabel: t('checklist.update'),
      keyboardType: 'number-pad',
    });
    if (result === null) {
      return;
    }
    const minutes = Math.round(Number(result));
    if (!Number.isFinite(minutes) || minutes <= 0) {
      push({
        kind: 'error',
        title: t('checklist.invalidDurationTitle'),
        body: t('checklist.invalidDurationBody'),
      });
      return;
    }
    await run(
      () => api.updateItem(item.id, { durationSeconds: minutes * 60 }),
      { success: t('checklist.durationUpdated') },
    );
  };

  const remove = async () => {
    const ok = await confirm({
      title: t('checklist.deleteItemTitle'),
      message: t('checklist.deleteItemMessage', { item: item.text }),
      confirmLabel: t('common.delete'),
      destructive: true,
    });
    if (ok) {
      void run(() => api.removeItem(item.id));
    }
  };

  return (
    <View
      style={[
        styles.itemRow,
        isCurrent && { backgroundColor: colors.accentSoft },
        item.checked && styles.itemChecked,
      ]}>
      <Pressable
        accessibilityLabel={
          item.checked
            ? t('checklist.completedItem')
            : isCurrent
              ? t('checklist.checkItem')
              : t('checklist.pendingItem')
        }
        accessibilityRole="button"
        disabled={!isCurrent || item.checked || pending}
        hitSlop={8}
        onPress={() => void run(() => api.checkItem(item.id))}
        style={[
          styles.checkCircle,
          {
            borderColor: item.checked
              ? colors.good
              : isCurrent
                ? colors.accent
                : colors.border,
            backgroundColor: item.checked ? colors.good : colors.card,
          },
        ]}>
        <Text
          style={[
            styles.checkMark,
            { color: item.checked ? '#ffffff' : 'transparent' },
          ]}>
          ✓
        </Text>
      </Pressable>

      <View style={styles.itemBody}>
        <View style={styles.itemTitleRow}>
          <Text
            style={[
              styles.itemText,
              { color: colors.text },
              item.checked && styles.itemTextChecked,
              isCurrent && styles.itemTextCurrent,
            ]}>
            {item.text}
          </Text>
          {isCurrent && !item.checked ? (
            <Badge label={t('checklist.current')} tone="accent" />
          ) : null}
        </View>
        <View style={styles.carryRow}>
          <CarryNote item={item} />
          {!item.checked &&
          (item.carry_in_seconds !== 0 || item.elapsed_seconds > 0) ? (
            <Text style={[styles.budget, { color: colors.textFaint }]}>
              {t('checklist.budget', {
                time: formatClock(
                  Math.max(0, item.base_seconds + item.carry_in_seconds),
                ),
              })}
            </Text>
          ) : null}
        </View>
      </View>

      <View style={styles.itemActions}>
        {item.checked ? (
          <Text style={[styles.doneText, { color: colors.textFaint }]}>
            {t('checklist.done')}
          </Text>
        ) : (
          <>
            <Pressable
              accessibilityLabel={t('checklist.editDuration')}
              disabled={pending}
              onPress={() => void editDuration()}
              style={({ pressed }) => [
                styles.durationButton,
                { backgroundColor: colors.cardAlt },
                pressed && styles.pressed,
              ]}>
              <Text
                style={[
                  styles.durationText,
                  { color: isOverrun ? colors.danger : isCurrent ? colors.accent : colors.textMuted },
                ]}>
                {shown}
              </Text>
            </Pressable>
            <Pressable
              accessibilityLabel={t('checklist.removeItem')}
              disabled={pending}
              hitSlop={8}
              onPress={() => void remove()}
              style={({ pressed }) => [styles.removeButton, pressed && styles.pressed]}>
              <Text style={[styles.removeText, { color: colors.textFaint }]}>×</Text>
            </Pressable>
          </>
        )}
      </View>
    </View>
  );
}

function AddItemRow({ subject }: { subject: ChecklistSubject }) {
  const { colors } = useTheme();
  const { t } = useLanguage();
  const { pending, run } = useAction();
  const { push } = useToast();
  const [text, setText] = useState('');
  const [minutes, setMinutes] = useState('');

  const submit = async () => {
    const value = text.trim();
    if (!value) {
      return;
    }
    const parsed = minutes.trim() === '' ? 0 : Math.round(Number(minutes));
    if (minutes.trim() !== '' && (!Number.isFinite(parsed) || parsed <= 0)) {
      push({
        kind: 'error',
        title: t('checklist.invalidDurationTitle'),
        body: t('checklist.invalidDurationBodyAdd'),
      });
      return;
    }
    const ok = await run(() =>
      api.addItem(subject.id, value, parsed > 0 ? parsed * 60 : 0),
    );
    if (ok) {
      setText('');
      setMinutes('');
    }
  };

  return (
    <View style={[styles.addItemRow, { borderTopColor: colors.border }]}>
      <ThemedInput
        onChangeText={setText}
        placeholder={t('checklist.addItemPlaceholder')}
        style={styles.addItemText}
        value={text}
      />
      <ThemedInput
        keyboardType="number-pad"
        onChangeText={setMinutes}
        placeholder="40"
        style={styles.addItemMinutes}
        value={minutes}
      />
      <Button
        disabled={!text.trim()}
        label={t('checklist.add')}
        left="+"
        onPress={() => void submit()}
        pending={pending}
        size="sm"
      />
    </View>
  );
}

function SubjectCard({
  subject,
  activeSubjectId,
  summary,
}: {
  subject: ChecklistSubject;
  activeSubjectId: string | null;
  summary: ChecklistSummary;
}) {
  const { colors } = useTheme();
  const { t } = useLanguage();
  const { pending, run } = useAction();
  const { confirm, prompt } = useDialog();
  const isActive = subject.id === activeSubjectId;
  const checked = subject.items.filter(item => item.checked).length;
  const complete = subject.items.length > 0 && checked === subject.items.length;

  const rename = async () => {
    const name = (
      await prompt({
        title: t('checklist.renameSubjectTitle'),
        label: t('checklist.subjectNameLabel'),
        initialValue: subject.name,
        submitLabel: t('common.rename'),
      })
    )?.trim();
    if (name && name !== subject.name) {
      void run(() => api.renameSubject(subject.id, name));
    }
  };

  const remove = async () => {
    const ok = await confirm({
      title: t('checklist.deleteSubjectTitle'),
      message: t('checklist.deleteSubjectMessage', { subject: subject.name }),
      confirmLabel: t('common.delete'),
      destructive: true,
    });
    if (ok) {
      void run(() => api.removeSubject(subject.id));
    }
  };

  const reset = async () => {
    const ok = await confirm({
      title: t('checklist.resetSubjectTitle'),
      message: t('checklist.resetSubjectMessage', { subject: subject.name }),
      confirmLabel: t('common.reset'),
      destructive: true,
    });
    if (ok) {
      void run(() => api.resetSubject(subject.id));
    }
  };

  return (
    <Card
      padded={false}
      style={isActive ? { borderColor: colors.accentBorder, borderWidth: 1.5 } : undefined}>
      <View style={styles.subjectHeader}>
        <View style={styles.subjectTitleBlock}>
          <View style={styles.subjectTitleRow}>
            <Text
              style={[
                styles.subjectName,
                { color: colors.text },
                complete && styles.subjectNameComplete,
              ]}>
              {subject.name}
            </Text>
            {isActive ? (
              <Badge label={t('checklist.active')} tone="accent" />
            ) : null}
            {complete ? (
              <Badge label={t('checklist.complete')} tone="good" />
            ) : null}
          </View>
          <Text style={[styles.subjectMeta, { color: colors.textMuted }]}>
            {subject.items.length === 0
              ? t('checklist.noItems')
              : t('checklist.doneCount', {
                  checked,
                  total: subject.items.length,
                })}
          </Text>
        </View>
      </View>

      <View style={[styles.subjectActions, { borderTopColor: colors.border }]}>
        {!isActive && !complete ? (
          <SubjectAction
            disabled={pending}
            label={t('checklist.select')}
            onPress={() => void run(() => api.selectSubject(subject.id))}
          />
        ) : null}
        <SubjectAction
          disabled={pending}
          label={t('checklist.rename')}
          onPress={() => void rename()}
        />
        <SubjectAction
          disabled={pending || checked === 0}
          label={t('checklist.undo')}
          onPress={() => void run(() => api.uncheckLast(subject.id))}
        />
        <SubjectAction
          disabled={pending || checked === 0}
          label={t('checklist.reset')}
          onPress={() => void reset()}
        />
        <SubjectAction
          danger
          disabled={pending}
          label={t('checklist.delete')}
          onPress={() => void remove()}
        />
        {pending ? <Spinner /> : null}
      </View>

      {subject.items.length > 0 ? (
        <View>
          <Divider />
          {subject.items.map((item, index) => (
            <View key={item.id}>
              <ItemRow
                isCurrent={item.id === summary.active_item_id}
                item={item}
                summary={summary}
              />
              {index < subject.items.length - 1 ? <Divider /> : null}
            </View>
          ))}
        </View>
      ) : (
        <Text style={[styles.noItems, { color: colors.textMuted }]}>
          {t('checklist.noItemsHint')}
        </Text>
      )}

      <AddItemRow subject={subject} />
    </Card>
  );
}

function SubjectAction({
  label,
  onPress,
  disabled,
  danger,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.subjectAction,
        { backgroundColor: colors.cardAlt, opacity: disabled ? 0.35 : pressed ? 0.7 : 1 },
      ]}>
      <Text
        style={[
          styles.subjectActionText,
          { color: danger ? colors.danger : colors.textMuted },
        ]}>
        {label}
      </Text>
    </Pressable>
  );
}

function RestBanner({ summary, running }: { summary: ChecklistSummary; running: boolean }) {
  const { colors } = useTheme();
  const { t } = useLanguage();
  const { pending, run } = useAction();
  return (
    <Card
      style={[
        styles.restBanner,
        { backgroundColor: colors.warnSoft, borderColor: colors.warnBorder },
      ]}>
      <Text style={[styles.restMark, { color: colors.warn }]}>☕</Text>
      <View style={styles.restBody}>
        <Text style={[styles.restTitle, { color: colors.warn }]}>
          {t('checklist.restTitle')}
        </Text>
        <Text style={[styles.restMessage, { color: colors.warn }]}>
          {running ? t('checklist.restRunning') : t('checklist.restQueued')}
        </Text>
      </View>
      <View style={styles.restRight}>
        <Text style={[styles.restClock, { color: colors.warn }]}>
          {formatClock(summary.rest_remaining_seconds)}
        </Text>
        <Button
          disabled={pending}
          label={t('checklist.skipRest')}
          onPress={() => void run(() => api.skipPhase())}
          size="sm"
          variant="secondary"
        />
      </View>
    </Card>
  );
}

export function ChecklistScreen() {
  const { state, checklist } = useLive();
  const { colors } = useTheme();
  const { t } = useLanguage();
  const { pending, run } = useAction();
  const [name, setName] = useState('');

  const submitSubject = async () => {
    const value = name.trim();
    if (!value) {
      return;
    }
    const ok = await run(() => api.addSubject(value));
    if (ok) {
      setName('');
    }
  };

  if (checklist === null || state === null) {
    return (
      <Screen>
        <Card style={styles.loadingCard}>
          <Spinner />
          <Text style={[styles.loadingText, { color: colors.textMuted }]}>
            {t('checklist.loading')}
          </Text>
        </Card>
      </Screen>
    );
  }

  const summary = state.checklist;

  return (
    <Screen>
      <PageHeader
        title={t('checklist.title')}
        subtitle={t('checklist.subtitle')}
      />

      {summary.rest_remaining_seconds > 0 ? (
        <RestBanner running={state.snapshot.running} summary={summary} />
      ) : null}

      <Card style={styles.addSubjectCard}>
        <ThemedInput
          onChangeText={setName}
          placeholder={t('checklist.addSubjectPlaceholder')}
          style={styles.subjectInput}
          value={name}
        />
        <Button
          disabled={!name.trim()}
          label={t('checklist.addSubject')}
          left="+"
          onPress={() => void submitSubject()}
          pending={pending}
        />
      </Card>

      {checklist.subjects.length === 0 ? (
        <EmptyState
          mark="☑"
          message={t('checklist.emptyMessage')}
          title={t('checklist.emptyTitle')}
        />
      ) : (
        <View style={styles.subjectList}>
          {checklist.subjects.map(subject => (
            <SubjectCard
              activeSubjectId={checklist.active_subject_id}
              key={subject.id}
              subject={subject}
              summary={summary}
            />
          ))}
        </View>
      )}

      <Text style={[styles.footer, { color: colors.textFaint }]}>
        {checklist.subjects.length > 0
          ? t('checklist.footer', {
              revision: checklist.revision,
              weekday: weekdayLabel(t, state.snapshot.weekday),
              hours: formatHours(state.snapshot.elapsed_seconds),
            })
          : t('checklist.footerNoSubjects')}
      </Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  loadingCard: { minHeight: 160, alignItems: 'center', justifyContent: 'center', gap: 10 },
  loadingText: { fontSize: 13 },
  restBanner: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  restMark: { fontSize: 22 },
  restBody: { flex: 1, gap: 2 },
  restTitle: { fontSize: 14, fontWeight: '800' },
  restMessage: { fontSize: 11, lineHeight: 15, opacity: 0.85 },
  restRight: { alignItems: 'flex-end', gap: 6 },
  restClock: { fontSize: 18, fontWeight: '800', fontVariant: ['tabular-nums'] },
  addSubjectCard: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  subjectInput: { flex: 1 },
  subjectList: { gap: 12 },
  subjectHeader: { padding: 14, paddingBottom: 10 },
  subjectTitleBlock: { gap: 2 },
  subjectTitleRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 7 },
  subjectName: { fontSize: 15, fontWeight: '800', flexShrink: 1 },
  subjectNameComplete: { color: '#94a3b8', textDecorationLine: 'line-through' },
  subjectMeta: { fontSize: 11 },
  subjectActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 14,
    paddingBottom: 12,
  },
  subjectAction: { borderRadius: 8, paddingHorizontal: 9, paddingVertical: 5 },
  subjectActionText: { fontSize: 11, fontWeight: '700' },
  noItems: { fontSize: 13, paddingHorizontal: 14, paddingVertical: 14 },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  itemChecked: { opacity: 0.58 },
  checkCircle: {
    width: 21,
    height: 21,
    borderRadius: 10.5,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  checkMark: { fontSize: 12, fontWeight: '900', lineHeight: 15 },
  itemBody: { flex: 1, gap: 2, minWidth: 0 },
  itemTitleRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 },
  itemText: { fontSize: 13, fontWeight: '500', flexShrink: 1 },
  itemTextChecked: { textDecorationLine: 'line-through' },
  itemTextCurrent: { fontWeight: '700' },
  carryRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  budget: { fontSize: 11 },
  itemActions: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  durationButton: { borderRadius: 8, paddingHorizontal: 7, paddingVertical: 5 },
  durationText: {
    fontSize: 12,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  removeButton: { paddingHorizontal: 3, paddingVertical: 1 },
  removeText: { fontSize: 17, lineHeight: 20 },
  doneText: { fontSize: 10, fontWeight: '700', textTransform: 'uppercase' },
  addItemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderTopWidth: StyleSheet.hairlineWidth,
    padding: 10,
  },
  addItemText: { flex: 1, paddingVertical: 8 },
  addItemMinutes: {
    width: 52,
    paddingHorizontal: 8,
    paddingVertical: 8,
    textAlign: 'right',
  },
  footer: { fontSize: 10, textAlign: 'center', lineHeight: 15, paddingBottom: 4 },
  pressed: { opacity: 0.6 },
});
