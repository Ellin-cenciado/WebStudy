import {
  useRef,
  useState,
  type DragEvent,
  type FormEvent,
} from "react";
import {
  FileText,
  FileUp,
  Presentation,
  Sparkles,
  TriangleAlert,
  X,
} from "lucide-react";
import { Spinner } from "../ui";
import { api } from "../../lib/api";
import { cn } from "../../lib/cn";
import { errorMessage, formatBytes } from "../../lib/format";
import type {
  StudyPrepConfig,
  StudyPrepDepth,
  StudyPrepLanguage,
  StudyPrepRun,
} from "../../lib/types";

const SUPPORTED = [".pdf", ".pptx", ".md", ".markdown"];
const MAX_NOTES_CHARS = 400_000;

const selectClass =
  "rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/20 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-50";

function kindOf(file: File): string {
  const name = file.name.toLowerCase();
  if (name.endsWith(".pdf")) return "PDF";
  if (name.endsWith(".pptx")) return "PPTX";
  return "Markdown";
}

function FileIcon({ file }: { file: File }) {
  if (file.name.toLowerCase().endsWith(".pptx")) {
    return <Presentation className="size-4 shrink-0 text-orange-500" />;
  }
  if (file.name.toLowerCase().endsWith(".pdf")) {
    return <FileText className="size-4 shrink-0 text-red-500" />;
  }
  return <FileText className="size-4 shrink-0 text-indigo-500" />;
}

