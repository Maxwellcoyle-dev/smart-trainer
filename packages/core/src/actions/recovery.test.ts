import { describe, it, expect } from "vitest";
import {
  recoveryProgress,
  stepFlagDown,
  SORENESS_RESOLVE_THRESHOLD,
  RESOLVE_AFTER_CLEAR_CHECKINS,
} from "./policy.js";

describe("recoveryProgress", () => {
  it("returns requiredClear when all entries in window are at or below threshold", () => {
    const severities = [2, 1, 0]; // newest-first, all clear
    expect(recoveryProgress(severities, SORENESS_RESOLVE_THRESHOLD, RESOLVE_AFTER_CLEAR_CHECKINS)).toBe(3);
  });

  it("returns 0 when the most-recent entry is sore", () => {
    const severities = [5, 0, 0];
    expect(recoveryProgress(severities, SORENESS_RESOLVE_THRESHOLD, RESOLVE_AFTER_CLEAR_CHECKINS)).toBe(0);
  });

  it("resets streak when a sore reading appears inside the window", () => {
    // newest-first: clear, clear, sore — streak breaks at index 2
    const severities = [0, 1, 6];
    expect(recoveryProgress(severities, SORENESS_RESOLVE_THRESHOLD, RESOLVE_AFTER_CLEAR_CHECKINS)).toBe(2);
  });

  it("treats missing entries (severity 0) as clear", () => {
    const severities = [0, 0, 0];
    expect(recoveryProgress(severities, SORENESS_RESOLVE_THRESHOLD, RESOLVE_AFTER_CLEAR_CHECKINS)).toBe(3);
  });

  it("returns partial count for a partial clear window", () => {
    const severities = [1, 2]; // only 2 entries, both clear
    expect(recoveryProgress(severities, SORENESS_RESOLVE_THRESHOLD, RESOLVE_AFTER_CLEAR_CHECKINS)).toBe(2);
  });

  it("caps at requiredClear even if more entries are provided", () => {
    const severities = [0, 0, 0, 0, 0];
    expect(recoveryProgress(severities, SORENESS_RESOLVE_THRESHOLD, RESOLVE_AFTER_CLEAR_CHECKINS)).toBe(3);
  });

  it("exactly-at-threshold severity counts as clear", () => {
    const severities = [SORENESS_RESOLVE_THRESHOLD, SORENESS_RESOLVE_THRESHOLD, SORENESS_RESOLVE_THRESHOLD];
    expect(recoveryProgress(severities, SORENESS_RESOLVE_THRESHOLD, RESOLVE_AFTER_CLEAR_CHECKINS)).toBe(3);
  });

  it("one above threshold breaks the streak immediately", () => {
    const severities = [SORENESS_RESOLVE_THRESHOLD + 1, 0, 0];
    expect(recoveryProgress(severities, SORENESS_RESOLVE_THRESHOLD, RESOLVE_AFTER_CLEAR_CHECKINS)).toBe(0);
  });
});

describe("stepFlagDown", () => {
  const date = "2026-06-20";

  it("steps active → watch (no resolved_date)", () => {
    expect(stepFlagDown("active", date)).toEqual({ status: "watch", resolved_date: null });
  });

  it("steps rehab → watch (no resolved_date)", () => {
    expect(stepFlagDown("rehab", date)).toEqual({ status: "watch", resolved_date: null });
  });

  it("steps watch → resolved and sets resolved_date", () => {
    expect(stepFlagDown("watch", date)).toEqual({ status: "resolved", resolved_date: date });
  });

  it("resolved is terminal — stays resolved with no date change", () => {
    expect(stepFlagDown("resolved", date)).toEqual({ status: "resolved", resolved_date: null });
  });
});
