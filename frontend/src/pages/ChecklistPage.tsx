import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import {
  Check,
  ChevronRight,
  Coffee,
  ListPlus,
  Pencil,
  Plus,
  RotateCcw,
  Sparkles,
  Trash2,
  Undo2,
} from "lucide-react";
import { useLive } from "../context/LiveContext";
import { useDialog } from "../context/DialogContext";
import { useAction } from "../hooks/useAction";
import { api } from "../lib/api";
import { cn } from "../lib/cn";
import {
  formatClock,
  formatHours,
  formatOverrun,
  formatWeekday,
} from "../lib/format";
import type { ChecklistItem, ChecklistSubject } from "../lib/types";
import { PageHeader, Skeleton, Spinner } from "../components/ui";

function CarryNote({ item }: { item: ChecklistItem }) {
  const carryIn = item.carry_in_seconds;
  if (item.checked) {
    if (item.carry_out_seconds > 0) {
      return (
        <span className="text-emerald-600 dark:text-emerald-400">
          Surplus {formatClock(item.carry_out_seconds)} passed on
        </span>
      );
    }
    if (item.carry_out_seconds < 0) {
      return (
        <span className="text-red-600 dark:text-red-400">
          Overrun {formatClock(-item.carry_out_seconds)} deducted from next
        </span>
      );
    }
    return <span>Completed</span>;
  }
  if (carryIn > 0) {
    return (
      <span className="text-emerald-600 dark:text-emerald-400">
        +{formatClock(carryIn)} carried
      </span>
    );
  }
  if (carryIn < 0) {
    return (
      <span className="text-red-600 dark:text-red-400">
        −{formatClock(-carryIn)} debt
      </span>
    );
  }
  return <span>{formatClock(item.base_seconds)} planned</span>;
}

function ItemTimer({
  item,
  active,
  remaining,
  overrun,
}: {
  item: ChecklistItem;
  active: boolean;
  remaining: number;
  overrun: number;
}) {
  const [editing, setEditing] = useState(false);
  const [minutes, setMinutes] = useState(String(Math.max(1, Math.round(item.base_seconds / 60))));
  const skipBlur = useRef(false);
  const { pending, run } = useAction();

  useEffect(() => {
    if (!editing) {
      setMinutes(String(Math.max(1, Math.round(item.base_seconds / 60))));
    }
  }, [editing, item.base_seconds]);

  const commit = () => {
    if (skipBlur.current) {
      skipBlur.current = false;
      return;
    }
    if (!editing) return;
    setEditing(false);
    const value = Math.round(Number(minutes));
    if (!Number.isFinite(value) || value <= 0) {
      setMinutes(String(Math.max(1, Math.round(item.base_seconds / 60))));
      return;
    }
    if (value * 60 === item.base_seconds) return;
    void run(
      () => api.updateItem(item.id, { duration_seconds: value * 60 }),
      { success: "Duration updated" },
    );
  };

  const cancel = () => {
    skipBlur.current = true;
    setEditing(false);
    setMinutes(String(Math.max(1, Math.round(item.base_seconds / 60))));
  };

  if (item.checked) {
    return (
      <span className="text-xs font-semibold text-slate-400 dark:text-slate-500">
        Done
      </span>
    );
  }

  if (editing) {
    return (
      <span className="inline-flex items-center gap-1">
        <input
          type="number"
          min={1}
          max={1440}
          value={minutes}
          autoFocus
          onFocus={(event) => event.currentTarget.select()}
          onChange={(event) => setMinutes(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              commit();
            }
            if (event.key === "Escape") {
              event.preventDefault();
              cancel();
            }
          }}
          className="w-16 rounded-lg border border-indigo-300 bg-white px-1.5 py-0.5 text-right text-xs font-semibold tabular-nums outline-none ring-2 ring-indigo-500/20 dark:border-indigo-700 dark:bg-slate-900"
          aria-label="Item duration in minutes"
        />
        <span className="text-[10px] text-slate-400">min</span>
      </span>
    );
  }

  const isOverrun = overrun > 0 || remaining < 0;

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      disabled={pending}
      className={cn(
        "rounded-lg px-1.5 py-0.5 font-mono text-sm font-bold tabular-nums transition hover:bg-slate-100 disabled:opacity-50 dark:hover:bg-slate-800",
        isOverrun
          ? "text-red-600 dark:text-red-400"
          : active
            ? "text-indigo-700 dark:text-indigo-300"
            : "text-slate-600 dark:text-slate-300",
      )}
      title="Click to change the planned duration"
    >
      {isOverrun
        ? formatOverrun(Math.max(overrun, -remaining))
        : formatClock(Math.max(remaining, 0))}
    </button>
  );
}

