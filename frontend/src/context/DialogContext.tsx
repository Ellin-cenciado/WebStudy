import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { cn } from "../lib/cn";

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
}

interface DialogContextValue {
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  prompt: (options: PromptOptions) => Promise<string | null>;
}

type DialogRequest =
  | {
      kind: "confirm";
      options: ConfirmOptions;
      resolve: (value: boolean) => void;
    }
  | {
      kind: "prompt";
      options: PromptOptions;
      resolve: (value: string | null) => void;
    };

type PendingDialog = DialogRequest & { id: number };

const DialogContext = createContext<DialogContextValue | null>(null);

const inputClass =
  "mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/20 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-50";

function DialogHost({
  pending,
  onResolve,
}: {
  pending: PendingDialog;
  onResolve: (value: boolean | string | null) => void;
}) {
  const titleId = useId();
  const descriptionId = useId();
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const [value, setValue] = useState(
    pending.kind === "prompt" ? (pending.options.initialValue ?? "") : "",
  );

  const cancel = useCallback(() => {
    onResolve(pending.kind === "confirm" ? false : null);
  }, [onResolve, pending.kind]);

  const submit = useCallback(() => {
    onResolve(pending.kind === "confirm" ? true : value);
  }, [onResolve, pending.kind, value]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        cancel();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [cancel]);

  useEffect(() => {
    if (pending.kind === "prompt") {
      inputRef.current?.focus();
      inputRef.current?.select();
    } else {
      confirmRef.current?.focus();
    }
  }, [pending.kind]);

  const options = pending.options;
  const destructive = pending.kind === "confirm" && pending.options.destructive;
  const cancelLabel = options.cancelLabel ?? "Cancel";
  const submitLabel =
    pending.kind === "confirm"
      ? (pending.options.confirmLabel ?? "Confirm")
      : (pending.options.submitLabel ?? "Save");
  const emptyPrompt = pending.kind === "prompt" && value.trim() === "";

  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-4">
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-slate-950/50 backdrop-blur-[2px]"
        onClick={cancel}
      />
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!emptyPrompt) submit();
        }}
        className="relative w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl dark:border-slate-800 dark:bg-slate-900"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={options.message ? descriptionId : undefined}
      >
        <h2
          id={titleId}
          className="text-lg font-bold text-slate-900 dark:text-slate-50"
        >
          {options.title}
        </h2>
        {options.message ? (
          <p
            id={descriptionId}
            className="mt-2 text-sm text-slate-600 dark:text-slate-300"
          >
            {options.message}
          </p>
        ) : null}

        {pending.kind === "prompt" ? (
          <label
            htmlFor={inputId}
            className="mt-4 flex flex-col text-sm font-semibold text-slate-700 dark:text-slate-200"
          >
            {pending.options.label ?? "Value"}
            <input
              id={inputId}
              ref={inputRef}
              value={value}
              onChange={(event) => setValue(event.target.value)}
              className={inputClass}
              autoComplete="off"
            />
          </label>
        ) : null}

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={cancel}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
            type="submit"
            disabled={emptyPrompt}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-sm font-semibold text-white transition disabled:cursor-not-allowed disabled:opacity-40",
              destructive
                ? "bg-red-600 hover:bg-red-500"
                : "bg-indigo-600 hover:bg-indigo-500",
            )}
          >
            {submitLabel}
          </button>
        </div>
      </form>
    </div>
  );
}

export function DialogProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<PendingDialog | null>(null);
  const pendingRef = useRef<PendingDialog | null>(null);
  const nextId = useRef(0);

  const open = useCallback((request: DialogRequest) => {
    const previous = pendingRef.current;
    if (previous !== null) {
      if (previous.kind === "confirm") previous.resolve(false);
      else previous.resolve(null);
    }
    const next: PendingDialog = {
      ...request,
      id: nextId.current,
    } as PendingDialog;
    nextId.current += 1;
    pendingRef.current = next;
    setPending(next);
  }, []);

  const confirm = useCallback(
    (options: ConfirmOptions) =>
      new Promise<boolean>((resolve) => {
        open({ kind: "confirm", options, resolve });
      }),
    [open],
  );

  const prompt = useCallback(
    (options: PromptOptions) =>
      new Promise<string | null>((resolve) => {
        open({ kind: "prompt", options, resolve });
      }),
    [open],
  );

  const resolveDialog = useCallback((value: boolean | string | null) => {
    const current = pendingRef.current;
    if (current === null) return;
    pendingRef.current = null;
    setPending(null);
    if (current.kind === "confirm") {
      current.resolve(value === true);
    } else {
      current.resolve(typeof value === "string" ? value : null);
    }
  }, []);

  const value = useMemo(() => ({ confirm, prompt }), [confirm, prompt]);

  return (
    <DialogContext.Provider value={value}>
      {children}
      {pending !== null ? (
        <DialogHost
          key={pending.id}
          pending={pending}
          onResolve={resolveDialog}
        />
      ) : null}
    </DialogContext.Provider>
  );
}

export function useDialog(): DialogContextValue {
  const context = useContext(DialogContext);
  if (context === null) {
    throw new Error("useDialog must be used inside DialogProvider");
  }
  return context;
}
