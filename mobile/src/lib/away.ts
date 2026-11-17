import type { Snapshot } from './types';

export interface AwaySnapshot {
  elapsedSeconds: number;
  logicalDay: string;
  running: boolean;
}

export interface AwayMarker extends AwaySnapshot {
  ageSeconds: number;
}

export const AWAY_THRESHOLD_SECONDS = 60;
export const AWAY_AGE_TOLERANCE_SECONDS = 20;

export function toAwaySnapshot(snapshot: Snapshot): AwaySnapshot {
  return {
    elapsedSeconds: snapshot.elapsed_seconds,
    logicalDay: snapshot.logical_day,
    running: snapshot.running,
  };
}

export function awayDelta(
  before: AwaySnapshot,
  after: AwaySnapshot,
): number | null {
  if (!before.running || !after.running) {
    return null;
  }
  if (before.logicalDay !== after.logicalDay) {
    return null;
  }
  const delta = after.elapsedSeconds - before.elapsedSeconds;
  return delta >= AWAY_THRESHOLD_SECONDS ? delta : null;
}

/**
 * A marker survives UI destruction, but its elapsed time can stop advancing
 * while the process is dead (force-stop or reboot). The monotonic age check
 * prevents claiming time that the engine did not actually credit.
 */
export function markerDelta(
  marker: AwayMarker,
  after: AwaySnapshot,
): number | null {
  const delta = awayDelta(marker, after);
  if (delta === null) {
    return null;
  }
  if (Math.abs(delta - marker.ageSeconds) > AWAY_AGE_TOLERANCE_SECONDS) {
    return null;
  }
  return delta;
}
