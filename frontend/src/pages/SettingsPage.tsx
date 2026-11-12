import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Bell,
  Check,
  Clock3,
  Database,
  Moon,
  Plane,
  RotateCcw,
  Save,
  Settings2,
  ShieldCheck,
  Sun,
  TriangleAlert,
} from "lucide-react";
import { PageHeader, Spinner } from "../components/ui";
import { useConfig } from "../context/ConfigContext";
import { useDialog } from "../context/DialogContext";
import { useLive } from "../context/LiveContext";
import { useTheme } from "../context/ThemeContext";
import { useToast } from "../context/ToastContext";
import { api } from "../lib/api";
import { cn } from "../lib/cn";
import {
  errorMessage,
  formatDate,
  formatHours,
  titleCase,
} from "../lib/format";
import {
  DAY_MODES,
  WEEKDAYS,
  type Config,
  type DayMode,
  type Recovery,
} from "../lib/types";

const MODE_HELP: Record<DayMode, string> = {
  carried: "Unmet required time carries into the next day.",
  optional: "A goal only; unmet time is discarded.",
  free: "No requirement. Existing debt is preserved.",
};

function cloneConfig(config: Config): Config {
  return JSON.parse(JSON.stringify(config)) as Config;
}

function SettingsField({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">
        {label}
      </span>
      {children}
      {hint ? (
        <span className="text-xs text-slate-500 dark:text-slate-400">{hint}</span>
      ) : null}
    </label>
  );
}

const inputClass =
  "rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/20 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-50";

