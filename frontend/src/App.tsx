import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout";
import { ConfigProvider } from "./context/ConfigContext";
import { DialogProvider } from "./context/DialogContext";
import { LiveProvider } from "./context/LiveContext";
import { ThemeProvider } from "./context/ThemeContext";
import { ToastProvider } from "./context/ToastContext";
import { ChecklistPage } from "./pages/ChecklistPage";
import { SettingsPage } from "./pages/SettingsPage";
import { StatsPage } from "./pages/StatsPage";
import { TimerPage } from "./pages/TimerPage";

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
