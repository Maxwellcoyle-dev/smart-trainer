import { describe, it, expect } from "vitest";
import { buildGoalDiff } from "./writes.js";

// ─── buildGoalDiff (pure helper, no DB needed) ────────────────────────────────

describe("buildGoalDiff", () => {
  it("createGoal — returns correct before/after for a create-style diff", () => {
    // For creates, callers pass current={} and the insert payload as changes.
    const current = {};
    const changes = { kind: "event", title: "Run a half marathon", priority: 1 };
    const { before, after, fields } = buildGoalDiff(current, changes);

    expect(fields).toEqual(["kind", "title", "priority"]);
    // before values come from current (all undefined → the keys exist with undefined)
    expect(before.kind).toBeUndefined();
    expect(before.title).toBeUndefined();
    // after mirrors changes exactly
    expect(after).toEqual(changes);
  });

  it("updateGoal — computes before/after limited to the changed fields", () => {
    const current = {
      id: "abc",
      title: "Old title",
      priority: 1,
      status: "active",
      notes: null,
    };
    const changes = { title: "New title", priority: 2 };
    const { before, after, fields } = buildGoalDiff(current, changes);

    expect(fields).toEqual(["title", "priority"]);
    expect(before).toEqual({ title: "Old title", priority: 1 });
    expect(after).toEqual({ title: "New title", priority: 2 });
    // Unchanged fields must NOT appear in the diff
    expect("status" in before).toBe(false);
    expect("id" in before).toBe(false);
  });

  it("updateGoal — rejects empty change set (caller responsibility)", () => {
    // buildGoalDiff itself is fine with empty changes; the guard lives in updateGoal.
    // Verify the pure function returns empty fields for an empty changes object.
    const { fields } = buildGoalDiff({ title: "foo" }, {});
    expect(fields).toHaveLength(0);
  });

  it("deleteGoal — diff contains status=abandoned and deleted_at", () => {
    const current = { status: "active", deleted_at: null };
    const deletedAt = "2026-06-20T00:00:00.000Z";
    const changes = { status: "abandoned", deleted_at: deletedAt };
    const { before, after, fields } = buildGoalDiff(current, changes);

    expect(fields).toContain("status");
    expect(fields).toContain("deleted_at");
    expect(before.status).toBe("active");
    expect(before.deleted_at).toBeNull();
    expect(after.status).toBe("abandoned");
    expect(after.deleted_at).toBe(deletedAt);
  });
});
