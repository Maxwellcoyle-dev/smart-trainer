import { describe, it, expect } from "vitest";
import { invertDiff } from "./apply.js";
import type { AdaptationDiff } from "../types.js";

const UUID = "00000000-0000-0000-0000-000000000001";

describe("invertDiff", () => {
  it("inverts create → delete targeting the same entity_id", () => {
    const diff: AdaptationDiff = {
      entity_type: "prescribed_sessions",
      entity_id: UUID,
      op: "create",
      before: null,
      after: { name: "Easy run" },
      fields: ["name"],
    };
    const [inv] = invertDiff(diff);
    expect(inv.op).toBe("delete");
    expect(inv.entity_id).toBe(UUID);
  });

  it("inverts update → update swapping before/after", () => {
    const diff: AdaptationDiff = {
      entity_type: "prescribed_sessions",
      entity_id: UUID,
      op: "update",
      before: { name: "Old" },
      after: { name: "New" },
      fields: ["name"],
    };
    const [inv] = invertDiff(diff);
    expect(inv.op).toBe("update");
    expect(inv.after).toEqual({ name: "Old" });
    expect(inv.before).toEqual({ name: "New" });
  });

  it("inverts soft-delete → update clearing deleted_at", () => {
    const diff: AdaptationDiff = {
      entity_type: "prescribed_sessions",
      entity_id: UUID,
      op: "delete",
      before: { name: "Run" },
      after: null,
      fields: [],
    };
    const [inv] = invertDiff(diff);
    expect(inv.op).toBe("update");
    expect((inv.after as Record<string, unknown>)["deleted_at"]).toBeNull();
  });

  it("inverts hard-delete (skeleton_slots) → create", () => {
    const diff: AdaptationDiff = {
      entity_type: "skeleton_slots",
      entity_id: UUID,
      op: "delete",
      before: { day: 1 },
      after: null,
      fields: [],
    };
    const [inv] = invertDiff(diff);
    expect(inv.op).toBe("create");
    expect(inv.after).toEqual({ day: 1 });
  });

  it("inverts an array of diffs in reversed order", () => {
    const diffs: AdaptationDiff[] = [
      {
        entity_type: "prescribed_sessions",
        entity_id: UUID,
        op: "create",
        before: null,
        after: { name: "A" },
        fields: ["name"],
      },
      {
        entity_type: "prescribed_sessions",
        entity_id: "00000000-0000-0000-0000-000000000002",
        op: "update",
        before: { name: "B" },
        after: { name: "B2" },
        fields: ["name"],
      },
    ];
    const inv = invertDiff(diffs);
    expect(inv).toHaveLength(2);
    // reversed: second diff first
    expect(inv[0].entity_id).toBe("00000000-0000-0000-0000-000000000002");
    expect(inv[0].op).toBe("update");
    expect(inv[1].entity_id).toBe(UUID);
    expect(inv[1].op).toBe("delete");
  });
});
