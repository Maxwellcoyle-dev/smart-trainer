import { SupabaseClient } from "../db.js";
import type {
  WriteMode,
  WriteSource,
  LogRunInput,
  LogClimbSessionInput,
  LogStrengthInput,
  LogCheckInInput,
  SkeletonSlotInput,
  AdaptationDiff,
  Proposal,
  AdaptationLog,
  Session,
  RunDetails,
  Climb,
  CheckIn,
  SorenessEntry,
  WeekSkeleton,
  SkeletonSlot,
} from "../types.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function appendAdaptationLog(
  db: SupabaseClient,
  userId: string,
  source: WriteSource,
  action_type: string,
  diff: AdaptationDiff,
  rationale: string | null,
  proposal_id?: string | null
): Promise<void> {
  const { error } = await db.from("adaptation_logs").insert({
    user_id: userId,
    source,
    action_type,
    diff,
    rationale,
    proposal_id: proposal_id ?? null,
  });
  if (error) throw error;
}

async function createProposal(
  db: SupabaseClient,
  userId: string,
  source: "app_coach" | "desktop_mcp",
  action_type: string,
  diff: AdaptationDiff,
  rationale: string | null
): Promise<Proposal> {
  const { data, error } = await db
    .from("proposals")
    .insert({ user_id: userId, source, action_type, diff, rationale, status: "pending" })
    .select()
    .single();
  if (error) throw error;
  return data;
}

// ─── Log a run ────────────────────────────────────────────────────────────────

export interface LogRunResult {
  mode: WriteMode;
  session?: Session & { run_details: RunDetails };
  proposal?: Proposal;
}

export async function logRun(
  db: SupabaseClient,
  userId: string,
  input: LogRunInput,
  mode: WriteMode = "apply",
  source: WriteSource = "manual"
): Promise<LogRunResult> {
  const diff: AdaptationDiff = {
    entity_type: "session+run_details",
    entity_id: null,
    op: "create",
    before: null,
    after: { ...input, sport: "run" },
    fields: ["occurred_at", "distance_m", "duration_s", "surface"],
  };

  if (mode === "propose") {
    const proposal = await createProposal(
      db, userId, source as "app_coach" | "desktop_mcp", "log_run", diff, null
    );
    return { mode: "propose", proposal };
  }

  const { data: session, error: sErr } = await db
    .from("sessions")
    .insert({
      user_id: userId,
      sport: "run",
      occurred_at: input.occurred_at,
      duration_s: input.duration_s,
      session_rpe: input.session_rpe ?? null,
      location: input.location ?? null,
      notes: input.notes ?? null,
      prescribed_session_id: input.prescribed_session_id ?? null,
    })
    .select()
    .single();
  if (sErr) throw sErr;

  const { data: rd, error: rdErr } = await db
    .from("run_details")
    .insert({
      session_id: session.id,
      user_id: userId,
      distance_m: input.distance_m,
      surface: input.surface,
      elevation_gain_m: input.elevation_gain_m ?? null,
    })
    .select()
    .single();
  if (rdErr) throw rdErr;

  // Link prescribed session status if provided
  if (input.prescribed_session_id) {
    await db
      .from("prescribed_sessions")
      .update({ status: "completed", logged_session_id: session.id })
      .eq("id", input.prescribed_session_id);
  }

  await appendAdaptationLog(db, userId, source, "log_run", {
    ...diff,
    entity_id: session.id,
    after: { session_id: session.id, distance_m: input.distance_m },
  }, null);

  return { mode: "apply", session: { ...session, run_details: rd } };
}

// ─── Log a climb session ──────────────────────────────────────────────────────

export interface LogClimbResult {
  mode: WriteMode;
  session?: Session & { climbs: Climb[] };
  proposal?: Proposal;
}

