import { useCallback, useEffect, useRef, useState } from "react";
import { Plus, Sparkles, TriangleAlert } from "lucide-react";
import { HistoryList } from "../components/study-prep/HistoryList";
import { RunDetail } from "../components/study-prep/RunDetail";
import { StudyPrepForm } from "../components/study-prep/StudyPrepForm";
import { PageHeader, Skeleton } from "../components/ui";
import { useDialog } from "../context/DialogContext";
import { useToast } from "../context/ToastContext";
import { api, ApiError } from "../lib/api";
import { errorMessage } from "../lib/format";
import type {
  StudyPrepConfig,
  StudyPrepResult,
  StudyPrepRun,
} from "../lib/types";

function mergeRun(list: StudyPrepRun[], run: StudyPrepRun): StudyPrepRun[] {
  const next = list.some((entry) => entry.id === run.id)
    ? list.map((entry) => (entry.id === run.id ? run : entry))
    : [run, ...list];
  return [...next].sort((left, right) =>
    right.created_at.localeCompare(left.created_at),
  );
}

export function StudyPrepPage() {
  const [config, setConfig] = useState<StudyPrepConfig | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);
  const [runs, setRuns] = useState<StudyPrepRun[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selectedIdRef = useRef<string | null>(null);
  const resultRequest = useRef(0);
  const [detail, setDetail] = useState<StudyPrepRun | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [result, setResult] = useState<StudyPrepResult | null>(null);
  const [resultLoading, setResultLoading] = useState(false);
  const [resultError, setResultError] = useState<string | null>(null);
  const [actionPending, setActionPending] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const { confirm } = useDialog();
  const { push } = useToast();

  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  const refreshRuns = useCallback(async (selectActive = false) => {
    try {
      const list = await api.studyPrepRuns();
      setRuns(list);
      setHistoryError(null);
      if (selectActive) {
        setSelectedId((current) => {
          if (current !== null) return current;
          const active = list.find(
            (run) => run.status === "queued" || run.status === "running",
          );
          return active?.id ?? null;
        });
      }
      return list;
    } catch (caught) {
      setHistoryError(errorMessage(caught));
      return [];
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  const loadResult = useCallback(async (runId: string) => {
    const token = ++resultRequest.current;
    setResultLoading(true);
    setResultError(null);
    try {
      const next = await api.studyPrepResult(runId);
      if (resultRequest.current !== token || selectedIdRef.current !== runId) {
        return;
      }
      setResult(next);
    } catch (caught) {
      if (resultRequest.current === token && selectedIdRef.current === runId) {
        setResultError(errorMessage(caught));
      }
    } finally {
      if (resultRequest.current === token) {
        setResultLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    void api
      .studyPrepConfig()
      .then((next) => {
        setConfig(next);
        setConfigError(null);
      })
      .catch((caught) => setConfigError(errorMessage(caught)));
    void refreshRuns(true);
  }, [refreshRuns]);

  useEffect(() => {
    resultRequest.current += 1;
    setResult(null);
    setResultLoading(false);
    setResultError(null);
    if (selectedId === null) {
      setDetail(null);
      setDetailLoading(false);
      setDetailError(null);
      return;
    }
    let active = true;
    setDetail(null);
    setDetailLoading(true);
    setDetailError(null);
    void api
      .studyPrepRun(selectedId)
      .then((run) => {
        if (!active) return;
        setDetail(run);
        setRuns((current) => mergeRun(current, run));
      })
      .catch((caught) => {
        if (active) setDetailError(errorMessage(caught));
      })
      .finally(() => {
        if (active) setDetailLoading(false);
      });
    return () => {
      active = false;
    };
  }, [selectedId]);

  const detailId = detail?.id;
  const detailStatus = detail?.status;

  useEffect(() => {
    if (selectedId === null || detailId !== selectedId) return;
    if (detailStatus !== "queued" && detailStatus !== "running") return;
    let active = true;
    const tick = async () => {
      try {
        const run = await api.studyPrepRun(selectedId);
        if (!active) return;
        setDetail(run);
        setRuns((current) => mergeRun(current, run));
        if (run.status !== "queued" && run.status !== "running") {
          void refreshRuns();
        }
      } catch (caught) {
        if (!active) return;
        if (caught instanceof ApiError && caught.status === 404) {
          setHistoryError("That preparation was deleted.");
          setSelectedId(null);
        }
        // Other poll failures are transient; keep the visible progress.
      }
    };
    const timer = window.setInterval(() => void tick(), 1500);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [selectedId, detailId, detailStatus, refreshRuns]);

  useEffect(() => {
    if (selectedId === null || detailId !== selectedId) return;
    if (detailStatus !== "ready" || !detail?.has_result) return;
    void loadResult(selectedId);
  }, [selectedId, detailId, detailStatus, detail?.has_result, loadResult]);

  const created = (run: StudyPrepRun) => {
    setRuns((current) => mergeRun(current, run));
    setSelectedId(run.id);
    setResult(null);
    setResultError(null);
    push({
      kind: "success",
      title: "Preparation queued",
      body: "The notes and plan will appear here when the run finishes.",
    });
  };

  const cancelRun = async () => {
    if (detail === null) return;
    const runId = detail.id;
    setActionPending(true);
    try {
      const run = await api.cancelStudyPrepRun(runId);
      if (selectedIdRef.current === runId) setDetail(run);
      setRuns((current) => mergeRun(current, run));
      push({ kind: "info", title: "Preparation cancelled" });
    } catch (caught) {
      push({
        kind: "error",
        title: "Could not cancel the run",
        body: errorMessage(caught),
      });
    } finally {
      setActionPending(false);
    }
  };

  const retryRun = async () => {
    if (detail === null) return;
    const runId = detail.id;
    setActionPending(true);
    try {
      const run = await api.retryStudyPrepRun(runId);
      if (selectedIdRef.current === runId) {
        resultRequest.current += 1;
        setDetail(run);
        setResult(null);
        setResultLoading(false);
        setResultError(null);
      }
      setRuns((current) => mergeRun(current, run));
      push({ kind: "info", title: "Preparation queued again" });
    } catch (caught) {
      push({
        kind: "error",
        title: "Could not retry the run",
        body: errorMessage(caught),
      });
    } finally {
      setActionPending(false);
    }
  };

  const deleteRun = async (run: StudyPrepRun) => {
    const active = run.status === "queued" || run.status === "running";
    const ok = await confirm({
      title: "Delete preparation?",
      message: active
        ? `Cancel and delete "${run.title}"? Its uploaded files, notes, and plan will be removed.`
        : `Delete "${run.title}"? Its uploaded files, notes, and plan will be removed.`,
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!ok) return;
    setBusyId(run.id);
    try {
      await api.deleteStudyPrepRun(run.id);
      setRuns((current) => current.filter((entry) => entry.id !== run.id));
      if (selectedIdRef.current === run.id) {
        setSelectedId(null);
      }
      push({ kind: "success", title: "Preparation deleted" });
    } catch (caught) {
      push({
        kind: "error",
        title: "Could not delete the preparation",
        body: errorMessage(caught),
      });
    } finally {
      setBusyId(null);
    }
  };

  const imported = async () => {
    if (selectedId === null) return;
    const runId = selectedId;
    try {
      const run = await api.studyPrepRun(runId);
      if (selectedIdRef.current === runId) setDetail(run);
      setRuns((current) => mergeRun(current, run));
    } catch (caught) {
      push({
        kind: "warning",
        title: "Imported, but the run status did not refresh",
        body: errorMessage(caught),
      });
    }
  };

  const reloadSelected = async () => {
    if (selectedId === null) return;
    const runId = selectedId;
    setDetailLoading(true);
    setDetailError(null);
    try {
      const run = await api.studyPrepRun(runId);
      if (selectedIdRef.current !== runId) return;
      setDetail(run);
      setRuns((current) => mergeRun(current, run));
    } catch (caught) {
      if (selectedIdRef.current === runId) {
        setDetailError(errorMessage(caught));
      }
    } finally {
      if (selectedIdRef.current === runId) {
        setDetailLoading(false);
      }
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Study Prep"
        subtitle="Turn rough notes and text-based sources into polished notes and an editable study plan."
        actions={
          selectedId !== null ? (
            <button
              type="button"
              onClick={() => setSelectedId(null)}
              className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-indigo-500"
            >
              <Plus className="size-4" />
              New preparation
            </button>
          ) : null
        }
      />

      {configError !== null ? (
        <div className="flex items-start gap-2.5 rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-900 dark:border-red-900 dark:bg-red-950/50 dark:text-red-100">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" />
          <div>
            <p className="font-semibold">Could not load the study-prep config</p>
            <p className="mt-0.5 text-xs opacity-80">{configError}</p>
          </div>
        </div>
      ) : config?.configured ? (
        <p className="text-xs text-slate-400 dark:text-slate-500">
          Using{" "}
          <span className="font-semibold text-slate-500 dark:text-slate-400">
            {config.provider === "ollama" ? "Ollama" : "OpenAI-compatible"}
          </span>{" "}
          · {config.model} · {config.base_url}
        </p>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-4">
          {selectedId === null ? (
            <StudyPrepForm config={config} onCreated={created} />
          ) : detailLoading && detail === null ? (
            <div className="space-y-3">
              <Skeleton className="h-48" />
              <Skeleton className="h-96" />
            </div>
          ) : detailError !== null ? (
            <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-900 dark:border-red-900 dark:bg-red-950/50 dark:text-red-100">
              <div className="flex items-start gap-2">
                <TriangleAlert className="mt-0.5 size-4 shrink-0" />
                <div>
                  <p className="font-semibold">Could not load this preparation</p>
                  <p className="mt-0.5 text-xs opacity-80">{detailError}</p>
                  <button
                    type="button"
                    onClick={() => void reloadSelected()}
                    className="mt-2 rounded-lg bg-red-900 px-2.5 py-1.5 text-xs font-semibold text-white dark:bg-red-100 dark:text-red-950"
                  >
                    Try again
                  </button>
                </div>
              </div>
            </div>
          ) : detail !== null ? (
            <RunDetail
              key={detail.id}
              run={detail}
              result={result}
              resultLoading={resultLoading}
              resultError={resultError}
              busy={actionPending}
              onCancel={() => void cancelRun()}
              onRetry={() => void retryRun()}
              onDelete={() => void deleteRun(detail)}
              onReloadResult={() => void loadResult(detail.id)}
              onImported={() => void imported()}
            />
          ) : (
            <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-400 dark:border-slate-800 dark:bg-slate-900">
              Select a preparation from the history.
            </div>
          )}
        </div>

        <HistoryList
          runs={runs}
          selectedId={selectedId}
          loading={historyLoading}
          error={historyError}
          busyId={busyId}
          onSelect={setSelectedId}
          onDelete={(run) => void deleteRun(run)}
          onNew={() => setSelectedId(null)}
        />
      </div>

      <p className="flex items-start justify-center gap-1.5 pb-2 text-center text-xs text-slate-400 dark:text-slate-500">
        <Sparkles className="mt-0.5 size-3.5 shrink-0" />
        Uploaded sources, extracted text, notes, and plans stay under the WebStudy
        state directory. Only extracted excerpts are sent to the configured model.
      </p>
    </div>
  );
}
