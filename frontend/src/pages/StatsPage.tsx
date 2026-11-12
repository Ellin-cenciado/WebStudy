import { useCallback, useEffect, useState } from "react";
import { BarChart3, RefreshCw, TriangleAlert } from "lucide-react";
import { PageHeader, Spinner, StatCard } from "../components/ui";
import { useLive } from "../context/LiveContext";
import { api } from "../lib/api";
import { cn } from "../lib/cn";
import {
  errorMessage,
  formatDate,
  formatHours,
  titleCase,
} from "../lib/format";
import type { DayRow, StatsResponse } from "../lib/types";

function dayTone(day: DayRow): "good" | "warning" | "neutral" {
  if (day.day_kind === "free" || day.day_kind === "vacation") return "neutral";
  if (day.completed) return "good";
  return "warning";
}

function DayRowItem({ day }: { day: DayRow }) {
  const offDay = day.day_kind === "free" || day.day_kind === "vacation";
  const percent =
    day.required_seconds > 0
      ? Math.min(100, Math.round((day.elapsed_seconds / day.required_seconds) * 100))
      : 0;
  const tone = dayTone(day);
  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <div
        className={cn(
          "grid size-9 shrink-0 place-items-center rounded-xl text-[10px] font-bold uppercase",
          tone === "good" &&
            "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
          tone === "warning" &&
            "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
          tone === "neutral" &&
            "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400",
        )}
      >
        {day.day_kind === "vacation"
          ? "Vac"
          : day.day_kind === "free"
            ? "Free"
            : `${percent}%`}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold">
          {formatDate(day.logical_date)}
        </p>
        <p className="text-[11px] text-slate-500 dark:text-slate-400">
          {formatHours(day.elapsed_seconds)} studied
          {day.required_seconds > 0
            ? ` of ${formatHours(day.required_seconds)}`
            : ""}
          {day.optional_goal_seconds > 0
            ? ` · optional ${formatHours(day.optional_done_seconds)}`
            : ""}
        </p>
      </div>
      <div className="text-right">
        <p
          className={cn(
            "text-xs font-bold",
            day.completed
              ? "text-emerald-600 dark:text-emerald-400"
              : offDay
                ? "text-slate-400"
                : "text-amber-600 dark:text-amber-400",
          )}
        >
          {offDay ? "No goal" : day.completed ? "Complete" : "Incomplete"}
        </p>
        <p className="text-[11px] tabular-nums text-slate-400 dark:text-slate-500">
          debt out {formatHours(day.debt_out_seconds)}
        </p>
      </div>
    </li>
  );
}

function Bars({ days }: { days: DayRow[] }) {
  const recent = days.slice(-14);
  if (recent.length === 0) {
    return (
      <div className="grid h-48 place-items-center text-sm text-slate-400">
        No history yet.
      </div>
    );
  }
  return (
    <div className="flex h-52 items-end gap-1.5 border-b border-slate-200 pb-2 dark:border-slate-800">
      {recent.map((day) => {
        const fraction =
          day.required_seconds > 0
            ? Math.max(
                day.elapsed_seconds > 0 ? 0.03 : 0,
                Math.min(1, day.elapsed_seconds / day.required_seconds),
              )
            : day.elapsed_seconds > 0
              ? 1
              : 0.03;
        return (
          <div
            key={day.logical_date}
            className="group flex h-full min-w-0 flex-1 flex-col justify-end gap-1.5"
            title={`${formatDate(day.logical_date)}: ${formatHours(
              day.elapsed_seconds,
            )} of ${formatHours(day.required_seconds)} (${titleCase(day.day_kind)})`}
          >
            <div className="relative flex flex-1 items-end">
              <div
                className={cn(
                  "w-full rounded-t-md transition group-hover:opacity-80",
                  day.day_kind === "free" || day.day_kind === "vacation"
                    ? "bg-slate-300 dark:bg-slate-700"
                    : day.completed
                      ? "bg-emerald-500"
                      : "bg-amber-400 dark:bg-amber-500",
                )}
                style={{ height: `${fraction * 100}%` }}
              />
            </div>
            <span className="truncate text-center text-[9px] font-medium text-slate-400">
              {day.logical_date.slice(5)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export function StatsPage() {
  const { state } = useLive();
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setStats(await api.stats(30));
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, state?.snapshot.logical_day]);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Stats"
        subtitle="The last 30 days of study, debt, and compliance."
        actions={
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            {loading ? <Spinner /> : <RefreshCw className="size-4" />}
            Refresh
          </button>
        }
      />

      {error !== null ? (
        <div className="flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-900 dark:border-red-900 dark:bg-red-950/50 dark:text-red-100">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" />
          <div>
            <p className="font-semibold">Could not load stats</p>
            <p className="mt-0.5 opacity-80">{error}</p>
          </div>
        </div>
      ) : null}

      {stats === null ? (
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="h-24 animate-pulse rounded-2xl bg-slate-200/70 dark:bg-slate-800/70" />
          <div className="h-24 animate-pulse rounded-2xl bg-slate-200/70 dark:bg-slate-800/70" />
          <div className="h-24 animate-pulse rounded-2xl bg-slate-200/70 dark:bg-slate-800/70" />
        </div>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <StatCard
              label="Current streak"
              value={`${stats.summary.streak} day${stats.summary.streak === 1 ? "" : "s"}`}
              hint="Consecutive completed study days"
              tone={stats.summary.streak > 0 ? "good" : "default"}
            />
            <StatCard
              label="30-day compliance"
              value={
                stats.summary.total === 0
                  ? "—"
                  : `${Math.round(
                      (stats.summary.completed / stats.summary.total) * 100,
                    )}%`
              }
              hint={
                stats.summary.total === 0
                  ? "No required days in this window"
                  : `${stats.summary.completed} of ${stats.summary.total} required days completed`
              }
              tone={
                stats.summary.total > 0 &&
                stats.summary.completed === stats.summary.total
                  ? "good"
                  : "default"
              }
            />
            <StatCard
              label="Carried debt"
              value={formatHours(stats.summary.debt_seconds)}
              hint="Unmet required time carried forward"
              tone={stats.summary.debt_seconds > 0 ? "warning" : "good"}
            />
          </div>

          <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <h2 className="flex items-center gap-2 text-sm font-bold">
                  <BarChart3 className="size-4 text-indigo-500" />
                  Last 14 days
                </h2>
                <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                  Green means the required goal was met. Amber means it was not.
                </p>
              </div>
            </div>
            <Bars days={stats.days} />
          </section>

          <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div className="border-b border-slate-100 px-4 py-3 dark:border-slate-800">
              <h2 className="text-sm font-bold">Day log</h2>
            </div>
            {stats.days.length === 0 ? (
              <p className="px-4 py-10 text-center text-sm text-slate-500 dark:text-slate-400">
                History appears after the first day settles.
              </p>
            ) : (
              <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                {[...stats.days].reverse().map((day) => (
                  <DayRowItem key={day.logical_date} day={day} />
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
