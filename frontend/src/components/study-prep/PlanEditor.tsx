import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ClipboardCheck,
  ListPlus,
  Plus,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { Spinner } from "../ui";
import { useDialog } from "../../context/DialogContext";
import { useToast } from "../../context/ToastContext";
import { api } from "../../lib/api";
import { cn } from "../../lib/cn";
import { errorMessage, formatHours } from "../../lib/format";
import type {
  ChecklistImportSubject,
  StudyPlan,
  StudySourceRef,
} from "../../lib/types";

interface DraftItem {
  key: string;
  text: string;
  minutes: string;
  refs: StudySourceRef[];
  examScope: boolean;
}

interface DraftSubject {
  key: string;
  name: string;
  items: DraftItem[];
}

interface PlanValidation {
  payload: ChecklistImportSubject[];
  error: string | null;
  totalSeconds: number;
  totalItems: number;
}

function validate(subjects: DraftSubject[]): PlanValidation {
  if (subjects.length === 0) {
    return {
      payload: [],
      error: "Add at least one subject before importing.",
      totalSeconds: 0,
      totalItems: 0,
    };
  }
  if (subjects.length > 20) {
    return {
      payload: [],
      error: "A plan can contain at most 20 subjects.",
      totalSeconds: 0,
      totalItems: 0,
    };
  }
  const payload: ChecklistImportSubject[] = [];
  let totalSeconds = 0;
  let totalItems = 0;
  for (const subject of subjects) {
    const name = subject.name.trim();
    if (!name) {
      return {
        payload: [],
        error: "Every subject needs a name.",
        totalSeconds,
        totalItems,
      };
    }
    if (name.length > 200) {
      return {
        payload: [],
        error: "Subject names are limited to 200 characters.",
        totalSeconds,
        totalItems,
      };
    }
    if (subject.items.length === 0) {
      return {
        payload: [],
        error: `Add at least one item to "${name}".`,
        totalSeconds,
        totalItems,
      };
    }
    if (subject.items.length > 100) {
      return {
        payload: [],
        error: `"${name}" has more than 100 items.`,
        totalSeconds,
        totalItems,
      };
    }
    const items = [];
    for (const item of subject.items) {
      const text = item.text.trim();
      if (!text) {
        return {
          payload: [],
          error: `Every item in "${name}" needs text.`,
          totalSeconds,
          totalItems,
        };
      }
      if (text.length > 500) {
        return {
          payload: [],
          error: "Item text is limited to 500 characters.",
          totalSeconds,
          totalItems,
        };
      }
      const minutes = Number(item.minutes);
      if (
        item.minutes.trim() === "" ||
        !Number.isInteger(minutes) ||
        minutes < 1 ||
        minutes > 1440
      ) {
        return {
          payload: [],
          error: "Item durations must be whole minutes between 1 and 1440.",
          totalSeconds,
          totalItems,
        };
      }
      totalSeconds += minutes * 60;
      totalItems += 1;
      items.push({ text, duration_seconds: minutes * 60 });
    }
    payload.push({ name, items });
  }
  return { payload, error: null, totalSeconds, totalItems };
}

function planToDraft(plan: StudyPlan): DraftSubject[] {
  return plan.subjects.map((subject, subjectIndex) => ({
    key: subject.temp_id || `subject-${subjectIndex}`,
    name: subject.name,
    items: subject.items.map((item, itemIndex) => ({
      key: item.temp_id || `item-${subjectIndex}-${itemIndex}`,
      text: item.text,
      minutes: String(Math.max(1, Math.round(item.duration_seconds / 60))),
      refs: item.refs,
      examScope: item.exam_scope,
    })),
  }));
}

const inputClass =
  "w-full rounded-lg border border-transparent bg-transparent px-2 py-1 text-sm outline-none transition hover:border-slate-200 focus:border-indigo-400 focus:bg-white focus:ring-2 focus:ring-indigo-500/20 dark:hover:border-slate-700 dark:focus:border-indigo-500 dark:focus:bg-slate-950";

const minutesClass =
  "w-16 rounded-lg border border-transparent bg-transparent px-1.5 py-1 text-right text-sm tabular-nums outline-none transition hover:border-slate-200 focus:border-indigo-400 focus:bg-white focus:ring-2 focus:ring-indigo-500/20 disabled:opacity-60 dark:hover:border-slate-700 dark:focus:border-indigo-500 dark:focus:bg-slate-950";

