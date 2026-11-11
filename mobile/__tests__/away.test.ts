import { awayDelta, markerDelta } from '../src/lib/away';

const base = {
  elapsedSeconds: 600,
  logicalDay: '2026-11-11',
  running: true,
};

test('reports a delta at or above the away threshold', () => {
  expect(awayDelta(base, { ...base, elapsedSeconds: 660 })).toBe(60);
  expect(awayDelta(base, { ...base, elapsedSeconds: 725 })).toBe(125);
});

test('ignores absences shorter than the threshold', () => {
  expect(awayDelta(base, { ...base, elapsedSeconds: 659 })).toBeNull();
});

test('ignores paused sessions', () => {
  expect(
    awayDelta(base, { ...base, elapsedSeconds: 900, running: false }),
  ).toBeNull();
  expect(
    awayDelta({ ...base, running: false }, { ...base, elapsedSeconds: 900 }),
  ).toBeNull();
});

test('ignores a logical-day rollover', () => {
  expect(
    awayDelta(base, {
      ...base,
      elapsedSeconds: 900,
      logicalDay: '2026-11-12',
    }),
  ).toBeNull();
});

test('uses a surviving marker when its age matches the accrued time', () => {
  const marker = { ...base, ageSeconds: 125 };
  expect(markerDelta(marker, { ...base, elapsedSeconds: 725 })).toBe(125);
});

test('ignores a stale marker when dead time was not credited', () => {
  const marker = { ...base, ageSeconds: 600 };
  expect(markerDelta(marker, { ...base, elapsedSeconds: 620 })).toBeNull();
});
