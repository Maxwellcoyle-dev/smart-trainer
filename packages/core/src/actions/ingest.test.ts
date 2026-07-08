import { describe, it, expect } from "vitest";
import { isOverlapping, ImportedActivitySchema, OVERLAP_WINDOW_MIN } from "./ingest.js";

describe("isOverlapping", () => {
  it("true within the window", () => {
    expect(isOverlapping("2026-07-07T10:00:00Z", "2026-07-07T10:15:00Z")).toBe(true);
    expect(isOverlapping("2026-07-07T10:15:00Z", "2026-07-07T10:00:00Z")).toBe(true);
  });

  it("true exactly at the window edge", () => {
    expect(
      isOverlapping("2026-07-07T10:00:00Z", `2026-07-07T10:${OVERLAP_WINDOW_MIN}:00Z`)
    ).toBe(true);
  });

  it("false outside the window", () => {
    expect(isOverlapping("2026-07-07T10:00:00Z", "2026-07-07T10:21:00Z")).toBe(false);
    expect(isOverlapping("2026-07-07T10:00:00Z", "2026-07-08T10:00:00Z")).toBe(false);
  });

  it("respects a custom window", () => {
    expect(isOverlapping("2026-07-07T10:00:00Z", "2026-07-07T10:05:00Z", 4)).toBe(false);
  });
});

describe("ImportedActivitySchema", () => {
  const base = {
    provider: "file_upload",
    external_id: "abc123",
    sport: "run",
    occurred_at: "2026-07-07T10:00:00Z",
    duration_s: 3600,
    raw: {},
  };

  it("accepts a minimal valid activity", () => {
    expect(ImportedActivitySchema.safeParse(base).success).toBe(true);
  });

  it("accepts optional distance/elevation/hr/title", () => {
    const r = ImportedActivitySchema.safeParse({
      ...base,
      distance_m: 10500,
      elevation_gain_m: 150,
      avg_hr: 148,
      title: "Morning Run",
    });
    expect(r.success).toBe(true);
  });

  it("rejects unknown providers and absurd HR", () => {
    expect(ImportedActivitySchema.safeParse({ ...base, provider: "fitbit" }).success).toBe(false);
    expect(ImportedActivitySchema.safeParse({ ...base, avg_hr: 300 }).success).toBe(false);
  });
});