export function PlanEditor({
  plan,
  runId,
  importedAt,
  onImported,
}: {
  plan: StudyPlan;
  runId: string;
  importedAt: string | null;
  onImported: () => void;
}) {
  const counter = useRef(0);
  const keyFor = useCallback((prefix: string) => {
    counter.current += 1;
    return `${prefix}-new-${counter.current}`;
  }, []);
  const { confirm } = useDialog();
  const { push } = useToast();
  const [subjects, setSubjects] = useState<DraftSubject[]>(() =>
    planToDraft(plan),
  );
  const [importing, setImporting] = useState(false);
  const [importedLocally, setImportedLocally] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);

  useEffect(() => {
    setSubjects(planToDraft(plan));
    setImportedLocally(false);
  }, [plan]);

  const validation = useMemo(() => validate(subjects), [subjects]);
  const imported = importedAt !== null || importedLocally;
  const disabled = imported || importing;

  const updateSubject = (key: string, patch: Partial<DraftSubject>) => {
    setSubjects((current) =>
      current.map((subject) =>
        subject.key === key ? { ...subject, ...patch } : subject,
      ),
    );
  };

  const updateItem = (subjectKey: string, itemKey: string, patch: Partial<DraftItem>) => {
    setSubjects((current) =>
      current.map((subject) =>
        subject.key === subjectKey
          ? {
              ...subject,
              items: subject.items.map((item) =>
                item.key === itemKey ? { ...item, ...patch } : item,
              ),
            }
          : subject,
      ),
    );
  };

  const addItem = (subjectKey: string) => {
    const item: DraftItem = {
      key: keyFor("item"),
      text: "",
      minutes: "30",
      refs: [],
      examScope: true,
    };
    setSubjects((current) =>
      current.map((subject) =>
        subject.key === subjectKey
          ? { ...subject, items: [...subject.items, item] }
          : subject,
      ),
    );
  };

  const removeItem = (subjectKey: string, itemKey: string) => {
    setSubjects((current) =>
      current.map((subject) =>
        subject.key === subjectKey
          ? {
              ...subject,
              items: subject.items.filter((item) => item.key !== itemKey),
            }
          : subject,
      ),
    );
  };

  const addSubject = () => {
    const subject: DraftSubject = {
      key: keyFor("subject"),
      name: "New subject",
      items: [
        {
          key: keyFor("item"),
          text: "",
          minutes: "30",
          refs: [],
          examScope: true,
        },
      ],
    };
    setSubjects((current) => [...current, subject]);
  };

  const removeSubject = (key: string) => {
    setSubjects((current) => current.filter((subject) => subject.key !== key));
  };

  const importPlan = async () => {
    if (validation.error !== null || imported) return;
    const ok = await confirm({
      title: "Import to checklist?",
      message: `Add ${validation.totalItems} ${
        validation.totalItems === 1 ? "item" : "items"
      } (${formatHours(validation.totalSeconds)}) to your checklist? Existing subjects are kept, and this run can only be imported once.`,
      confirmLabel: "Import",
    });
    if (!ok) return;
    setImporting(true);
    setImportError(null);
    try {
      const result = await api.importStudyPrepRun(runId, validation.payload);
      setImportedLocally(true);
      push({
        kind: "success",
        title: "Checklist updated",
        body: `Added ${result.total_items} ${
          result.total_items === 1 ? "item" : "items"
        } in ${result.subjects.length} ${
          result.subjects.length === 1 ? "subject" : "subjects"
        }.`,
      });
      onImported();
    } catch (caught) {
      setImportError(errorMessage(caught));
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div>
          <p className="text-sm font-bold">
            {subjects.length} {subjects.length === 1 ? "subject" : "subjects"} ·{" "}
            {validation.totalItems} {validation.totalItems === 1 ? "item" : "items"}
          </p>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            {formatHours(validation.totalSeconds)} total · five-minute subject rests
            are added by the checklist, not counted here.
          </p>
        </div>
        {imported ? (
          <div className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-100 px-3 py-2 text-sm font-semibold text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">
            <ClipboardCheck className="size-4" />
            Imported to checklist
          </div>
        ) : (
          <button
            type="button"
            onClick={() => void importPlan()}
            disabled={importing || validation.error !== null}
            className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {importing ? <Spinner /> : <ClipboardCheck className="size-4" />}
            Import to checklist
          </button>
        )}
      </div>

      {imported ? (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-100">
          <p className="font-semibold">This plan is already in your checklist.</p>
          <p className="mt-0.5 text-xs opacity-80">
            Existing subjects were kept. Open the checklist to review the new
            subjects, or create a new preparation for another plan.
          </p>
        </div>
      ) : null}

      {plan.warnings.length > 0 ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/50 dark:text-amber-100">
          <div className="flex items-start gap-2">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" />
            <div>
              <p className="font-semibold">Plan notes</p>
              <ul className="mt-1 space-y-1 text-xs opacity-90">
                {plan.warnings.map((warning) => (
                  <li key={warning}>· {warning}</li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      ) : null}

      <div className="space-y-4">
        {subjects.map((subject, subjectIndex) => (
          <section
            key={subject.key}
            className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900"
          >
            <header className="flex items-center gap-2 border-b border-slate-100 px-3 py-2.5 dark:border-slate-800">
              <span className="grid size-6 shrink-0 place-items-center rounded-full bg-indigo-100 text-[11px] font-bold text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300">
                {subjectIndex + 1}
              </span>
              <input
                value={subject.name}
                onChange={(event) =>
                  updateSubject(subject.key, { name: event.target.value })
                }
                disabled={disabled}
                aria-label={`Subject ${subjectIndex + 1} name`}
                className={cn(inputClass, "min-w-0 flex-1 text-base font-bold")}
              />
              <button
                type="button"
                onClick={() => removeSubject(subject.key)}
                disabled={disabled}
                className="rounded-lg p-1.5 text-slate-400 transition hover:bg-red-50 hover:text-red-600 disabled:opacity-30 dark:hover:bg-red-950 dark:hover:text-red-300"
                title="Remove subject"
                aria-label="Remove subject"
              >
                <Trash2 className="size-4" />
              </button>
            </header>

            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {subject.items.map((item, itemIndex) => (
                <li key={item.key} className="px-3 py-2">
                  <div className="flex items-start gap-2">
                    <span className="mt-1 w-5 shrink-0 text-right text-[11px] font-semibold tabular-nums text-slate-400">
                      {itemIndex + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <input
                        value={item.text}
                        onChange={(event) =>
                          updateItem(subject.key, item.key, {
                            text: event.target.value,
                          })
                        }
                        disabled={disabled}
                        placeholder="What will you study?"
                        aria-label={`Item ${itemIndex + 1} text`}
                        className={inputClass}
                      />
                      {item.refs.length > 0 ? (
                        <p className="truncate px-2 text-[11px] text-slate-400 dark:text-slate-500">
                          {item.refs
                            .map((ref) => ref.display)
                            .join(" · ")}
                          {item.examScope ? " · exam scope" : " · optional"}
                        </p>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <input
                        value={item.minutes}
                        onChange={(event) =>
                          updateItem(subject.key, item.key, {
                            minutes: event.target.value,
                          })
                        }
                        disabled={disabled}
                        inputMode="numeric"
                        aria-label={`Item ${itemIndex + 1} duration in minutes`}
                        className={minutesClass}
                      />
                      <span className="text-[10px] text-slate-400">min</span>
                      <button
                        type="button"
                        onClick={() => removeItem(subject.key, item.key)}
                        disabled={disabled}
                        className="rounded-lg p-1.5 text-slate-300 transition hover:bg-red-50 hover:text-red-600 disabled:opacity-20 dark:hover:bg-red-950 dark:hover:text-red-300"
                        title="Remove item"
                        aria-label="Remove item"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>

            <div className="border-t border-slate-100 px-3 py-2 dark:border-slate-800">
              <button
                type="button"
                onClick={() => addItem(subject.key)}
                disabled={disabled}
                className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-semibold text-indigo-600 transition hover:bg-indigo-50 disabled:opacity-30 dark:text-indigo-300 dark:hover:bg-indigo-950"
              >
                <Plus className="size-3.5" />
                Add item
              </button>
            </div>
          </section>
        ))}

        <button
          type="button"
          onClick={addSubject}
          disabled={disabled}
          className="flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-slate-300 px-4 py-3 text-sm font-semibold text-slate-500 transition hover:border-indigo-300 hover:text-indigo-600 disabled:opacity-40 dark:border-slate-700 dark:text-slate-400 dark:hover:border-indigo-800 dark:hover:text-indigo-300"
        >
          <ListPlus className="size-4" />
          Add subject
        </button>
      </div>

      {validation.error !== null && !imported ? (
        <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/50 dark:text-amber-100">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" />
          <p>{validation.error}</p>
        </div>
      ) : null}

      {importError !== null ? (
        <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-900 dark:border-red-900 dark:bg-red-950/50 dark:text-red-100">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" />
          <p>{importError}</p>
        </div>
      ) : null}
    </div>
  );
}
