import { NavLink, Outlet } from "react-router-dom";
import {
  BarChart3,
  BookOpenCheck,
  ListChecks,
  Moon,
  Settings,
  Sun,
  Timer,
  WifiOff,
} from "lucide-react";
import { cn } from "../lib/cn";
import { useLive } from "../context/LiveContext";
import { useTheme } from "../context/ThemeContext";

const NAV_ITEMS = [
  { to: "/", label: "Timer", icon: Timer, end: true },
  { to: "/checklist", label: "Checklist", icon: ListChecks },
  { to: "/stats", label: "Stats", icon: BarChart3 },
  { to: "/settings", label: "Settings", icon: Settings },
];

function ConnectionBadge() {
  const { connected } = useLive();
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide",
        connected
          ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
          : "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
      )}
      title={connected ? "Connected to the backend" : "Backend offline"}
    >
      <span
        className={cn(
          "size-1.5 rounded-full",
          connected ? "bg-emerald-500" : "animate-pulse bg-red-500",
        )}
      />
      {connected ? "Live" : "Offline"}
    </span>
  );
}

function ThemeButton() {
  const { theme, toggle } = useTheme();
  return (
    <button
      type="button"
      onClick={toggle}
      className="rounded-xl p-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
      aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
    >
      {theme === "dark" ? <Sun className="size-5" /> : <Moon className="size-5" />}
    </button>
  );
}

function Brand() {
  return (
    <div className="flex items-center gap-2.5">
      <span className="grid size-9 place-items-center rounded-xl bg-indigo-600 text-white shadow-sm shadow-indigo-600/30">
        <BookOpenCheck className="size-5" />
      </span>
      <div className="leading-tight">
        <p className="text-base font-bold tracking-tight text-slate-900 dark:text-slate-50">
          WebStudy
        </p>
        <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
          carry-over study tracker
        </p>
      </div>
    </div>
  );
}

function Sidebar() {
  return (
    <aside className="hidden w-64 shrink-0 border-r border-slate-200 bg-white/80 px-4 py-5 backdrop-blur dark:border-slate-800 dark:bg-slate-900/80 lg:flex lg:flex-col">
      <Brand />
      <nav className="mt-8 flex flex-1 flex-col gap-1">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition",
                  isActive
                    ? "bg-indigo-50 text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300"
                    : "text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100",
                )
              }
            >
              <Icon className="size-[18px]" />
              {item.label}
            </NavLink>
          );
        })}
      </nav>
      <div className="mt-6 flex items-center justify-between border-t border-slate-200 pt-4 dark:border-slate-800">
        <ConnectionBadge />
        <ThemeButton />
      </div>
    </aside>
  );
}

function MobileHeader() {
  return (
    <header className="sticky top-0 z-30 flex items-center justify-between border-b border-slate-200 bg-white/90 px-4 py-3 backdrop-blur dark:border-slate-800 dark:bg-slate-950/90 lg:hidden">
      <Brand />
      <div className="flex items-center gap-1">
        <ConnectionBadge />
        <ThemeButton />
      </div>
    </header>
  );
}

function MobileNav() {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur dark:border-slate-800 dark:bg-slate-950/95 lg:hidden">
      <div className="mx-auto grid max-w-md grid-cols-4">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                cn(
                  "flex flex-col items-center gap-1 py-2.5 text-[11px] font-semibold transition",
                  isActive
                    ? "text-indigo-600 dark:text-indigo-300"
                    : "text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200",
                )
              }
            >
              <Icon className="size-5" />
              {item.label}
            </NavLink>
          );
        })}
      </div>
    </nav>
  );
}

function OfflineBanner() {
  const { connected, error } = useLive();
  if (connected) return null;
  return (
    <div className="mb-4 flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/60 dark:text-amber-100">
      <WifiOff className="mt-0.5 size-4 shrink-0" />
      <p>{error ?? "Connecting to the WebStudy backend…"}</p>
    </div>
  );
}

export function Layout() {
  return (
    <div className="flex min-h-svh bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <MobileHeader />
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 pb-24 pt-5 sm:px-6 lg:px-8 lg:pb-10 lg:pt-8">
          <OfflineBanner />
          <Outlet />
        </main>
      </div>
      <MobileNav />
    </div>
  );
}
