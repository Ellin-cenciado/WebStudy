import { useEffect } from "react";
import {
  CheckCircle2,
  Coffee,
  FastForward,
  Pause,
  Play,
  RotateCcw,
  Sparkles,
} from "lucide-react";
import { useLive } from "../context/LiveContext";
import { useAction } from "../hooks/useAction";
import { api } from "../lib/api";
import { cn } from "../lib/cn";
import { formatClock, formatHours, formatTimestamp, titleCase } from "../lib/format";
import { ProgressBar, Skeleton, Spinner } from "../components/ui";

function phaseLabel(
  phase: string,
  freeDay: boolean,
  complete: boolean,
  vacation = false,
): string {
  if (complete) return "Day complete";
  if (vacation) return "Vacation";
  if (freeDay) return "Free day";
  if (phase === "idle") return "Ready";
  return titleCase(phase);
}

export function TimerPage() {
  const { state, connected } = useLive();
  const { pending, run } = useAction();

  const snapshot = state?.snapshot;
  const complete = snapshot?.day_complete ?? false;
  const freeDay = snapshot?.is_free_day ?? false;
  const vacation = snapshot?.is_vacation ?? false;
  const running = snapshot?.running ?? false;
  const canControl = connected && snapshot !== undefined && !complete && !freeDay;

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = event.target;
      if (
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        (target instanceof Element &&
          target.closest(
            'input, textarea, select, button, a, [contenteditable="true"], [role="button"]',
          ) !== null)
      ) {
        return;
      }
      if (event.code === "Space" && canControl) {
        event.preventDefault();
        void run(() => (running ? api.pause() : api.start()));
      }
      if (event.key.toLowerCase() === "s" && canControl) {
        event.preventDefault();
        void run(() => api.skipPhase());
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [canControl, run, running]);

  if (state === null || snapshot === undefined) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-52" />
        <Skeleton className="h-[28rem] w-full" />
        <div className="grid gap-4 sm:grid-cols-3">
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
        </div>
      </div>
    );
  }

  const phaseLength = snapshot.phase_length_seconds;
  const phaseProgress = phaseLength > 0 ? snapshot.phase_elapsed_seconds : 0;
  const countdown =
    complete || freeDay
      ? null
      : snapshot.phase === "idle"
        ? null
        : formatClock(snapshot.phase_remaining_seconds);

  const primaryLabel = complete
    ? "Done"
    : vacation
      ? "Vacation"
      : freeDay
        ? "Free day"
        : running
          ? "Pause"
          : snapshot.phase === "complete"
            ? "Done"
            : "Start";

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-indigo-600 dark:text-indigo-400">
            {snapshot.weekday} · {snapshot.logical_day}
          </p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-50 sm:text-3xl">
            {complete
              ? "You did it."
              : vacation
                ? "Vacation mode."
                : freeDay
                  ? "Take the day off."
                  : running
                    ? "Stay with it."
                    : "Ready when you are."}
          </h1>
        </div>
        <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-2.5 py-1 shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
            <span
              className={cn(
                "size-1.5 rounded-full",
                running ? "animate-pulse bg-emerald-500" : "bg-slate-400",
              )}
            />
            {running ? "Session running" : "Session paused"}
          </span>
          <span className="hidden sm:inline">
            updated {formatTimestamp(state.server_time)}
          </span>
        </div>
      </div>

      <section className="relative overflow-hidden rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900 sm:p-10">
        <div
          className={cn(
            "pointer-events-none absolute inset-x-0 top-0 h-40 opacity-70 blur-2xl",
            running
              ? "bg-gradient-to-b from-indigo-200/70 to-transparent dark:from-indigo-900/40"
              : "bg-gradient-to-b from-slate-100 to-transparent dark:from-slate-800/40",
          )}
        />
        <div className="relative flex flex-col items-center text-center">
          <span
            className={cn(
              "inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-bold uppercase tracking-[0.18em]",
              complete
                ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
                : freeDay
                  ? "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"
                  : snapshot.phase === "break"
                    ? "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300"
                    : "bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300",
            )}
          >
            {complete ? (
              <CheckCircle2 className="size-3.5" />
            ) : snapshot.phase === "break" ? (
              <Coffee className="size-3.5" />
            ) : running ? (
              <Sparkles className="size-3.5" />
            ) : (
              <RotateCcw className="size-3.5" />
            )}
            {phaseLabel(snapshot.phase, freeDay, complete, vacation)}
          </span>

          <div className="mt-5 min-h-[7rem] sm:min-h-[9rem]">
            {countdown !== null ? (
              <p className="font-mono text-6xl font-black tabular-nums tracking-tight text-slate-900 dark:text-slate-50 sm:text-8xl">
                {countdown}
              </p>
            ) : (
              <p className="text-5xl font-black tracking-tight text-slate-900 dark:text-slate-50 sm:text-7xl">
                {complete
                  ? "Done"
                  : vacation
                    ? "Off"
                    : freeDay
                      ? "Rest"
                      : "Ready"}
              </p>
            )}
          </div>

          {snapshot.phase !== "idle" && phaseLength > 0 && !complete && !freeDay ? (
            <div className="mt-1 w-full max-w-sm">
              <ProgressBar
                value={phaseProgress}
                max={phaseLength}
                tone={snapshot.phase === "break" ? "amber" : "indigo"}
                className="h-1.5"
              />
            </div>
          ) : null}

          <p className="mt-5 text-sm text-slate-500 dark:text-slate-400">
            {freeDay
              ? "No study required today."
              : complete
                ? `Required ${formatHours(snapshot.required_seconds)} — all done.`
                : `${formatHours(snapshot.remaining_seconds)} remaining of ${formatHours(snapshot.required_seconds)}`}
          </p>

          <div className="mt-5 w-full max-w-md">
            <ProgressBar
              value={snapshot.elapsed_seconds}
              max={snapshot.required_seconds}
              tone={complete ? "emerald" : "indigo"}
              className="h-2.5"
            />
            <div className="mt-1.5 flex justify-between text-[11px] font-medium tabular-nums text-slate-500 dark:text-slate-400">
              <span>{formatHours(snapshot.elapsed_seconds)} studied</span>
              <span>{formatHours(snapshot.required_seconds)} goal</span>
            </div>
          </div>

          {snapshot.debt_seconds > 0 && !complete ? (
            <p className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700 ring-1 ring-amber-200 dark:bg-amber-950/60 dark:text-amber-300 dark:ring-amber-900">
              <RotateCcw className="size-3.5" />
              Carried in: {formatHours(snapshot.debt_seconds)} debt
            </p>
          ) : null}

          {snapshot.optional_goal_seconds > 0 ? (
            <div className="mt-5 w-full max-w-md rounded-2xl bg-slate-50 p-3 ring-1 ring-slate-200 dark:bg-slate-800/50 dark:ring-slate-800">
              <div className="flex items-center justify-between text-xs font-semibold text-slate-600 dark:text-slate-300">
                <span>Optional weekend goal</span>
                <span className="tabular-nums">
                  {formatHours(snapshot.optional_done_seconds)} /{" "}
                  {formatHours(snapshot.optional_goal_seconds)}
                </span>
              </div>
              <ProgressBar
                value={snapshot.optional_done_seconds}
                max={snapshot.optional_goal_seconds}
                tone="amber"
                className="mt-2 h-1.5"
              />
            </div>
          ) : null}

          <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
            <button
              type="button"
              onClick={() =>
                void run(() => (running ? api.pause() : api.start()))
              }
              disabled={!canControl || pending}
              className={cn(
                "inline-flex min-w-36 items-center justify-center gap-2 rounded-full px-6 py-3 text-sm font-bold text-white shadow-lg transition",
                running
                  ? "bg-slate-900 shadow-slate-900/20 hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white"
                  : "bg-indigo-600 shadow-indigo-600/25 hover:bg-indigo-500",
                (!canControl || pending) && "cursor-not-allowed opacity-50",
              )}
            >
              {pending ? (
                <Spinner />
              ) : running ? (
                <Pause className="size-4" />
              ) : (
                <Play className="size-4" />
              )}
              {primaryLabel}
            </button>
            <button
              type="button"
              onClick={() => void run(() => api.skipPhase())}
              disabled={!canControl || pending || snapshot.phase === "idle"}
              className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              <FastForward className="size-4" />
              Skip phase
            </button>
          </div>

          <p className="mt-4 text-[11px] text-slate-400 dark:text-slate-500">
            <kbd className="rounded border border-slate-200 px-1 py-0.5 dark:border-slate-700">Space</kbd>{" "}
            start / pause ·{" "}
            <kbd className="rounded border border-slate-200 px-1 py-0.5 dark:border-slate-700">S</kbd>{" "}
            skip phase
          </p>
        </div>
      </section>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Day type
          </p>
          <p className="mt-2 text-lg font-bold capitalize">{snapshot.day_kind}</p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            {vacation
              ? "No requirement. Existing debt is preserved."
              : snapshot.is_free_day
                ? "No requirement. Debt is preserved."
                : snapshot.day_kind === "optional"
                  ? "Goal only. Unmet time is discarded."
                  : "Unmet time becomes tomorrow's debt."}
          </p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Session time
          </p>
          <p className="mt-2 text-lg font-bold tabular-nums">
            {formatHours(snapshot.elapsed_seconds)}
          </p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            The daily goal counts session time, breaks included.
          </p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Active item
          </p>
          <p className="mt-2 text-lg font-bold tabular-nums">
            {state.checklist.active_item_id
              ? state.checklist.overrun_seconds > 0
                ? `+${formatClock(state.checklist.overrun_seconds)}`
                : formatClock(state.checklist.remaining_seconds)
              : "—"}
          </p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            {state.checklist.rest_remaining_seconds > 0
              ? `Rest: ${formatClock(state.checklist.rest_remaining_seconds)}`
              : "Only study time advances the item."}
          </p>
        </div>
      </div>
    </div>
  );
}
