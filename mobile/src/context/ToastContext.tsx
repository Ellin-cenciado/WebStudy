import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLanguage } from './LanguageContext';
import { useTheme, type Palette } from './ThemeContext';

export type ToastKind = 'info' | 'success' | 'warning' | 'error';

export interface ToastInput {
  title: string;
  body?: string;
  kind?: ToastKind;
  timeoutMs?: number;
}

interface Toast extends ToastInput {
  id: string;
  kind: ToastKind;
}

interface ToastContextValue {
  push: (toast: ToastInput) => void;
  dismiss: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

let toastSequence = 0;

function toastTone(colors: Palette, kind: ToastKind): StyleProp<ViewStyle> {
  switch (kind) {
    case 'success':
      return {
        backgroundColor: colors.goodSoft,
        borderColor: colors.goodBorder,
      };
    case 'error':
      return {
        backgroundColor: colors.dangerSoft,
        borderColor: colors.dangerBorder,
      };
    case 'warning':
      return {
        backgroundColor: colors.warnSoft,
        borderColor: colors.warnBorder,
      };
    default:
      return {
        backgroundColor: colors.card,
        borderColor: colors.border,
      };
  }
}

function toastText(colors: Palette, kind: ToastKind): string {
  switch (kind) {
    case 'success':
      return colors.good;
    case 'error':
      return colors.danger;
    case 'warning':
      return colors.warn;
    default:
      return colors.text;
  }
}

function ToastCard({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  const { colors } = useTheme();
  const { t } = useLanguage();
  const { title, body, kind } = toast;
  const color = toastText(colors, kind);
  return (
    <View style={[styles.toast, toastTone(colors, kind)]}>
      <Text style={[styles.toastMark, { color }]}>
        {kind === 'success' ? '✓' : kind === 'info' ? 'i' : '!'}
      </Text>
      <View style={styles.toastBody}>
        <Text style={[styles.toastTitle, { color }]}>{title}</Text>
        {body ? (
          <Text style={[styles.toastMessage, { color }]}>{body}</Text>
        ) : null}
      </View>
      <Pressable
        accessibilityLabel={t('common.dismissNotification')}
        hitSlop={10}
        onPress={onDismiss}
        style={styles.toastClose}>
        <Text style={[styles.toastCloseText, { color }]}>×</Text>
      </Pressable>
    </View>
  );
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef<Array<ReturnType<typeof setTimeout>>>([]);
  const insets = useSafeAreaInsets();

  const dismiss = useCallback((id: string) => {
    setToasts(current => current.filter(toast => toast.id !== id));
  }, []);

  const push = useCallback(
    (input: ToastInput) => {
      toastSequence += 1;
      const id = `toast-${toastSequence}`;
      const toast: Toast = {
        ...input,
        id,
        kind: input.kind ?? 'info',
      };
      setToasts(current => [...current.slice(-3), toast]);
      const timer = setTimeout(() => dismiss(id), input.timeoutMs ?? 5000);
      timers.current.push(timer);
    },
    [dismiss],
  );

  useEffect(
    () => () => {
      timers.current.forEach(clearTimeout);
      timers.current = [];
    },
    [],
  );

  const value = useMemo(() => ({ push, dismiss }), [push, dismiss]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      {toasts.length > 0 ? (
        <View
          pointerEvents="box-none"
          style={[styles.overlay, { bottom: insets.bottom + 78 }]}>
          {toasts.map(toast => (
            <ToastCard
              key={toast.id}
              toast={toast}
              onDismiss={() => dismiss(toast.id)}
            />
          ))}
        </View>
      ) : null}
    </ToastContext.Provider>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    left: 14,
    right: 14,
    gap: 8,
    zIndex: 100,
    elevation: 20,
  },
  toast: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    borderWidth: 1,
    borderRadius: 16,
    padding: 13,
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  toastMark: {
    fontSize: 16,
    fontWeight: '800',
    width: 18,
    textAlign: 'center',
    marginTop: 1,
  },
  toastBody: { flex: 1, minWidth: 0 },
  toastTitle: { fontSize: 14, fontWeight: '700' },
  toastMessage: { fontSize: 13, marginTop: 2, opacity: 0.85, lineHeight: 18 },
  toastClose: { paddingHorizontal: 2 },
  toastCloseText: { fontSize: 20, lineHeight: 20, opacity: 0.6 },
});

export function useToast(): ToastContextValue {
  const value = useContext(ToastContext);
  if (value === null) {
    throw new Error('useToast must be used inside ToastProvider');
  }
  return value;
}
