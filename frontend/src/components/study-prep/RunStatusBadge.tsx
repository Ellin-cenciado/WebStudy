import { cn } from "../../lib/cn";
import type { StudyPrepStatus } from "../../lib/types";

const STYLES: Record<StudyPrepStatus, string> = {
  queued:
    "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
  running:
    "bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300",
  ready:
    "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
  failed: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
  cancelled:
    "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400",
  interrupted:
    "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
};

const LABELS: Record<StudyPrepStatus, string> = {
  queued: "Queued",
  running: "Running",
  ready: "Ready",
  failed: "Failed",
  cancelled: "Cancelled",
  interrupted: "Interrupted",
};

export function RunStatusBadge({
  status,
  className,
}: {
  status: StudyPrepStatus;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide",
        STYLES[status],
        className,
      )}
    >
      {status === "running" ? (
        <span className="size-1.5 animate-pulse rounded-full bg-current" />
      ) : null}
      {LABELS[status]}
    </span>
  );
}