function AddItemForm({ subject }: { subject: ChecklistSubject }) {
  const [text, setText] = useState("");
  const [minutes, setMinutes] = useState("");
  const { pending, run } = useAction();

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const value = text.trim();
    if (!value) return;
    const parsed = minutes.trim() === "" ? 0 : Math.round(Number(minutes));
    if (minutes.trim() !== "" && (!Number.isFinite(parsed) || parsed <= 0)) {
      return;
    }
    const ok = await run(() =>
      api.addItem(subject.id, value, parsed > 0 ? parsed * 60 : 0),
    );
    if (ok) {
      setText("");
      setMinutes("");
    }
  };

  return (
    <form
      onSubmit={(event) => void submit(event)}
      className="flex flex-col gap-2 border-t border-slate-200 p-3 dark:border-slate-800 sm:flex-row sm:items-center"
    >
      <div className="relative flex-1">
        <ListPlus className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
        <input
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="Add an item…"
          className="w-full rounded-xl border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/20 dark:border-slate-700 dark:bg-slate-950"
        />
      </div>
      <div className="flex items-center gap-2">
        <input
          type="number"
          min={1}
          max={1440}
          value={minutes}
          onChange={(event) => setMinutes(event.target.value)}
          placeholder="40"
          className="w-20 rounded-xl border border-slate-200 bg-white px-2 py-2 text-right text-sm tabular-nums outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/20 dark:border-slate-700 dark:bg-slate-950"
          aria-label="Optional duration in minutes"
        />
        <span className="text-xs text-slate-400">min</span>
        <button
          type="submit"
          disabled={pending || !text.trim()}
          className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {pending ? <Spinner /> : <Plus className="size-4" />}
          Add
        </button>
      </div>
    </form>
  );
}

