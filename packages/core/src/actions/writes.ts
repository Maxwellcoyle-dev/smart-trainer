import { SupabaseClient } from "../db.js";
import { applyDiff, invertDiff } from "./apply.js";
import {
  SORENESS_RESOLVE_THRESHOLD,
  RESOLVE_AFTER_CLEAR_CHECKINS,
  recoveryProgress,
  stepFlagDown,
} from "./policy.js";
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
  InjuryFlag,
  WeekSkeleton,
  SkeletonSlot,
  Goal,
  CreateGoalInput,
  UpdateGoalInput,
} from "../types.js";
import { getProfile } from "./reads.js";

// ─── Injury-flag policy ───────────────────────────────────────────────────────

/** Soreness severity at or above this value auto-opens/updates an injury_flag. */
export const SORENESS_FLAG_THRESHOLD = 5;

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
  raised_flags?: InjuryFlag[];
  resolved_flags?: InjuryFlag[];
  downgraded_flags?: InjuryFlag[];
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

  // ── Auto-flag pass (apply mode only) ─────────────────────────────────────

  // Scope: watch_list from profile; empty list → all body parts in scope.
  const profile = await getProfile(db, userId);
  const watchList: string[] = profile?.watch_list ?? [];

  // Fetch existing open flags once so we can match without extra round-trips.
  const { data: openFlags, error: flagFetchErr } = await db
    .from("injury_flags")
    .select("*")
    .eq("user_id", userId)
    .is("deleted_at", null)
    .neq("status", "resolved");
  if (flagFetchErr) throw flagFetchErr;

  const raisedFlags: InjuryFlag[] = [];

  for (const entry of entries) {
    // Only process parts that are in scope and meet the severity threshold.
    const inScope = watchList.length === 0 || watchList.includes(entry.body_part);
    if (!inScope || entry.severity < SORENESS_FLAG_THRESHOLD) continue;

    const existing = (openFlags ?? []).find(
      (f) => f.body_part === entry.body_part && f.side === entry.side
    );

    if (existing) {
      // Update: take max severity, append dated note to narrative.
      const newSeverity = Math.max(existing.severity ?? 0, entry.severity);
      const note = `\n[${input.check_in_date}] check-in soreness ${entry.severity}/10`;
      const { data: updated, error: updErr } = await db
        .from("injury_flags")
        .update({
          severity: newSeverity,
          narrative: (existing.narrative ?? "") + note,
        })
        .eq("id", existing.id)
        .select()
        .single();
      if (updErr) throw updErr;
      raisedFlags.push(updated as InjuryFlag);
    } else {
      // Insert: new flag at 'watch' status.
      const { data: inserted, error: insErr } = await db
        .from("injury_flags")
        .insert({
          user_id: userId,
          body_part: entry.body_part,
          side: entry.side,
          status: "watch",
          severity: entry.severity,
          onset_date: input.check_in_date,
          origin: source,
          narrative: `Auto-raised from check-in ${input.check_in_date} — ${entry.body_part} soreness ${entry.severity}/10`,
        })
        .select()
        .single();
      if (insErr) throw insErr;
      raisedFlags.push(inserted as InjuryFlag);
    }
  }

  // ── Recovery pass ────────────────────────────────────────────────────────
  // Only run on flags that were NOT raised/escalated by the raise pass above,
  // so we never both raise and resolve the same (body_part, side) in one check-in.
  const raisedKeys = new Set(raisedFlags.map((f) => `${f.body_part}:${f.side}`));

  const resolvedFlags: InjuryFlag[] = [];
  const downgradedFlags: InjuryFlag[] = [];

  const candidateFlags = (openFlags ?? []).filter(
    (f) => !raisedKeys.has(`${f.body_part}:${f.side}`)
  );

  for (const flag of candidateFlags) {
    // Fetch the last RESOLVE_AFTER_CLEAR_CHECKINS soreness entries for this
    // (body_part, side), ordered newest-first. Missing rows mean severity 0.
    const { data: recentRows, error: recentErr } = await db
      .from("soreness_entries")
      .select("severity, check_ins!inner(user_id, check_in_date)")
      .eq("check_ins.user_id", userId)
      .eq("body_part", flag.body_part)
      .eq("side", flag.side)
      .order("check_in_date", { referencedTable: "check_ins", ascending: false })
      .limit(RESOLVE_AFTER_CLEAR_CHECKINS);
    if (recentErr) throw recentErr;

    // Build the severity array newest-first. Count check-ins in the window
    // that have no entry at all as clear (severity 0). We know the current
    // check-in is included if a soreness entry exists; if the part wasn't
    // mentioned this check-in, it is implicitly clear and we insert a 0.
    const severities: number[] = (recentRows ?? []).map(
      (r) => (r as { severity: number }).severity
    );
    // If the current check-in had no soreness entry for this part, prepend 0.
    const currentEntryExists = entries.some(
      (e) => e.body_part === flag.body_part && e.side === flag.side
    );
    if (!currentEntryExists) {
      severities.unshift(0);
    }

    const progress = recoveryProgress(severities, SORENESS_RESOLVE_THRESHOLD, RESOLVE_AFTER_CLEAR_CHECKINS);
    if (progress < RESOLVE_AFTER_CLEAR_CHECKINS) continue;

    const { status: newStatus, resolved_date } = stepFlagDown(flag.status, input.check_in_date);
    const direction = `${flag.status}→${newStatus}`;
    const note = `\n[${input.check_in_date}] cleared ${RESOLVE_AFTER_CLEAR_CHECKINS} check-ins — ${direction}`;

    const updatePayload: Record<string, unknown> = {
      status: newStatus,
      narrative: (flag.narrative ?? "") + note,
    };
    if (resolved_date) updatePayload.resolved_date = resolved_date;

    const { data: updated, error: updErr } = await db
      .from("injury_flags")
      .update(updatePayload)
      .eq("id", flag.id)
      .select()
      .single();
    if (updErr) throw updErr;

    if (newStatus === "resolved") {
      resolvedFlags.push(updated as InjuryFlag);
    } else {
      downgradedFlags.push(updated as InjuryFlag);
    }
  }

  // Audit: one adaptation_log entry for the check-in (flags included in after).
  await appendAdaptationLog(
    db,
    userId,
    source,
    "log_check_in",
    {
      entity_type: "check_in+soreness_entries",
      entity_id: ci.id,
      op: "create",
      before: null,
      after: {
        check_in_id: ci.id,
        raised_flag_ids: raisedFlags.map((f) => f.id),
        resolved_flag_ids: resolvedFlags.map((f) => f.id),
        downgraded_flag_ids: downgradedFlags.map((f) => f.id),
      },
      fields: ["check_in_date", "soreness"],
    },
    null
  );

  return {
    mode: "apply",
    check_in: { ...ci, soreness_entries: entries },
    raised_flags: raisedFlags,
    resolved_flags: resolvedFlags,
    downgraded_flags: downgradedFlags,
  };
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

