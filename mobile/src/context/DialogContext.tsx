import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useTheme } from './ThemeContext';

export interface ConfirmOptions {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
}

export interface PromptOptions {
  title: string;
  message?: string;
  label?: string;
  initialValue?: string;
  submitLabel?: string;
  cancelLabel?: string;
  keyboardType?: 'default' | 'number-pad';
}

interface DialogContextValue {
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  prompt: (options: PromptOptions) => Promise<string | null>;
}

type DialogRequest =
  | {
      kind: 'confirm';
      options: ConfirmOptions;
      resolve: (value: boolean) => void;
    }
  | {
      kind: 'prompt';
      options: PromptOptions;
      resolve: (value: string | null) => void;
    };

type PendingDialog = DialogRequest & { id: number };

const DialogContext = createContext<DialogContextValue | null>(null);

function DialogHost({
  pending,
  onResolve,
}: {
  pending: PendingDialog;
  onResolve: (value: boolean | string | null) => void;
}) {
  const { colors } = useTheme();
  const initial =
    pending.kind === 'prompt' ? pending.options.initialValue ?? '' : '';
  const [value, setValue] = useState(initial);

  const cancel = useCallback(() => {
    onResolve(pending.kind === 'confirm' ? false : null);
  }, [onResolve, pending.kind]);

  const submit = useCallback(() => {
    if (pending.kind === 'confirm') {
      onResolve(true);
    } else {
      onResolve(value);
    }
  }, [onResolve, pending.kind, value]);

  const options = pending.options;
  const destructive = pending.kind === 'confirm' && pending.options.destructive;
  const cancelLabel = options.cancelLabel ?? 'Cancel';
  const submitLabel =
    pending.kind === 'confirm'
      ? pending.options.confirmLabel ?? 'Confirm'
      : pending.options.submitLabel ?? 'Save';
  const emptyPrompt = pending.kind === 'prompt' && value.trim() === '';

  return (
    <Modal
      animationType="fade"
      onRequestClose={cancel}
      statusBarTranslucent
      transparent
      visible>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.root}>
        <Pressable
          accessibilityLabel="Close dialog"
          onPress={cancel}
          style={[StyleSheet.absoluteFill, styles.backdrop]}
        />
        <View
          style={[
            styles.card,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}>
          <Text style={[styles.title, { color: colors.text }]}>
            {options.title}
          </Text>
          {options.message ? (
            <Text style={[styles.message, { color: colors.textMuted }]}>
              {options.message}
            </Text>
          ) : null}

          {pending.kind === 'prompt' ? (
            <View style={styles.field}>
              <Text style={[styles.label, { color: colors.textMuted }]}>
                {pending.options.label ?? 'Value'}
              </Text>
              <TextInput
                autoFocus
                keyboardType={pending.options.keyboardType ?? 'default'}
                onChangeText={setValue}
                onSubmitEditing={submit}
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
                  },
                ]}
                value={value}
              />
            </View>
          ) : null}

          <View style={styles.actions}>
            <Pressable
              onPress={cancel}
              style={({ pressed }) => [
                styles.button,
                styles.cancel,
                { borderColor: colors.border },
                pressed && styles.pressed,
              ]}>
              <Text style={[styles.cancelText, { color: colors.textMuted }]}>
                {cancelLabel}
              </Text>
            </Pressable>
            <Pressable
              disabled={emptyPrompt}
              onPress={submit}
              style={({ pressed }) => [
                styles.button,
                {
                  backgroundColor: destructive ? colors.danger : colors.accent,
                  opacity: emptyPrompt ? 0.4 : pressed ? 0.75 : 1,
                },
              ]}>
              <Text
                style={[
                  styles.submitText,
                  { color: destructive ? '#ffffff' : colors.accentText },
                ]}>
                {submitLabel}
              </Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

export function DialogProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<PendingDialog | null>(null);
  const pendingRef = useRef<PendingDialog | null>(null);
  const nextId = useRef(0);

  const open = useCallback((request: DialogRequest) => {
    const previous = pendingRef.current;
    if (previous !== null) {
      if (previous.kind === 'confirm') {
        previous.resolve(false);
      } else {
        previous.resolve(null);
      }
    }
    const next = { ...request, id: nextId.current } as PendingDialog;
    nextId.current += 1;
    pendingRef.current = next;
    setPending(next);
  }, []);

  const confirm = useCallback(
    (options: ConfirmOptions) =>
      new Promise<boolean>(resolve => {
        open({ kind: 'confirm', options, resolve });
      }),
    [open],
  );

  const prompt = useCallback(
    (options: PromptOptions) =>
      new Promise<string | null>(resolve => {
        open({ kind: 'prompt', options, resolve });
      }),
    [open],
  );

  const resolveDialog = useCallback((value: boolean | string | null) => {
    const current = pendingRef.current;
    if (current === null) {
      return;
    }
    pendingRef.current = null;
    setPending(null);
    if (current.kind === 'confirm') {
      current.resolve(value === true);
    } else {
      current.resolve(typeof value === 'string' ? value : null);
    }
  }, []);

  const value = useMemo(() => ({ confirm, prompt }), [confirm, prompt]);

  return (
    <DialogContext.Provider value={value}>
      {children}
      {pending !== null ? (
        <DialogHost
          key={pending.id}
          onResolve={resolveDialog}
          pending={pending}
        />
      ) : null}
    </DialogContext.Provider>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  backdrop: { backgroundColor: 'rgba(2, 6, 23, 0.55)' },
  card: {
    width: '100%',
    maxWidth: 440,
    borderRadius: 20,
    borderWidth: 1,
    padding: 20,
    shadowColor: '#000',
    shadowOpacity: 0.26,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 10 },
    elevation: 12,
  },
  title: { fontSize: 18, fontWeight: '700' },
  message: { fontSize: 14, lineHeight: 20, marginTop: 8 },
  field: { marginTop: 16, gap: 6 },
  label: { fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.6 },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
  },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 20 },
  button: {
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 11,
    minWidth: 82,
    alignItems: 'center',
  },
  cancel: { borderWidth: 1 },
  cancelText: { fontSize: 14, fontWeight: '600' },
  submitText: { fontSize: 14, fontWeight: '700' },
  pressed: { opacity: 0.7 },
});

export function useDialog(): DialogContextValue {
  const value = useContext(DialogContext);
  if (value === null) {
    throw new Error('useDialog must be used inside DialogProvider');
  }
  return value;
}
