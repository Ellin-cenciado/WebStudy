export function formatClock(totalSeconds: number): string {
  const negative = totalSeconds < 0;
  const seconds = Math.abs(Math.trunc(totalSeconds));
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  const clock =
    hours > 0
      ? `${hours}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
      : `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  return negative ? `-${clock}` : clock;
}

export function formatOverrun(totalSeconds: number): string {
  return `+${formatClock(Math.max(0, totalSeconds))}`;
}

export function formatHours(totalSeconds: number): string {
  const sign = totalSeconds < 0 ? '-' : '';
  const seconds = Math.abs(Math.trunc(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${sign}${hours}h ${String(minutes).padStart(2, '0')}m`;
}

export function formatDate(isoDate: string, locale = 'en'): string {
  const [year, month, day] = isoDate.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  return date.toLocaleDateString(locale, {
    month: 'short',
    day: 'numeric',
    weekday: 'short',
  });
}

export function formatTimestamp(isoTimestamp: string, locale = 'en'): string {
  const date = new Date(isoTimestamp);
  return date.toLocaleTimeString(locale, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: locale.startsWith('es') ? false : undefined,
  });
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '0 B';
  }
  const units = ['B', 'KB', 'MB', 'GB'];
  const index = Math.min(
    units.length - 1,
    Math.floor(Math.log(bytes) / Math.log(1024)),
  );
  const value = bytes / 1024 ** index;
  return `${index === 0 ? Math.round(value) : value.toFixed(value >= 10 ? 0 : 1)} ${units[index]}`;
}

export function formatDateTime(isoTimestamp: string, locale = 'en'): string {
  const date = new Date(isoTimestamp);
  if (Number.isNaN(date.getTime())) {
    return isoTimestamp;
  }
  return date.toLocaleString(locale, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: locale.startsWith('es') ? false : undefined,
  });
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