export async function logClimbSession(
  db: SupabaseClient,
  userId: string,
  input: LogClimbSessionInput,
  mode: WriteMode = "apply",
  source: WriteSource = "manual"
): Promise<LogClimbResult> {
  const diff: AdaptationDiff = {
    entity_type: "session+climbs",
    entity_id: null,
    op: "create",
    before: null,
    after: { ...input, sport: "climb", climb_count: input.climbs.length },
    fields: ["occurred_at", "climbs"],
  };

  if (mode === "propose") {
    const proposal = await createProposal(
      db, userId, source as "app_coach" | "desktop_mcp", "log_climb_session", diff, null
    );
    return { mode: "propose", proposal };
  }

  const { data: session, error: sErr } = await db
    .from("sessions")
    .insert({
      user_id: userId,
      sport: "climb",
      occurred_at: input.occurred_at,
      duration_s: input.duration_s ?? null,
      session_rpe: input.session_rpe ?? null,
      location: input.location ?? null,
      notes: input.notes ?? null,
      prescribed_session_id: input.prescribed_session_id ?? null,
    })
    .select()
    .single();
  if (sErr) throw sErr;

  let climbs: Climb[] = [];
  if (input.climbs.length > 0) {
    const rows = input.climbs.map((c, i) => ({
      user_id: userId,
      session_id: session.id,
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
    }));
    const { data, error } = await db.from("climbs").insert(rows).select();
    if (error) throw error;
    climbs = data ?? [];
  }

  if (input.prescribed_session_id) {
    await db
      .from("prescribed_sessions")
      .update({ status: "completed", logged_session_id: session.id })
      .eq("id", input.prescribed_session_id);
  }

  await appendAdaptationLog(db, userId, source, "log_climb_session", {
    ...diff, entity_id: session.id, after: { session_id: session.id, climb_count: climbs.length },
  }, null);

  return { mode: "apply", session: { ...session, climbs } };
}

// ─── Log strength ─────────────────────────────────────────────────────────────

export interface LogStrengthResult {
  mode: WriteMode;
  session?: Session;
  proposal?: Proposal;
}

export async function logStrength(
  db: SupabaseClient,
  userId: string,
  input: LogStrengthInput,
  mode: WriteMode = "apply",
  source: WriteSource = "manual"
): Promise<LogStrengthResult> {
  const diff: AdaptationDiff = {
    entity_type: "session+strength_sets",
    entity_id: null,
    op: "create",
    before: null,
    after: { ...input, sport: "strength" },
    fields: ["occurred_at", "sets"],
  };

  if (mode === "propose") {
    const proposal = await createProposal(
      db, userId, source as "app_coach" | "desktop_mcp", "log_strength", diff, null
    );
    return { mode: "propose", proposal };
  }

  const { data: session, error: sErr } = await db
    .from("sessions")
    .insert({
      user_id: userId,
      sport: "strength",
      occurred_at: input.occurred_at,
      duration_s: input.duration_s ?? null,
      session_rpe: input.session_rpe ?? null,
      notes: input.notes ?? null,
      prescribed_session_id: input.prescribed_session_id ?? null,
    })
    .select()
    .single();
  if (sErr) throw sErr;

  if (input.sets.length > 0) {
    const rows = input.sets.map((s) => ({
      user_id: userId,
      session_id: session.id,
      exercise_id: s.exercise_id ?? null,
      exercise_name: s.exercise_name,
      set_index: s.set_index,
      reps: s.reps ?? null,
      weight_kg: s.weight_kg ?? null,
      rpe: s.rpe ?? null,
    }));
    const { error } = await db.from("strength_sets").insert(rows);
    if (error) throw error;
  }

  if (input.prescribed_session_id) {
    await db
      .from("prescribed_sessions")
      .update({ status: "completed", logged_session_id: session.id })
      .eq("id", input.prescribed_session_id);
  }

  await appendAdaptationLog(db, userId, source, "log_strength", {
    ...diff, entity_id: session.id,
  }, null);

  return { mode: "apply", session };
}

// ─── Log check-in ─────────────────────────────────────────────────────────────

export interface LogCheckInResult {
  mode: WriteMode;
  check_in?: CheckIn & { soreness_entries: SorenessEntry[] };
  proposal?: Proposal;
}

