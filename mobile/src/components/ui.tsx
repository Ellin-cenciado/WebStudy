import React, { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
  type ScrollViewProps,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';
import { useTheme, type Palette } from '../context/ThemeContext';

export type Tone = 'accent' | 'good' | 'warn' | 'danger' | 'muted';

function toneColor(colors: Palette, tone: Tone): string {
  switch (tone) {
    case 'good':
      return colors.good;
    case 'warn':
      return colors.warn;
    case 'danger':
      return colors.danger;
    case 'muted':
      return colors.textMuted;
    default:
      return colors.accent;
  }
}

export function ProgressBar({
  value,
  max,
  tone = 'accent',
  height = 8,
}: {
  value: number;
  max: number;
  tone?: Tone;
  height?: number;
}) {
  const { colors } = useTheme();
  const fraction = max <= 0 ? 0 : Math.max(0, Math.min(1, value / max));
  return (
    <View
      accessibilityRole="progressbar"
      style={[
        styles.progressTrack,
        { backgroundColor: colors.cardAlt, height, borderRadius: height / 2 },
      ]}>
      <View
        style={{
          width: `${fraction * 100}%`,
          height,
          borderRadius: height / 2,
          backgroundColor: toneColor(colors, tone),
        }}
      />
    </View>
  );
}

export function Spinner({ color }: { color?: string }) {
  const { colors } = useTheme();
  return <ActivityIndicator color={color ?? colors.accent} size="small" />;
}

export function Screen({
  children,
  contentContainerStyle,
  ...props
}: ScrollViewProps & { children: ReactNode }) {
  return (
    <ScrollView
      contentContainerStyle={[styles.screenContent, contentContainerStyle]}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
      style={styles.screen}
      {...props}>
      {children}
    </ScrollView>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  const { colors } = useTheme();
  return (
    <View style={styles.pageHeader}>
      <View style={styles.pageHeaderText}>
        <Text style={[styles.pageTitle, { color: colors.text }]}>{title}</Text>
        {subtitle ? (
          <Text style={[styles.pageSubtitle, { color: colors.textMuted }]}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {actions ? <View style={styles.pageActions}>{actions}</View> : null}
    </View>
  );
}

export function Card({
  children,
  style,
  padded = true,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  padded?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: colors.card,
          borderColor: colors.border,
          padding: padded ? 16 : 0,
        },
        style,
      ]}>
      {children}
    </View>
  );
}

export function SectionTitle({
  title,
  subtitle,
  right,
}: {
  title: string;
  subtitle?: string;
  right?: ReactNode;
}) {
  const { colors } = useTheme();
  return (
    <View style={styles.sectionTitleRow}>
      <View style={styles.sectionTitleText}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>{title}</Text>
        {subtitle ? (
          <Text style={[styles.sectionSubtitle, { color: colors.textMuted }]}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {right}
    </View>
  );
}

export function Badge({
  label,
  tone = 'accent',
}: {
  label: string;
  tone?: Tone;
}) {
  const { colors } = useTheme();
  const color = toneColor(colors, tone);
  const background =
    tone === 'good'
      ? colors.goodSoft
      : tone === 'warn'
        ? colors.warnSoft
        : tone === 'danger'
          ? colors.dangerSoft
          : tone === 'muted'
            ? colors.cardAlt
            : colors.accentSoft;
  return (
    <View style={[styles.badge, { backgroundColor: background }]}>
      <Text style={[styles.badgeText, { color }]}>{label}</Text>
    </View>
  );
}

export function StatCard({
  label,
  value,
  hint,
  tone = 'accent',
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: Tone;
}) {
  const { colors } = useTheme();
  return (
    <Card style={styles.statCard}>
      <Text style={[styles.statLabel, { color: colors.textMuted }]}>{label}</Text>
      <Text style={[styles.statValue, { color: toneColor(colors, tone) }]}>
        {value}
      </Text>
      {hint ? (
        <Text style={[styles.statHint, { color: colors.textMuted }]}>{hint}</Text>
      ) : null}
    </Card>
  );
}

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
type ButtonSize = 'sm' | 'md';

export function Button({
  label,
  onPress,
  variant = 'primary',
  size = 'md',
  disabled = false,
  pending = false,
  left,
  style,
  accessibilityLabel,
}: {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  disabled?: boolean;
  pending?: boolean;
  left?: string;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
}) {
  const { colors } = useTheme();
  const isDisabled = disabled || pending;
  const background =
    variant === 'primary'
      ? colors.accent
      : variant === 'danger'
        ? colors.danger
        : 'transparent';
  const border = variant === 'secondary' ? colors.border : 'transparent';
  const textColor =
    variant === 'primary'
      ? colors.accentText
      : variant === 'danger'
        ? '#ffffff'
        : variant === 'ghost'
          ? colors.textMuted
          : colors.text;

  return (
    <Pressable
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityRole="button"
      disabled={isDisabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        size === 'sm' ? styles.buttonSmall : styles.buttonMedium,
        {
          backgroundColor: background,
          borderColor: border,
          opacity: isDisabled ? 0.4 : pressed ? 0.72 : 1,
        },
        style,
      ]}>
      {pending ? (
        <Spinner color={variant === 'secondary' || variant === 'ghost' ? colors.accent : textColor} />
      ) : left ? (
        <Text style={[styles.buttonGlyph, { color: textColor }]}>{left}</Text>
      ) : null}
      <Text
        style={[
          styles.buttonText,
          size === 'sm' && styles.buttonTextSmall,
          { color: textColor },
        ]}>
        {label}
      </Text>
    </Pressable>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  const { colors } = useTheme();
  return (
    <View style={styles.field}>
      <Text style={[styles.fieldLabel, { color: colors.textMuted }]}>{label}</Text>
      {children}
      {hint ? (
        <Text style={[styles.fieldHint, { color: colors.textFaint }]}>{hint}</Text>
      ) : null}
    </View>
  );
}

export function ThemedInput(props: TextInputProps) {
  const { colors } = useTheme();
  return (
    <TextInput
      {...props}
      placeholderTextColor={props.placeholderTextColor ?? colors.textFaint}
      selectionColor={props.selectionColor ?? colors.accent}
      underlineColorAndroid="transparent"
      style={[
        styles.input,
        {
          backgroundColor: colors.input,
          borderColor: colors.border,
          color: colors.text,
        },
        props.style,
      ]}
    />
  );
}

export function NumberField({
  value,
  onCommit,
  min = 0,
  max = 1440,
  style,
  placeholder,
  disabled = false,
}: {
  value: number;
  onCommit: (value: number) => void;
  min?: number;
  max?: number;
  style?: StyleProp<ViewStyle>;
  placeholder?: string;
  disabled?: boolean;
}) {
  const { colors } = useTheme();
  const [text, setText] = useState(String(value));
  const focused = useRef(false);

  useEffect(() => {
    if (!focused.current) {
      setText(String(value));
    }
  }, [value]);

  const commit = () => {
    focused.current = false;
    const parsed = Math.round(Number(text));
    if (!Number.isFinite(parsed)) {
      setText(String(value));
      return;
    }
    const clamped = Math.max(min, Math.min(max, parsed));
    setText(String(clamped));
    if (clamped !== value) {
      onCommit(clamped);
    }
  };

  return (
    <TextInput
      editable={!disabled}
      keyboardType="number-pad"
      onBlur={commit}
      onChangeText={setText}
      onFocus={() => {
        focused.current = true;
      }}
      onSubmitEditing={commit}
      placeholder={placeholder}
      placeholderTextColor={colors.textFaint}
      selectTextOnFocus
      selectionColor={colors.accent}
      underlineColorAndroid="transparent"
      style={[
        styles.input,
        {
          backgroundColor: colors.input,
          borderColor: colors.border,
          color: colors.text,
          opacity: disabled ? 0.4 : 1,
        },
        style,
      ]}
      value={text}
    />
  );
}

export function ToggleRow({
  label,
  description,
  value,
  onValueChange,
}: {
  label: string;
  description?: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
}) {
  const { colors } = useTheme();
  return (
    <View style={[styles.toggleRow, { borderColor: colors.border }]}>
      <View style={styles.toggleText}>
        <Text style={[styles.toggleLabel, { color: colors.text }]}>{label}</Text>
        {description ? (
          <Text style={[styles.toggleDescription, { color: colors.textMuted }]}>
            {description}
          </Text>
        ) : null}
      </View>
      <Switch
        onValueChange={onValueChange}
        thumbColor="#ffffff"
        trackColor={{ false: colors.cardAlt, true: colors.accent }}
        value={value}
      />
    </View>
  );
}

export function EmptyState({
  mark,
  title,
  message,
}: {
  mark: string;
  title: string;
  message: string;
}) {
  const { colors } = useTheme();
  return (
    <View
      style={[
        styles.empty,
        { borderColor: colors.border, backgroundColor: colors.card },
      ]}>
      <Text style={[styles.emptyMark, { color: colors.textFaint }]}>{mark}</Text>
      <Text style={[styles.emptyTitle, { color: colors.text }]}>{title}</Text>
      <Text style={[styles.emptyMessage, { color: colors.textMuted }]}>
        {message}
      </Text>
    </View>
  );
}

export function Divider() {
  const { colors } = useTheme();
  return <View style={[styles.divider, { backgroundColor: colors.border }]} />;
}

const styles = StyleSheet.create({
  progressTrack: { width: '100%', overflow: 'hidden' },
  screen: { flex: 1 },
  screenContent: { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 28, gap: 14 },
  pageHeader: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: 12,
    flexWrap: 'wrap',
  },
  pageHeaderText: { flexShrink: 1 },
  pageTitle: { fontSize: 24, fontWeight: '800', letterSpacing: -0.5 },
  pageSubtitle: { fontSize: 13, lineHeight: 19, marginTop: 3 },
  pageActions: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  card: {
    borderWidth: 1,
    borderRadius: 18,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 1,
  },
  sectionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  sectionTitleText: { flexShrink: 1 },
  sectionTitle: { fontSize: 15, fontWeight: '700' },
  sectionSubtitle: { fontSize: 12, lineHeight: 17, marginTop: 2 },
  badge: {
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
    alignSelf: 'flex-start',
  },
  badgeText: {
    fontSize: 10,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.7,
  },
  statCard: { flex: 1, minWidth: 100, padding: 13, gap: 3 },
  statLabel: {
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  statValue: {
    fontSize: 18,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  statHint: { fontSize: 11, lineHeight: 15 },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    borderRadius: 13,
    borderWidth: 1,
  },
  buttonMedium: { paddingHorizontal: 16, paddingVertical: 12 },
  buttonSmall: { paddingHorizontal: 10, paddingVertical: 7, borderRadius: 10 },
  buttonGlyph: { fontSize: 14, fontWeight: '700' },
  buttonText: { fontSize: 14, fontWeight: '700' },
  buttonTextSmall: { fontSize: 12 },
  field: { gap: 6 },
  fieldLabel: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.7,
  },
  fieldHint: { fontSize: 11, lineHeight: 16 },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
  },
  toggleText: { flex: 1, gap: 2 },
  toggleLabel: { fontSize: 14, fontWeight: '600' },
  toggleDescription: { fontSize: 11, lineHeight: 16 },
  empty: {
    borderWidth: 1,
    borderStyle: 'dashed',
    borderRadius: 20,
    paddingHorizontal: 24,
    paddingVertical: 44,
    alignItems: 'center',
  },
  emptyMark: { fontSize: 32, marginBottom: 8 },
  emptyTitle: { fontSize: 17, fontWeight: '700' },
  emptyMessage: {
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
    marginTop: 5,
    maxWidth: 320,
  },
  divider: { height: StyleSheet.hairlineWidth, width: '100%' },
});
