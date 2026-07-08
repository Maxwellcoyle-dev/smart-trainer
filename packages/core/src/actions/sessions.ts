// ─── Session history: edit + delete logged workouts ──────────────────────────
//
// Sessions are soft-deleted (deleted_at) — every metric view and read already
// filters `sessions.deleted_at is null`, so a soft-delete at the session level
// removes the workout from all charts/pyramids/mileage without touching child
// rows. Edits update the session row and (when provided) replace child detail
// rows: run_details is updated in place (1:1); climbs and strength_sets use
// replace semantics (soft-delete existing, insert the new list) so the client
// can send the full corrected list without diffing.

import { SupabaseClient } from "../db.js";
import type {
  Session,
  RunDetails,
  Climb,
  StrengthSet,
  ClimbInput,
  StrengthSetInput,
  RunSurface,
} from "../types.js";
import { appendAdaptationLog } from "./writes.js";

export interface UpdateSessionInput {
  occurred_at?: string;
  duration_s?: number | null;
  session_rpe?: number | null;
  location?: string | null;
  notes?: string | null;
  /** Run sessions only — updates run_details in place. */
  run?: {
    distance_m: number;
    surface: RunSurface;
    elevation_gain_m?: number | null;
  };
  /** Climb sessions only — replaces the session's climbs. */
  climbs?: ClimbInput[];
  /** Strength sessions only — replaces the session's sets. */
  sets?: StrengthSetInput[];
}

export type SessionWithDetails = Session & {
  run_details?: RunDetails | null;
  climbs?: Climb[];
  strength_sets?: StrengthSet[];
};

async function getOwnedSession(
  db: SupabaseClient,
  userId: string,
  sessionId: string
): Promise<Session> {
  const { data, error } = await db
    .from("sessions")
    .select("*")
    .eq("id", sessionId)
    .eq("user_id", userId)
    .is("deleted_at", null)
    .single();
  if (error) throw error;
  return data as Session;
}

export async function updateSession(
  db: SupabaseClient,
  userId: string,
  sessionId: string,
  input: UpdateSessionInput
): Promise<{ session: SessionWithDetails }> {
  const before = await getOwnedSession(db, userId, sessionId);

  // Session-level fields
  const patch: Record<string, unknown> = {};
  if (input.occurred_at !== undefined) patch.occurred_at = input.occurred_at;
  if (input.duration_s !== undefined) patch.duration_s = input.duration_s;
  if (input.session_rpe !== undefined) patch.session_rpe = input.session_rpe;
  if (input.location !== undefined) patch.location = input.location;
  if (input.notes !== undefined) patch.notes = input.notes;

  let session = before;
  if (Object.keys(patch).length > 0) {
    const { data, error } = await db
      .from("sessions")
      .update(patch)
      .eq("id", sessionId)
      .eq("user_id", userId)
      .select()
      .single();
    if (error) throw error;
    session = data as Session;
  }

  // Run details (1:1 update in place)
  let runDetails: RunDetails | null = null;
  if (input.run) {
    const { data, error } = await db
      .from("run_details")
      .update({
        distance_m: input.run.distance_m,
        surface: input.run.surface,
        elevation_gain_m: input.run.elevation_gain_m ?? null,
      })
      .eq("session_id", sessionId)
      .eq("user_id", userId)
      .select()
      .single();
    if (error) throw error;
    runDetails = data as RunDetails;
  }

  // Climbs (replace: soft-delete existing, insert new)
  let climbs: Climb[] | undefined;
  if (input.climbs) {
    const now = new Date().toISOString();
    const { error: delErr } = await db
      .from("climbs")
      .update({ deleted_at: now })
      .eq("session_id", sessionId)
      .eq("user_id", userId)
      .is("deleted_at", null);
    if (delErr) throw delErr;

    if (input.climbs.length > 0) {
      const { data, error } = await db
        .from("climbs")
        .insert(
          input.climbs.map((c, i) => ({
            user_id: userId,
            session_id: sessionId,
            grade_id: c.grade_id ?? null,
            grade_label: c.grade_label,
            grade_value: c.grade_value ?? null,
            style: c.style,
            environment: c.environment,
            attempts: c.attempts,
            sends: c.sends,
            route_name: c.route_name ?? null,
            crag: c.crag ?? null,
            order_in_session: c.order_in_session ?? i,
            angle: c.angle ?? null,
            character_tags: c.character_tags ?? [],
            length_ft: c.length_ft ?? null,
            effort: c.effort ?? null,
            result: c.result ?? null,
            climb_notes: c.climb_notes ?? null,
            wall: c.wall ?? null,
          }))
        )
        .select();
      if (error) throw error;
      climbs = (data ?? []) as Climb[];
    } else {
      climbs = [];
    }
  }

  // Strength sets (replace)
  let sets: StrengthSet[] | undefined;
  if (input.sets) {
    const now = new Date().toISOString();
    const { error: delErr } = await db
      .from("strength_sets")
      .update({ deleted_at: now })
      .eq("session_id", sessionId)
      .eq("user_id", userId)
      .is("deleted_at", null);
    if (delErr) throw delErr;

    if (input.sets.length > 0) {
      const { data, error } = await db
        .from("strength_sets")
        .insert(
          input.sets.map((s, i) => ({
            user_id: userId,
            session_id: sessionId,
            exercise_id: s.exercise_id ?? null,
            exercise_name: s.exercise_name,
            set_index: s.set_index ?? i,
            reps: s.reps ?? null,
            weight_kg: s.weight_kg ?? null,
            rpe: s.rpe ?? null,
          }))
        )
        .select();
      if (error) throw error;
      sets = (data ?? []) as StrengthSet[];
    } else {
      sets = [];
    }
  }

  await appendAdaptationLog(db, userId, "manual", "edit_session", {
    entity_type: "session",
    entity_id: sessionId,
    op: "update",
    before: {
      occurred_at: before.occurred_at,
      session_rpe: before.session_rpe,
      location: before.location,
      notes: before.notes,
    },
    after: patch,
    fields: [
      ...Object.keys(patch),
      ...(input.run ? ["run_details"] : []),
      ...(input.climbs ? ["climbs"] : []),
      ...(input.sets ? ["strength_sets"] : []),
    ],
  }, null);

  return {
    session: {
      ...session,
      ...(runDetails ? { run_details: runDetails } : {}),
      ...(climbs !== undefined ? { climbs } : {}),
      ...(sets !== undefined ? { strength_sets: sets } : {}),
    },
  };
}

export async function deleteSession(
  db: SupabaseClient,
  userId: string,
  sessionId: string
): Promise<{ deleted: true }> {
  const before = await getOwnedSession(db, userId, sessionId);

  const { error } = await db
    .from("sessions")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", sessionId)
    .eq("user_id", userId);
  if (error) throw error;

  // If this log had completed a prescribed session, reopen it so adherence
  // and plan state don't count a deleted workout.
  if (before.prescribed_session_id) {
    await db
      .from("prescribed_sessions")
      .update({ status: "planned", logged_session_id: null })
      .eq("id", before.prescribed_session_id)
      .eq("user_id", userId);
  }

  await appendAdaptationLog(db, userId, "manual", "delete_session", {
    entity_type: "session",
    entity_id: sessionId,
    op: "delete",
    before: { occurred_at: before.occurred_at, sport: before.sport },
    after: { deleted_at: "<set>" },
    fields: ["deleted_at"],
  }, null);

  return { deleted: true };
}