export async function logCheckIn(
  db: SupabaseClient,
  userId: string,
  input: LogCheckInInput,
  mode: WriteMode = "apply",
  source: WriteSource = "manual"
): Promise<LogCheckInResult> {
  const diff: AdaptationDiff = {
    entity_type: "check_in+soreness_entries",
    entity_id: null,
    op: "create",
    before: null,
    after: { ...input },
    fields: ["check_in_date", "mood", "readiness", "soreness"],
  };

  if (mode === "propose") {
    const proposal = await createProposal(
      db, userId, source as "app_coach" | "desktop_mcp", "log_check_in", diff, null
    );
    return { mode: "propose", proposal };
  }

  const { data: ci, error: ciErr } = await db
    .from("check_ins")
    .upsert(
      {
        user_id: userId,
        check_in_date: input.check_in_date,
        sleep_hours: input.sleep_hours ?? null,
        sleep_quality: input.sleep_quality ?? null,
        bodyweight_kg: input.bodyweight_kg ?? null,
        mood: input.mood ?? null,
        readiness: input.readiness ?? null,
        notes: input.notes ?? null,
      },
      { onConflict: "user_id,check_in_date" }
    )
    .select()
    .single();
  if (ciErr) throw ciErr;

  let entries: SorenessEntry[] = [];
  if (input.soreness.length > 0) {
    // Delete existing soreness for this check-in and re-insert (handles re-logging same day)
    await db.from("soreness_entries").delete().eq("check_in_id", ci.id);
    const rows = input.soreness.map((s) => ({
      user_id: userId,
      check_in_id: ci.id,
      body_part: s.body_part,
      side: s.side ?? "na",
      severity: s.severity,
    }));
    const { data, error } = await db.from("soreness_entries").insert(rows).select();
    if (error) throw error;
    entries = data ?? [];
  }

  return { mode: "apply", check_in: { ...ci, soreness_entries: entries } };
}

// ─── Week skeleton ────────────────────────────────────────────────────────────

export interface SetWeekSkeletonResult {
  mode: WriteMode;
  skeleton?: WeekSkeleton & { skeleton_slots: SkeletonSlot[] };
  proposal?: Proposal;
}

export async function setWeekSkeleton(
  db: SupabaseClient,
  userId: string,
  slots: SkeletonSlotInput[],
  name = "My Week",
  mode: WriteMode = "apply",
  source: WriteSource = "manual"
): Promise<SetWeekSkeletonResult> {
  const diff: AdaptationDiff = {
    entity_type: "week_skeleton+skeleton_slots",
    entity_id: null,
    op: "update",
    before: null,
    after: { slots },
    fields: ["skeleton_slots"],
  };

  if (mode === "propose") {
    const proposal = await createProposal(
      db, userId, source as "app_coach" | "desktop_mcp", "set_week_skeleton", diff, null
    );
    return { mode: "propose", proposal };
  }

  // Deactivate any existing active skeleton
  await db
    .from("week_skeletons")
    .update({ is_active: false })
    .eq("user_id", userId)
    .eq("is_active", true);

  const { data: skeleton, error: skErr } = await db
    .from("week_skeletons")
    .insert({ user_id: userId, name, is_active: true })
    .select()
    .single();
  if (skErr) throw skErr;

  let slotRows: SkeletonSlot[] = [];
  if (slots.length > 0) {
    const rows = slots.map((s) => ({
      user_id: userId,
      skeleton_id: skeleton.id,
      day_of_week: s.day_of_week,
      sport: s.sport,
      order_in_day: s.order_in_day ?? 0,
      hint: s.hint ?? null,
    }));
    const { data, error } = await db.from("skeleton_slots").insert(rows).select();
    if (error) throw error;
    slotRows = data ?? [];
  }

  await appendAdaptationLog(db, userId, source, "set_week_skeleton", {
    ...diff, entity_id: skeleton.id, after: { skeleton_id: skeleton.id, slot_count: slotRows.length },
  }, null);

  return { mode: "apply", skeleton: { ...skeleton, skeleton_slots: slotRows } };
}

// ─── Resolve proposal ─────────────────────────────────────────────────────────

export async function resolveProposal(
  db: SupabaseClient,
  userId: string,
  proposalId: string,
  resolution: "approved" | "rejected"
): Promise<void> {
  const { data: proposal, error: fetchErr } = await db
    .from("proposals")
    .select("*")
    .eq("id", proposalId)
    .eq("user_id", userId)
    .single();
  if (fetchErr) throw fetchErr;

  const { error: updateErr } = await db
    .from("proposals")
    .update({ status: resolution, resolved_at: new Date().toISOString() })
    .eq("id", proposalId);
  if (updateErr) throw updateErr;

  if (resolution === "approved") {
    await appendAdaptationLog(
      db, userId, "manual", `resolve_proposal:approved`,
      {
        entity_type: "proposal",
        entity_id: proposalId,
        op: "update",
        before: { status: "pending" },
        after: { status: "approved" },
        fields: ["status"],
      },
      null,
      proposalId
    );
  }
}
