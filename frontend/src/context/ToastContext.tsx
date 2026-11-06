import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { CheckCircle2, Info, TriangleAlert, X } from "lucide-react";
import { cn } from "../lib/cn";

export type ToastKind = "info" | "success" | "warning" | "error";

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

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: string) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const push = useCallback(
    (input: ToastInput) => {
      toastSequence += 1;
      const id = `toast-${toastSequence}`;
      const toast: Toast = {
        ...input,
        id,
        kind: input.kind ?? "info",
        timeoutMs: input.timeoutMs ?? 6000,
      };
      setToasts((current) => [...current.slice(-4), toast]);
      window.setTimeout(() => dismiss(id), toast.timeoutMs);
    },
    [dismiss],
  );

  const value = useMemo(() => ({ push, dismiss }), [push, dismiss]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        className="pointer-events-none fixed inset-x-0 bottom-20 z-50 flex flex-col items-center gap-2 px-4 sm:bottom-6 sm:items-end sm:px-6"
        aria-live="polite"
        aria-atomic="false"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={cn(
              "pointer-events-auto flex w-full max-w-md items-start gap-3 rounded-2xl border p-4 shadow-xl backdrop-blur",
              toast.kind === "success" &&
                "border-emerald-200 bg-emerald-50/95 text-emerald-950 dark:border-emerald-900 dark:bg-emerald-950/95 dark:text-emerald-50",
              toast.kind === "error" &&
                "border-red-200 bg-red-50/95 text-red-950 dark:border-red-900 dark:bg-red-950/95 dark:text-red-50",
              toast.kind === "warning" &&
                "border-amber-200 bg-amber-50/95 text-amber-950 dark:border-amber-900 dark:bg-amber-950/95 dark:text-amber-50",
              toast.kind === "info" &&
                "border-slate-200 bg-white/95 text-slate-900 dark:border-slate-700 dark:bg-slate-900/95 dark:text-slate-50",
            )}
          >
            <span className="mt-0.5 shrink-0">
              {toast.kind === "success" ? (
                <CheckCircle2 className="size-5" />
              ) : toast.kind === "error" || toast.kind === "warning" ? (
                <TriangleAlert className="size-5" />
              ) : (
                <Info className="size-5" />
              )}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">{toast.title}</p>
              {toast.body ? (
                <p className="mt-0.5 text-sm opacity-80">{toast.body}</p>
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => dismiss(toast.id)}
              className="rounded-full p-1 opacity-60 transition hover:bg-black/5 hover:opacity-100 dark:hover:bg-white/10"
              aria-label="Dismiss notification"
            >
              <X className="size-4" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const value = useContext(ToastContext);
  if (value === null) {
    throw new Error("useToast must be used inside ToastProvider");
  }
  return value;
}