// ─── create_plan (scaffold a plan → phase → weeks) ────────────────────────────

export interface CreatePlanInput {
  name: string;
  start_date: string;   // ISO date (YYYY-MM-DD); ideally a Monday
  n_weeks: number;      // number of plan_weeks to scaffold
  intent?: string | null;
}

export interface CreatePlanResult {
  plan_id: string;
  phase_id: string;
  plan_week_ids: string[];
  log_id: string;
}

/**
 * Scaffold an active plan with one phase and `n_weeks` empty plan_weeks (Mondays
 * stepping weekly from start_date). This gives `fill_week` and the coach a target
 * to write prescribed sessions into. Any previously-active plan is marked
 * 'completed' so the "current plan" stays singular (getCurrentPlan uses single()).
 * Manual user action → direct apply + audit log.
 */
export async function createPlan(
  db: SupabaseClient,
  userId: string,
  input: CreatePlanInput,
  source: WriteSource = "manual"
): Promise<CreatePlanResult> {
  const nWeeks = Math.max(1, Math.floor(input.n_weeks));

  const start = new Date(input.start_date + "T00:00:00Z");
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + nWeeks * 7 - 1);
  const endDate = end.toISOString().slice(0, 10);

  // Keep "current plan" singular.
  await db
    .from("plans")
    .update({ status: "completed" })
    .eq("user_id", userId)
    .eq("status", "active");

  const { data: plan, error: planErr } = await db
    .from("plans")
    .insert({
      user_id: userId,
      name: input.name,
      status: "active",
      start_date: input.start_date,
      end_date: endDate,
      intent: input.intent ?? null,
    })
    .select("id")
    .single();
  if (planErr) throw planErr;

  const { data: phase, error: phaseErr } = await db
    .from("phases")
    .insert({
      user_id: userId,
      plan_id: plan.id,
      phase_index: 0,
      name: "Block 1",
      type: "base",
      intent: input.intent ?? null,
      start_date: input.start_date,
      end_date: endDate,
    })
    .select("id")
    .single();
  if (phaseErr) throw phaseErr;

  const weekRows = Array.from({ length: nWeeks }, (_, i) => {
    const ws = new Date(start);
    ws.setUTCDate(ws.getUTCDate() + i * 7);
    return {
      user_id: userId,
      phase_id: phase.id,
      week_index: i,
      start_date: ws.toISOString().slice(0, 10),
    };
  });
  const { data: weeks, error: weekErr } = await db
    .from("plan_weeks")
    .insert(weekRows)
    .select("id");
  if (weekErr) throw weekErr;
  const planWeekIds = (weeks ?? []).map((w) => (w as { id: string }).id);

  const logId = await appendAdaptationLog(
    db,
    userId,
    source,
    "create_plan",
    {
      entity_type: "plans",
      entity_id: plan.id,
      op: "create",
      before: null,
      after: { plan_id: plan.id, phase_id: phase.id, n_weeks: nWeeks },
      fields: ["name", "start_date", "end_date"],
    },
    `Created plan "${input.name}" (${nWeeks} weeks)`
  );

  return { plan_id: plan.id, phase_id: phase.id, plan_week_ids: planWeekIds, log_id: logId };
}

