import { lazy, Suspense } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout";
import { Skeleton } from "./components/ui";
import { ConfigProvider } from "./context/ConfigContext";
import { DialogProvider } from "./context/DialogContext";
import { LiveProvider } from "./context/LiveContext";
import { ThemeProvider } from "./context/ThemeContext";
import { ToastProvider } from "./context/ToastContext";
import { ChecklistPage } from "./pages/ChecklistPage";
import { SettingsPage } from "./pages/SettingsPage";
import { StatsPage } from "./pages/StatsPage";
import { TimerPage } from "./pages/TimerPage";

const StudyPrepPage = lazy(() =>
  import("./pages/StudyPrepPage").then((module) => ({
    default: module.StudyPrepPage,
  })),
);

export default function App() {
  return (
    <ThemeProvider>
      <ToastProvider>
        <DialogProvider>
          <ConfigProvider>
            <LiveProvider>
              <BrowserRouter>
                <Routes>
                  <Route element={<Layout />}>
                    <Route index element={<TimerPage />} />
                    <Route path="checklist" element={<ChecklistPage />} />
                    <Route
                      path="study-prep"
                      element={
                        <Suspense
                          fallback={
                            <div className="space-y-3">
                              <Skeleton className="h-48" />
                              <Skeleton className="h-96" />
                            </div>
                          }
                        >
                          <StudyPrepPage />
                        </Suspense>
                      }
                    />
                    <Route path="stats" element={<StatsPage />} />
                    <Route path="settings" element={<SettingsPage />} />
                    <Route path="*" element={<Navigate to="/" replace />} />
                  </Route>
                </Routes>
              </BrowserRouter>
            </LiveProvider>
          </ConfigProvider>
        </DialogProvider>
      </ToastProvider>
    </ThemeProvider>
  );
}
