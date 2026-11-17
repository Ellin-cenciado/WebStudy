import { Copy, Download, FileText, Languages } from "lucide-react";
import { Markdown } from "./Markdown";
import { useToast } from "../../context/ToastContext";
import { errorMessage } from "../../lib/format";
import type { StudyPrepNotes } from "../../lib/types";

function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "study-notes";
}

export function NotesView({ notes }: { notes: StudyPrepNotes }) {
  const { push } = useToast();

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(notes.markdown);
      push({ kind: "success", title: "Markdown copied" });
    } catch (caught) {
      push({
        kind: "error",
        title: "Could not copy the notes",
        body: errorMessage(caught),
      });
    }
  };

  const download = () => {
    const blob = new Blob([notes.markdown], {
      type: "text/markdown;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${slugify(notes.title)}.md`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 font-semibold dark:bg-slate-800">
            <FileText className="size-3.5" />
            {notes.word_count.toLocaleString()} words
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 font-semibold uppercase dark:bg-slate-800">
            <Languages className="size-3.5" />
            {notes.language}
          </span>
          <span className="rounded-full bg-slate-100 px-2.5 py-1 font-semibold dark:bg-slate-800">
            {notes.sections.length}{" "}
            {notes.sections.length === 1 ? "section" : "sections"}
          </span>
          {notes.exam_scope.length > 0 ? (
            <span className="rounded-full bg-amber-100 px-2.5 py-1 font-semibold text-amber-800 dark:bg-amber-950 dark:text-amber-200">
              {notes.exam_scope.length} exam-scope{" "}
              {notes.exam_scope.length === 1 ? "note" : "notes"}
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void copy()}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            <Copy className="size-4" />
            Copy Markdown
          </button>
          <button
            type="button"
            onClick={download}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            <Download className="size-4" />
            Download .md
          </button>
        </div>
      </div>

      <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900 sm:p-7">
        <Markdown>{notes.markdown}</Markdown>
      </article>
    </div>
  );
}
