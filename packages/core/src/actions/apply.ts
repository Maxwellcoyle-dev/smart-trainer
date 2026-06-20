import { SupabaseClient } from "../db.js";
import type { AdaptationDiff } from "../types.js";

/**
 * Generic diff-apply engine.
 *
 * Plan-change writes (from the coach, MCP, or hooks) are expressed as one or
 * more `AdaptationDiff` envelopes and land in the `proposals` queue. When a
 * proposal is approved — or applied directly from Desktop — the envelope is
 * replayed against the target table here. The same envelope, inverted, is the
 * undo. Keeping this generic means new plan-edit actions don't each need bespoke
 * apply/undo code: they just describe the change as a diff.
 *
 * Only a whitelist of plan/structure tables may be touched this way. Execution
 * tables (sessions, climbs, …) are written by the explicit logging actions, not
 * through generic diffs, so they are intentionally excluded.
 */
const APPLIABLE_TABLES = new Set<string>([
  "prescribed_sessions",
  "plans",
  "phases",
  "plan_weeks",
  "goals",
  "plan_goals",
  "week_skeletons",
  "skeleton_slots",
  "injury_flags",
]);

// Tables WITHOUT a `deleted_at` column → deletes are physical and undo re-inserts.
const HARD_DELETE_TABLES = new Set<string>(["plan_goals", "skeleton_slots"]);

export class DiffApplyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DiffApplyError";
  }
}

function assertAppliable(entityType: string): void {
  if (!APPLIABLE_TABLES.has(entityType)) {
    throw new DiffApplyError(
      `Diff entity_type "${entityType}" is not an appliable table. ` +
        `Allowed: ${[...APPLIABLE_TABLES].join(", ")}.`
    );
  }
}

function asArray(diff: AdaptationDiff | AdaptationDiff[]): AdaptationDiff[] {
  return Array.isArray(diff) ? diff : [diff];
}

/** Apply one envelope to its target table. Returns the affected row id. */
async function applyOne(
  db: SupabaseClient,
  userId: string,
  d: AdaptationDiff
): Promise<string | null> {
  assertAppliable(d.entity_type);

  switch (d.op) {
    case "create": {
      if (!d.after) throw new DiffApplyError("create diff missing `after`");
      const row: Record<string, unknown> = { ...d.after, user_id: userId };
      if (d.entity_id) row.id = d.entity_id;
      const { data, error } = await db
        .from(d.entity_type)
        .insert(row)
        .select("id")
        .single();
      if (error) throw error;
      return (data as { id: string }).id;
    }

    case "update": {
      if (!d.entity_id) throw new DiffApplyError("update diff missing `entity_id`");
      if (!d.after) throw new DiffApplyError("update diff missing `after`");
      const { error } = await db
        .from(d.entity_type)
        .update(d.after)
        .eq("id", d.entity_id)
        .eq("user_id", userId);
      if (error) throw error;
      return d.entity_id;
    }

    case "delete": {
      if (!d.entity_id) throw new DiffApplyError("delete diff missing `entity_id`");
      const q = db.from(d.entity_type);
      const { error } = HARD_DELETE_TABLES.has(d.entity_type)
        ? await q.delete().eq("id", d.entity_id).eq("user_id", userId)
        : await q
            .update({ deleted_at: new Date().toISOString() })
            .eq("id", d.entity_id)
            .eq("user_id", userId);
      if (error) throw error;
      return d.entity_id;
    }

    case "replace_subtree":
      throw new DiffApplyError(
        "replace_subtree must be expanded into create/update/delete envelopes before apply"
      );

    default:
      throw new DiffApplyError(`Unknown diff op "${(d as AdaptationDiff).op}"`);
  }
}

export interface ApplyResult {
  /** The same diffs, with create envelopes' entity_id filled from the DB so the
   *  stored log is undo-ready. */
  diffs: AdaptationDiff[];
  ids: (string | null)[];
}

/** Apply a diff (or array) in order; returns undo-ready diffs + affected ids. */
export async function applyDiff(
  db: SupabaseClient,
  userId: string,
  diff: AdaptationDiff | AdaptationDiff[]
): Promise<ApplyResult> {
  const diffs = asArray(diff);
  const ids: (string | null)[] = [];
  const resolved: AdaptationDiff[] = [];
  for (const d of diffs) {
    const id = await applyOne(db, userId, d);
    ids.push(id);
    // Backfill the id of a freshly created row so its inverse can target it.
    resolved.push(d.op === "create" && id ? { ...d, entity_id: id } : d);
  }
  return { diffs: resolved, ids };
}

/**
 * Invert a diff so applying the result undoes the original. The inverse of an
 * array is the per-item inverses in reverse order.
 *   create → delete the created row
 *   update → update back to `before`
 *   delete → restore (un-soft-delete, or re-insert for hard-delete tables)
 */
export function invertDiff(
  diff: AdaptationDiff | AdaptationDiff[]
): AdaptationDiff[] {
  return [...asArray(diff)].reverse().map(invertOne);
}

function invertOne(d: AdaptationDiff): AdaptationDiff {
  switch (d.op) {
    case "create":
      return {
        entity_type: d.entity_type,
        entity_id: d.entity_id,
        op: "delete",
        before: d.after,
        after: null,
        fields: d.fields,
      };
    case "update":
      return {
        entity_type: d.entity_type,
        entity_id: d.entity_id,
        op: "update",
        before: d.after,
        after: d.before,
        fields: d.fields,
      };
    case "delete":
      if (HARD_DELETE_TABLES.has(d.entity_type)) {
        return {
          entity_type: d.entity_type,
          entity_id: d.entity_id,
          op: "create",
          before: null,
          after: d.before,
          fields: d.fields,
        };
      }
      // Soft-delete inverse: clear the flag on the same row.
      return {
        entity_type: d.entity_type,
        entity_id: d.entity_id,
        op: "update",
        before: { deleted_at: "<set>" },
        after: { deleted_at: null },
        fields: ["deleted_at"],
      };
    default:
      throw new DiffApplyError(`Cannot invert op "${d.op}"`);
  }
}
