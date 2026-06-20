import { SupabaseClient } from "../db.js";
import { applyDiff, invertDiff } from "./apply.js";
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
  Session,
  RunDetails,
  Climb,
  CheckIn,
  SorenessEntry,
  WeekSkeleton,
  SkeletonSlot,
} from "../types.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Append one entry to the immutable adaptation ledger. Returns the new log id. */
async function appendAdaptationLog(
  db: SupabaseClient,
  userId: string,
  source: WriteSource,
  action_type: string,
  diff: AdaptationDiff | AdaptationDiff[],
  rationale: string | null,
  extra?: { proposal_id?: string | null; reverts_log_id?: string | null }
): Promise<string> {
  const { data, error } = await db
    .from("adaptation_logs")
    .insert({
      user_id: userId,
      source,
      action_type,
      diff,
      rationale,
      proposal_id: extra?.proposal_id ?? null,
      reverts_log_id: extra?.reverts_log_id ?? null,
    })
    .select("id")
    .single();
  if (error) throw error;
  return (data as { id: string }).id;
}

async function createProposal(
  db: SupabaseClient,
  userId: string,
  source: WriteSource,
  action_type: string,
  diff: AdaptationDiff | AdaptationDiff[],
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

// ─── Resolve proposal (apply or reject) ───────────────────────────────────────

export interface ResolveResult {
  status: "approved" | "rejected";
  /** adaptation_logs id, when approved (the change actually applied). */
  log_id?: string;
}

export async function resolveProposal(
  db: SupabaseClient,
  userId: string,
  proposalId: string,
  resolution: "approved" | "rejected"
): Promise<ResolveResult> {
  const { data: proposal, error: fetchErr } = await db
    .from("proposals")
    .select("*")
    .eq("id", proposalId)
    .eq("user_id", userId)
    .single();
  if (fetchErr) throw fetchErr;
  if (proposal.status !== "pending") {
    throw new Error(`Proposal ${proposalId} is already ${proposal.status}`);
  }

  // Rejected: no domain change, nothing to apply or log.
  if (resolution === "rejected") {
    const { error } = await db
      .from("proposals")
      .update({ status: "rejected", resolved_at: new Date().toISOString() })
      .eq("id", proposalId);
    if (error) throw error;
    return { status: "rejected" };
  }

  // Approved: replay the proposal's diff against the domain, then record it in
  // the ledger with the originating source, so history + undo stay intact.
  const { diffs } = await applyDiff(
    db,
    userId,
    proposal.diff as AdaptationDiff | AdaptationDiff[]
  );

  const logId = await appendAdaptationLog(
    db,
    userId,
    proposal.source as WriteSource,
    proposal.action_type as string,
    diffs,
    (proposal.rationale as string | null) ?? null,
    { proposal_id: proposalId }
  );

  const { error: updateErr } = await db
    .from("proposals")
    .update({ status: "approved", resolved_at: new Date().toISOString() })
    .eq("id", proposalId);
  if (updateErr) throw updateErr;

  return { status: "approved", log_id: logId };
}

// ─── Undo an applied change ───────────────────────────────────────────────────

/**
 * Undo adaptation_logs[logId] by applying the inverse of its diff and appending
 * a new ledger entry that points back at the original (`reverts_log_id`). The
 * ledger stays append-only; the original is stamped `reverted_at`.
 */
export async function undoAdaptation(
  db: SupabaseClient,
  userId: string,
  logId: string
): Promise<{ undo_log_id: string }> {
  const { data: log, error } = await db
    .from("adaptation_logs")
    .select("*")
    .eq("id", logId)
    .eq("user_id", userId)
    .single();
  if (error) throw error;
  if (log.reverted_at) throw new Error(`Log ${logId} has already been undone`);

  const inverse = invertDiff(log.diff as AdaptationDiff | AdaptationDiff[]);
  await applyDiff(db, userId, inverse);

  const undoLogId = await appendAdaptationLog(
    db,
    userId,
    "manual",
    `undo:${log.action_type}`,
    inverse,
    `Undo of ${logId}`,
    { reverts_log_id: logId }
  );

  const { error: stampErr } = await db
    .from("adaptation_logs")
    .update({ reverted_at: new Date().toISOString() })
    .eq("id", logId);
  if (stampErr) throw stampErr;

  return { undo_log_id: undoLogId };
}

// ─── fill_week (skeleton → prescribed sessions) ───────────────────────────────

export interface FillWeekResult {
  mode: WriteMode;
  count: number;
  proposal?: Proposal;
  log_id?: string;
}

/**
 * Expand the user's active week skeleton into prescribed_sessions for one plan
 * week. This is the deterministic scaffold ("the frame Claude fills"); richer
 * per-session prescriptions come later from the coach via adjust_session.
 * In-app/hook callers use `propose`; Desktop may `apply` directly.
 */
export async function fillWeek(
  db: SupabaseClient,
  userId: string,
  planWeekId: string,
  mode: WriteMode = "propose",
  source: WriteSource = "app_coach"
): Promise<FillWeekResult> {
  const { data: week, error: weekErr } = await db
    .from("plan_weeks")
    .select("id, start_date")
    .eq("id", planWeekId)
    .eq("user_id", userId)
    .single();
  if (weekErr) throw weekErr;

  const { data: skeleton, error: skErr } = await db
    .from("week_skeletons")
    .select("id, skeleton_slots(*)")
    .eq("user_id", userId)
    .eq("is_active", true)
    .is("deleted_at", null)
    .maybeSingle();
  if (skErr) throw skErr;

  const slots: SkeletonSlot[] = (skeleton?.skeleton_slots ?? []) as SkeletonSlot[];
  const startDate = week.start_date as string | null;

  const diffs: AdaptationDiff[] = slots
    .filter((s) => s.sport !== "rest")
    .map((s) => {
      let scheduled_date: string | null = null;
      if (startDate) {
        const d = new Date(startDate + "T00:00:00Z");
        d.setUTCDate(d.getUTCDate() + s.day_of_week);
        scheduled_date = d.toISOString().slice(0, 10);
      }
      return {
        entity_type: "prescribed_sessions",
        entity_id: null,
        op: "create",
        before: null,
        after: {
          plan_week_id: planWeekId,
          day_of_week: s.day_of_week,
          scheduled_date,
          sport: s.sport,
          order_in_day: s.order_in_day,
          prescription: { kind: s.sport },
          status: "planned",
        },
        fields: ["sport", "day_of_week", "scheduled_date", "prescription"],
      };
    });

  const rationale = `Filled plan week from active skeleton (${diffs.length} sessions)`;

  if (mode === "propose") {
    const proposal = await createProposal(db, userId, source, "fill_week", diffs, rationale);
    return { mode: "propose", count: diffs.length, proposal };
  }

  const { diffs: applied } = await applyDiff(db, userId, diffs);
  const logId = await appendAdaptationLog(db, userId, source, "fill_week", applied, rationale);
  return { mode: "apply", count: diffs.length, log_id: logId };
}

// ─── adjust_session (edit a single prescribed session) ────────────────────────

export interface AdjustSessionResult {
  mode: WriteMode;
  proposal?: Proposal;
  log_id?: string;
}

export async function adjustSession(
  db: SupabaseClient,
  userId: string,
  prescribedSessionId: string,
  changes: Record<string, unknown>,
  mode: WriteMode = "propose",
  source: WriteSource = "app_coach",
  rationale: string | null = null
): Promise<AdjustSessionResult> {
  const fields = Object.keys(changes);
  if (fields.length === 0) throw new Error("adjustSession: no changes provided");

  const { data: current, error } = await db
    .from("prescribed_sessions")
    .select("*")
    .eq("id", prescribedSessionId)
    .eq("user_id", userId)
    .single();
  if (error) throw error;

  const before: Record<string, unknown> = {};
  for (const f of fields) before[f] = (current as Record<string, unknown>)[f];

  const diff: AdaptationDiff = {
    entity_type: "prescribed_sessions",
    entity_id: prescribedSessionId,
    op: "update",
    before,
    after: changes,
    fields,
  };

  if (mode === "propose") {
    const proposal = await createProposal(db, userId, source, "adjust_session", diff, rationale);
    return { mode: "propose", proposal };
  }

  const { diffs } = await applyDiff(db, userId, diff);
  const logId = await appendAdaptationLog(db, userId, source, "adjust_session", diffs, rationale);
  return { mode: "apply", log_id: logId };
}
