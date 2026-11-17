import { useState } from "react";
import {
  Ban,
  FileText,
  ListChecks,
  NotebookPen,
  Presentation,
  RotateCcw,
  Sparkles,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { NotesView } from "./NotesView";
import { PlanEditor } from "./PlanEditor";
import { RunStatusBadge } from "./RunStatusBadge";
import { ProgressBar, Skeleton, Spinner } from "../ui";
import { cn } from "../../lib/cn";
import { formatBytes, formatDateTime, formatHours } from "../../lib/format";
import type {
  StudyPrepRun,
  StudyPrepResult,
  StudyPrepStage,
  StudySourceKind,
} from "../../lib/types";

const STAGE_LABELS: Record<StudyPrepStage, string> = {
  queued: "Queued",
  extracting: "Extracting source text",
  mapping: "Mapping the material",
  drafting: "Writing the notes",
  planning: "Estimating study time",
  ready: "Ready",
  failed: "Failed",
  cancelled: "Cancelled",
  interrupted: "Interrupted",
};

function SourceIcon({ kind }: { kind: StudySourceKind }) {
  if (kind === "pptx") {
    return <Presentation className="size-4 shrink-0 text-orange-500" />;
  }
  if (kind === "notes") {
    return <NotebookPen className="size-4 shrink-0 text-violet-500" />;
  }
  return <FileText className="size-4 shrink-0 text-red-500" />;
}

function OptionsLine({ run }: { run: StudyPrepRun }) {
  const language =
    run.options.language === "auto" ? "Auto language" : run.options.language.toUpperCase();
  return (
    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
      {language} · {run.options.depth} ·{" "}
      {run.options.target_minutes === null
        ? "automatic target"
        : `${run.options.target_minutes} min target`}{" "}
      · {formatDateTime(run.created_at)}
    </p>
  );
}

export function RunDetail({
  run,
  result,
  resultLoading,
  resultError,
  busy,
  onCancel,
  onRetry,
  onDelete,
  onReloadResult,
  onImported,
}: {
  run: StudyPrepRun;
  result: StudyPrepResult | null;
  resultLoading: boolean;
  resultError: string | null;
  busy: boolean;
  onCancel: () => void;
  onRetry: () => void;
  onDelete: () => void;
  onReloadResult: () => void;
  onImported: () => void;
}) {
  const [tab, setTab] = useState<"notes" | "plan">("notes");
  const active = run.status === "queued" || run.status === "running";
  const canRetry =
    run.status === "failed" ||
    run.status === "cancelled" ||
    run.status === "interrupted";

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-bold">{run.title}</h2>
              <RunStatusBadge status={run.status} />
              {run.imported_at !== null ? (
                <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                  Imported
                </span>
              ) : null}
            </div>
            <OptionsLine run={run} />
          </div>
          <div className="flex items-center gap-1.5">
            {active ? (
              <button
                type="button"
                onClick={onCancel}
                disabled={busy}
                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-40 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                {busy ? <Spinner /> : <Ban className="size-4" />}
                Cancel
              </button>
            ) : null}
            {canRetry ? (
              <button
                type="button"
                onClick={onRetry}
                disabled={busy}
                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-40 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                {busy ? <Spinner /> : <RotateCcw className="size-4" />}
                Retry
              </button>
            ) : null}
            <button
              type="button"
              onClick={onDelete}
              disabled={busy}
              className="rounded-xl border border-slate-200 bg-white p-2 text-slate-400 transition hover:bg-red-50 hover:text-red-600 disabled:opacity-40 dark:border-slate-700 dark:bg-slate-900 dark:hover:bg-red-950 dark:hover:text-red-300"
              title="Delete preparation"
              aria-label="Delete preparation"
            >
              <Trash2 className="size-4" />
            </button>
          </div>
        </div>

        {active ? (
          <div className="mt-4 rounded-xl bg-slate-50 p-3 dark:bg-slate-950/50">
            <div className="flex items-center justify-between gap-3 text-sm">
              <p className="font-semibold">{STAGE_LABELS[run.stage]}</p>
              <p className="tabular-nums text-slate-500 dark:text-slate-400">
                {run.progress}%
              </p>
            </div>
            <ProgressBar value={run.progress} max={100} className="mt-2" />
            <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">
              {run.stage_detail || "Working…"} The run continues in the background;
              you can leave this page.
            </p>
          </div>
        ) : null}

        {run.error !== null ? (
          <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-900 dark:border-red-900 dark:bg-red-950/50 dark:text-red-100">
            <div className="flex items-start gap-2">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" />
              <div>
                <p className="font-semibold">{run.error.message}</p>
                {run.error.hint ? (
                  <p className="mt-0.5 text-xs opacity-80">{run.error.hint}</p>
                ) : null}
                <p className="mt-1 font-mono text-[10px] opacity-60">
                  {run.error.code}
                </p>
              </div>
            </div>
          </div>
        ) : null}

        {run.status === "ready" ? null : run.error === null && !active ? (
          <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">
            This run did not finish. Retry it or create a new preparation.
          </p>
        ) : null}

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">
              Sources
            </p>
            {run.sources.length === 0 ? (
              <p className="mt-1 text-xs text-slate-400">Rough notes only</p>
            ) : (
              <ul className="mt-1.5 space-y-1.5">
                {run.sources.map((source) => (
                  <li
                    key={source.id}
                    className="flex items-start gap-2 rounded-lg border border-slate-100 bg-slate-50/60 px-2.5 py-1.5 text-xs dark:border-slate-800 dark:bg-slate-950/40"
                  >
                    <SourceIcon kind={source.kind} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold">{source.filename}</p>
                      <p className="text-[10px] text-slate-500 dark:text-slate-400">
                        {source.kind.toUpperCase()}
                        {source.size_bytes > 0
                          ? ` · ${formatBytes(source.size_bytes)}`
                          : ""}
                        {source.unit_count > 0
                          ? ` · ${source.unit_count} ${source.unit_label}`
                          : ""}
                        {source.chapter_count > 0
                          ? ` · ${source.chapter_count} chapters`
                          : ""}
                      </p>
                      {source.error ? (
                        <p className="mt-0.5 text-[10px] text-red-600 dark:text-red-400">
                          {source.error}
                        </p>
                      ) : null}
                    </div>
                    {source.status === "ready" ? (
                      <span className="mt-1 size-1.5 shrink-0 rounded-full bg-emerald-500" />
                    ) : source.status === "error" ? (
                      <span className="mt-1 size-1.5 shrink-0 rounded-full bg-red-500" />
                    ) : (
                      <span className="mt-1 size-1.5 shrink-0 animate-pulse rounded-full bg-slate-400" />
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">
              Plan
            </p>
            {run.status === "ready" ? (
              <div className="mt-1.5 rounded-xl border border-slate-100 bg-slate-50/60 p-3 text-xs dark:border-slate-800 dark:bg-slate-950/40">
                <p className="text-base font-bold tabular-nums">
                  {run.item_count ?? 0}{" "}
                  {run.item_count === 1 ? "item" : "items"}
                </p>
                <p className="mt-0.5 text-slate-500 dark:text-slate-400">
                  {run.subject_count ?? 0}{" "}
                  {run.subject_count === 1 ? "subject" : "subjects"} ·{" "}
                  {formatHours(run.total_duration_seconds ?? 0)} of study time
                </p>
              </div>
            ) : (
              <p className="mt-1.5 text-xs text-slate-400">
                The plan appears when the notes are ready.
              </p>
            )}
          </div>
        </div>

        {run.warnings.length > 0 ? (
          <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/50 dark:text-amber-100">
            <p className="font-semibold">Warnings</p>
            <ul className="mt-1 space-y-0.5 opacity-90">
              {run.warnings.map((warning) => (
                <li key={warning}>· {warning}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      {run.status === "ready" ? (
        resultLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-14" />
            <Skeleton className="h-96" />
          </div>
        ) : resultError !== null ? (
          <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-900 dark:border-red-900 dark:bg-red-950/50 dark:text-red-100">
            <div className="flex items-start gap-2">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" />
              <div>
                <p className="font-semibold">Could not load the result</p>
                <p className="mt-0.5 text-xs opacity-80">{resultError}</p>
                <button
                  type="button"
                  onClick={onReloadResult}
                  className="mt-2 rounded-lg bg-red-900 px-2.5 py-1.5 text-xs font-semibold text-white dark:bg-red-100 dark:text-red-950"
                >
                  Try again
                </button>
              </div>
            </div>
          </div>
        ) : result !== null ? (
          <div className="space-y-3">
            <div className="inline-flex rounded-xl border border-slate-200 bg-white p-1 shadow-sm dark:border-slate-800 dark:bg-slate-900">
              <button
                type="button"
                onClick={() => setTab("notes")}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold transition",
                  tab === "notes"
                    ? "bg-indigo-600 text-white"
                    : "text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100",
                )}
              >
                <Sparkles className="size-4" />
                Notes
              </button>
              <button
                type="button"
                onClick={() => setTab("plan")}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold transition",
                  tab === "plan"
                    ? "bg-indigo-600 text-white"
                    : "text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100",
                )}
              >
                <ListChecks className="size-4" />
                Plan
              </button>
            </div>
            {tab === "notes" ? (
              <NotesView notes={result.notes} />
            ) : (
              <PlanEditor
                plan={result.plan}
                runId={run.id}
                importedAt={run.imported_at}
                onImported={onImported}
              />
            )}
          </div>
        ) : null
      ) : null}
    </div>
  );
}
