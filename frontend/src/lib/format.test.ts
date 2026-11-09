import { describe, expect, it } from "vitest";
import {
  formatBytes,
  formatClock,
  formatHours,
  formatOverrun,
  titleCase,
} from "./format";

describe("formatClock", () => {
  it("formats minutes and seconds", () => {
    expect(formatClock(0)).toBe("00:00");
    expect(formatClock(65)).toBe("01:05");
    expect(formatClock(600)).toBe("10:00");
  });

  it("includes hours when needed", () => {
    expect(formatClock(3661)).toBe("1:01:01");
  });

  it("keeps overrun sign", () => {
    expect(formatClock(-65)).toBe("-01:05");
    expect(formatOverrun(65)).toBe("+01:05");
  });
});

describe("formatHours", () => {
  it("formats study totals", () => {
    expect(formatHours(0)).toBe("0h 00m");
    expect(formatHours(4 * 3600)).toBe("4h 00m");
    expect(formatHours(5400)).toBe("1h 30m");
    expect(formatHours(-5400)).toBe("-1h 30m");
  });
});

describe("formatBytes", () => {
  it("formats uploaded source sizes", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(50 * 1024 * 1024)).toBe("50 MB");
  });
});

describe("titleCase", () => {
  it("turns snake case into a label", () => {
    expect(titleCase("day_complete")).toBe("Day Complete");
  });
});