export function SettingsPage() {
  const { config, loading, error, refresh, save } = useConfig();
  const { push } = useToast();
  const { theme, toggle } = useTheme();
  const { state } = useLive();
  const { confirm } = useDialog();
  const [draft, setDraft] = useState<Config | null>(null);
  const [pending, setPending] = useState(false);
  const [recovery, setRecovery] = useState<Recovery | null>(null);
  const [resetPending, setResetPending] = useState(false);
  const [permission, setPermission] = useState<
    NotificationPermission | "unsupported"
  >(() =>
    typeof Notification === "undefined" ? "unsupported" : Notification.permission,
  );

  useEffect(() => {
    if (config !== null) {
      setDraft(cloneConfig(config));
    }
  }, [config]);

  const refreshRecovery = useCallback(async () => {
    try {
      setRecovery(await api.recovery());
    } catch {
      // The settings page can still function without the recovery preview.
    }
  }, []);

  useEffect(() => {
    void refreshRecovery();
  }, [refreshRecovery]);

  const dirty = useMemo(
    () =>
      config !== null &&
      draft !== null &&
      JSON.stringify(config) !== JSON.stringify(draft),
    [config, draft],
  );

  const updateDay = (day: string, patch: Partial<Config["schedule"][keyof Config["schedule"]]>) => {
    setDraft((current) => {
      if (current === null) return current;
      const weekday = day as keyof Config["schedule"];
      return {
        ...current,
        schedule: {
          ...current.schedule,
          [weekday]: { ...current.schedule[weekday], ...patch },
        },
      };
    });
  };

  const changeMode = (day: string, mode: DayMode) => {
    const current = draft?.schedule[day as keyof Config["schedule"]];
    if (current === undefined) return;
    let quota = current.quota_minutes;
    if (mode === "free") quota = 0;
    if (mode !== "free" && current.mode === "free" && quota === 0) quota = 240;
    updateDay(day, { mode, quota_minutes: quota });
  };

  const updateVacation = (patch: Partial<Config["vacation"]>) => {
    setDraft((current) =>
      current === null
        ? current
        : { ...current, vacation: { ...current.vacation, ...patch } },
    );
  };

  const debtSeconds =
    state?.snapshot.debt_seconds ?? recovery?.debt_seconds ?? 0;

  const submit = async () => {
    if (draft === null || !dirty) return;
    if (
      draft.vacation.enabled &&
      draft.vacation.start !== null &&
      draft.vacation.end !== null &&
      draft.vacation.start > draft.vacation.end
    ) {
      push({
        kind: "error",
        title: "Invalid vacation range",
        body: "The vacation end date must be on or after the start date.",
      });
      return;
    }
    if (draft.reset_cooldown_days < 1) {
      push({
        kind: "error",
        title: "Invalid reset cooldown",
        body: "The reset cooldown must be at least one day.",
      });
      return;
    }
    setPending(true);
    try {
      await save(draft);
      await refreshRecovery();
      push({ kind: "success", title: "Settings saved" });
    } catch (caught) {
      push({
        kind: "error",
        title: "Could not save settings",
        body: errorMessage(caught),
      });
    } finally {
      setPending(false);
    }
  };

  const resetDebt = async () => {
    if (debtSeconds <= 0 || recovery === null || !recovery.can_reset) return;
    const ok = await confirm({
      title: "Forgive carried debt?",
      message: `This clears ${formatHours(
        debtSeconds,
      )} of carried debt. The next reset will be available after the ${
        recovery.cooldown_days
      }-day cooldown. Study time, history, and checklist progress are kept.`,
      confirmLabel: "Forgive debt",
      destructive: true,
    });
    if (!ok) return;
    setResetPending(true);
    try {
      const result = await api.resetDebt();
      setRecovery(result.recovery);
    } catch (caught) {
      push({
        kind: "error",
        title: "Could not reset debt",
        body: errorMessage(caught),
      });
    } finally {
      setResetPending(false);
    }
  };

  const requestNotifications = async () => {
    if (typeof Notification === "undefined") return;
    const result = await Notification.requestPermission();
    setPermission(result);
    if (result === "granted") {
      push({ kind: "success", title: "Desktop notifications enabled" });
    }
  };

  if (loading && config === null) {
    return (
      <div className="space-y-4">
        <div className="h-10 w-40 animate-pulse rounded-xl bg-slate-200/70 dark:bg-slate-800/70" />
        <div className="h-72 animate-pulse rounded-2xl bg-slate-200/70 dark:bg-slate-800/70" />
        <div className="h-96 animate-pulse rounded-2xl bg-slate-200/70 dark:bg-slate-800/70" />
      </div>
    );
  }

  if (error !== null && config === null) {
    return (
      <div className="space-y-4">
        <PageHeader title="Settings" />
        <div className="flex flex-col items-start gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-900 dark:border-red-900 dark:bg-red-950/50 dark:text-red-100">
          <div className="flex items-start gap-3">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" />
            <div>
              <p className="font-semibold">Could not load settings</p>
              <p className="mt-0.5 opacity-80">{error}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => void refresh()}
            className="rounded-xl bg-red-900 px-3 py-2 text-xs font-semibold text-white dark:bg-red-100 dark:text-red-950"
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  if (draft === null) return null;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Settings"
        subtitle="These settings are shared with the original SimpleStudy config."
        actions={
          <>
            <button
              type="button"
              onClick={() => setDraft(config ? cloneConfig(config) : draft)}
              disabled={!dirty || pending}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-40 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              <RotateCcw className="size-4" />
              Reset
            </button>
            <button
              type="button"
              onClick={() => void submit()}
              disabled={!dirty || pending}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-sm font-semibold text-white transition",
                dirty
                  ? "bg-indigo-600 hover:bg-indigo-500"
                  : "bg-slate-300 dark:bg-slate-700",
                pending && "opacity-60",
              )}
            >
              {pending ? <Spinner /> : <Save className="size-4" />}
              Save
            </button>
          </>
        }
      />

      {error !== null ? (
        <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/50 dark:text-amber-100">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" />
          {error}
        </div>
      ) : null}

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="mb-4 flex items-center gap-2">
          <Settings2 className="size-4 text-indigo-500" />
          <h2 className="text-sm font-bold">General</h2>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <SettingsField
            label="Day boundary"
            hint="The logical day rolls over at this local time. Use 04:00 for late-night study."
          >
            <input
              type="time"
              value={draft.boundary}
              onChange={(event) =>
                setDraft({ ...draft, boundary: event.target.value })
              }
              className={inputClass}
            />
          </SettingsField>
          <div className="grid gap-3">
            <label className="flex items-start gap-3 rounded-xl border border-slate-200 p-3 dark:border-slate-700">
              <input
                type="checkbox"
                checked={draft.auto_start}
                onChange={(event) =>
                  setDraft({ ...draft, auto_start: event.target.checked })
                }
                className="mt-0.5 size-4 accent-indigo-600"
              />
              <span>
                <span className="block text-sm font-semibold">
                  Start automatically
                </span>
                <span className="block text-xs text-slate-500 dark:text-slate-400">
                  Begin a study phase when the backend starts.
                </span>
              </span>
            </label>
            <label className="flex items-start gap-3 rounded-xl border border-slate-200 p-3 dark:border-slate-700">
              <input
                type="checkbox"
                checked={draft.notifications}
                onChange={(event) =>
                  setDraft({ ...draft, notifications: event.target.checked })
                }
                className="mt-0.5 size-4 accent-indigo-600"
              />
              <span>
                <span className="block text-sm font-semibold">
                  Notifications
                </span>
                <span className="block text-xs text-slate-500 dark:text-slate-400">
                  Show phase, rest, and day-complete events as toasts and
                  browser notifications.
                </span>
              </span>
            </label>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="mb-4 flex items-center gap-2">
          <Plane className="size-4 text-indigo-500" />
          <h2 className="text-sm font-bold">Vacation</h2>
        </div>
        <label className="flex items-start gap-3 rounded-xl border border-slate-200 p-3 dark:border-slate-700">
          <input
            type="checkbox"
            checked={draft.vacation.enabled}
            onChange={(event) =>
              updateVacation({ enabled: event.target.checked })
            }
            className="mt-0.5 size-4 accent-indigo-600"
          />
          <span>
            <span className="block text-sm font-semibold">
              Enable vacation mode
            </span>
            <span className="block text-xs text-slate-500 dark:text-slate-400">
              Vacation days have no quota and add no new debt. Existing debt is
              preserved.
            </span>
          </span>
        </label>
        {draft.vacation.enabled ? (
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <SettingsField
              label="Starts"
              hint="Leave blank to start immediately."
            >
              <input
                type="date"
                value={draft.vacation.start ?? ""}
                onChange={(event) =>
                  updateVacation({ start: event.target.value || null })
                }
                className={inputClass}
              />
            </SettingsField>
            <SettingsField
              label="Ends"
              hint="Leave blank to stay on until you turn it off."
            >
              <input
                type="date"
                value={draft.vacation.end ?? ""}
                onChange={(event) =>
                  updateVacation({ end: event.target.value || null })
                }
                className={inputClass}
              />
            </SettingsField>
          </div>
        ) : null}
        <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
          Past settled days are not rewritten. If you want a fresh start on
          returning, use the recovery reset below.
        </p>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="mb-4 flex items-center gap-2">
          <Clock3 className="size-4 text-indigo-500" />
          <h2 className="text-sm font-bold">Pomodoro</h2>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <SettingsField
            label="Study phase"
            hint="Breaks count toward the daily session, by design."
          >
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={1}
                max={240}
                value={draft.study_minutes}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    study_minutes: Number(event.target.value),
                  })
                }
                className={cn(inputClass, "w-28 tabular-nums")}
              />
              <span className="text-sm text-slate-500 dark:text-slate-400">
                minutes
              </span>
            </div>
          </SettingsField>
          <SettingsField label="Break phase">
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={1}
                max={120}
                value={draft.break_minutes}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    break_minutes: Number(event.target.value),
                  })
                }
                className={cn(inputClass, "w-28 tabular-nums")}
              />
              <span className="text-sm text-slate-500 dark:text-slate-400">
                minutes
              </span>
            </div>
          </SettingsField>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="mb-4 flex items-center gap-2">
          <ShieldCheck className="size-4 text-indigo-500" />
          <h2 className="text-sm font-bold">Recovery</h2>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="rounded-xl border border-slate-200 p-3 dark:border-slate-700">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Carried debt
            </p>
            <p className="mt-2 text-2xl font-bold tabular-nums">
              {formatHours(debtSeconds)}
            </p>
          </div>
          <SettingsField
            label="Maximum carried debt"
            hint="0 = no limit. Lowering this below current debt forgives the excess when saved."
          >
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={0}
                max={168}
                value={draft.max_debt_hours}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    max_debt_hours: Number(event.target.value),
                  })
                }
                className={cn(inputClass, "w-28 tabular-nums")}
              />
              <span className="text-sm text-slate-500 dark:text-slate-400">
                hours
              </span>
            </div>
          </SettingsField>
          <SettingsField
            label="Reset cooldown"
            hint="Days between debt forgiveness resets."
          >
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={1}
                max={365}
                value={draft.reset_cooldown_days}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    reset_cooldown_days: Number(event.target.value),
                  })
                }
                className={cn(inputClass, "w-28 tabular-nums")}
              />
              <span className="text-sm text-slate-500 dark:text-slate-400">
                days
              </span>
            </div>
          </SettingsField>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => void resetDebt()}
            disabled={
              debtSeconds <= 0 ||
              recovery === null ||
              !recovery.can_reset ||
              resetPending
            }
            className="inline-flex items-center gap-1.5 rounded-xl border border-red-200 bg-red-50 px-3.5 py-2 text-sm font-semibold text-red-700 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200 dark:hover:bg-red-950/70"
          >
            {resetPending ? <Spinner /> : <RotateCcw className="size-4" />}
            Forgive carried debt
          </button>
          <span className="text-xs text-slate-500 dark:text-slate-400">
            {debtSeconds <= 0
              ? recovery?.next_reset_on != null
                ? `No carried debt. Next reset available on ${formatDate(
                    recovery.next_reset_on,
                  )}.`
                : "No carried debt."
              : recovery === null
                ? "Checking cooldown…"
                : recovery.can_reset
                  ? "Available now."
                  : recovery.next_reset_on !== null
                    ? `Next reset available on ${formatDate(
                        recovery.next_reset_on,
                      )}.`
                    : "Cooldown active."}
          </span>
        </div>
        <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
          This clears only the daily carried debt. Study time, history, and
          checklist progress are kept. The cooldown is enforced by the backend.
        </p>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="mb-4">
          <h2 className="text-sm font-bold">Weekly schedule</h2>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            Each weekday can require carried hours, set an optional goal, or be
            free.
          </p>
        </div>
        <div className="divide-y divide-slate-100 dark:divide-slate-800">
          {WEEKDAYS.map((day) => {
            const setting = draft.schedule[day];
            return (
              <div
                key={day}
                className="grid gap-3 py-3 first:pt-0 last:pb-0 sm:grid-cols-[8rem_10rem_1fr] sm:items-center"
              >
                <p className="text-sm font-semibold capitalize">{day}</p>
                <select
                  value={setting.mode}
                  onChange={(event) =>
                    changeMode(day, event.target.value as DayMode)
                  }
                  className={cn(inputClass, "capitalize")}
                >
                  {DAY_MODES.map((mode) => (
                    <option key={mode} value={mode}>
                      {titleCase(mode)}
                    </option>
                  ))}
                </select>
                <div className="flex flex-wrap items-center gap-3">
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min={0}
                      max={1440}
                      value={setting.quota_minutes}
                      disabled={setting.mode === "free"}
                      onChange={(event) =>
                        updateDay(day, {
                          quota_minutes: Number(event.target.value),
                        })
                      }
                      className={cn(
                        inputClass,
                        "w-24 tabular-nums disabled:opacity-40",
                      )}
                      aria-label={`${day} quota in minutes`}
                    />
                    <span className="text-xs text-slate-500 dark:text-slate-400">
                      minutes
                    </span>
                  </div>
                  <span className="text-xs text-slate-500 dark:text-slate-400">
                    {MODE_HELP[setting.mode]}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="mb-3 flex items-center gap-2">
            <Bell className="size-4 text-indigo-500" />
            <h2 className="text-sm font-bold">Desktop notifications</h2>
          </div>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Allow desktop notifications to get phase changes and rest reminders
            even when this window is in the background. The Notifications switch
            above must also be on.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void requestNotifications()}
              disabled={
                permission === "unsupported" ||
                permission === "granted" ||
                permission === "denied"
              }
              className="inline-flex items-center gap-1.5 rounded-xl bg-slate-900 px-3 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-40 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white"
            >
              {permission === "granted" ? (
                <Check className="size-4" />
              ) : (
                <Bell className="size-4" />
              )}
              {permission === "granted"
                ? "Allowed"
                : permission === "denied"
                  ? "Blocked"
                  : permission === "unsupported"
                    ? "Not supported"
                    : "Enable notifications"}
            </button>
            <span className="text-xs text-slate-500 dark:text-slate-400">
              Status: {permission}
            </span>
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="mb-3 flex items-center gap-2">
            {theme === "dark" ? (
              <Moon className="size-4 text-indigo-500" />
            ) : (
              <Sun className="size-4 text-indigo-500" />
            )}
            <h2 className="text-sm font-bold">Appearance</h2>
          </div>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            WebStudy follows the system theme on first visit and remembers your
            choice on this device.
          </p>
          <button
            type="button"
            onClick={toggle}
            className="mt-3 inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold transition hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800"
          >
            {theme === "dark" ? (
              <Sun className="size-4" />
            ) : (
              <Moon className="size-4" />
            )}
            Switch to {theme === "dark" ? "light" : "dark"} mode
          </button>
        </section>
      </div>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="mb-3 flex items-center gap-2">
          <Database className="size-4 text-indigo-500" />
          <h2 className="text-sm font-bold">Your data</h2>
        </div>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          WebStudy reads and writes the same XDG data files as SimpleStudy
          (config, state, checklist, and history). Stop the old GTK daemon before
          running this backend against the same data directory. Set{" "}
          <code className="rounded bg-slate-100 px-1 py-0.5 text-xs dark:bg-slate-800">
            WEBSTUDY_STATE_DIR
          </code>{" "}
          and{" "}
          <code className="rounded bg-slate-100 px-1 py-0.5 text-xs dark:bg-slate-800">
            WEBSTUDY_CONFIG_DIR
          </code>{" "}
          to run a side-by-side copy.
        </p>
      </section>

      <p className="pb-2 text-center text-xs text-slate-400 dark:text-slate-500">
        The transparency settings from the desktop app are left untouched.
      </p>
    </div>
  );
}
