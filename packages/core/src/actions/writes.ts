import { SupabaseClient } from "../db.js";
import type {
  RunLog,
  ClimbSession,
  StrengthLog,
  CheckIn,
  WeekSkeleton,
  Proposal,
  AdaptationLog,
} from "../types.js";

export type WriteMode = "apply" | "propose";

interface WriteResult<T> {
  mode: WriteMode;
  data?: T;
  proposal?: Proposal;
}

async function createProposal(
  db: SupabaseClient,
  userId: string,
  action: string,
  payload: Record<string, unknown>,
  rationale: string | null,
  source: "app-coach" | "desktop-mcp"
): Promise<Proposal> {
  const { data, error } = await db
    .from("proposals")
    .insert({
      user_id: userId,
      source,
      action,
      payload,
      rationale,
      status: "pending",
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function logAdaptation(
  db: SupabaseClient,
  userId: string,
  source: "app-coach" | "desktop-mcp" | "manual",
  action: string,
  diff: Record<string, unknown>,
  rationale: string | null,
  status: "applied" | "proposed"
): Promise<void> {
  const { error } = await db.from("adaptation_logs").insert({
    user_id: userId,
    source,
    action,
    diff,
    rationale,
    status,
  });
  if (error) throw error;
}

export async function logRun(
  db: SupabaseClient,
  userId: string,
  payload: Omit<RunLog, "id" | "user_id" | "pace_per_km">,
  mode: WriteMode = "apply",
  source: "app-coach" | "desktop-mcp" | "manual" = "manual"
): Promise<WriteResult<RunLog>> {
  const pace_per_km = payload.duration_seconds / 60 / payload.distance_km;
  const full = { ...payload, user_id: userId, pace_per_km };

  if (mode === "propose") {
    const proposal = await createProposal(db, userId, "log_run", full, null, source as "app-coach" | "desktop-mcp");
    return { mode: "propose", proposal };
  }

  const { data, error } = await db.from("run_logs").insert(full).select().single();
  if (error) throw error;
  await logAdaptation(db, userId, source, "log_run", full, null, "applied");
  return { mode: "apply", data };
}

export async function logClimbSession(
  db: SupabaseClient,
  userId: string,
  payload: Omit<ClimbSession, "id" | "user_id">,
  mode: WriteMode = "apply",
  source: "app-coach" | "desktop-mcp" | "manual" = "manual"
): Promise<WriteResult<ClimbSession>> {
  const { climbs, ...sessionFields } = payload;
  const full = { ...sessionFields, user_id: userId };

  if (mode === "propose") {
    const proposal = await createProposal(db, userId, "log_climb_session", { ...full, climbs }, null, source as "app-coach" | "desktop-mcp");
    return { mode: "propose", proposal };
  }

  const { data: session, error: sessionError } = await db
    .from("climb_sessions")
    .insert(full)
    .select()
    .single();
  if (sessionError) throw sessionError;

  if (climbs.length > 0) {
    const climbRows = climbs.map((c) => ({ ...c, session_id: session.id }));
    const { error: climbError } = await db.from("climbs").insert(climbRows);
    if (climbError) throw climbError;
  }

  await logAdaptation(db, userId, source, "log_climb_session", { session_id: session.id }, null, "applied");
  return { mode: "apply", data: { ...session, climbs } };
}

export async function logStrength(
  db: SupabaseClient,
  userId: string,
  payload: Omit<StrengthLog, "id" | "user_id">,
  mode: WriteMode = "apply",
  source: "app-coach" | "desktop-mcp" | "manual" = "manual"
): Promise<WriteResult<StrengthLog>> {
  const { sets, ...logFields } = payload;
  const full = { ...logFields, user_id: userId };

  if (mode === "propose") {
    const proposal = await createProposal(db, userId, "log_strength", { ...full, sets }, null, source as "app-coach" | "desktop-mcp");
    return { mode: "propose", proposal };
  }

  const { data: log, error: logError } = await db
    .from("strength_logs")
    .insert(full)
    .select()
    .single();
  if (logError) throw logError;

  if (sets.length > 0) {
    const setRows = sets.map((s) => ({ ...s, log_id: log.id }));
    const { error: setError } = await db.from("strength_sets").insert(setRows);
    if (setError) throw setError;
  }

  await logAdaptation(db, userId, source, "log_strength", { log_id: log.id }, null, "applied");
  return { mode: "apply", data: { ...log, sets } };
}

export async function logCheckin(
  db: SupabaseClient,
  userId: string,
  payload: Omit<CheckIn, "id" | "user_id">,
  mode: WriteMode = "apply"
): Promise<WriteResult<CheckIn>> {
  const full = { ...payload, user_id: userId };

  if (mode === "propose") {
    const proposal = await createProposal(db, userId, "log_checkin", full, null, "app-coach");
    return { mode: "propose", proposal };
  }

  const { data, error } = await db.from("check_ins").insert(full).select().single();
  if (error) throw error;
  return { mode: "apply", data };
}

export async function setWeekSkeleton(
  db: SupabaseClient,
  userId: string,
  slots: WeekSkeleton["slots"],
  mode: WriteMode = "apply",
  source: "app-coach" | "desktop-mcp" | "manual" = "manual"
): Promise<WriteResult<WeekSkeleton>> {
  if (mode === "propose") {
    const proposal = await createProposal(db, userId, "set_week_skeleton", { slots }, null, source as "app-coach" | "desktop-mcp");
    return { mode: "propose", proposal };
  }

  const { data, error } = await db
    .from("week_skeletons")
    .upsert({ user_id: userId, slots, updated_at: new Date().toISOString() }, { onConflict: "user_id" })
    .select()
    .single();
  if (error) throw error;
  await logAdaptation(db, userId, source, "set_week_skeleton", { slots }, null, "applied");
  return { mode: "apply", data };
}

export async function resolveProposal(
  db: SupabaseClient,
  userId: string,
  proposalId: string,
  resolution: "approved" | "rejected"
): Promise<void> {
  const { data: proposal, error: fetchError } = await db
    .from("proposals")
    .select("*")
    .eq("id", proposalId)
    .eq("user_id", userId)
    .single();
  if (fetchError) throw fetchError;

  const { error: updateError } = await db
    .from("proposals")
    .update({ status: resolution })
    .eq("id", proposalId);
  if (updateError) throw updateError;

  await logAdaptation(
    db,
    userId,
    "manual",
    `resolve_proposal:${resolution}`,
    { proposal_id: proposalId, original_action: proposal.action },
    null,
    resolution === "approved" ? "applied" : "proposed"
  );
}
