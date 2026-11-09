import { Check, Plus, Sparkles, Trash2 } from "lucide-react";
import { RunStatusBadge } from "./RunStatusBadge";
import { Skeleton } from "../ui";
import { cn } from "../../lib/cn";
import { formatDateTime, formatHours } from "../../lib/format";
import type { StudyPrepRun } from "../../lib/types";

export function HistoryList({
  runs,
  selectedId,
  loading,
  error,
  busyId,
  onSelect,
  onDelete,
  onNew,
}: {
  runs: StudyPrepRun[];
  selectedId: string | null;
  loading: boolean;
  error: string | null;
  busyId: string | null;
  onSelect: (runId: string) => void;
  onDelete: (run: StudyPrepRun) => void;
  onNew: () => void;
}) {
  return (
    <aside className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-bold">History</h2>
        <button
          type="button"
          onClick={onNew}
          className="inline-flex items-center gap-1 rounded-lg bg-indigo-50 px-2 py-1.5 text-xs font-semibold text-indigo-700 transition hover:bg-indigo-100 dark:bg-indigo-950 dark:text-indigo-300 dark:hover:bg-indigo-900"
        >
          <Plus className="size-3.5" />
          New
        </button>
      </div>

      {error !== null ? (
        <p className="mt-3 rounded-xl bg-red-50 p-2.5 text-xs text-red-800 dark:bg-red-950/50 dark:text-red-200">
          {error}
        </p>
      ) : null}

      {loading && runs.length === 0 ? (
        <div className="mt-3 space-y-2">
          <Skeleton className="h-16 rounded-xl" />
          <Skeleton className="h-16 rounded-xl" />
        </div>
      ) : runs.length === 0 ? (
        <div className="mt-4 rounded-xl border border-dashed border-slate-200 px-3 py-6 text-center dark:border-slate-700">
          <Sparkles className="mx-auto size-6 text-slate-300 dark:text-slate-600" />
          <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
            No preparations yet. Your generated notes and plans will appear here.
          </p>
        </div>
      ) : (
        <ul className="mt-3 space-y-1.5">
          {runs.map((run) => {
            const selected = run.id === selectedId;
            return (
              <li
                key={run.id}
                className={cn(
                  "flex items-stretch gap-1 rounded-xl border transition",
                  selected
                    ? "border-indigo-200 bg-indigo-50/70 dark:border-indigo-900 dark:bg-indigo-950/30"
                    : "border-transparent hover:border-slate-200 hover:bg-slate-50 dark:hover:border-slate-700 dark:hover:bg-slate-800/50",
                )}
              >
                <button
                  type="button"
                  onClick={() => onSelect(run.id)}
                  className="min-w-0 flex-1 px-2.5 py-2 text-left"
                >
                  <span className="flex items-center gap-1.5">
                    <span className="min-w-0 flex-1 truncate text-xs font-bold">
                      {run.title}
                    </span>
                    {run.imported_at !== null ? (
                      <span
                        className="inline-flex items-center gap-0.5 rounded-full bg-emerald-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
                        title="Imported to the checklist"
                      >
                        <Check className="size-2.5" />
                        Imported
                      </span>
                    ) : null}
                  </span>
                  <span className="mt-1 flex flex-wrap items-center gap-1.5">
                    <RunStatusBadge status={run.status} />
                    <span className="text-[10px] text-slate-400">
                      {formatDateTime(run.created_at)}
                    </span>
                  </span>
                  {run.status === "ready" &&
                  run.item_count !== null &&
                  run.total_duration_seconds !== null ? (
                    <span className="mt-1 block text-[10px] text-slate-500 dark:text-slate-400">
                      {run.subject_count ?? 0} subjects · {run.item_count} items ·{" "}
                      {formatHours(run.total_duration_seconds)}
                    </span>
                  ) : (
                    <span className="mt-1 block truncate text-[10px] text-slate-500 dark:text-slate-400">
                      {run.stage_detail}
                    </span>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => onDelete(run)}
                  disabled={busyId === run.id}
                  className="m-1 shrink-0 self-center rounded-lg p-1.5 text-slate-300 transition hover:bg-red-50 hover:text-red-600 disabled:opacity-30 dark:hover:bg-red-950 dark:hover:text-red-300"
                  title="Delete preparation"
                  aria-label={`Delete ${run.title}`}
                >
                  <Trash2 className="size-3.5" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </aside>
  );
}