// ─── Goals (create / update / soft-delete) ────────────────────────────────────

/**
 * Build a before/after diff object limited to the keys that actually changed.
 * Pure function — easy to unit-test without a DB.
 */
export function buildGoalDiff(
  current: Record<string, unknown>,
  changes: Record<string, unknown>
): { before: Record<string, unknown>; after: Record<string, unknown>; fields: string[] } {
  const fields = Object.keys(changes);
  const before: Record<string, unknown> = {};
  for (const f of fields) before[f] = current[f];
  return { before, after: changes, fields };
}

export async function createGoal(
  db: SupabaseClient,
  userId: string,
  input: CreateGoalInput,
  source: WriteSource = "manual"
): Promise<Goal> {
  const { data, error } = await db
    .from("goals")
    .insert({
      user_id: userId,
      kind: input.kind,
      title: input.title,
      sport: input.sport ?? null,
      target_date: input.target_date ?? null,
      target: input.target ?? {},
      priority: input.priority ?? 1,
      notes: input.notes ?? null,
      status: "active",
    })
    .select()
    .single();
  if (error) throw error;
  const goal = data as Goal;

  await appendAdaptationLog(db, userId, source, "create_goal", {
    entity_type: "goals",
    entity_id: goal.id,
    op: "create",
    before: null,
    after: { goal_id: goal.id, kind: goal.kind, title: goal.title },
    fields: ["kind", "title", "sport", "target_date", "priority"],
  }, null);

  return goal;
}

export async function updateGoal(
  db: SupabaseClient,
  userId: string,
  goalId: string,
  changes: UpdateGoalInput,
  source: WriteSource = "manual"
): Promise<Goal> {
  const fields = Object.keys(changes).filter(
    (k) => (changes as Record<string, unknown>)[k] !== undefined
  );
  if (fields.length === 0) throw new Error("updateGoal: no changes provided");

  const { data: current, error: fetchErr } = await db
    .from("goals")
    .select("*")
    .eq("id", goalId)
    .eq("user_id", userId)
    .single();
  if (fetchErr) throw fetchErr;

  const defined: Record<string, unknown> = {};
  for (const f of fields) defined[f] = (changes as Record<string, unknown>)[f];

  const { before, after } = buildGoalDiff(current as Record<string, unknown>, defined);

  const { data: updated, error: upErr } = await db
    .from("goals")
    .update(defined)
    .eq("id", goalId)
    .eq("user_id", userId)
    .select()
    .single();
  if (upErr) throw upErr;

  await appendAdaptationLog(db, userId, source, "update_goal", {
    entity_type: "goals",
    entity_id: goalId,
    op: "update",
    before,
    after,
    fields,
  }, null);

  return updated as Goal;
}

export async function deleteGoal(
  db: SupabaseClient,
  userId: string,
  goalId: string,
  source: WriteSource = "manual"
): Promise<Goal> {
  const { data: current, error: fetchErr } = await db
    .from("goals")
    .select("*")
    .eq("id", goalId)
    .eq("user_id", userId)
    .single();
  if (fetchErr) throw fetchErr;

  const deletedAt = new Date().toISOString();
  const { data, error } = await db
    .from("goals")
    .update({ status: "abandoned", deleted_at: deletedAt })
    .eq("id", goalId)
    .eq("user_id", userId)
    .select()
    .single();
  if (error) throw error;

  const cur = current as Record<string, unknown>;
  await appendAdaptationLog(db, userId, source, "update_goal", {
    entity_type: "goals",
    entity_id: goalId,
    op: "update",
    before: { status: cur["status"], deleted_at: cur["deleted_at"] },
    after: { status: "abandoned", deleted_at: deletedAt },
    fields: ["status", "deleted_at"],
  }, "Goal soft-deleted");

  return data as Goal;
}