function SubjectCard({
  subject,
  activeSubjectId,
  activeItemId,
  remaining,
  overrun,
}: {
  subject: ChecklistSubject;
  activeSubjectId: string | null;
  activeItemId: string;
  remaining: number;
  overrun: number;
}) {
  const isActive = subject.id === activeSubjectId;
  const checked = subject.items.filter((item) => item.checked).length;
  const complete = subject.items.length > 0 && checked === subject.items.length;
  const { pending, run } = useAction();
  const { confirm, prompt } = useDialog();

  const rename = async () => {
    const name = (
      await prompt({
        title: "Rename subject",
        label: "Subject name",
        initialValue: subject.name,
        submitLabel: "Rename",
      })
    )?.trim();
    if (name && name !== subject.name) {
      void run(() => api.renameSubject(subject.id, name));
    }
  };

  const remove = async () => {
    const ok = await confirm({
      title: "Delete subject?",
      message: `Delete "${subject.name}" and all of its items? This cannot be undone.`,
      confirmLabel: "Delete",
      destructive: true,
    });
    if (ok) {
      void run(() => api.removeSubject(subject.id));
    }
  };

  const reset = async () => {
    const ok = await confirm({
      title: "Reset subject?",
      message: `Reset all progress in "${subject.name}"?`,
      confirmLabel: "Reset",
      destructive: true,
    });
    if (ok) {
      void run(() => api.resetSubject(subject.id));
    }
  };

  const removeItem = async (item: ChecklistItem) => {
    const ok = await confirm({
      title: "Delete item?",
      message: `Delete "${item.text}"? This cannot be undone.`,
      confirmLabel: "Delete",
      destructive: true,
    });
    if (ok) {
      void run(() => api.removeItem(item.id));
    }
  };

  return (
    <section
      className={cn(
        "overflow-hidden rounded-2xl border bg-white shadow-sm transition dark:bg-slate-900",
        isActive
          ? "border-indigo-300 ring-2 ring-indigo-500/10 dark:border-indigo-800"
          : "border-slate-200 dark:border-slate-800",
      )}
    >
      <header className="flex flex-wrap items-center gap-3 p-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2
              className={cn(
                "truncate text-base font-bold",
                complete && "text-slate-400 line-through dark:text-slate-500",
              )}
            >
              {subject.name}
            </h2>
            {isActive ? (
              <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300">
                Active
              </span>
            ) : null}
            {complete ? (
              <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                Complete
              </span>
            ) : null}
          </div>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            {subject.items.length === 0
              ? "No items yet"
              : `${checked}/${subject.items.length} done`}
          </p>
        </div>
        <div className="flex items-center gap-1">
          {!isActive && !complete ? (
            <button
              type="button"
              onClick={() => void run(() => api.selectSubject(subject.id))}
              disabled={pending}
              className="rounded-lg p-2 text-slate-400 transition hover:bg-indigo-50 hover:text-indigo-700 disabled:opacity-40 dark:hover:bg-indigo-950 dark:hover:text-indigo-300"
              title="Make this the active subject"
              aria-label="Select subject"
            >
              <ChevronRight className="size-4" />
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => void rename()}
            disabled={pending}
            className="rounded-lg p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 disabled:opacity-40 dark:hover:bg-slate-800 dark:hover:text-slate-200"
            title="Rename subject"
            aria-label="Rename subject"
          >
            <Pencil className="size-4" />
          </button>
          <button
            type="button"
            onClick={() => void run(() => api.uncheckLast(subject.id))}
            disabled={pending || checked === 0}
            className="rounded-lg p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 disabled:opacity-30 dark:hover:bg-slate-800 dark:hover:text-slate-200"
            title="Uncheck the last item"
            aria-label="Uncheck last item"
          >
            <Undo2 className="size-4" />
          </button>
          <button
            type="button"
            onClick={() => void reset()}
            disabled={pending || checked === 0}
            className="rounded-lg p-2 text-slate-400 transition hover:bg-amber-50 hover:text-amber-700 disabled:opacity-30 dark:hover:bg-amber-950 dark:hover:text-amber-300"
            title="Reset subject progress"
            aria-label="Reset subject"
          >
            <RotateCcw className="size-4" />
          </button>
          <button
            type="button"
            onClick={() => void remove()}
            disabled={pending}
            className="rounded-lg p-2 text-slate-400 transition hover:bg-red-50 hover:text-red-700 disabled:opacity-30 dark:hover:bg-red-950 dark:hover:text-red-300"
            title="Delete subject"
            aria-label="Delete subject"
          >
            <Trash2 className="size-4" />
          </button>
        </div>
      </header>

      {subject.items.length > 0 ? (
        <ul className="divide-y divide-slate-100 border-t border-slate-100 dark:divide-slate-800 dark:border-slate-800">
          {subject.items.map((item) => {
            const isCurrent = item.id === activeItemId;
            const futureRemaining =
              item.base_seconds + item.carry_in_seconds - item.elapsed_seconds;
            return (
              <li
                key={item.id}
                className={cn(
                  "flex items-start gap-2.5 px-4 py-2.5 transition sm:gap-3",
                  isCurrent && "bg-indigo-50/60 dark:bg-indigo-950/20",
                  item.checked && "opacity-60",
                )}
              >
                <button
                  type="button"
                  onClick={() => {
                    if (isCurrent && !item.checked) {
                      void run(() => api.checkItem(item.id));
                    }
                  }}
                  disabled={!isCurrent || item.checked || pending}
                  className={cn(
                    "mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border transition",
                    item.checked
                      ? "border-emerald-500 bg-emerald-500 text-white"
                      : isCurrent
                        ? "border-indigo-400 bg-white text-transparent hover:bg-indigo-50 dark:bg-slate-900 dark:hover:bg-indigo-950"
                        : "border-slate-200 bg-slate-50 text-transparent dark:border-slate-700 dark:bg-slate-800",
                  )}
                  aria-label={item.checked ? "Completed item" : "Check current item"}
                >
                  <Check className="size-3.5" />
                </button>

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <span
                      className={cn(
                        "text-sm font-medium",
                        item.checked && "line-through",
                        isCurrent && "font-semibold",
                      )}
                    >
                      {item.text}
                    </span>
                    {isCurrent && !item.checked ? (
                      <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-indigo-600 dark:text-indigo-300">
                        <span className="size-1.5 animate-pulse rounded-full bg-indigo-500" />
                        Current
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                    <CarryNote item={item} />
                    {!item.checked && (item.carry_in_seconds !== 0 || item.elapsed_seconds > 0) ? (
                      <span className="ml-1 text-slate-400 dark:text-slate-500">
                        · budget{" "}
                        {formatClock(
                          Math.max(0, item.base_seconds + item.carry_in_seconds),
                        )}
                      </span>
                    ) : null}
                  </p>
                </div>

                <div className="flex shrink-0 items-center gap-1">
                  <ItemTimer
                    item={item}
                    active={isCurrent}
                    remaining={isCurrent ? remaining : futureRemaining}
                    overrun={isCurrent ? overrun : 0}
                  />
                  <button
                    type="button"
                    onClick={() => void removeItem(item)}
                    disabled={item.checked || pending}
                    className="rounded-lg p-1.5 text-slate-300 transition hover:bg-red-50 hover:text-red-600 disabled:opacity-20 dark:hover:bg-red-950 dark:hover:text-red-300"
                    title="Remove item"
                    aria-label="Remove item"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="border-t border-slate-100 px-4 py-4 text-sm text-slate-500 dark:border-slate-800 dark:text-slate-400">
          Add the first item for this subject below.
        </p>
      )}

      <AddItemForm subject={subject} />
    </section>
  );
}

export function ChecklistPage() {
  const { state, checklist } = useLive();
  const [name, setName] = useState("");
  const { pending, run } = useAction();
  const summary = state?.checklist;

  const addSubject = async (event: FormEvent) => {
    event.preventDefault();
    const value = name.trim();
    if (!value) return;
    const ok = await run(() => api.addSubject(value));
    if (ok) setName("");
  };

  if (checklist === null || summary === undefined) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-52" />
        <Skeleton className="h-32" />
        <Skeleton className="h-48" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Checklist"
        subtitle="Only the first unchecked item of the active subject is running."
      />

      {summary.rest_remaining_seconds > 0 ? (
        <section className="flex flex-wrap items-center gap-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-amber-950 shadow-sm dark:border-amber-900 dark:bg-amber-950/50 dark:text-amber-50">
          <span className="grid size-11 place-items-center rounded-2xl bg-amber-100 text-amber-700 dark:bg-amber-900/60 dark:text-amber-300">
            <Coffee className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-bold">Subject rest</p>
            <p className="text-sm opacity-80">
              {state?.snapshot.running
                ? "Step away. The rest counts toward today's session."
                : "The rest is queued and will start when you resume."}
            </p>
          </div>
          <p className="font-mono text-2xl font-bold tabular-nums">
            {formatClock(summary.rest_remaining_seconds)}
          </p>
          <button
            type="button"
            onClick={() => void run(() => api.skipPhase())}
            disabled={pending}
            className="rounded-full border border-amber-300 bg-white/70 px-4 py-2 text-sm font-semibold transition hover:bg-white disabled:opacity-40 dark:border-amber-800 dark:bg-amber-900/30 dark:hover:bg-amber-900/50"
          >
            Skip rest
          </button>
        </section>
      ) : null}

      <form
        onSubmit={(event) => void addSubject(event)}
        className="flex flex-col gap-2 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-800 dark:bg-slate-900 sm:flex-row"
      >
        <div className="relative flex-1">
          <ListPlus className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Add a subject (e.g. Mathematics)…"
            className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-9 pr-3 text-sm outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/20 dark:border-slate-700 dark:bg-slate-950"
          />
        </div>
        <button
          type="submit"
          disabled={pending || !name.trim()}
          className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {pending ? <Spinner /> : <Plus className="size-4" />}
          Add subject
        </button>
      </form>

      {checklist.subjects.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-slate-300 bg-white/60 px-6 py-16 text-center dark:border-slate-700 dark:bg-slate-900/40">
          <ListPlus className="mx-auto size-10 text-slate-300 dark:text-slate-600" />
          <h2 className="mt-3 text-lg font-bold">Start a checklist</h2>
          <p className="mx-auto mt-1 max-w-md text-sm text-slate-500 dark:text-slate-400">
            Add a subject, then add items. Each item gets its own countdown and
            carries any surplus or debt into the next item.
          </p>
          <Link
            to="/study-prep"
            className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-indigo-50 px-3.5 py-2 text-sm font-semibold text-indigo-700 transition hover:bg-indigo-100 dark:bg-indigo-950 dark:text-indigo-300 dark:hover:bg-indigo-900"
          >
            <Sparkles className="size-4" />
            Generate a plan from notes and sources
          </Link>
        </div>
      ) : (
        <div className="space-y-4">
          {checklist.subjects.map((subject) => (
            <SubjectCard
              key={subject.id}
              subject={subject}
              activeSubjectId={checklist.active_subject_id}
              activeItemId={summary.active_item_id}
              remaining={summary.remaining_seconds}
              overrun={summary.overrun_seconds}
            />
          ))}
        </div>
      )}

      <p className="pb-2 text-center text-xs text-slate-400 dark:text-slate-500">
        {checklist.subjects.length > 0
          ? `${checklist.revision} checklist revision · ${formatWeekday(
              state?.snapshot.weekday ?? "",
            )} · ${formatHours(state?.snapshot.elapsed_seconds ?? 0)} studied today`
          : "Carry belongs to one subject. Completing the last item discards it."}
      </p>
    </div>
  );
}