export function StudyPrepForm({
  config,
  onCreated,
}: {
  config: StudyPrepConfig | null;
  onCreated: (run: StudyPrepRun) => void;
}) {
  const [notes, setNotes] = useState("");
  const [language, setLanguage] = useState<StudyPrepLanguage>("auto");
  const [depth, setDepth] = useState<StudyPrepDepth>("balanced");
  const [target, setTarget] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [dragging, setDragging] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const maxFiles = config?.max_files ?? 10;
  const maxFileBytes = config?.max_file_bytes ?? 50 * 1024 * 1024;
  const maxTotalBytes = config?.max_total_bytes ?? 200 * 1024 * 1024;
  const providerReady = config?.configured ?? true;

  const addFiles = (incoming: File[]) => {
    if (incoming.length === 0) return;
    setError(null);
    const accepted: File[] = [];
    for (const file of incoming) {
      const lower = file.name.toLowerCase();
      if (!SUPPORTED.some((suffix) => lower.endsWith(suffix))) {
        setError(
          `"${file.name}" is not supported. Use PDF, PPTX, or Markdown files.`,
        );
        continue;
      }
      if (file.size > maxFileBytes) {
        setError(
          `"${file.name}" is larger than ${formatBytes(maxFileBytes)}.`,
        );
        continue;
      }
      const duplicate = files.some(
        (existing) =>
          existing.name === file.name &&
          existing.size === file.size &&
          existing.lastModified === file.lastModified,
      );
      if (!duplicate) accepted.push(file);
    }
    if (accepted.length === 0) return;
    const next = [...files, ...accepted].slice(0, maxFiles);
    if (files.length + accepted.length > maxFiles) {
      setError(`Upload at most ${maxFiles} source files at a time.`);
    }
    if (next.reduce((sum, file) => sum + file.size, 0) > maxTotalBytes) {
      setError(`The uploads must be at most ${formatBytes(maxTotalBytes)} in total.`);
      return;
    }
    setFiles(next);
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    addFiles(Array.from(event.dataTransfer.files));
  };

  const removeFile = (targetFile: File) => {
    setFiles((current) => current.filter((file) => file !== targetFile));
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    if (!notes.trim() && files.length === 0) {
      setError("Add rough notes, at least one source file, or both.");
      return;
    }
    let targetMinutes: number | null = null;
    if (target.trim() !== "") {
      const parsed = Number(target);
      if (!Number.isInteger(parsed) || parsed < 10 || parsed > 10_000) {
        setError("Target minutes must be a whole number between 10 and 10000.");
        return;
      }
      targetMinutes = parsed;
    }
    setSubmitting(true);
    try {
      const run = await api.createStudyPrepRun({
        notes,
        language,
        depth,
        targetMinutes,
        files,
      });
      setNotes("");
      setTarget("");
      setFiles([]);
      onCreated(run);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form
      onSubmit={(event) => void submit(event)}
      className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900"
    >
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-indigo-100 text-indigo-600 dark:bg-indigo-950 dark:text-indigo-300">
          <Sparkles className="size-5" />
        </span>
        <div>
          <h2 className="text-base font-bold">New preparation</h2>
          <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
            Add rough notes and text-based sources. The model writes the polished
            notes; study times are calculated from the source size.
          </p>
        </div>
      </div>

      {!providerReady ? (
        <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/50 dark:text-amber-100">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" />
          <div>
            <p className="font-semibold">No language model configured</p>
            <p className="mt-0.5 text-xs opacity-80">
              Set <code className="font-mono">WEBSTUDY_LLM_MODEL</code> (and
              optionally <code className="font-mono">WEBSTUDY_LLM_BASE_URL</code>)
              and restart the backend.
            </p>
          </div>
        </div>
      ) : null}

      <div className="mt-5 space-y-4">
        <label className="block">
          <span className="flex items-baseline justify-between gap-2">
            <span className="text-sm font-semibold">Rough notes</span>
            <span className="text-[11px] tabular-nums text-slate-400">
              {notes.length.toLocaleString()} characters
            </span>
          </span>
          <textarea
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            maxLength={MAX_NOTES_CHARS}
            rows={7}
            placeholder={
              "Dump what you know or what the teacher said. Mention the exam scope, tricky topics, and anything that must not be missed.\n\nExample: Units 3-5 are in the exam. The membrane transport table is important. Skip the historical introduction."
            }
            className="mt-1.5 w-full resize-y rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm leading-relaxed text-slate-900 outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/20 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-50"
          />
        </label>

        <div
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={cn(
            "rounded-xl border border-dashed p-4 transition",
            dragging
              ? "border-indigo-400 bg-indigo-50 dark:bg-indigo-950/30"
              : "border-slate-300 bg-slate-50/60 dark:border-slate-700 dark:bg-slate-950/40",
          )}
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold">Source files</p>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                PDF, PPTX, or Markdown · up to {maxFiles} files ·{" "}
                {formatBytes(maxFileBytes)} each ·{" "}
                {formatBytes(maxTotalBytes)} total
              </p>
            </div>
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              <FileUp className="size-4" />
              Choose files
            </button>
            <input
              ref={inputRef}
              type="file"
              multiple
              accept=".pdf,.pptx,.md,.markdown,application/pdf,application/vnd.openxmlformats-officedocument.presentationml.presentation,text/markdown"
              className="sr-only"
              onChange={(event) => {
                addFiles(Array.from(event.target.files ?? []));
                event.target.value = "";
              }}
            />
          </div>

          {files.length > 0 ? (
            <ul className="mt-3 space-y-1.5">
              {files.map((file) => (
                <li
                  key={`${file.name}-${file.size}-${file.lastModified}`}
                  className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-900"
                >
                  <FileIcon file={file} />
                  <span className="min-w-0 flex-1 truncate">{file.name}</span>
                  <span className="shrink-0 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                    {kindOf(file)}
                  </span>
                  <span className="shrink-0 text-[11px] tabular-nums text-slate-400">
                    {formatBytes(file.size)}
                  </span>
                  <button
                    type="button"
                    onClick={() => removeFile(file)}
                    className="rounded-lg p-1 text-slate-400 transition hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950 dark:hover:text-red-300"
                    aria-label={`Remove ${file.name}`}
                  >
                    <X className="size-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-xs text-slate-400 dark:text-slate-500">
              Drop files here or choose them from disk. Scanned PDFs and image-only
              slides are not supported.
            </p>
          )}
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">
              Output language
            </span>
            <select
              value={language}
              onChange={(event) =>
                setLanguage(event.target.value as StudyPrepLanguage)
              }
              className={selectClass}
            >
              <option value="auto">Auto-detect</option>
              <option value="es">Spanish</option>
              <option value="en">English</option>
            </select>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">
              Depth
            </span>
            <select
              value={depth}
              onChange={(event) => setDepth(event.target.value as StudyPrepDepth)}
              className={selectClass}
            >
              <option value="quick">Quick review</option>
              <option value="balanced">Balanced</option>
              <option value="deep">Deep / exam-ready</option>
            </select>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">
              Target (optional)
            </span>
            <div className="relative">
              <input
                value={target}
                onChange={(event) => setTarget(event.target.value)}
                inputMode="numeric"
                placeholder="Automatic"
                className={cn(selectClass, "w-full pr-12 text-right tabular-nums")}
              />
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400">
                min
              </span>
            </div>
          </label>
        </div>

        {error !== null ? (
          <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-900 dark:border-red-900 dark:bg-red-950/50 dark:text-red-100">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" />
            <p>{error}</p>
          </div>
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-slate-400 dark:text-slate-500">
            The plan is deterministic: source words and structure set the study
            time, not the model.
          </p>
          <button
            type="submit"
            disabled={
              submitting ||
              !providerReady ||
              (!notes.trim() && files.length === 0)
            }
            className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm shadow-indigo-600/20 transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {submitting ? <Spinner /> : <Sparkles className="size-4" />}
            Prepare notes & plan
          </button>
        </div>
      </div>
    </form>
  );
}
