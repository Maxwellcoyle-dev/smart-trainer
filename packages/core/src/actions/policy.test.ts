import { describe, it, expect } from "vitest";
import { shouldRaiseFlag, SORENESS_FLAG_THRESHOLD } from "./policy.js";

describe("shouldRaiseFlag", () => {
  it("returns true when part is in watch-list and severity meets threshold", () => {
    expect(shouldRaiseFlag("knee", SORENESS_FLAG_THRESHOLD, ["knee"])).toBe(true);
  });

  it("returns false when part is in watch-list but severity is below threshold", () => {
    expect(shouldRaiseFlag("knee", SORENESS_FLAG_THRESHOLD - 1, ["knee"])).toBe(false);
  });

  it("returns true when watch-list is empty (all parts in scope) and severity meets threshold", () => {
    expect(shouldRaiseFlag("shoulder", SORENESS_FLAG_THRESHOLD, [])).toBe(true);
  });

  it("returns false when part is not in watch-list", () => {
    expect(shouldRaiseFlag("shoulder", SORENESS_FLAG_THRESHOLD + 2, ["knee"])).toBe(false);
  });

  it("returns true when severity is exactly at threshold (boundary)", () => {
    expect(shouldRaiseFlag("hip", SORENESS_FLAG_THRESHOLD, [], SORENESS_FLAG_THRESHOLD)).toBe(true);
  });
});
